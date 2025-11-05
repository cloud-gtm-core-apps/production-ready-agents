import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import passport from "./auth";
import { storage } from "./storage";
import { insertUserSchema, type Conversation, type Message, type MenuItem, orderConversations } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { WebSocketServer, WebSocket } from "ws";
import { sessionMiddleware } from "./index";
import { randomUUID, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { users, oauthTokens, menuItemPopularityAggregates } from "@shared/schema";

// Middleware to check if user is authenticated
export const isAuthenticated = (req: any, res: any, next: any) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

// Encryption utilities for OAuth tokens
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'default-key-change-in-production';
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  // Derive a 32-byte key from the encryption key
  return scryptSync(ENCRYPTION_KEY, 'salt', 32);
}

function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation contexts for AI conversations
const aiConversationContexts = new Map<string, Array<{ role: 'system' | 'user' | 'assistant', content: string }>>();

// Debounce timers for automatic order detection (2 seconds after last message)
const orderDetectionTimers = new Map<string, NodeJS.Timeout>();

// Store active WebSocket connections per userId for broadcasting updates
const userWebSockets = new Map<string, Set<WebSocket>>();

// Cache for menu items with expiration (1 day)
interface MenuItemCache {
  items: Array<{ name: string; price: string; category: string | null }>;
  expiresAt: number;
}
const menuItemsCache = new Map<string, MenuItemCache>();

// Helper function to get menu items with caching (1 day cache)
async function getMenuItemsWithCache(userId: string): Promise<Array<{ name: string; price: string; category: string | null }>> {
  const cached = menuItemsCache.get(userId);
  const now = Date.now();

  // Check if cache exists and is still valid (1 day = 24 * 60 * 60 * 1000 ms)
  if (cached && cached.expiresAt > now) {
    console.log(`[Menu Cache] Using cached menu items for userId ${userId}`);
    return cached.items;
  }

  // Fetch fresh menu items from database
  console.log(`[Menu Cache] Fetching fresh menu items for userId ${userId}`);
  const menuItems = await storage.getMenuItems(userId);

  // Format for cache (only include needed fields)
  const formattedItems = menuItems.map(item => ({
    name: item.name,
    price: item.price,
    category: item.category
  }));

  // Cache for 1 day
  const expiresAt = now + (24 * 60 * 60 * 1000);
  menuItemsCache.set(userId, {
    items: formattedItems,
    expiresAt
  });

  return formattedItems;
}

// Helper function to convert relative time strings to absolute times
function convertRelativeTimeToAbsolute(timeStr: string, baseTime: Date = new Date()): string | null {
  const normalized = timeStr.toLowerCase().trim();

  // Check if it's already an absolute time format (contains AM/PM or : pattern)
  if (normalized.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i)) {
    // Already absolute time, return as-is (but ensure proper formatting)
    const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const period = match[3].toUpperCase();

      const hours12 = hours % 12 || 12;
      const minutesStr = minutes.toString().padStart(2, '0');
      return `${hours12}:${minutesStr} ${period}`;
    }
    return timeStr;
  }

  // Match patterns like "1 hour", "2 hours", "30 minutes", "15 min", "half an hour", etc.
  const hourMatch = normalized.match(/(\d+)\s*hour/i) || normalized.match(/half\s*an?\s*hour/i);
  const minuteMatch = normalized.match(/(\d+)\s*min(?:ute)?s?/i);

  const resultTime = new Date(baseTime);

  if (hourMatch) {
    const hours = normalized.includes('half') ? 0.5 : parseInt(hourMatch[1] || '0');
    resultTime.setTime(resultTime.getTime() + (hours * 60 * 60 * 1000));
  } else if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1] || '0');
    resultTime.setTime(resultTime.getTime() + (minutes * 60 * 1000));
  } else {
    // Not a relative time we can parse
    return null;
  }

  // Format as "HH:MM AM/PM"
  const hours = resultTime.getHours();
  const minutes = resultTime.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  const minutesStr = minutes.toString().padStart(2, '0');

  return `${hours12}:${minutesStr} ${ampm}`;
}

// Function to analyze conversation and detect if an order has been made
async function analyzeOrderFromConversation(
  messages: Message[],
  customerName?: string,
  menuItems?: Array<{ name: string; price: string; category: string | null }>
): Promise<{ orderMade: boolean; orderDetails?: { customerName: string; items: string[]; pickupTime?: string; notes?: string } }> {
  // Format conversation for AI analysis
  const conversationText = messages.map(msg => {
    const sender = msg.isOutgoing ? 'Customer' : 'Restaurant';
    return `${sender}: ${msg.text}`;
  }).join('\n');

  // Get current time to convert relative times
  const currentTime = new Date();
  const currentTimeString = currentTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Build menu context if menu items are provided
  let menuContext = '';
  if (menuItems && menuItems.length > 0) {
    // Group by category for better organization
    const byCategory = menuItems.reduce((acc, item) => {
      const category = item.category || 'Other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {} as Record<string, Array<{ name: string; price: string }>>);

    menuContext = '\n\nMENU ITEMS (use this to accurately identify and correlate items mentioned in the conversation):\n';
    Object.entries(byCategory).forEach(([category, items]) => {
      menuContext += `\n${category}:\n`;
      items.forEach(item => {
        menuContext += `  - ${item.name}: ${item.price}\n`;
      });
    });
    menuContext += '\nWhen extracting items from the conversation, match them to the menu items above. Use the exact menu item names when possible. Include the price from the menu for each item. If a customer mentions variations or customizations, include them in the item name (e.g., "Corn on the Cob (with butter): $3.50" or "2x Corn on the Cob: $7.00"). For items with quantities, calculate the total price (e.g., "2x Corn on the Cob: $7.00" if the price is $3.50 each).';
  }

  const systemPrompt = `You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.

IMPORTANT: Current time is ${currentTimeString}. When a pickup time is mentioned, you MUST convert it to an absolute time.${menuContext}

If an order has been placed, extract:
1. Customer name (if mentioned)
2. All items ordered (be specific, include quantities, prices, and customizations):
   - Match items mentioned in the conversation to the menu items provided above
   - Use exact menu item names when possible
   - Include the price from the menu for each item in the format: "Item Name: $X.XX"
   - For quantities, include quantity and calculate total price: "2x Item Name: $X.XX" (where $X.XX is the total for that quantity)
   - Include customizations or modifications in the item name: "Item Name (customization): $X.XX"
   - If an item is mentioned but not in the menu, still include it as mentioned (without price if unknown)
3. Pickup time (if mentioned):
   - If relative time is mentioned (e.g., "in 1 hour", "30 minutes", "15 min", "half an hour"), convert it to absolute time based on current time (${currentTimeString})
   - If absolute time is mentioned (e.g., "3:30 PM", "5pm"), use it as-is
   - Format as "HH:MM AM/PM" (e.g., "3:30 PM", "5:00 PM")
   - Example: If current time is 2:00 PM and customer says "in 1 hour", return "3:00 PM"
   - Example: If current time is 2:00 PM and customer says "in 30 minutes", return "2:30 PM"
4. Any special notes or instructions

Return ONLY a valid JSON object with this exact structure:
{
  "orderMade": true/false,
  "orderDetails": {
    "customerName": "string or null",
    "items": ["item 1: $X.XX", "item 2: $X.XX", ...],
    "pickupTime": "string in format 'HH:MM AM/PM' (e.g., '3:30 PM', '5:00 PM') or null",
    "notes": "string or null"
  }
}

If no order has been made, return: {"orderMade": false}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation:\n\n${conversationText}\n\nCustomer name from order info: ${customerName || 'unknown'}` }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = JSON.parse(completion.choices[0].message.content || '{"orderMade": false}');

    // Convert relative times to absolute times as a fallback if AI didn't convert it
    if (response.orderMade && response.orderDetails && response.orderDetails.pickupTime) {
      const originalTime = response.orderDetails.pickupTime;
      const convertedTime = convertRelativeTimeToAbsolute(response.orderDetails.pickupTime, currentTime);
      if (convertedTime) {
        response.orderDetails.pickupTime = convertedTime;
        console.log(`[Order Detection] Converted relative time "${originalTime}" to absolute time "${convertedTime}"`);
      }
    }

    return response;
  } catch (error) {
    console.error('Error analyzing order:', error);
    return { orderMade: false };
  }
}

// Function to format order details into AI organized message format
function formatOrderMessage(orderDetails: { customerName: string; items: string[]; pickupTime?: string; notes?: string }, menuItems?: Array<{ name: string; price: string; category: string | null }>): string {
  let message = `Customer: ${orderDetails.customerName}\n`;

  // Add each item on its own line with spacing
  // If items already have prices (from AI), use them as-is
  // Otherwise, try to match with menu items and add prices
  orderDetails.items.forEach((item) => {
    // Check if item already has a price in the format "Item: $X.XX"
    if (item.includes(':$') || item.includes(': $')) {
      // Item already has price, use as-is
      message += `\n${item}`;
    } else if (menuItems && menuItems.length > 0) {
      // Try to match item with menu items to add price
      let matched = false;

      // Look for quantity prefix (e.g., "2x ")
      const quantityMatch = item.match(/^(\d+)x\s*(.+)$/i);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
      const baseItemName = quantityMatch ? quantityMatch[2].trim() : item.trim();

      // Try exact match first
      for (const menuItem of menuItems) {
        if (menuItem.name.toLowerCase() === baseItemName.toLowerCase()) {
          const priceNum = parseFloat(menuItem.price.replace(/[^0-9.]/g, ''));
          const totalPrice = (priceNum * quantity).toFixed(2);
          const formattedItem = quantity > 1
            ? `${quantity}x ${menuItem.name}: $${totalPrice}`
            : `${menuItem.name}: ${menuItem.price}`;
          message += `\n${formattedItem}`;
          matched = true;
          break;
        }
      }

      // If no exact match, try partial match
      if (!matched) {
        for (const menuItem of menuItems) {
          if (baseItemName.toLowerCase().includes(menuItem.name.toLowerCase()) ||
            menuItem.name.toLowerCase().includes(baseItemName.toLowerCase())) {
            const priceNum = parseFloat(menuItem.price.replace(/[^0-9.]/g, ''));
            const totalPrice = (priceNum * quantity).toFixed(2);
            const formattedItem = quantity > 1
              ? `${quantity}x ${menuItem.name}: $${totalPrice}`
              : `${menuItem.name}: ${menuItem.price}`;
            message += `\n${formattedItem}`;
            matched = true;
            break;
          }
        }
      }

      // If still no match, use item as-is without price
      if (!matched) {
        message += `\n${item}`;
      }
    } else {
      // No menu items available, use item as-is
      message += `\n${item}`;
    }
  });

  // Add notes as a separate line if they exist
  if (orderDetails.notes && orderDetails.notes.trim()) {
    message += `\n\n${orderDetails.notes}`;
  }

  // Add pickup time with spacing (shown in AI organized bubble)
  if (orderDetails.pickupTime) {
    message += `\n\nPickup Time: ${orderDetails.pickupTime}`;
  }

  return message;
}

// Helper function to generate AI suggested response
async function generateAISuggestedResponse(
  messages: Message[],
  userId: string,
  orderId: string,
  ws?: WebSocket,
  shouldBroadcast: boolean = true
): Promise<string | null> {
  try {
    // Only generate suggestions when the last message is from the customer (not the owner)
    // isOutgoing: true = Customer messages, isOutgoing: false = Restaurant/Owner messages
    if (messages.length === 0) {
      return null; // No messages, nothing to suggest
    }

    // Get the last message (most recent)
    const lastMessage = messages[messages.length - 1];

    // Skip if last message is from restaurant/owner (isOutgoing: false)
    // Only generate suggestions for customer messages (isOutgoing: true)
    if (!lastMessage.isOutgoing) {
      console.log(`[AI Suggested Response] Skipping - last message is from restaurant/owner, not generating suggestion`);
      return null;
    }

    // Also skip AI organized messages (they're system messages, not customer messages)
    if ((lastMessage as any).isAIOrganized) {
      console.log(`[AI Suggested Response] Skipping - last message is AI organized message, not generating suggestion`);
      return null;
    }

    // Format conversation for AI analysis
    const conversationText = messages.map(msg => {
      const sender = msg.isOutgoing ? 'Customer' : 'Restaurant';
      return `${sender}: ${msg.text}`;
    }).join('\n');

    const systemPrompt = `You are helping a restaurant manager named Rod write responses to customers. Generate a short, natural, human-sounding response based on the conversation.

Guidelines:
- Keep it brief (under 40 words, ideally 10-20 words)
- Sound natural and casual, like a real person texting
- Be helpful but not overly excited or enthusiastic
- Use normal, everyday language - no exclamation points unless truly needed
- Match the tone of the conversation - if customer is casual, be casual
- Don't be overly formal or corporate-sounding
- Just provide the response text itself - no prefixes or labels

Think: "How would a real restaurant manager text back to a customer?" - natural, brief, helpful.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Conversation:\n${conversationText}\n\nGenerate a short response suggestion for Rod to send to the customer.` }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    const suggestedResponse = completion.choices[0].message.content?.trim() || '';

    if (suggestedResponse) {
      console.log(`[AI Suggested Response] Generated suggestion for order ${orderId}: ${suggestedResponse.substring(0, 50)}...`);

      // Broadcast to WebSocket connections only if shouldBroadcast is true
      if (shouldBroadcast) {
        const userWs = userWebSockets.get(userId);
        if (userWs && userWs.size > 0) {
          userWs.forEach((clientWs) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'ai_suggested_response',
                orderId: orderId,
                suggestion: suggestedResponse,
                timestamp: new Date().toISOString(),
              }));
            }
          });
          console.log(`[AI Suggested Response] ✓ Broadcasted to ${userWs.size} WebSocket connection(s) for order ${orderId}`);
        } else if (ws && ws.readyState === WebSocket.OPEN) {
          // Fallback to provided WebSocket
          ws.send(JSON.stringify({
            type: 'ai_suggested_response',
            orderId: orderId,
            suggestion: suggestedResponse,
            timestamp: new Date().toISOString(),
          }));
          console.log(`[AI Suggested Response] ✓ Sent via provided WebSocket for order ${orderId}`);
        }
      }

      return suggestedResponse;
    }

    return null;
  } catch (error) {
    console.error(`[AI Suggested Response] Error generating suggestion for order ${orderId}:`, error);
    // Don't throw - this is a non-critical feature
    return null;
  }
}

// Helper function to trigger debounced order detection
function triggerDebouncedOrderDetection(userId: string, orderId: string, ws?: WebSocket) {
  // Clear existing timer if any
  const existingTimer = orderDetectionTimers.get(orderId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer for 2 seconds
  const timer = setTimeout(async () => {
    console.log(`[Order Detection] Debounce timer expired for order ${orderId}, triggering analysis...`);
    await checkForOrderDetection(userId, orderId, ws);
    orderDetectionTimers.delete(orderId);
  }, 2000); // 2 second debounce

  orderDetectionTimers.set(orderId, timer);
  console.log(`[Order Detection] Debounce timer started for order ${orderId} (2 seconds)`);
}

// Helper function to check for order detection asynchronously
async function checkForOrderDetection(
  userId: string,
  orderId: string,
  ws?: WebSocket
): Promise<void> {
  // Log immediately to confirm function is called
  console.log(`[Order Detection] Function called for order ${orderId}, userId: ${userId}, hasWS: ${!!ws}`);

  // Return a promise that resolves after the delay and work is complete
  return new Promise((resolve) => {
    // Run asynchronously with a delay to ensure message is saved to database
    setTimeout(async () => {
      try {
        console.log(`[Order Detection] Starting check for order ${orderId}, userId: ${userId}`);

        const order = await storage.getOrderById(userId, orderId);

        if (!order) {
          console.log(`[Order Detection] Order ${orderId} not found, skipping`);
          resolve();
          return;
        }

        // Get all messages for the conversation
        const conversation = await storage.getOrderConversation(userId, orderId);
        if (!conversation) {
          console.log(`[Order Detection] No conversation found for order ${orderId}, skipping`);
          resolve();
          return;
        }

        const messages = (conversation.messages as Message[]) || [];
        console.log(`[Order Detection] Found ${messages.length} messages in conversation`);

        if (messages.length === 0) {
          console.log(`[Order Detection] No messages in conversation, skipping`);
          resolve();
          return;
        }

        // Check if there are any customer messages (isOutgoing: true)
        // If only restaurant messages exist, skip order detection (no customer input yet)
        const hasCustomerMessages = messages.some(msg => msg.isOutgoing === true);
        if (!hasCustomerMessages) {
          console.log(`[Order Detection] No customer messages in conversation yet, skipping (only restaurant messages)`);
          resolve();
          return;
        }

        // Check if there's an existing AI organized message
        // If it exists, check if there are new messages after it
        const allAIOrganizedMessages = messages.filter(msg => msg.isAIOrganized === true);
        const latestAIOrganizedMessage = allAIOrganizedMessages.length > 0
          ? allAIOrganizedMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
          : null;

        let hasNewMessages = false;

        if (latestAIOrganizedMessage) {
          // Find messages after the latest AI organized message
          const lastAITimestamp = new Date(latestAIOrganizedMessage.timestamp).getTime();
          const newMessages = messages.filter(msg =>
            new Date(msg.timestamp).getTime() > lastAITimestamp && !msg.isAIOrganized
          );

          if (newMessages.length === 0) {
            // No new messages after last AI organized message, skip analysis
            console.log(`[Order Detection] No new messages after last AI organized message, skipping analysis`);
            resolve();
            return;
          }

          hasNewMessages = true;
          console.log(`[Order Detection] Found ${newMessages.length} new messages after last AI organized message, will analyze full conversation and compare`);
        }

        // Get menu items with caching for context
        const menuItems = await getMenuItemsWithCache(userId);
        console.log(`[Order Detection] Retrieved ${menuItems.length} menu items for context`);

        // Analyze FULL conversation for order (need full context for AI to understand the order)
        console.log(`[Order Detection] Calling analyzeOrderFromConversation for order ${orderId}...`);
        const analysis = await analyzeOrderFromConversation(
          messages,
          order.firstName || undefined,
          menuItems
        );

        console.log(`[Order Detection] Analysis result for order ${orderId}:`, {
          orderMade: analysis.orderMade,
          hasDetails: !!analysis.orderDetails,
          pickupTime: analysis.orderDetails?.pickupTime,
          pickupTimeType: typeof analysis.orderDetails?.pickupTime
        });

        if (analysis.orderMade && analysis.orderDetails) {
          // If there's a previous AI organized message, compare the new analysis with it
          // Only create a new message if the order has actually changed
          if (latestAIOrganizedMessage && hasNewMessages) {
            // Parse the previous AI organized message to extract order details
            const previousText = latestAIOrganizedMessage.text;
            const newOrderMessageText = formatOrderMessage(analysis.orderDetails, menuItems);

            // Compare the formatted messages - if they're the same, order hasn't changed
            if (previousText === newOrderMessageText) {
              console.log(`[Order Detection] Order has not changed (exact match), skipping new AI organized message`);
              resolve();
              return;
            }

            // Do a more detailed comparison of order details
            // Extract items from previous message by parsing the formatted text
            // Items appear after "Customer:" line and before notes/pickup time
            const previousLines = previousText.split('\n').filter(line => line.trim());
            const previousItems: string[] = [];
            let foundCustomer = false;
            let inItemsSection = false;

            for (const line of previousLines) {
              const trimmed = line.trim();

              if (trimmed.toLowerCase().startsWith('customer:')) {
                foundCustomer = true;
                inItemsSection = true;
                continue;
              }

              if (foundCustomer && inItemsSection) {
                // Check if we've reached notes or pickup time section
                if (trimmed.toLowerCase().includes('pickup time:')) {
                  inItemsSection = false;
                  break;
                }

                // Items contain $ (price) or start with quantity (e.g., "2x ")
                // Skip empty lines and notes (notes don't have $ and don't start with quantity)
                if (trimmed && (trimmed.includes('$') || trimmed.match(/^\d+x\s+/i))) {
                  previousItems.push(trimmed);
                } else if (trimmed.length > 50 || (previousItems.length > 0 && !trimmed.includes('$') && !trimmed.match(/^\d+x\s+/i))) {
                  // Likely notes section, stop collecting items
                  inItemsSection = false;
                  break;
                }
              }
            }

            // Extract items from new analysis (these are the raw items from AI)
            const newItems = analysis.orderDetails.items || [];

            // Normalize items for comparison - extract just item name and quantity, ignore prices
            const normalizeItem = (item: string) => {
              // Remove price information (everything after : $ or :$)
              let normalized = item.trim()
                .replace(/:\s*\$[0-9.]+.*$/i, '') // Remove price and everything after
                .replace(/\s+/g, ' ') // Normalize whitespace
                .toLowerCase();

              // Extract quantity and item name (e.g., "2x burger" or "burger")
              const quantityMatch = normalized.match(/^(\d+)x\s*(.+)$/);
              if (quantityMatch) {
                const quantity = parseInt(quantityMatch[1]);
                const itemName = quantityMatch[2].trim();
                return `${quantity}x ${itemName}`;
              }

              return normalized.trim();
            };

            const previousItemsNormalized = previousItems.map(normalizeItem).sort();
            const newItemsNormalized = newItems.map(normalizeItem).sort();

            // Compare items
            const itemsChanged = JSON.stringify(previousItemsNormalized) !== JSON.stringify(newItemsNormalized);

            // Compare pickup time (normalize both to handle format variations)
            const previousPickupTimeMatch = previousText.match(/Pickup Time:\s*(.+?)(?:\n|$)/i);
            const previousPickupTime = previousPickupTimeMatch?.[1]?.trim() || null;
            const newPickupTime = analysis.orderDetails.pickupTime || null;
            const pickupTimeChanged = previousPickupTime !== newPickupTime;

            // Compare notes (if present)
            // Notes appear after items, before pickup time
            const notesMatch = previousText.match(/Customer:[\s\S]*?\n\n([\s\S]*?)(?:\n\nPickup Time:|$)/i);
            const previousNotes = notesMatch?.[1]?.trim() || null;
            // Clean up notes - remove any items that might have been captured
            const cleanedPreviousNotes = previousNotes && !previousNotes.includes('$') && !previousNotes.match(/^\d+x\s+/i)
              ? previousNotes
              : null;
            const newNotes = analysis.orderDetails.notes?.trim() || null;
            const notesChanged = cleanedPreviousNotes !== newNotes;

            console.log(`[Order Detection] Comparison results:`, {
              itemsChanged,
              pickupTimeChanged,
              notesChanged,
              previousItems: previousItemsNormalized,
              newItems: newItemsNormalized,
              previousItemsCount: previousItemsNormalized.length,
              newItemsCount: newItemsNormalized.length,
              previousPickupTime,
              newPickupTime,
              previousNotes: cleanedPreviousNotes,
              newNotes
            });

            // Only skip if nothing changed
            if (!itemsChanged && !pickupTimeChanged && !notesChanged) {
              console.log(`[Order Detection] Order details unchanged, skipping new AI organized message`);
              resolve();
              return;
            }

            console.log(`[Order Detection] Order has changed - items: ${itemsChanged}, pickup time: ${pickupTimeChanged}, notes: ${notesChanged}`);
          }

          // Check if pickup time is included in order details (handle various formats: string, null, undefined, "null" string)
          const pickupTimeValue = analysis.orderDetails.pickupTime;
          const hasPickupTime = pickupTimeValue &&
            pickupTimeValue !== null &&
            pickupTimeValue !== undefined &&
            String(pickupTimeValue).trim().toLowerCase() !== 'null' &&
            String(pickupTimeValue).trim().length > 0;

          console.log(`[Order Detection] Pickup time check for order ${orderId}:`, {
            pickupTime: analysis.orderDetails.pickupTime,
            hasPickupTime: hasPickupTime
          });

          // Create a NEW AI organized message bubble only if order changed
          {

            // Format and create NEW AI organized message
            const orderMessageText = formatOrderMessage(analysis.orderDetails, menuItems);
            console.log(`[Order Detection] Creating NEW AI organized message for order ${orderId}:`, orderMessageText.substring(0, 100));

            const orderMessage: Message = {
              id: randomUUID(), // Always generate new ID for new message bubble
              text: orderMessageText,
              isOutgoing: false,
              timestamp: new Date().toISOString(),
              isAIOrganized: true,
            };

            // Save the NEW AI organized message (adds to conversation, doesn't replace)
            console.log(`[Order Detection] Saving NEW AI organized message to database for order ${orderId}...`);
            await storage.addMessageToOrder(userId, orderId, orderMessage);

            // Update orderMade flag
            console.log(`[Order Detection] Setting orderMade=true for order ${orderId}...`);
            await storage.updateOrderMade(orderId, true);

            // If pickup time was included in order details, send it to frontend (don't save to DB)
            if (hasPickupTime) {
              console.log(`[Order Detection] Pickup time included in order details (${pickupTimeValue}), sending to frontend...`);

              // Set the flag so pickup time detection knows it was already found
              await storage.updatePickupTimeDetected(orderId, true);

              // Send detected pickup time to frontend via WebSocket (don't save to database)
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'pickup_time_detected',
                  orderId: orderId,
                  pickupTime: pickupTimeValue,
                  timestamp: new Date().toISOString(),
                }));
                console.log(`[Order Detection] ✓ Sent detected pickup time "${pickupTimeValue}" to frontend for order ${orderId}`);
              }
            } else {
              console.log(`[Order Detection] No pickup time in order details for order ${orderId}, pickupTimeDetected flag not set`);
            }

            console.log(`[Order Detection] ✓ Order detected and message saved successfully for order ${orderId}`);

            // ALWAYS broadcast new AI organized message to all active WebSocket connections
            // Send structured order data for auto-filling the form (message text is still saved but not displayed)
            const userWs = userWebSockets.get(userId);
            let broadcastSent = false;

            // Ensure orderDetails exists (it should at this point, but TypeScript needs the check)
            const orderDetails = analysis.orderDetails;
            if (orderDetails) {
              if (userWs && userWs.size > 0) {
                let sentCount = 0;
                userWs.forEach((clientWs) => {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: 'message_received',
                      text: orderMessageText,
                      timestamp: orderMessage.timestamp,
                      isAIOrganized: true,
                      orderId: orderId,
                      orderData: {
                        items: orderDetails.items,
                        notes: orderDetails.notes,
                        pickupTime: orderDetails.pickupTime,
                      },
                    }));
                    sentCount++;
                    broadcastSent = true;
                  }
                });
                console.log(`[Order Detection] ✓ Broadcasted AI organized message to ${sentCount} WebSocket connection(s) for order ${orderId}`);
              }

              // Also try provided WebSocket as fallback
              if (!broadcastSent && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'message_received',
                  text: orderMessageText,
                  timestamp: orderMessage.timestamp,
                  isAIOrganized: true,
                  orderId: orderId,
                  orderData: {
                    items: orderDetails.items,
                    notes: orderDetails.notes,
                    pickupTime: orderDetails.pickupTime,
                  },
                }));
                broadcastSent = true;
                console.log(`[Order Detection] ✓ Sent AI organized message via WebSocket for order ${orderId}`);
              }
            }

            if (!broadcastSent) {
              console.log(`[Order Detection] ⚠️ No active WebSocket connections for userId ${userId}, message saved to DB only`);
            }
          }
        } else {
          console.log(`[Order Detection] No order detected in conversation for order ${orderId}`);
        }

        // Resolve promise when order detection is complete
        resolve();
      } catch (error) {
        console.error(`[Order Detection] ERROR in order detection for order ${orderId}:`, error);
        if (error instanceof Error) {
          console.error(`[Order Detection] Error stack:`, error.stack);
        }
        // Resolve promise even on error
        resolve();
      }
    }, 500); // Delay to ensure database transaction is committed
  });
}

// Function to analyze conversation and detect pickup time
async function analyzePickupTimeFromConversation(
  messages: Message[]
): Promise<{ pickupTimeFound: boolean; pickupTime?: string }> {
  // Format conversation for AI analysis
  const conversationText = messages.map(msg => {
    const sender = msg.isOutgoing ? 'Customer' : 'Restaurant';
    return `${sender}: ${msg.text}`;
  }).join('\n');

  const systemPrompt = `You are a pickup time detection system for a restaurant. Analyze the conversation and extract any pickup time mentioned.

Look for:
1. Relative times: "15 minutes", "30 min", "1 hour", "in 20 minutes", "half an hour", etc.
2. Specific times: "3:30 PM", "5pm", "at 2:00", "by 4:15", etc.
3. Time expressions: "in 15", "15 mins", "30min", etc.

Convert relative times to specific times based on the current conversation context. For example:
- "15 minutes" from a message sent at 2:00 PM = 2:15 PM
- "1 hour" from a message sent at 3:00 PM = 4:00 PM

Return ONLY a valid JSON object with this exact structure:
{
  "pickupTimeFound": true/false,
  "pickupTime": "string in format 'HH:MM AM/PM' (e.g., '2:15 PM', '4:30 PM') or null",
  "relativeTime": "string if relative time mentioned (e.g., '15 minutes', '1 hour') or null"
}

If no pickup time is found, return: {"pickupTimeFound": false}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation for pickup time. Current time context: ${new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' })}\n\nConversation:\n${conversationText}` }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = JSON.parse(completion.choices[0].message.content || '{"pickupTimeFound": false}');

    if (response.pickupTimeFound && response.pickupTime) {
      return {
        pickupTimeFound: true,
        pickupTime: response.pickupTime
      };
    }

    return { pickupTimeFound: false };
  } catch (error) {
    console.error('Error analyzing pickup time:', error);
    return { pickupTimeFound: false };
  }
}

// Helper function to parse pickup time string (e.g., "2:30 PM") into a Date object
function parsePickupTimeString(timeStr: string): Date | null {
  try {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) {
      console.warn(`[Pickup Time] Could not parse pickup time string: ${timeStr}`);
      return null;
    }

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    // Create Date object for today with the specified time
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    return date;
  } catch (error) {
    console.error(`[Pickup Time] Error parsing pickup time: ${timeStr}`, error);
    return null;
  }
}

// Helper function to check for pickup time detection asynchronously
async function checkForPickupTimeDetection(
  userId: string,
  orderId: string,
  ws?: WebSocket
): Promise<void> {
  // Log immediately to confirm function is called
  console.log(`[Pickup Time Detection] Function called for order ${orderId}, userId: ${userId}, hasWS: ${!!ws}`);

  // Return a promise that resolves after the delay and work is complete
  return new Promise((resolve) => {
    // Run asynchronously with a delay to ensure message is saved to database
    setTimeout(async () => {
      try {
        console.log(`[Pickup Time Detection] Starting check for order ${orderId}, userId: ${userId}`);

        const order = await storage.getOrderById(userId, orderId);

        if (!order) {
          console.log(`[Pickup Time Detection] Order ${orderId} not found, skipping`);
          resolve();
          return;
        }

        // Skip if pickup time already detected
        // Note: We check pickupTimeDetected flag, NOT orderMade flag
        // This ensures pickup time detection runs even if order detection found an order but no pickup time
        if (order.pickupTimeDetected === true) {
          console.log(`[Pickup Time Detection] Order ${orderId} already has pickupTimeDetected=true, skipping`);
          resolve();
          return;
        }

        console.log(`[Pickup Time Detection] Order ${orderId} has pickupTimeDetected=${order.pickupTimeDetected}, orderMade=${order.orderMade}, proceeding with analysis`);

        // Get all messages for the conversation
        const conversation = await storage.getOrderConversation(userId, orderId);
        if (!conversation) {
          console.log(`[Pickup Time Detection] No conversation found for order ${orderId}, skipping`);
          resolve();
          return;
        }

        const messages = (conversation.messages as Message[]) || [];
        console.log(`[Pickup Time Detection] Found ${messages.length} messages in conversation`);

        if (messages.length === 0) {
          console.log(`[Pickup Time Detection] No messages in conversation, skipping`);
          resolve();
          return;
        }

        // Analyze conversation for pickup time
        console.log(`[Pickup Time Detection] Calling analyzePickupTimeFromConversation for order ${orderId}...`);
        const analysis = await analyzePickupTimeFromConversation(messages);

        console.log(`[Pickup Time Detection] Analysis result for order ${orderId}:`, {
          pickupTimeFound: analysis.pickupTimeFound,
          pickupTime: analysis.pickupTime
        });

        if (analysis.pickupTimeFound && analysis.pickupTime) {
          // Final check - make sure pickup time wasn't detected by another process
          const finalOrderCheck = await storage.getOrderById(userId, orderId);
          if (finalOrderCheck && finalOrderCheck.pickupTimeDetected === true) {
            console.log(`[Pickup Time Detection] Order ${orderId} pickup time was detected by another process, skipping`);
            resolve();
            return;
          }

          // Update pickupTimeDetected flag
          console.log(`[Pickup Time Detection] Setting pickupTimeDetected=true for order ${orderId}...`);
          await storage.updatePickupTimeDetected(orderId, true);

          // Send detected pickup time to frontend via WebSocket (don't save to database)
          console.log(`[Pickup Time Detection] Sending detected pickup time "${analysis.pickupTime}" to frontend for order ${orderId}...`);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'pickup_time_detected',
              orderId: orderId,
              pickupTime: analysis.pickupTime,
              timestamp: new Date().toISOString(),
            }));
            console.log(`[Pickup Time Detection] ✓ Sent detected pickup time "${analysis.pickupTime}" to frontend for order ${orderId}`);
          } else {
            console.log(`[Pickup Time Detection] WebSocket not available for order ${orderId}, pickup time will not be sent to frontend`);
          }

          console.log(`[Pickup Time Detection] ✓ Pickup time detected for order ${orderId} (will appear in order form when edited, not saved to DB)`);
        } else {
          console.log(`[Pickup Time Detection] No pickup time detected in conversation for order ${orderId}`);
        }

        // Resolve promise when pickup time detection is complete
        resolve();
      } catch (error) {
        console.error(`[Pickup Time Detection] ERROR in pickup time detection for order ${orderId}:`, error);
        if (error instanceof Error) {
          console.error(`[Pickup Time Detection] Error stack:`, error.stack);
        }
        resolve(); // Resolve even on error
      }
    }, 500); // Delay to ensure database transaction is committed
  });
}

// Random name generator for test conversations (Dearborn demographic)
const FIRST_NAMES = ['Fatima', 'Ahmed', 'Nour', 'Layla', 'Hassan', 'Zainab', 'Youssef', 'Rania', 'Omar', 'Maryam', 'Ali', 'Dina', 'Karim', 'Sara', 'Hadi', 'Mariam', 'Bilal', 'Lina', 'Tariq', 'Amira'];
const LAST_NAMES = ['Hassan', 'Ali', 'Bakri', 'Mansour', 'Khalil', 'Ahmad', 'Hammoud', 'Saleh', 'Ibrahim', 'Farah', 'Rahman', 'Mustafa', 'Nasser', 'Khoury', 'Masri', 'Saad'];

function generateRandomName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return { firstName, lastName };
}

function generateRandomPhoneNumber() {
  const prefix = '(313) 555-';
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}${suffix}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes

  // Signup route
  app.post("/api/auth/signup", async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);

      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.issues
        });
      }

      const { email, password } = result.data;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
      });

      // Log the user in after signup
      req.login(user, (err) => {
        if (err) {
          return next(err);
        }
        // Don't send password in response
        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json({ user: userWithoutPassword });
      });
    } catch (error) {
      next(error);
    }
  });

  // Login route
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Login failed" });
      }
      req.login(user, (err) => {
        if (err) {
          return next(err);
        }
        // Don't send password in response
        const { password: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
      });
    })(req, res, next);
  });

  // Logout route
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Session destruction failed" });
        }
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  // Get current user route
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) {
      const { password: _, ...userWithoutPassword } = req.user as any;
      res.json({ user: userWithoutPassword });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  // Menu routes

  // Get all menu items
  app.get("/api/menu-items", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const items = await storage.getMenuItems(userId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  // Get single menu item
  app.get("/api/menu-items/:itemId", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const { itemId } = req.params;
      const item = await storage.getMenuItemById(userId, itemId);

      if (!item) {
        return res.status(404).json({ message: 'Menu item not found' });
      }

      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  // Create menu item
  app.post("/api/menu-items", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const result = await storage.createMenuItem(userId, req.body);
      res.status(201).json(result);
    } catch (error: any) {
      // Return user-friendly error message for duplicate items
      if (error.message && error.message.includes('already exists')) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // Update menu item
  app.put("/api/menu-items/:itemId", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const { itemId } = req.params;
      const result = await storage.updateMenuItem(userId, itemId, req.body);
      res.json(result);
    } catch (error: any) {
      // Return user-friendly error message for duplicate items
      if (error.message && error.message.includes('already exists')) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // Delete menu item
  app.delete("/api/menu-items/:itemId", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const { itemId } = req.params;
      await storage.deleteMenuItem(userId, itemId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Orders routes

  // Get order counts for all statuses
  app.get("/api/orders/counts", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const counts = await storage.getOrderCounts(userId);
      res.json(counts);
    } catch (error) {
      next(error);
    }
  });

  // Get orders by status
  app.get("/api/orders/:status", isAuthenticated, async (req, res, next) => {
    try {
      const { status } = req.params;
      const userId = (req.user as any).id;

      // Validate status - handle both lowercase and capitalized
      const validStatuses = ['New', 'Confirmed', 'Ready', 'Completed'];
      const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

      if (!validStatuses.includes(capitalizedStatus)) {
        return res.status(400).json({ message: 'Invalid status' });
      }

      const ordersList = await storage.getOrdersByStatus(userId, capitalizedStatus as any);

      console.log(`[API] Fetching orders for status: ${capitalizedStatus}, found ${ordersList.length} orders`);

      // For each order, get its conversations from the orderConversations table
      const ordersWithConversations = await Promise.all(
        ordersList.map(async (order) => {
          // Get conversation row for this order
          const conversationRow = await storage.getOrderConversation(userId, order.id);

          // Get messages from the conversation row - keep timestamps as-is (ISO strings)
          const messages: Message[] = (conversationRow?.messages as Message[]) || [];

          // Format messages - keep timestamps exactly as stored
          const formattedMessages = messages.map((msg) => ({
            id: msg.id,
            text: msg.text,
            isOutgoing: msg.isOutgoing,
            timestamp: msg.timestamp, // Keep as ISO string, no conversion
            isAIOrganized: msg.isAIOrganized
          }));

          return {
            id: order.id,
            phoneNumber: order.number,
            lastMessage: order.lastMessage ? new Date(order.lastMessage).toISOString() : null, // Keep as ISO string
            customerName: order.firstName && order.lastName
              ? `${order.firstName} ${order.lastName}`
              : order.firstName || null,
            orderStatus: order.status?.toLowerCase(),
            orderCount: order.tag === 'VIP (8x)' ? 8 : parseInt(order.tag?.charAt(0) || '1'),
            messages: formattedMessages,
            orderDetails: order.orderPrice ? {
              items: order.items || [],
              pickupTime: order.pickupTime ? new Date(order.pickupTime).toISOString() : null, // Keep as ISO string
              pickupTimestamp: order.pickupTime ? new Date(order.pickupTime).getTime() : null, // Keep as timestamp number
              total: order.orderPrice,
              notes: order.notes || ''
            } : undefined
          };
        })
      );

      console.log(`[API] Returning ${ordersWithConversations.length} orders with conversations`);
      res.json(ordersWithConversations);
    } catch (error) {
      console.error('[API] Error fetching orders:', error);
      next(error);
    }
  });


  // Send order to preparation (update status, create customer, stats, history)
  app.post("/api/orders/:orderId/send-to-preparation", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;
      const { orderDetails } = req.body;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // 1. Find or create customer
      let customer = await storage.getCustomerByPhoneNumber(userId, order.number);

      if (!customer) {
        // Create new customer
        const nameParts = (order.firstName && order.lastName)
          ? { firstName: order.firstName, lastName: order.lastName }
          : (order.firstName
            ? { firstName: order.firstName, lastName: null }
            : { firstName: null, lastName: null });

        customer = await storage.createCustomer(userId, {
          userId: userId,
          phoneNumber: order.number,
          firstName: nameParts.firstName || null,
          lastName: nameParts.lastName || null,
        });
      }

      // 2. Create or update customer stats
      let customerStat = await storage.getCustomerStats(customer.id);
      const totalSpent = parseFloat(orderDetails?.total || order.orderPrice || '0');

      if (!customerStat) {
        // Create new stats
        await storage.createCustomerStats(customer.id, {
          customerId: customer.id,
          totalOrders: 1,
          totalSpent: totalSpent.toString(),
          lastOrderDate: new Date(),
        });
      } else {
        // Update existing stats
        const newTotalOrders = (customerStat.totalOrders || 0) + 1;
        const newTotalSpent = parseFloat(customerStat.totalSpent || '0') + totalSpent;
        await storage.updateCustomerStats(customer.id, {
          totalOrders: newTotalOrders,
          totalSpent: newTotalSpent.toFixed(2),
          lastOrderDate: new Date(),
        });
      }

      // 3. Create order history entry
      const orderHistoryEntry = await storage.createOrderHistory({
        customerId: customer.id,
        orderSummary: orderDetails || {
          items: order.items || [],
          total: order.orderPrice || '0',
          pickupTime: order.pickupTime?.toISOString() || null,
          notes: order.notes || null,
        },
        notes: orderDetails?.notes || order.notes || null,
        status: 'Confirmed',
      });

      // Trigger refresh of popularity aggregates for this order's date
      try {
        const orderDate = new Date(orderHistoryEntry.createdAt);
        const startDate = new Date(orderDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(orderDate);
        endDate.setHours(23, 59, 59, 999);
        await storage.refreshMenuItemPopularityAggregates(userId, startDate, endDate);
      } catch (error) {
        console.error('Error refreshing aggregates after order creation:', error);
        // Don't fail the request if aggregate refresh fails
      }

      // 4. Update order status, price, pickup time, items, and notes
      const updateData: { orderPrice?: string; items?: string[]; notes?: string; pickupTime?: Date } = {};

      if (orderDetails?.total) {
        updateData.orderPrice = orderDetails.total;
      }

      if (orderDetails?.items && orderDetails.items.length > 0) {
        updateData.items = orderDetails.items;
      }

      if (orderDetails?.notes !== undefined) {
        updateData.notes = orderDetails.notes || null;
      }

      if (orderDetails?.pickupTime) {
        // Parse pickup time string to Date
        // Handle formats like "3:30 PM" or ISO string
        try {
          let pickupTimeDate: Date;
          if (orderDetails.pickupTime.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
            // Format: "3:30 PM" - need to convert to Date
            const timeMatch = orderDetails.pickupTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (timeMatch) {
              let hours = parseInt(timeMatch[1]);
              const minutes = parseInt(timeMatch[2]);
              const period = timeMatch[3].toUpperCase();

              if (period === 'PM' && hours !== 12) hours += 12;
              if (period === 'AM' && hours === 12) hours = 0;

              const now = new Date();
              pickupTimeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
            } else {
              pickupTimeDate = new Date(orderDetails.pickupTime);
            }
          } else {
            pickupTimeDate = new Date(orderDetails.pickupTime);
          }
          updateData.pickupTime = pickupTimeDate;
        } catch (error) {
          console.error('Error parsing pickup time:', error);
        }
      }

      // Update order details (price, items, notes, pickup time)
      if (Object.keys(updateData).length > 0) {
        await storage.updateOrderDetails(orderId, updateData);
      }

      // Update order status to Confirmed
      await storage.updateOrderStatus(orderId, 'Confirmed');

      // 5. Create order in Clover (if Clover is connected)
      try {
        const tokenRecord = await db.select()
          .from(oauthTokens)
          .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
          .limit(1);

        if (tokenRecord[0]) {
          // Decrypt the access token
          let accessToken = process.env.MERCHENT_API_KEY || "";
          // try {
          //   accessToken = decrypt(tokenRecord[0].accessToken);
          // } catch (error) {
          //   // Fallback to env var if decryption fails
          //   accessToken = process.env.MERCHENT_API_KEY || "";
          // }


          const merchantId = tokenRecord[0].merchantId || 'H4RW04034BGH1';

          // Get menu items to match with Clover items
          const menuItems = await storage.getMenuItems(userId);

          // Parse order items and create line items for Clover
          const lineItems: Array<{
            item?: { id?: string; name?: string };
            name?: string;
            price?: number;
            unitQty?: number;
          }> = [];

          const orderItems = orderDetails?.items || order.items || [];

          // Skip Clover order creation if no items
          if (orderItems.length === 0) {
            console.log(`[Clover] Skipping Clover order creation - no items in order`);
          } else {

            for (const itemStr of orderItems) {
              // Parse item string (e.g., "2x Classic Elote Cup: $8.99" or "Classic Elote Cup: $8.99")
              const quantityMatch = itemStr.match(/^(\d+)x\s*(.+)$/i);
              const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
              const itemNameWithPrice = quantityMatch ? quantityMatch[2] : itemStr;

              // Extract price if present
              // Note: When quantity > 1, the price shown is the TOTAL price (e.g., "2x Item: $17.98" means $17.98 total)
              const priceMatch = itemNameWithPrice.match(/:\s*\$([\d.]+)/);
              const totalPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

              // Remove price from item name
              const itemName = itemNameWithPrice.replace(/:\s*\$[\d.]+.*$/, '').trim();

              // Calculate unit price
              let unitPrice: number;
              if (totalPrice !== null) {
                unitPrice = totalPrice / quantity; // Divide total by quantity to get unit price
              } else {
                // If no price found, try to get from menu items or default
                const matchingMenuItem = menuItems.find(mi =>
                  mi.name.toLowerCase() === itemName.toLowerCase() ||
                  itemName.toLowerCase().includes(mi.name.toLowerCase())
                );

                if (matchingMenuItem) {
                  unitPrice = parseFloat(matchingMenuItem.price.replace(/[^0-9.]/g, ''));
                } else {
                  // Default price if none found ($9.99)
                  unitPrice = 9.99;
                }
              }

              // Create separate line items for each quantity
              // Note: unitQty is only for items priced PER_UNIT (with scaling factor 1000)
              // For regular items with quantities, we create separate line items
              for (let i = 0; i < quantity; i++) {
                const lineItem: any = {
                  name: itemName,
                  price: Math.round(unitPrice * 100), // Price in cents (unit price, not total)
                };

                // Ensure price is valid (positive integer)
                if (lineItem.price > 0) {
                  lineItems.push(lineItem);
                } else {
                  console.warn(`[Clover] Skipping line item with invalid price: ${itemName} (price: ${lineItem.price})`);
                }
              }
            }

            // Create atomic order payload according to Clover API
            // Clover atomic order expects a "cart" object with lineItems
            const atomicOrderPayload: any = {
              orderCart: {
                lineItems: lineItems,
              },
            };

            // Add title if customer name is available
            if (order.firstName || order.lastName) {
              atomicOrderPayload.title = `Order from ${order.firstName || ''} ${order.lastName || ''}`.trim();
            }

            // Add notes if available
            if (orderDetails?.notes || order.notes) {
              atomicOrderPayload.note = orderDetails?.notes || order.notes || undefined;
            }

            // Ensure we have line items before creating order
            if (lineItems.length === 0) {
              console.log(`[Clover] Skipping Clover order creation - no valid line items parsed`);
            } else {
              console.log(`[Clover] Creating atomic order for merchant ${merchantId} with ${lineItems.length} items`);
              console.log(`[Clover] Atomic order payload:`, JSON.stringify(atomicOrderPayload, null, 2));

              // Create the atomic order in Clover
              const cloverResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/atomic_order/orders`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(atomicOrderPayload),
              });

              if (cloverResponse.ok) {
                const cloverOrder = await cloverResponse.json();
                console.log(`[Clover] ✓ Successfully created order ${cloverOrder.id} in Clover`);
              } else {
                const errorText = await cloverResponse.text();
                console.error(`[Clover] Failed to create order in Clover (${cloverResponse.status}):`, errorText);
                // Don't fail the request if Clover creation fails
              }
            }
          }
        }
      } catch (error) {
        console.error('[Clover] Error creating order in Clover:', error);
        // Don't fail the request if Clover creation fails - order is still saved locally
      }

      // 6. Send confirmation message to customer
      try {
        const confirmationMessageId = randomUUID();
        const confirmationMessage: Message = {
          id: confirmationMessageId,
          text: 'Your order has been confirmed',
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save confirmation message to database
        await storage.addMessageToOrder(userId, orderId, confirmationMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        // Broadcast confirmation message to all connected WebSocket clients for this user
        const userWs = userWebSockets.get(userId);
        if (userWs && userWs.size > 0) {
          let sentCount = 0;
          userWs.forEach((clientWs) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'message_received',
                messageId: confirmationMessageId,
                text: confirmationMessage.text,
                timestamp: confirmationMessage.timestamp,
                isOutgoing: false,
                orderId: orderId,
              }));
              sentCount++;
            }
          });
          console.log(`[Send to Preparation] ✓ Broadcasted confirmation message to ${sentCount} WebSocket connection(s) for order ${orderId}`);
        }
      } catch (error) {
        console.error('[Send to Preparation] Error sending confirmation message:', error);
        // Don't fail the request if message sending fails
      }

      res.json({
        success: true,
        message: 'Order sent to preparation successfully',
        customerId: customer.id
      });
    } catch (error) {
      console.error('Error sending order to preparation:', error);
      next(error);
    }
  });

  // Mark order as ready for pickup
  app.post("/api/orders/:orderId/mark-ready", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Update order status to Ready
      await storage.updateOrderStatus(orderId, 'Ready');

      // Find the customer for this order
      const customer = await storage.getCustomerByPhoneNumber(userId, order.number);
      if (customer) {
        // Get the latest order history entry for this customer
        const latestHistory = await storage.getLatestOrderHistoryByCustomer(customer.id);
        if (latestHistory) {
          // Update the latest order history status to Ready
          await storage.updateOrderHistory(latestHistory.id, {
            status: 'Ready',
          });
          console.log(`[Mark Ready] Updated order history ${latestHistory.id} to Ready for customer ${customer.id}`);
        } else {
          console.log(`[Mark Ready] No order history found for customer ${customer.id}`);
        }
      } else {
        console.log(`[Mark Ready] No customer found for order ${orderId} with phone ${order.number}`);
      }

      // Send ready for pickup message to customer
      try {
        const readyMessageId = randomUUID();
        const readyMessage: Message = {
          id: readyMessageId,
          text: 'Your order is ready for pickup',
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save ready message to database
        await storage.addMessageToOrder(userId, orderId, readyMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        // Broadcast ready message to all connected WebSocket clients for this user
        const userWs = userWebSockets.get(userId);
        if (userWs && userWs.size > 0) {
          let sentCount = 0;
          userWs.forEach((clientWs) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'message_received',
                messageId: readyMessageId,
                text: readyMessage.text,
                timestamp: readyMessage.timestamp,
                isOutgoing: false,
                orderId: orderId,
              }));
              sentCount++;
            }
          });
          console.log(`[Mark Ready] ✓ Broadcasted ready message to ${sentCount} WebSocket connection(s) for order ${orderId}`);
        }
      } catch (error) {
        console.error('[Mark Ready] Error sending ready message:', error);
        // Don't fail the request if message sending fails
      }

      res.json({ success: true, message: 'Order marked as ready' });
    } catch (error) {
      console.error('Error marking order as ready:', error);
      next(error);
    }
  });

  // Mark order as picked up (completed)
  app.post("/api/orders/:orderId/mark-picked-up", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Update order status to Completed and update lastMessage to track completion date
      await storage.updateOrderStatus(orderId, 'Completed');
      await storage.updateOrderLastMessage(orderId, new Date());

      // Find the customer for this order
      const customer = await storage.getCustomerByPhoneNumber(userId, order.number);
      if (customer) {
        // Get the latest order history entry for this customer
        const latestHistory = await storage.getLatestOrderHistoryByCustomer(customer.id);
        if (latestHistory) {
          // Update the latest order history status to Completed
          await storage.updateOrderHistory(latestHistory.id, {
            status: 'Completed',
          });
          console.log(`[Mark Picked Up] Updated order history ${latestHistory.id} to Completed for customer ${customer.id}`);
        } else {
          console.log(`[Mark Picked Up] No order history found for customer ${customer.id}`);
        }
      } else {
        console.log(`[Mark Picked Up] No customer found for order ${orderId} with phone ${order.number}`);
      }

      res.json({ success: true, message: 'Order marked as picked up' });
    } catch (error) {
      console.error('Error marking order as picked up:', error);
      next(error);
    }
  });

  // Get order history with pagination
  app.get("/api/order-history", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await storage.getOrderHistoryPaginated(userId, page, limit);

      res.json(result);
    } catch (error) {
      console.error('Error fetching order history:', error);
      next(error);
    }
  });

  // Delete an order
  app.delete("/api/orders/:orderId", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      await storage.deleteOrder(userId, orderId);
      res.json({ message: 'Order deleted successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Generate AI suggested response for a conversation
  app.post("/api/orders/:orderId/generate-suggestion", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Get the conversation
      const conversation = await storage.getOrderConversation(userId, orderId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const messages = (conversation.messages as Message[]) || [];

      // Generate AI suggested response (don't broadcast via WebSocket, just return it)
      const suggestedResponse = await generateAISuggestedResponse(messages, userId, orderId, undefined, false);

      // Return in API response - client will display it directly
      res.json({ success: true, suggestion: suggestedResponse });
    } catch (error) {
      console.error('Error generating AI suggested response:', error);
      next(error);
    }
  });

  // Send a message to an order conversation
  app.post("/api/orders/:orderId/message", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const { message } = req.body;
      const userId = (req.user as any).id;

      if (!message || !message.trim()) {
        return res.status(400).json({ message: 'Message is required' });
      }

      // Get the order to find the phone number
      const order = await storage.getOrderById(userId, orderId);

      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Save Rod's message to the database
      // isOutgoing: false = restaurant messages (Rod's messages)
      const rodMessage: Message = {
        id: randomUUID(),
        text: message.trim(),
        isOutgoing: false,
        timestamp: new Date().toISOString(),
      };
      await storage.addMessageToOrder(userId, orderId, rodMessage);
      await storage.updateOrderLastMessage(orderId, new Date());

      // Trigger debounced order detection after Rod's message
      triggerDebouncedOrderDetection(userId, orderId);

      // Generate AI suggested response asynchronously
      (async () => {
        try {
          const conversation = await storage.getOrderConversation(userId, orderId);
          if (conversation) {
            const allMessages = (conversation.messages as Message[]) || [];
            await generateAISuggestedResponse(allMessages, userId, orderId);
            console.log("AI suggested response generated");
          }
        } catch (error) {
          console.error(`[REST API] Error generating AI suggested response:`, error);
        }
      })();

      // Check if this is an AI test conversation
      const context = aiConversationContexts.get(orderId);

      if (context) {
        // This is an AI conversation, get AI response
        // Add Rod's message to context
        context.push({
          role: 'user',
          content: `Rod (restaurant manager) says: ${message.trim()}`
        });

        // Get AI response
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: context,
          temperature: 0.9,
          max_tokens: 150,
        });

        const aiResponse = completion.choices[0].message.content || "Thanks!";

        // Add AI response to context
        context.push({
          role: 'assistant',
          content: aiResponse
        });

        // Save AI response to database
        // isOutgoing: true = customer messages (AI responses)
        const aiMessage: Message = {
          id: randomUUID(),
          text: aiResponse,
          isOutgoing: true,
          timestamp: new Date().toISOString(),
        };
        await storage.addMessageToOrder(userId, orderId, aiMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        // Trigger debounced order detection after AI response
        triggerDebouncedOrderDetection(userId, orderId);

        // Generate AI suggested response asynchronously
        (async () => {
          try {
            const conversation = await storage.getOrderConversation(userId, orderId);
            if (conversation) {
              const allMessages = (conversation.messages as Message[]) || [];
              await generateAISuggestedResponse(allMessages, userId, orderId);
              console.log("AI suggested response generated");
            }
          } catch (error) {
            console.error(`[REST API] Error generating AI suggested response:`, error);
          }
        })();
      } else {
        // Regular chat (non-AI) - customer messages come from external sources
        // Trigger debounced order detection when customer messages are received
        triggerDebouncedOrderDetection(userId, orderId);

        // Generate AI suggested response asynchronously
        (async () => {
          try {
            const conversation = await storage.getOrderConversation(userId, orderId);
            if (conversation) {
              const allMessages = (conversation.messages as Message[]) || [];
              await generateAISuggestedResponse(allMessages, userId, orderId);
            }
          } catch (error) {
            console.error(`[REST API] Error generating AI suggested response:`, error);
          }
        })();
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // AI Test Conversation routes

  // Start a new test conversation
  app.post("/api/test-conversation/start", async (req, res) => {
    try {
      const conversationId = `test-${Date.now()}`;
      const customerNames = ['Sarah', 'Mike', 'Emma', 'David', 'Olivia', 'James'];
      const randomName = customerNames[Math.floor(Math.random() * customerNames.length)];

      // Initialize conversation context
      const systemPrompt = `You are a customer named ${randomName} texting Corn on the Corner, a street food vendor in Dearborn, Michigan. You want to place an order for corn-based menu items.

Menu items available:
- Classic Elote Cup ($8.99)
- Buffalo Ranch Elote ($9.99)
- Flamin Hot Cheetos Elote ($10.99)
- Bacon Cheddar Elote ($11.99)
- Nacho Cheese Elote ($9.99)
- Corn Ribs ($7.99)
- Street Corn Dog ($6.99)
- Churro Bites ($5.99)
- Tajin Fries ($4.99)

You should:
1. Text casually like a real customer (informal, brief messages)
2. Start by introducing yourself and placing an order
3. Mention when you want to pick it up (e.g., "15 minutes", "20 min", "in half an hour")
4. Be natural and friendly
5. Keep messages short and realistic
6. Respond naturally to Rod (the manager) when he replies

Start the conversation now by texting your order.`;

      aiConversationContexts.set(conversationId, [
        { role: 'system', content: systemPrompt }
      ]);

      // Get initial AI message
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: aiConversationContexts.get(conversationId)!,
        temperature: 0.9,
        max_tokens: 150,
      });

      const initialMessage = completion.choices[0].message.content || "Hi! I'd like to place an order";

      // Add AI response to context
      aiConversationContexts.get(conversationId)!.push({
        role: 'assistant',
        content: initialMessage
      });

      res.json({
        conversationId,
        customerName: randomName,
        initialMessage,
      });
    } catch (error: any) {
      console.error('Error starting test conversation:', error);
      res.status(500).json({ message: 'Failed to start test conversation', error: error.message });
    }
  });

  // Send message to AI and get response
  app.post("/api/test-conversation/message", async (req, res) => {
    try {
      const { conversationId, message } = req.body;

      if (!conversationId || !message) {
        return res.status(400).json({ message: 'Missing conversationId or message' });
      }

      const context = aiConversationContexts.get(conversationId);

      if (!context) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Add user message to context
      context.push({
        role: 'user',
        content: `Rod (restaurant manager) says: ${message}`
      });

      // Get AI response
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: context,
        temperature: 0.9,
        max_tokens: 150,
      });

      const aiResponse = completion.choices[0].message.content || "Thanks!";

      // Add AI response to context
      context.push({
        role: 'assistant',
        content: aiResponse
      });

      res.json({
        response: aiResponse,
      });
    } catch (error: any) {
      console.error('Error getting AI response:', error);
      res.status(500).json({ message: 'Failed to get AI response', error: error.message });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server for AI test simulator
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade with session authentication
  httpServer.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url || '', 'http://localhost').pathname;

    if (pathname === '/ws/test-simulator') {
      const req = request as any;

      // Create a minimal response object for middleware
      const res: any = {
        writeHead: () => { },
        end: () => socket.destroy(),
        setHeader: () => { },
        getHeader: () => undefined,
        on: () => { },
        once: () => { },
        emit: () => { },
      };

      // Apply session middleware to parse the session from the cookie
      sessionMiddleware(req, res, () => {
        // Apply passport middleware to populate req.user
        passport.initialize()(req, res, () => {
          passport.session()(req, res, () => {
            const userId = req.user?.id;

            if (!userId) {
              console.log('WebSocket connection rejected: not authenticated');
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }

            // User is authenticated, proceed with WebSocket upgrade
            wss.handleUpgrade(request, socket, head, (ws) => {
              // Attach userId to the WebSocket instance
              (ws as any).userId = userId;
              wss.emit('connection', ws, request);
            });
          });
        });
      });
    }
  });

  wss.on('connection', (ws: WebSocket, req: any) => {
    const userId = (ws as any).userId;
    console.log('WebSocket client connected to test simulator, userId:', userId);

    // Add WebSocket to user's connection set for broadcasting updates
    if (userId) {
      if (!userWebSockets.has(userId)) {
        userWebSockets.set(userId, new Set());
      }
      userWebSockets.get(userId)!.add(ws);
    }

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, text, orderId, phoneNumber } = message;

        if (type === 'start') {
          // Create new test conversation
          const { firstName, lastName } = generateRandomName();
          const phone = generateRandomPhoneNumber();

          // Create initial order in database with EMPTY order details
          // Rod will fill in the details manually as the conversation progresses
          const order = await storage.createOrder({
            userId,
            firstName,
            lastName,
            number: phone,
            firstMessage: 'Welcome to Corn on the Corner! 🌽',
            status: 'New',
            lastMessage: new Date(),
            pickupTime: null,
            items: [],
            orderPrice: '0.00',
            notes: '',
            orderMade: false, // Explicitly set to false for new orders
            pickupTimeDetected: false, // Explicitly set to false for new orders
          });

          // Create conversation row with initial greeting message
          const initialGreeting: Message = {
            id: randomUUID(),
            text: 'Welcome to Corn on the Corner! 🌽',
            isOutgoing: false,
            timestamp: new Date().toISOString(),
          };

          await storage.createOrderConversation({
            userId,
            orderId: order.id,
            number: phone,
            messages: [initialGreeting],
            updatedAt: new Date(),
          });

          // Initialize AI context
          const context = [
            {
              role: 'system' as const,
              content: `You are a customer texting a street food vendor called "Corn on the Corner" in Dearborn, Michigan. Your name is ${firstName} ${lastName}. You're hungry and want to order corn-based menu items. Be casual, friendly, and realistic. Menu items include: Classic Elote Cup, Buffalo Ranch Elote, Flamin Hot Cheetos Elote, Bacon Cheddar Elote, Nacho Cheese Elote, Corn Ribs, Street Corn Dog, Churro Bites, Tajin Fries. Keep responses under 150 characters. Sound like a real person texting.`
            }
          ];
          aiConversationContexts.set(order.id, context);

          ws.send(JSON.stringify({
            type: 'conversation_started',
            orderId: order.id,
            phoneNumber: phone,
            customerName: `${firstName} ${lastName}`,
          }));


        } else if (type === 'send_message') {
          // Rod sends a message - support both AI test conversations and regular conversations
          if (!orderId || !text || !text.trim()) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing orderId or message text' }));
            return;
          }

          // Verify order exists
          const order = await storage.getOrderById(userId, orderId);
          if (!order) {
            ws.send(JSON.stringify({ type: 'error', message: 'Order not found' }));
            return;
          }

          // Save Rod's message to database immediately
          const rodMessageId = randomUUID();
          const rodMessage: Message = {
            id: rodMessageId,
            text: text.trim(),
            isOutgoing: false,
            timestamp: new Date().toISOString(),
          };
          await storage.addMessageToOrder(userId, orderId, rodMessage);
          await storage.updateOrderLastMessage(orderId, new Date());

          // Send Rod's message immediately to frontend so it appears instantly
          ws.send(JSON.stringify({
            type: 'message_sent',
            messageId: rodMessageId,
            text: text.trim(),
            timestamp: rodMessage.timestamp,
            orderId: orderId,
          }));

          // Trigger debounced order detection after Rod's message
          triggerDebouncedOrderDetection(userId, orderId, ws);

          // Generate AI suggested response asynchronously with a delay
          // Delay it to avoid interfering with the AI response that's about to stream
          setTimeout(async () => {
            try {
              const conversation = await storage.getOrderConversation(userId, orderId);
              if (conversation) {
                const allMessages = (conversation.messages as Message[]) || [];
                await generateAISuggestedResponse(allMessages, userId, orderId, ws);
              }
            } catch (error) {
              console.error(`[WebSocket] Error generating AI suggested response:`, error);
            }
          }, 1000); // Delay to let AI response start streaming first

          // Check if this is an AI test conversation
          const context = aiConversationContexts.get(orderId);

          if (context) {
            // This is an AI conversation - get streaming AI response

            // Add Rod's message to context
            const contextMessage = `Rod (restaurant manager) says: ${text.trim()}`;
            context.push({
              role: 'user',
              content: contextMessage
            });

            // Create a placeholder message ID for the streaming response
            const aiMessageId = randomUUID();

            // Send initial message signal to create placeholder on client
            ws.send(JSON.stringify({
              type: 'message_stream_start',
              messageId: aiMessageId,
              orderId: orderId,
              timestamp: new Date().toISOString(),
            }));

            // Get AI response with streaming
            const stream = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: context,
              temperature: 0.9,
              max_tokens: 150,
              stream: true,
            });

            let aiResponse = '';

            // Stream chunks to client
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || '';
              if (content) {
                aiResponse += content;
                // Send each chunk to client
                ws.send(JSON.stringify({
                  type: 'message_stream_chunk',
                  messageId: aiMessageId,
                  orderId: orderId,
                  text: content,
                }));
              }
            }

            // If no response, use default
            if (!aiResponse) {
              aiResponse = "Thanks!";
              ws.send(JSON.stringify({
                type: 'message_stream_chunk',
                messageId: aiMessageId,
                orderId: orderId,
                text: aiResponse,
              }));
            }

            // Send stream complete signal
            ws.send(JSON.stringify({
              type: 'message_stream_complete',
              messageId: aiMessageId,
              orderId: orderId,
              timestamp: new Date().toISOString(),
            }));

            // Add AI response to context
            context.push({
              role: 'assistant',
              content: aiResponse
            });

            // Save AI response to database (always save, even if empty)
            const finalAiResponse = aiResponse || "Thanks!";
            const aiMessage: Message = {
              id: aiMessageId,
              text: finalAiResponse,
              isOutgoing: true,
              timestamp: new Date().toISOString(),
            };
            try {
              console.log(`[WebSocket] Saving AI response to database for order ${orderId}: ${finalAiResponse.substring(0, 50)}...`);
              await storage.addMessageToOrder(userId, orderId, aiMessage);
              await storage.updateOrderLastMessage(orderId, new Date());
              console.log(`[WebSocket] AI response saved successfully to order ${orderId}`);
            } catch (saveError) {
              console.error(`[WebSocket] Error saving AI response for order ${orderId}:`, saveError);
              // Try to send error to client
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Failed to save AI response to database'
                }));
              }
            }

            // Trigger debounced order detection after AI response is saved
            // This will analyze the conversation after 2 seconds of no new messages
            triggerDebouncedOrderDetection(userId, orderId, ws);

            // Generate AI suggested response asynchronously with a delay to avoid blocking/interfering with message display
            // This runs independently and doesn't block the AI response streaming
            setTimeout(async () => {
              try {
                const conversation = await storage.getOrderConversation(userId, orderId);
                if (conversation) {
                  const allMessages = (conversation.messages as Message[]) || [];
                  await generateAISuggestedResponse(allMessages, userId, orderId, ws);
                }
              } catch (error) {
                console.error(`[WebSocket] Error generating AI suggested response:`, error);
              }
            }, 500); // Small delay to let the AI message display smoothly first
          } else {
            // Regular conversation (not AI test) - no AI response needed
            // Message is already saved and sent to frontend above
            console.log(`[WebSocket] Message sent to regular conversation ${orderId}, no AI response`);

            // Generate AI suggested response asynchronously with a small delay
            setTimeout(async () => {
              try {
                const conversation = await storage.getOrderConversation(userId, orderId);
                if (conversation) {
                  const allMessages = (conversation.messages as Message[]) || [];
                  await generateAISuggestedResponse(allMessages, userId, orderId, ws);
                }
              } catch (error) {
                console.error(`[WebSocket] Error generating AI suggested response:`, error);
              }
            }, 300); // Small delay for regular conversations
          }
        }
      } catch (error: any) {
        console.error('WebSocket error:', error);
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      // Remove WebSocket from user's connection set
      if (userId && userWebSockets.has(userId)) {
        userWebSockets.get(userId)!.delete(ws);
        if (userWebSockets.get(userId)!.size === 0) {
          userWebSockets.delete(userId);
        }
      }
    });
  });

  // Set up periodic refresh for menu item popularity aggregates (every 15 minutes)
  setInterval(async () => {
    try {
      // Get all users and refresh their aggregates
      const allUsers = await db.select().from(users);
      for (const user of allUsers) {
        try {
          await storage.refreshMenuItemPopularityAggregates(user.id);
        } catch (error) {
          console.error(`Error refreshing aggregates for user ${user.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in periodic aggregate refresh:', error);
    }
  }, 15 * 60 * 1000); // 15 minutes

  // Refresh aggregates on server start for all users
  (async () => {
    try {
      const allUsers = await db.select().from(users);
      for (const user of allUsers) {
        try {
          await storage.refreshMenuItemPopularityAggregates(user.id);
        } catch (error) {
          console.error(`Error refreshing aggregates for user ${user.id} on startup:`, error);
        }
      }
    } catch (error) {
      console.error('Error in startup aggregate refresh:', error);
    }
  })();

  // API endpoint to manually refresh aggregates
  app.post("/api/analytics/refresh-aggregates", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const { startDate, endDate } = req.body;

      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;

      console.log(`[Analytics] Manual refresh requested for user ${userId}`);
      await storage.refreshMenuItemPopularityAggregates(userId, start, end);
      res.json({ message: "Aggregates refreshed successfully" });
    } catch (error) {
      console.error('Error refreshing aggregates:', error);
      next(error);
    }
  });

  // API endpoint to get menu item popularity data
  app.get("/api/analytics/popularity", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const { startDate, endDate, groupBy = 'day' } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      if (!['day', 'week', 'month'].includes(groupBy as string)) {
        return res.status(400).json({ message: "groupBy must be 'day', 'week', or 'month'" });
      }

      const data = await storage.getMenuItemPopularity(userId, start, end, groupBy as 'day' | 'week' | 'month');
      console.log(`[Analytics] Returning ${data.length} data points for user ${userId}`);
      res.json(data);
    } catch (error) {
      console.error('Error fetching popularity data:', error);
      next(error);
    }
  });

  // Clover OAuth routes
  // Initiate OAuth flow - redirect to Clover
  app.get("/api/integrations/clover/authorize", isAuthenticated, async (req, res) => {
    try {
      const clientId = process.env.CLOVER_APP_ID;
      if (!clientId) {
        return res.status(500).json({ message: "Clover app ID not configured" });
      }

      const REDIRECT_URI = process.env.REDIRECT_URI;
      const authUrl = `https://sandbox.dev.clover.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${REDIRECT_URI}`;

      res.redirect(authUrl);
    } catch (error) {
      console.error('Error initiating Clover OAuth:', error);
      res.status(500).json({ message: "Failed to initiate OAuth flow" });
    }
  });

  // OAuth callback endpoint
  app.get("/oauth/callback", async (req, res, next) => {
    try {
      const { code, error, merchant_id, client_id } = req.query;

      if (error) {
        console.error('OAuth error:', error);
        return res.redirect('/settings?error=oauth_failed');
      }

      if (!code) {
        return res.redirect('/settings?error=no_code');
      }

      const clientSecret = process.env.CLOVER_APP_SECRET;

      if (!client_id || !clientSecret) {
        console.error('Clover credentials not configured');
        return res.redirect('/settings?error=config_error');
      }

      const tokenResponse = await fetch('https://apisandbox.dev.clover.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: client_id as string,
          client_secret: clientSecret,
          code: code as string
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        return res.redirect('/settings?error=token_exchange_failed');
      }

      const tokenData = await tokenResponse.json();
      console.log(`[OAuth] Full token response:`, JSON.stringify(tokenData, null, 2));

      // Get user ID from session (user needs to be logged in)
      if (!req.isAuthenticated()) {
        return res.redirect('/login?redirect=/oauth/callback');
      }

      const userId = (req.user as any).id;

      // Encrypt tokens before storing
      const encryptedAccessToken = encrypt(tokenData.access_token);
      const refreshToken = tokenData.refresh_token;
      const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;
      const expiresIn = tokenData.expires_in;
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

      // Check if token already exists for this user and provider
      const existingToken = await db.select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
        .limit(1);

      if (existingToken.length > 0) {
        // Update existing token (preserve existing merchantId if new one is null)
        await db.update(oauthTokens)
          .set({
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt: expiresAt,
            merchantId: merchant_id as string,
            updatedAt: new Date(),
          })
          .where(eq(oauthTokens.id, existingToken[0].id));
      } else {
        // Insert new token
        await db.insert(oauthTokens).values({
          userId,
          provider: 'clover',
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: expiresAt,
          merchantId: merchant_id as string,
        });
      }

      res.redirect('/settings?success=clover_connected');
    } catch (error) {
      console.error('Error in OAuth callback:', error);
      next(error);
    }
  });

  // Check Clover connection status
  app.get("/api/integrations/clover/status", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;

      const token = await db.select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
        .limit(1);

      res.json({ connected: token.length > 0 });
    } catch (error) {
      console.error('Error checking Clover status:', error);
      next(error);
    }
  });

  // Disconnect Clover (remove token)
  app.delete("/api/integrations/clover/disconnect", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;

      // Check if token exists before deleting
      const existingToken = await db.select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
        .limit(1);

      if (existingToken.length > 0) {
        await db.delete(oauthTokens)
          .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')));
        console.log(`[OAuth] Clover token removed for user ${userId}`);
      } else {
        console.log(`[OAuth] No Clover token found to remove for user ${userId}`);
      }

      res.json({ success: true, message: "Clover disconnected successfully" });
    } catch (error) {
      console.error('Error disconnecting Clover:', error);
      next(error);
    }
  });

  // Sync menu items from Clover
  app.post("/api/integrations/clover/sync-menu", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;

      // Get Clover token
      const tokenRecord = await db.select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
        .limit(1);

      if (!tokenRecord[0]) {
        return res.status(401).json({ message: "Clover not connected" });
      }

      let accessToken = process.env.MERCHENT_API_KEY || "";

      console.log(`[Clover Sync] Decrypted Access token: ${accessToken}`);
      const merchantId = tokenRecord[0].merchantId || 'H4RW04034BGH1';

      // First, delete all existing menu items to replace with fresh data
      console.log(`[Clover Sync] Deleting all existing menu items for fresh sync...`);
      const existingItems = await storage.getMenuItems(userId);

      // Delete menu_item_popularity_aggregates first (due to foreign key constraint)
      if (existingItems.length > 0) {
        const menuItemIds = existingItems.map(item => item.id);
        console.log(`[Clover Sync] Deleting popularity aggregates for ${menuItemIds.length} menu items...`);
        await db.delete(menuItemPopularityAggregates)
          .where(eq(menuItemPopularityAggregates.userId, userId));
        console.log(`[Clover Sync] Deleted popularity aggregates`);
      }

      // Now delete menu items
      let deletedCount = 0;
      for (const existingItem of existingItems) {
        try {
          await storage.deleteMenuItem(userId, existingItem.id);
          deletedCount++;
        } catch (error) {
          console.error(`Error deleting existing item ${existingItem.id}:`, error);
        }
      }
      console.log(`[Clover Sync] Deleted ${deletedCount} of ${existingItems.length} existing menu items`);

      // Verify deletion by fetching items again - should be empty
      const remainingItems = await storage.getMenuItems(userId);
      if (remainingItems.length > 0) {
        console.warn(`[Clover Sync] Warning: ${remainingItems.length} items still remain after deletion. Attempting to delete again...`);
        // Delete remaining items manually
        for (const item of remainingItems) {
          try {
            await db.delete(menuItemPopularityAggregates)
              .where(eq(menuItemPopularityAggregates.menuItemId, item.id));
            await storage.deleteMenuItem(userId, item.id);
          } catch (error) {
            console.error(`Error deleting remaining item ${item.id}:`, error);
          }
        }
      }

      // Fetch all categories from Clover
      console.log(`[Clover Sync] Fetching categories for merchant ${merchantId}`);
      const categoriesResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/categories?limit=1000`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!categoriesResponse.ok) {
        const errorText = await categoriesResponse.text();
        const statusCode = categoriesResponse.status;
        console.error(`[Clover Sync] Failed to fetch categories (${statusCode}):`, errorText);

        if (statusCode === 401) {
          return res.status(401).json({
            message: "Unauthorized - Token may be invalid or expired. Please reconnect Clover in Settings.",
            requiresReconnect: true,
            statusCode
          });
        }

        return res.status(500).json({
          message: "Failed to fetch categories from Clover",
          statusCode,
          details: errorText
        });
      }

      const categoriesData = await categoriesResponse.json();
      const categories = categoriesData.elements || (Array.isArray(categoriesData) ? categoriesData : []);
      console.log(`[Clover Sync] Found ${categories.length} categories`);

      // Map Clover items to our menu items schema and save to database
      const syncedItems: MenuItem[] = [];
      const errors: string[] = [];

      // For each category, fetch its items
      for (const category of categories) {
        try {
          const categoryId = category.id;
          const categoryName = category.name;

          console.log(`[Clover Sync] Fetching items for category: ${categoryName} (${categoryId})`);

          const categoryItemsResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/categories/${categoryId}/items?limit=1000`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
          });

          if (!categoryItemsResponse.ok) {
            const errorText = await categoryItemsResponse.text();
            console.error(`[Clover Sync] Failed to fetch items for category ${categoryName} (${categoryItemsResponse.status}):`, errorText);
            errors.push(`Failed to fetch items for category "${categoryName}": ${errorText}`);
            continue;
          }

          const categoryItemsData = await categoryItemsResponse.json();
          const categoryItems = categoryItemsData.elements || (Array.isArray(categoryItemsData) ? categoryItemsData : []);
          console.log(`[Clover Sync] Found ${categoryItems.length} items in category "${categoryName}"`);

          // Process each item in this category
          for (const cloverItem of categoryItems) {
            try {
              // Skip if item doesn't have a name or is hidden
              if (!cloverItem.name || cloverItem.hidden === true) {
                continue;
              }

              // Format price (Clover stores price in cents, convert to dollars)
              const priceInCents = cloverItem.price || 0;
              const priceInDollars = (priceInCents / 100).toFixed(2);
              const formattedPrice = `$${priceInDollars}`;

              // Create menu item with category
              const newItem = await storage.createMenuItem(userId, {
                name: cloverItem.name,
                price: formattedPrice,
                category: categoryName,
                description: cloverItem.description || undefined,
                imageUrl: cloverItem.imageHref || undefined,
                isAvailable: !cloverItem.hidden,
              } as any);
              syncedItems.push(newItem);
            } catch (error: any) {
              console.error(`Error syncing item "${cloverItem.name}" in category "${categoryName}":`, error);
              errors.push(`Failed to sync "${cloverItem.name}" in category "${categoryName}": ${error.message}`);
            }
          }
        } catch (error: any) {
          console.error(`Error processing category "${category.name}":`, error);
          errors.push(`Failed to process category "${category.name}": ${error.message}`);
        }
      }

      // Clear menu items cache
      menuItemsCache.delete(userId);

      res.json({
        success: true,
        synced: syncedItems.length,
        items: syncedItems,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error('Error syncing menu items from Clover:', error);
      next(error);
    }
  });

  return httpServer;
}
