import { createCipheriv, createDecipheriv, randomBytes, scryptSync, randomUUID } from "crypto";
import type { Response as ExpressResponse } from "express";
import { storage } from "./storage.js";
import { menuItemsCache, MESSAGING_SERVICE_URL, OptInStatus, twilioOptInCache, sseClients, type MenuItemCache } from "./globals.js";
import { Message } from "@shared/schema";
import { openai } from "./clients.js";
import { IStorage } from "./storage.js";
import { oauthTokens } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { getRedisClient, getRedisSubscriber } from "./redis.js";
import { analyzeOrderSummaryFromConversation, detectPickupTimeFromConversation, detectHalfSandwichRequest } from "./aiFunctions.js";


// Check if user is authenticated

export const isAuthenticated = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ message: "Unauthorized" });
};

// Validates and normalizes order status string (accepts any case and converts to proper case)
export function validateAndNormalizeStatus(status: string): string {
  const validStatuses = ['New', 'Confirmed', 'Ready', 'Completed'];
  // Convert to proper case: first letter uppercase, rest lowercase
  const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  if (!validStatuses.includes(normalizedStatus)) {
    throw new Error('Invalid status');
  }

  return normalizedStatus;
}

// Formats messages for API response, keeping timestamps as ISO strings
export function formatMessages(messages: Message[]) {
  return messages.map((msg) => ({
    id: msg.id,
    text: msg.text,
    isOutgoing: msg.isOutgoing,
    timestamp: msg.timestamp, // Keep as ISO string, no conversion
    isAIOrganized: msg.isAIOrganized
  }));
}

// Formats customer name from first and last name (returns full name if both exist, otherwise first name or null)
export function formatCustomerName(firstName: string | null, lastName: string | null): string | null {
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  return firstName || null;
}

// Calculates order count from order tag (handles "VIP (8x)" as 8, otherwise parses first digit, defaults to 1)
export function calculateOrderCount(tag: string | null): number {
  if (tag === 'VIP (8x)') {
    return 8;
  }
  // Parse first digit from tag (e.g., "3x" -> 3, "1" -> 1)
  return parseInt(tag?.charAt(0) || '1');
}

// Extracts pickup time from order notes (format: "PICKUP_TIME: 10:00 PM") or falls back to Date object
export function extractPickupTimeFromNotes(notes: string | null, pickupTimeDate: Date | null): string | null {
  // First, try to extract from notes (format: "PICKUP_TIME: 10:00 PM")
  if (notes) {
    const match = notes.match(/PICKUP_TIME:\s*([\d:]+?\s*(AM|PM))/i);
    if (match) {
      return match[1].trim();
    }
  }

  // Fallback: if stored as Date, convert to string (shouldn't normally happen)
  if (pickupTimeDate) {
    return new Date(pickupTimeDate).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  }

  return null;
}

// Removes pickup time from notes string for display purposes
export function removePickupTimeFromNotes(notes: string | null): string {
  if (!notes) return '';
  // Remove "PICKUP_TIME: 10:00 PM" pattern from notes
  return notes.replace(/PICKUP_TIME:\s*[\d:]+?\s*(AM|PM)/i, '').trim();
}

// Validates pickup time string format (e.g., "10:00 PM", "9:30 AM")
export function isValidPickupTimeFormat(pickupTime: string): boolean {
  return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(pickupTime.trim());
}

// Validates and trims message string (throws error if empty)
export function validateAndTrimMessage(message: string): string {
  const trimmedMessage = typeof message === "string" ? message.trim() : "";

  if (!trimmedMessage) {
    throw new Error('Message is required');
  }

  return trimmedMessage;
}

// Extracts quantity from item string (e.g., "Burger x2" returns 2, "Pizza" returns 1)
export function extractQuantityFromItemString(itemStr: string): { quantity: number; itemNameWithoutQuantity: string } {
  const quantityMatch = itemStr.match(/\s*x(\d+)$/i);
  if (quantityMatch) {
    const quantity = parseInt(quantityMatch[1]);
    const itemNameWithoutQuantity = itemStr.replace(/\s*x\d+$/i, '').trim();
    return { quantity, itemNameWithoutQuantity };
  }
  return { quantity: 1, itemNameWithoutQuantity: itemStr };
}

// Extracts price from item string (e.g., "Burger: $9.99" returns 9.99, "Pizza" returns null)
export function extractPriceFromItemString(itemStr: string): { totalPrice: number | null; itemNameWithoutPrice: string } {
  const priceMatch = itemStr.match(/:\s*\$([\d.]+)/);
  if (priceMatch) {
    const totalPrice = parseFloat(priceMatch[1]);
    const itemNameWithoutPrice = itemStr.replace(/:\s*\$[\d.]+.*$/, '').trim();
    return { totalPrice, itemNameWithoutPrice };
  }
  return { totalPrice: null, itemNameWithoutPrice: itemStr };
}

// Builds order details object for API response (only includes if order has a price)
export function buildOrderDetails(order: any) {
  if (!order.orderPrice) {
    return undefined;
  }

  const pickupTime = extractPickupTimeFromNotes(order.notes, order.pickupTime);

  return {
    items: order.items || [],
    pickupTime: pickupTime,
    pickupTimestamp: order.pickupTime ? new Date(order.pickupTime).getTime() : null,
    total: order.orderPrice,
    notes: removePickupTimeFromNotes(order.notes)
  };
}

// Formats pickup time for confirmation message (uses orderDetails first, then falls back to order.pickupTime)
export async function formatPickupTimeForMessage(orderDetails: any, order: any): Promise<string> {
  // Use pickup time from orderDetails if it's a string (e.g., "10:00 PM")
  if (orderDetails?.pickupTime && typeof orderDetails.pickupTime === 'string') {
    return orderDetails.pickupTime.trim();
  }

  // Fallback: if stored as Date, convert to formatted string
  if (order.pickupTime) {
    const { formatRestaurantTime } = await import("./timezone.js");
    return formatRestaurantTime(new Date(order.pickupTime));
  }

  // Default message if no pickup time available
  return 'a later time today';
}

// Creates a confirmation message object for the customer
export function createConfirmationMessage(pickupTime: string): Message {
  return {
    id: randomUUID(),
    text: `Thanks for ordering! Your order is confirmed and will be ready for pickup at ${pickupTime}.`,
    isOutgoing: false, // false = from business (appears on right side)
    timestamp: new Date().toISOString(),
  };
}

// Encryption utilities 

const ENCRYPTION_KEY = process.env.SESSION_SECRET || '';
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
    // Derive a 32-byte key from the encryption key
    return scryptSync(ENCRYPTION_KEY, 'salt', 32);
}

export function encrypt(text: string): string {
    const key = getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
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

// Get menu items with caching (1 day cache)
// TODO: Fetch menu items from Clover API
export async function getMenuItemsWithCache(userId: string): Promise<Array<{ name: string; price: string; category: string | null }>> {
    const redis = getRedisClient();
    const cacheKey = `menu:items:${userId}`;
    const now = Date.now();

    // Use Redis if PRODUCTION is true
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const cacheData: MenuItemCache = JSON.parse(cached);
                // Check if cache is still valid (1 day = 24 * 60 * 60 * 1000 ms)
                if (cacheData.expiresAt > now) {
                    console.log(`[Menu Cache] Using Redis cached menu items for userId ${userId}`);
                    return cacheData.items;
                }
            }
        } catch (error) {
            console.error(`[Menu Cache] Redis get error for userId ${userId}:`, error);
            // Fall through to fetch from database
        }
    } else {
        // Use in-memory cache (development)
        const cached = menuItemsCache.get(userId);
        if (cached && cached.expiresAt > now) {
            console.log(`[Menu Cache] Using in-memory cached menu items for userId ${userId}`);
            return cached.items;
        }
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
    const cacheData: MenuItemCache = {
        items: formattedItems,
        expiresAt
    };

    // Store in Redis if PRODUCTION is true
    if (redis) {
        try {
            // Store with TTL of 1 day (86400 seconds)
            await redis.setex(cacheKey, 86400, JSON.stringify(cacheData));
            console.log(`[Menu Cache] Stored menu items in Redis for userId ${userId}`);
        } catch (error) {
            console.error(`[Menu Cache] Redis set error for userId ${userId}:`, error);
            // Continue even if Redis write fails
        }
    } else {
        // Store in in-memory cache (development)
        menuItemsCache.set(userId, cacheData);
    }

    return formattedItems;
}

// Order detection timer management with Redis support
interface TimerMetadata {
    userId: string;
    orderId: string;
    expiresAt: number;
}

export async function setOrderDetectionTimer(
    userId: string,
    orderId: string,
    delayMs: number,
    onExpire: (userId: string, orderId: string) => Promise<void>
): Promise<NodeJS.Timeout> {
    const redis = getRedisClient();
    const cacheKey = `order:detection:timer:${orderId}`;
    const expiresAt = Date.now() + delayMs;

    // Store timer metadata in Redis if PRODUCTION is true
    if (redis) {
        try {
            const metadata: TimerMetadata = { userId, orderId, expiresAt };
            // Store with TTL slightly longer than delay (3 seconds for 2 second delay)
            await redis.setex(cacheKey, 3, JSON.stringify(metadata));
            console.log(`[Order Detection Timer] Stored timer in Redis for order ${orderId}`);
        } catch (error) {
            console.error(`[Order Detection Timer] Redis set error for order ${orderId}:`, error);
        }
    }

    // Create the actual timer
    const timer = setTimeout(async () => {
        // Remove from Redis when timer fires
        if (redis) {
            try {
                await redis.del(cacheKey);
            } catch (error) {
                console.error(`[Order Detection Timer] Redis delete error for order ${orderId}:`, error);
            }
        }

        console.log(`[Order Detection] Debounce timer expired for order ${orderId}, triggering analysis...`);
        await onExpire(userId, orderId);

        // Remove from in-memory cache if still exists
        const { orderDetectionTimers } = await import('./globals.js');
        orderDetectionTimers.delete(orderId);
    }, delayMs);

    // Store in in-memory cache (always, for immediate access)
    const { orderDetectionTimers } = await import('./globals.js');
    orderDetectionTimers.set(orderId, timer);

    return timer;
}

export async function clearOrderDetectionTimer(orderId: string): Promise<void> {
    const redis = getRedisClient();
    const cacheKey = `order:detection:timer:${orderId}`;

    // Clear from Redis if PRODUCTION is true
    if (redis) {
        try {
            await redis.del(cacheKey);
            console.log(`[Order Detection Timer] Cleared Redis timer for order ${orderId}`);
        } catch (error) {
            console.error(`[Order Detection Timer] Redis delete error for order ${orderId}:`, error);
        }
    }

    // Clear from in-memory cache
    const { orderDetectionTimers } = await import('./globals.js');
    const existingTimer = orderDetectionTimers.get(orderId);
    if (existingTimer) {
        clearTimeout(existingTimer);
        orderDetectionTimers.delete(orderId);
        console.log(`[Order Detection Timer] Cleared in-memory timer for order ${orderId}`);
    }
}

export async function restoreOrderDetectionTimers(
    onExpire: (userId: string, orderId: string) => Promise<void>
): Promise<void> {
    const redis = getRedisClient();
    if (!redis) {
        return; // No Redis, nothing to restore
    }

    try {
        // Get all timer keys
        const keys = await redis.keys('order:detection:timer:*');
        const now = Date.now();

        for (const key of keys) {
            try {
                const cached = await redis.get(key);
                if (cached) {
                    const metadata: TimerMetadata = JSON.parse(cached);
                    const remainingTime = metadata.expiresAt - now;

                    if (remainingTime > 0) {
                        // Timer hasn't expired yet, restore it
                        console.log(`[Order Detection Timer] Restoring timer for order ${metadata.orderId}, ${remainingTime}ms remaining`);
                        await setOrderDetectionTimer(metadata.userId, metadata.orderId, remainingTime, onExpire);
                    } else {
                        // Timer should have fired, trigger detection immediately
                        console.log(`[Order Detection Timer] Timer for order ${metadata.orderId} expired during downtime, triggering detection`);
                        await redis.del(key);
                        await onExpire(metadata.userId, metadata.orderId);
                    }
                }
            } catch (error) {
                console.error(`[Order Detection Timer] Error restoring timer from key ${key}:`, error);
                // Clean up invalid key
                await redis.del(key);
            }
        }
    } catch (error) {
        console.error('[Order Detection Timer] Error restoring timers:', error);
    }
}

// SSE event management with Redis support
interface SSEEvent {
    event: string;
    data: unknown;
    timestamp: number;
    instanceId?: string; // Used to prevent duplicate messages from same instance
}

// Generate a unique instance ID for this server process
const INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

export async function emitSSEWithRedis(
    userId: string,
    event: string,
    data: unknown,
    sendToClients: (userId: string, payload: string) => void
): Promise<void> {
    const redis = getRedisClient();
    const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
    const sseEvent: SSEEvent = { event, data, timestamp: Date.now(), instanceId: INSTANCE_ID };

    // Send to local clients immediately
    sendToClients(userId, payload);

    // If PRODUCTION=true, also publish to Redis pub/sub and store recent events
    if (redis) {
        try {
            // Publish to Redis pub/sub for other server instances
            // Note: We include instanceId so other instances know it's from us
            const channel = `sse:user:${userId}`;
            await redis.publish(channel, JSON.stringify(sseEvent));
            console.log(`[SSE] Published event to Redis channel ${channel} (instance: ${INSTANCE_ID})`);

            // Store recent events (unlimited, expires at end of day)
            // Store without instanceId to avoid filtering issues on reconnect
            const recentEventForStorage: SSEEvent = { event, data, timestamp: Date.now() };
            const recentEventsKey = `sse:recent:${userId}`;
            await redis.lpush(recentEventsKey, JSON.stringify(recentEventForStorage));

            // Calculate seconds until end of day (midnight)
            const now = new Date();
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999); // Set to end of day
            const secondsUntilMidnight = Math.ceil((endOfDay.getTime() - now.getTime()) / 1000);

            // Set TTL to expire at end of day (or refresh if already set)
            await redis.expire(recentEventsKey, secondsUntilMidnight);
        } catch (error) {
            console.error(`[SSE] Redis error for userId ${userId}:`, error);
            // Continue even if Redis fails
        }
    }
}

export async function getRecentSSEEvents(userId: string): Promise<SSEEvent[]> {
    const redis = getRedisClient();
    if (!redis) {
        return []; // No Redis, no recent events
    }

    try {
        const recentEventsKey = `sse:recent:${userId}`;
        const events = await redis.lrange(recentEventsKey, 0, -1); // Get all events (no limit)
        return events.map(eventStr => JSON.parse(eventStr) as SSEEvent);
    } catch (error) {
        console.error(`[SSE] Error getting recent events for userId ${userId}:`, error);
        return [];
    }
}

// Helper function to send SSE payload to local clients
export function sendSSEToClients(userId: string, payload: string) {
    const clients = sseClients.get(userId);
    if (!clients || clients.size === 0) {
        return;
    }

    const staleClients: ExpressResponse[] = [];

    for (const client of Array.from(clients)) {
        try {
            client.write(payload);
        } catch (error) {
            staleClients.push(client);
        }
    }

    if (staleClients.length > 0) {
        const set = sseClients.get(userId);
        if (!set) {
            return;
        }
        staleClients.forEach((client) => {
            set.delete(client);
            try {
                client.end();
            } catch {
                // noop
            }
        });
        if (set.size === 0) {
            sseClients.delete(userId);
        }
    }
}

// Emit SSE event (with Redis support if PRODUCTION=true)
export async function emitSSE(userId: string, event: string, data: unknown) {
    await emitSSEWithRedis(userId, event, data, sendSSEToClients);
}

export function setupRedisSSESubscription(
    onEvent: (userId: string, event: string, data: unknown) => void
): void {
    const subscriber = getRedisSubscriber();
    if (!subscriber) {
        return; // No Redis, no subscription
    }

    // Subscribe to all user SSE channels using pattern matching
    subscriber.psubscribe('sse:user:*');

    subscriber.on('pmessage', (pattern, channel, message) => {
        try {
            // Extract userId from channel (format: sse:user:${userId})
            const userId = channel.replace('sse:user:', '');
            const sseEvent: SSEEvent = JSON.parse(message);

            // Filter out messages from our own instance to prevent duplicates
            // (We already sent to local clients when we published)
            if (sseEvent.instanceId === INSTANCE_ID) {
                console.log(`[SSE] Ignoring own message from Redis channel ${channel} (instance: ${INSTANCE_ID})`);
                return;
            }

            console.log(`[SSE] Received event from Redis channel ${channel} for userId ${userId} (from instance: ${sseEvent.instanceId})`);

            // Call the callback to send to local clients
            // This is a message from another server instance
            onEvent(userId, sseEvent.event, sseEvent.data);
        } catch (error) {
            console.error(`[SSE] Error processing Redis message from channel ${channel}:`, error);
        }
    });

    // Handle reconnection - resubscribe to pattern if connection is lost
    subscriber.on('ready', () => {
        console.log(`[SSE] Redis subscriber ready, subscribing to pattern sse:user:*`);
        subscriber.psubscribe('sse:user:*').catch((err) => {
            console.error('[SSE] Error resubscribing to Redis pattern:', err);
        });
    });

    console.log(`[SSE] Redis pub/sub subscription set up (instance: ${INSTANCE_ID})`);
}

// Clear menu items cache (works with both Redis and in-memory cache)
export async function clearMenuItemsCache(userId: string): Promise<void> {
    const redis = getRedisClient();
    const cacheKey = `menu:items:${userId}`;

    if (redis) {
        try {
            await redis.del(cacheKey);
            console.log(`[Menu Cache] Cleared Redis cache for userId ${userId}`);
        } catch (error) {
            console.error(`[Menu Cache] Redis delete error for userId ${userId}:`, error);
        }
    } else {
        // Clear in-memory cache (development)
        menuItemsCache.delete(userId);
        console.log(`[Menu Cache] Cleared in-memory cache for userId ${userId}`);
    }
}

// Convert relative time strings to absolute times
export async function convertRelativeTimeToAbsolute(timeStr: string, baseTime?: Date): Promise<string | null> {
    const { getRestaurantDateTimeComponents, getCurrentRestaurantTimeString } = await import("./timezone.js");

    // If baseTime not provided, get current time in restaurant timezone
    let restaurantBaseTime: Date;
    if (!baseTime) {
        const components = getRestaurantDateTimeComponents();
        restaurantBaseTime = new Date(
            components.year,
            components.month,
            components.day,
            components.hours,
            components.minutes,
            components.seconds
        );
    } else {
        // Convert baseTime to restaurant timezone representation
        const components = getRestaurantDateTimeComponents(baseTime);
        restaurantBaseTime = new Date(
            components.year,
            components.month,
            components.day,
            components.hours,
            components.minutes,
            components.seconds
        );
    }
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

    const resultTime = new Date(restaurantBaseTime);

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

// Format conversation for AI
export function formatConversation(messages: Message[]): string {
    return messages.map(msg => {
        const sender = msg.isOutgoing ? 'Customer' : 'Restaurant';
        return `${sender}: ${msg.text}`;
    }).join('\n');
}

// Build menu context for AI prompt
export function buildMenuContext(menuItems?: Array<{ name: string; price: string; category: string | null }>): string {
    if (!menuItems || menuItems.length === 0) return '';

    const byCategory = menuItems.reduce((acc, item) => {
        const category = item.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(item);
        return acc;
    }, {} as Record<string, Array<{ name: string; price: string }>>);

    let menuContext = '\n\nMENU ITEMS (use this to accurately identify and correlate items mentioned in the conversation):\n';
    Object.entries(byCategory).forEach(([category, items]) => {
        menuContext += `\n${category}:\n`;
        items.forEach(item => {
            menuContext += `  - ${item.name}: ${item.price}\n`;
        });
    });

    menuContext += '\nWhen extracting items from the conversation, match them to the menu items above. Use the exact menu item names when possible. Include the price from the menu for each item. If a customer mentions variations or customizations, include them in the item name (e.g., "Corn on the Cob (with butter): $3.50" or "2x Corn on the Cob: $7.00"). For items with quantities, calculate the total price (e.g., "2x Corn on the Cob: $7.00" if the price is $3.50 each).';

    return menuContext;
}

// Call OpenAI API for Order Summary
export async function OpenAIOrderSummary(systemPrompt: string, conversationText: string, customerName?: string) {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this conversation:\n\n${conversationText}\n\nCustomer name from order info: ${customerName || 'unknown'}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
    });

    return JSON.parse(completion.choices[0].message.content || '{"orderMade": false}');
}

// Call Trucube API for Order Summary 
export async function TrucubeOrderSummary(
    systemPrompt: string,
    conversationText: string,
    customerName?: string
): Promise<{
    orderMade: boolean;
    orderDetails?: {
        customerName: string;
        items: string[];
        pickupTime?: string;
        notes?: string;
    };
}> {

    const BEARER_TOKEN = process.env.TRUCUBE_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        throw new Error("TRUCUBE_BEARER_TOKEN is not set");
    }

    try {
        const response = await fetch("http://98.15.217.173:3000/api/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.1:latest",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: conversationText,
                    },
                ],
                stream: false,
            }),
        });

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        // Extract assistant response
        const assistantMessage = data?.choices?.[0]?.message?.content;

        if (!assistantMessage) {
            return { orderMade: false };
        }

        // Parse the JSON returned by the assistant
        try {
            const parsed = JSON.parse(assistantMessage);
            return parsed;
        } catch (err) {
            console.error("Failed to parse Trucube response:", assistantMessage, err);
            return { orderMade: false };
        }
    } catch (error) {
        console.error("Error calling Trucube API:", error);
        return { orderMade: false };
    }
}

// Function to format order details into AI organized message format
export function formatOrderMessage(orderDetails: { customerName: string; items: string[]; pickupTime?: string; notes?: string }, menuItems?: Array<{ name: string; price: string; category: string | null }>): string {
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

export function shouldGenerateAISuggestion(messages: any[]): boolean {
    // No messages, nothing to suggest
    if (messages.length === 0) return false;

    // Get the last (most recent) message
    const lastMessage = messages[messages.length - 1];

    // Skip if last message is from restaurant/owner
    if (!lastMessage.isOutgoing) {
        console.log(`[AI Suggested Response] Skipping - last message is from restaurant/owner`);
        return false;
    }

    // Skip AI-organized/system messages
    if (lastMessage.isAIOrganized) {
        console.log(`[AI Suggested Response] Skipping - last message is AI organized`);
        return false;
    }

    // All checks passed — should generate suggestion
    return true;
}

export async function OpenAISuggestedResponse(
    systemPrompt: string,
    conversationText: string
): Promise<string> {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `Conversation:\n${conversationText}\n\nGenerate a short response suggestion for Rod to send to the customer.`,
            },
        ],
        temperature: 0.7,
        max_tokens: 100,
    });

    return completion.choices[0].message.content?.trim() || "";
}

export async function TrucubeSuggestedResponse(
    systemPrompt: string,
    conversationText: string,
): Promise<string> {

    const BEARER_TOKEN = process.env.TRUCUBE_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        throw new Error("TRUCUBE_BEARER_TOKEN is not set");
    }

    try {
        const response = await fetch("http://98.15.217.173:3000/api/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.1:latest",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: `Conversation:\n${conversationText}\n\nGenerate a short response suggestion for Rod to send to the customer.`,
                    },
                ],
                stream: false,
            }),
        });

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        // Extract assistant response
        const assistantMessage = data?.choices?.[0]?.message?.content;

        if (!assistantMessage) {
            return "";
        }

        return assistantMessage;
    } catch (error) {
        console.error("Error calling Trucube API:", error);
        return "";
    }
}

// Conditional AI Output functions
export async function OpenAIConditionalOutput(
    systemPrompt: string,
    conversationText: string,
    customerName?: string
): Promise<{
    edgeCaseDetected: boolean;
    edgeCaseType?: string;
    orderDetails?: {
        customerName: string;
        items: string[];
        pickupTime?: string;
        notes?: string;
    };
    suggestedResponse?: string;
}> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this conversation:\n\n${conversationText}\n\nCustomer name from order info: ${customerName || 'unknown'}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
    });

    try {
        return JSON.parse(completion.choices[0].message.content || '{"edgeCaseDetected": false}');
    } catch (error) {
        console.error("Error parsing OpenAI conditional output:", error);
        return { edgeCaseDetected: false };
    }
}

export async function TrucubeConditionalOutput(
    systemPrompt: string,
    conversationText: string,
    customerName?: string
): Promise<{
    edgeCaseDetected: boolean;
    edgeCaseType?: string;
    orderDetails?: {
        customerName: string;
        items: string[];
        pickupTime?: string;
        notes?: string;
    };
    suggestedResponse?: string;
}> {
    const BEARER_TOKEN = process.env.TRUCUBE_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        throw new Error("TRUCUBE_BEARER_TOKEN is not set");
    }

    try {
        const response = await fetch("http://98.15.217.173:3000/api/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.1:latest",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: `Analyze this conversation:\n\n${conversationText}\n\nCustomer name from order info: ${customerName || 'unknown'}`,
                    },
                ],
                stream: false,
            }),
        });

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const assistantMessage = data?.choices?.[0]?.message?.content;

        if (!assistantMessage) {
            return { edgeCaseDetected: false };
        }

        try {
            return JSON.parse(assistantMessage);
        } catch (error) {
            console.error("Error parsing Trucube conditional output:", error);
            return { edgeCaseDetected: false };
        }
    } catch (error) {
        console.error("Error calling Trucube API for conditional output:", error);
        return { edgeCaseDetected: false };
    }
}

// Call OpenAI API for Pickup Time Detection
export async function OpenAIPickupTime(
    systemPrompt: string,
    conversationText: string
): Promise<{
    pickupTimeDetected: boolean;
    pickupTime?: string;
}> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this conversation:\n\n${conversationText}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
    });

    try {
        return JSON.parse(completion.choices[0].message.content || '{"pickupTimeDetected": false}');
    } catch (error) {
        console.error("Error parsing OpenAI pickup time response:", error);
        return { pickupTimeDetected: false };
    }
}

// Call Trucube API for Pickup Time Detection
export async function TrucubePickupTime(
    systemPrompt: string,
    conversationText: string
): Promise<{
    pickupTimeDetected: boolean;
    pickupTime?: string;
}> {
    const BEARER_TOKEN = process.env.TRUCUBE_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        throw new Error("TRUCUBE_BEARER_TOKEN is not set");
    }

    try {
        const response = await fetch("http://98.15.217.173:3000/api/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.1:latest",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: `Analyze this conversation:\n\n${conversationText}`,
                    },
                ],
                stream: false,
            }),
        });

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const assistantMessage = data?.choices?.[0]?.message?.content;

        if (!assistantMessage) {
            return { pickupTimeDetected: false };
        }

        try {
            return JSON.parse(assistantMessage);
        } catch (error) {
            console.error("Error parsing Trucube pickup time response:", assistantMessage, error);
            return { pickupTimeDetected: false };
        }
    } catch (error) {
        console.error("Error calling Trucube API for pickup time:", error);
        return { pickupTimeDetected: false };
    }
}

// Call OpenAI API for Half Sandwich Detection
export async function OpenAIHalfSandwich(
    systemPrompt: string,
    conversationText: string
): Promise<{
    wantsHalfSandwich: boolean;
}> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this conversation:\n\n${conversationText}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
    });

    try {
        return JSON.parse(completion.choices[0].message.content || '{"wantsHalfSandwich": false}');
    } catch (error) {
        console.error("Error parsing OpenAI half sandwich response:", error);
        return { wantsHalfSandwich: false };
    }
}

// Call Trucube API for Half Sandwich Detection
export async function TrucubeHalfSandwich(
    systemPrompt: string,
    conversationText: string
): Promise<{
    wantsHalfSandwich: boolean;
}> {
    const BEARER_TOKEN = process.env.TRUCUBE_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        throw new Error("TRUCUBE_BEARER_TOKEN is not set");
    }

    try {
        const response = await fetch("http://98.15.217.173:3000/api/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.1:latest",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: `Analyze this conversation:\n\n${conversationText}`,
                    },
                ],
                stream: false,
            }),
        });

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const assistantMessage = data?.choices?.[0]?.message?.content;

        if (!assistantMessage) {
            return { wantsHalfSandwich: false };
        }

        try {
            return JSON.parse(assistantMessage);
        } catch (error) {
            console.error("Error parsing Trucube half sandwich response:", assistantMessage, error);
            return { wantsHalfSandwich: false };
        }
    } catch (error) {
        console.error("Error calling Trucube API for half sandwich:", error);
        return { wantsHalfSandwich: false };
    }
}

// Random name generator for test conversations (Dearborn demographic)
const FIRST_NAMES = ['Fatima', 'Ahmed', 'Nour', 'Layla', 'Hassan', 'Zainab', 'Youssef', 'Rania', 'Omar', 'Maryam', 'Ali', 'Dina', 'Karim', 'Sara', 'Hadi', 'Mariam', 'Bilal', 'Lina', 'Tariq', 'Amira'];
const LAST_NAMES = ['Hassan', 'Ali', 'Bakri', 'Mansour', 'Khalil', 'Ahmad', 'Hammoud', 'Saleh', 'Ibrahim', 'Farah', 'Rahman', 'Mustafa', 'Nasser', 'Khoury', 'Masri', 'Saad'];

export function generateRandomName() {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    return { firstName, lastName };
}

export function generateRandomPhoneNumber() {
    const prefix = '(313) 555-';
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    return `${prefix}${suffix}`;
}

export async function findOrCreateCustomer(storage: IStorage, userId: string, order: any) {
    let customer = await storage.getCustomerByPhoneNumber(userId, order.number);

    if (!customer) {
        const nameParts = (order.firstName && order.lastName)
            ? { firstName: order.firstName, lastName: order.lastName }
            : (order.firstName
                ? { firstName: order.firstName, lastName: null }
                : { firstName: null, lastName: null });

        customer = await storage.createCustomer(userId, {
            userId,
            phoneNumber: order.number,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
        });
    }

    return customer;
}

export async function updateCustomerStats(storage: IStorage, customerId: string, orderTotal: number) {
    let customerStat = await storage.getCustomerStats(customerId);

    if (!customerStat) {
        // Create new stats
        await storage.createCustomerStats(customerId, {
            customerId,
            totalOrders: 1,
            totalSpent: orderTotal.toFixed(2),
            lastOrderDate: new Date(),
        });
    } else {
        // Update existing stats
        const newTotalOrders = (customerStat.totalOrders || 0) + 1;
        const newTotalSpent = parseFloat(customerStat.totalSpent || '0') + orderTotal;

        await storage.updateCustomerStats(customerId, {
            totalOrders: newTotalOrders,
            totalSpent: newTotalSpent.toFixed(2),
            lastOrderDate: new Date(),
        });
    }
}

export async function processCustomerOrder(
    storage: IStorage,
    userId: string,
    order: any,
    orderDetails?: any
) {
    // 1. Find or create customer
    const customer = await findOrCreateCustomer(storage, userId, order);

    // 2. Create or update customer stats
    const totalSpent = parseFloat(orderDetails?.total || order.orderPrice || '0');
    await updateCustomerStats(storage, customer.id, totalSpent);

    // 3. Create order history entry
    await storage.createOrderHistory({
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

    return customer;
}

async function parsePickupTime(pickupTime?: string | Date): Promise<Date | null> {
    if (!pickupTime) return null;

    try {
        if (typeof pickupTime === 'string' && pickupTime.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
            const { parseTimeInRestaurantTimezone } = await import("./timezone.js");
            const parsed = parseTimeInRestaurantTimezone(pickupTime);
            if (parsed) {
                return parsed;
            }
            // Fallback to old method if parsing fails
            const timeMatch = pickupTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);
                const period = timeMatch[3].toUpperCase();

                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;

                const { getRestaurantDateTimeComponents } = await import("./timezone.js");
                const components = getRestaurantDateTimeComponents();
                return new Date(components.year, components.month, components.day, hours, minutes);
            } else {
                return new Date(pickupTime);
            }
        } else {
            return new Date(pickupTime);
        }
    } catch (error) {
        console.error('Error parsing pickup time:', error);
        return null;
    }
}

export async function updateCloverOrder(
    storage: IStorage,
    userId: string,
    order: any,
    orderDetails?: any
) {
    try {
        // Check if order has a Clover order ID
        if (!order.cloverOrderId) {
            console.log('[Clover] Order does not have a Clover order ID, skipping update');
            return;
        }

        // Fetch Clover token record
        const tokenRecord = await db.select()
            .from(oauthTokens)
            .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
            .limit(1);

        if (!tokenRecord[0]) {
            console.log('[Clover] No Clover token found, skipping update');
            return;
        }

        // Decrypt or use fallback access token
        const accessToken = process.env.MERCHENT_API_KEY || "";
        const merchantId = tokenRecord[0].merchantId || 'H4RW04034BGH1';
        const cloverOrderId = order.cloverOrderId;

        console.log(`[Clover] Update - Using Clover order ID: ${cloverOrderId} for order ${order.id}`);

        // Fetch menu items for price matching
        const menuItems = await storage.getMenuItems(userId);

        // Parse order items into line items
        const lineItems: Array<{ name?: string; price?: number; unitQty?: number }> = [];
        const orderItems = orderDetails?.items || order.items || [];

        if (orderItems.length === 0) {
            console.log('[Clover] Skipping Clover order update - no items in order');
            return;
        }

        for (const itemStr of orderItems) {
            const quantityMatch = itemStr.match(/x(\d+)$/i);
            const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
            const itemNameWithPrice = quantityMatch ? quantityMatch[2] : itemStr;

            const priceMatch = itemNameWithPrice.match(/:\s*\$([\d.]+)/);
            const totalPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
            const itemName = itemNameWithPrice.replace(/:\s*\$[\d.]+.*$/, '').trim();

            let unitPrice: number;
            if (totalPrice !== null) {
                unitPrice = totalPrice / quantity;
            } else {
                const matchingMenuItem = menuItems.find(mi =>
                    mi.name.toLowerCase() === itemName.toLowerCase() ||
                    itemName.toLowerCase().includes(mi.name.toLowerCase())
                );
                unitPrice = matchingMenuItem ? parseFloat(matchingMenuItem.price.replace(/[^0-9.]/g, '')) : 9.99;
            }

            const lineItem: any = { name: itemName, price: Math.round(unitPrice * 100), quantitySold: quantity };
            if (lineItem.price > 0) lineItems.push(lineItem);
            else console.warn(`[Clover] Skipping invalid price line item: ${itemName} (${lineItem.price})`);

        }

        if (lineItems.length === 0) {
            console.log('[Clover] Skipping Clover order update - no valid line items parsed');
            return;
        }

        let clientCreatedTime = Date.now();
        const pickupTime = orderDetails?.pickupTime || order.pickupTime;
        if (pickupTime) {
            const parsedPickupTime = await parsePickupTime(pickupTime);
            if (parsedPickupTime) {
                clientCreatedTime = parsedPickupTime.getTime();
            }
        }

        // Build update payload
        const updatePayload: any = {
            orderCart: { lineItems, clientCreatedTime },
        };

        if (order.firstName || order.lastName) {
            updatePayload.title = `Order from ${order.firstName || ''} ${order.lastName || ''}`.trim();
        }

        if (orderDetails?.notes || order.notes) {
            updatePayload.note = orderDetails?.notes || order.notes;
        }

        // Update order in Clover
        // Note: Clover atomic orders may not support updates via standard REST endpoints
        // Try different methods and endpoints
        console.log(`[Clover] Attempting to update Clover order ${cloverOrderId} for merchant ${merchantId}`);
        console.log(`[Clover] Update payload:`, JSON.stringify(updatePayload, null, 2));

        let cloverResponse: Awaited<ReturnType<typeof fetch>> | null = null;
        let lastError: string = '';

        // Try 1: PATCH on regular orders endpoint
        try {
            cloverResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${cloverOrderId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updatePayload),
            });

            if (cloverResponse.ok) {
                const cloverOrder = await cloverResponse.json();
                console.log(`[Clover] ✓ Successfully updated order ${cloverOrderId} in Clover using PATCH`);
                return;
            }
            lastError = await cloverResponse.text();
            console.log(`[Clover] PATCH failed (${cloverResponse.status}): ${lastError}`);
        } catch (error) {
            console.log(`[Clover] PATCH request failed:`, error);
        }

        // Try 2: PUT on regular orders endpoint
        if (!cloverResponse?.ok) {
            try {
                cloverResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${cloverOrderId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updatePayload),
                });

                if (cloverResponse.ok) {
                    const cloverOrder = await cloverResponse.json();
                    console.log(`[Clover] ✓ Successfully updated order ${cloverOrderId} in Clover using PUT`);
                    return;
                }
                lastError = await cloverResponse.text();
                console.log(`[Clover] PUT failed (${cloverResponse.status}): ${lastError}`);
            } catch (error) {
                console.log(`[Clover] PUT request failed:`, error);
            }
        }

        // If all methods fail, log warning but don't throw error
        // Atomic orders created via atomic_order API may not be updatable via standard REST endpoints
        console.warn(`[Clover] Unable to update order ${cloverOrderId} in Clover. This may be expected if the order was created via atomic_order API. Last error: ${lastError}`);
        console.warn(`[Clover] The order exists in Clover with ID ${cloverOrderId}, but updates may need to be done manually in the Clover POS system.`);
    } catch (error) {
        console.error('[Clover] Error updating order in Clover:', error);
    }
}

export async function sendMessageThroughRelay(to: string, message: string): Promise<void> {
    const trimmed = typeof message === "string" ? message.trim() : "";
  
    if (!trimmed) {
      throw Object.assign(new Error("Message is empty"), { reason: "empty-message" });
    }
  
    try {
      const response = await fetch(MESSAGING_SERVICE_URL, {
        method: "POST", 
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          message: trimmed,
        }),
      });
  
      if (!response.ok) {
        let errorBody: string | undefined;
        try {
          errorBody = await response.text();
        } catch (readError) {
          console.error("[Messaging Service] Failed to read error response body", readError);
        }
  
        const error = Object.assign(
          new Error("Messaging service returned a non-OK response"),
          {
            status: response.status,
            statusText: response.statusText,
            body: errorBody,
          }
        );
  
        throw error;
      }
    } catch (error) {
      if (error instanceof Error && !("status" in error)) {
        console.error("[Messaging Service] Error sending message", error);
      }
      throw error;
    }
}


// Calculate total from order items
export function calculateTotalFromItems(items?: string[]): string | undefined {
    if (!items || items.length === 0) {
        return undefined;
    }

    let total = 0;
    let foundPrice = false;

    for (const item of items) {
        const priceMatch = item.match(/:\s*\$([\d.,]+)/);
        if (priceMatch) {
            const value = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (!Number.isNaN(value)) {
                total += value;
                foundPrice = true;
            }
        }
    }

    if (!foundPrice) {
        return undefined;
    }

    return total.toFixed(2);
}

// Helper function to trigger debounced order detection
export async function triggerDebouncedOrderDetection(userId: string, orderId: string) {
    // Clear existing timer if any
    await clearOrderDetectionTimer(orderId);

    // Set new timer for 2 seconds (with Redis support if PRODUCTION=true)
    await setOrderDetectionTimer(userId, orderId, 2000, checkForOrderDetection);
    console.log(`[Order Detection] Debounce timer started for order ${orderId} (2 seconds)`);
}

// Helper function to check for order detection asynchronously
export async function checkForOrderDetection(
    userId: string,
    orderId: string
): Promise<void> {
    // Log immediately to confirm function is called
    console.log(`[Order Detection] Function called for order ${orderId}, userId: ${userId}`);

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
                console.log(`[Order Detection] Calling analyzeOrderSummaryFromConversation for order ${orderId}...`);
                const summaryResult = await analyzeOrderSummaryFromConversation(
                    messages,
                    order.firstName || undefined,
                    menuItems
                );

                const detectedPickupTime = await detectPickupTimeFromConversation(messages, { referenceTime: new Date() });
                const lunchspecialrequest = await detectHalfSandwichRequest(messages);

                console.log(`[Order Detection] Lunch special request: ${lunchspecialrequest}`);

                // If lunch special is requested, add it to summaryResult.orderDetails.items
                if (lunchspecialrequest && summaryResult.orderDetails && menuItems && menuItems.length > 0) {
                    const lunchSpecial = menuItems.find(item => 
                        item.name.toLowerCase().includes('lunch') && 
                        item.name.toLowerCase().includes('special')
                    );

                    if (lunchSpecial) {
                        // Check if lunch special is already in the items
                        const lunchSpecialName = lunchSpecial.name.toLowerCase();
                        const alreadyPresent = summaryResult.orderDetails.items?.some((item: string) => {
                            const itemName = item.toLowerCase();
                            return itemName.includes(lunchSpecialName) || 
                                   (itemName.includes('lunch') && itemName.includes('special'));
                        });

                        if (!alreadyPresent) {
                            // Add lunch special with price in the format "Item Name: $X.XX"
                            const priceNum = parseFloat(lunchSpecial.price.replace(/[^0-9.]/g, ''));
                            const formattedPrice = priceNum.toFixed(2);
                            const lunchSpecialItem = `${lunchSpecial.name}: $${formattedPrice}`;
                            
                            // Ensure items array exists
                            if (!summaryResult.orderDetails.items) {
                                summaryResult.orderDetails.items = [];
                            }
                            
                            summaryResult.orderDetails.items.push(lunchSpecialItem);
                            console.log(`[Order Detection] Added lunch special to summaryResult.orderDetails.items: ${lunchSpecialItem}`);
                        }
                    }
                }

                const analysis = {
                    orderMade: summaryResult.orderMade,
                    orderDetails: summaryResult.orderDetails ? { ...summaryResult.orderDetails } : undefined,
                };

                if (analysis.orderDetails) {
                    if (!analysis.orderDetails.customerName) {
                        analysis.orderDetails.customerName = order.firstName || order.number || "Customer";
                    }

                    if (detectedPickupTime) {
                        analysis.orderDetails.pickupTime = detectedPickupTime;
                    }
                }

                // If lunch special is requested but no order was detected, create an order with just the lunch special
                if (lunchspecialrequest && (!analysis.orderMade || !analysis.orderDetails)) {
                    const lunchSpecial = menuItems.find(item => 
                        item.name.toLowerCase().includes('lunch') && 
                        item.name.toLowerCase().includes('special')
                    );

                    if (lunchSpecial) {
                        const priceNum = parseFloat(lunchSpecial.price.replace(/[^0-9.]/g, ''));
                        const formattedPrice = priceNum.toFixed(2);
                        const lunchSpecialItem = `${lunchSpecial.name}: $${formattedPrice}`;
                        
                        // Create order details with just the lunch special
                        analysis.orderMade = true;
                        analysis.orderDetails = {
                            customerName: order.firstName || order.number || "Customer",
                            items: [lunchSpecialItem],
                        };

                        // Add pickup time if detected
                        if (detectedPickupTime) {
                            analysis.orderDetails.pickupTime = detectedPickupTime;
                        }

                        console.log(`[Order Detection] Created order from lunch special request in checkForOrderDetection: ${lunchSpecialItem}`);
                    }
                }

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
                        const previousLines = previousText.split('\n').filter((line: string) => line.trim());
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
                            console.log(`[Order Detection] Pickup time included in order details (${pickupTimeValue}), persisting detection flag...`);

                            // Set the flag so pickup time detection knows it was already found
                            await storage.updatePickupTimeDetected(orderId, true);
                        } else {
                            console.log(`[Order Detection] No pickup time in order details for order ${orderId}, pickupTimeDetected flag not set`);
                        }

                        console.log(`[Order Detection] ✓ Order detected and message saved successfully for order ${orderId}`);

                        // Ensure orderDetails exists (it should at this point, but TypeScript needs the check)
                        const orderDetails = analysis.orderDetails;
                        if (orderDetails) {

                            try {
                                const derivedTotal = calculateTotalFromItems(orderDetails.items);
                                const updatePayload: {
                                    items?: string[];
                                    notes?: string | null;
                                    pickupTime?: string | Date;
                                    total?: string;
                                } = {
                                    items: orderDetails.items,
                                    pickupTime: orderDetails.pickupTime, // This will be stored in notes by updateOrderFromDetails
                                    total: derivedTotal,
                                };

                                // Notes will be handled in updateOrderFromDetails (it will append pickup time to notes)
                                // Only set notes if pickupTime is not present (to avoid conflicts)
                                if (orderDetails.notes !== undefined && !orderDetails.pickupTime) {
                                    updatePayload.notes = orderDetails.notes ?? null;
                                }

                                const { updateOrderFromDetails } = await import("./services/orders.service.js");
                                await updateOrderFromDetails(
                                    storage,
                                    orderId,
                                    updatePayload,
                                    { skipStatusUpdate: true }
                                );
                                console.log(`[Order Detection] Persisted AI order details to order ${orderId}`);
                            } catch (persistError) {
                                console.error(`[Order Detection] Failed to persist AI order details for order ${orderId}:`, persistError);
                            }
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

  