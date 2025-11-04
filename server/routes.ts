import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import passport from "./auth";
import { storage } from "./storage";
import { insertUserSchema, type Conversation, type Message, orderConversations } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { WebSocketServer, WebSocket } from "ws";
import { sessionMiddleware } from "./index";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

// Middleware to check if user is authenticated
export const isAuthenticated = (req: any, res: any, next: any) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation contexts for AI conversations
const aiConversationContexts = new Map<string, Array<{ role: 'system' | 'user' | 'assistant', content: string }>>();

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
  customerName?: string
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

  const systemPrompt = `You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.

IMPORTANT: Current time is ${currentTimeString}. When a pickup time is mentioned, you MUST convert it to an absolute time.

If an order has been placed, extract:
1. Customer name (if mentioned)
2. All items ordered (be specific, include quantities and customizations)
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
    "items": ["item 1", "item 2", ...],
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
function formatOrderMessage(orderDetails: { customerName: string; items: string[]; pickupTime?: string; notes?: string }): string {
  let message = `Customer: ${orderDetails.customerName}\n`;

  // Add each item on its own line with spacing
  orderDetails.items.forEach((item) => {
    message += `\n${item}`;
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

        // Check if order already exists
        const orderAlreadyExists = order.orderMade === true;
        const existingAIOrganizedMessage = messages.find(msg => msg.isAIOrganized === true);

        // If order already exists, we only proceed if we want to check for pickup time updates
        if (orderAlreadyExists && !existingAIOrganizedMessage) {
          console.log(`[Order Detection] Order ${orderId} already has orderMade=true but no AI organized message, skipping`);
          resolve();
          return;
        }

        console.log(`[Order Detection] Order ${orderId} has orderMade=${order.orderMade}, proceeding with analysis`);

        // Analyze conversation for order
        console.log(`[Order Detection] Calling analyzeOrderFromConversation for order ${orderId}...`);
        const analysis = await analyzeOrderFromConversation(
          messages,
          order.firstName || undefined
        );

        console.log(`[Order Detection] Analysis result for order ${orderId}:`, {
          orderMade: analysis.orderMade,
          hasDetails: !!analysis.orderDetails,
          pickupTime: analysis.orderDetails?.pickupTime,
          pickupTimeType: typeof analysis.orderDetails?.pickupTime
        });

        if (analysis.orderMade && analysis.orderDetails) {
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

          // If order already exists, check if pickup time has changed
          if (orderAlreadyExists && existingAIOrganizedMessage) {
            // Extract existing pickup time from AI organized message
            const existingPickupTimeMatch = existingAIOrganizedMessage.text.match(/Pickup Time:\s*(.+?)(?:\n|$)/i);
            const existingPickupTime = existingPickupTimeMatch ? existingPickupTimeMatch[1].trim() : null;

            // Only update if pickup time has changed
            if (hasPickupTime && pickupTimeValue !== existingPickupTime) {
              console.log(`[Order Detection] Pickup time changed from "${existingPickupTime}" to "${pickupTimeValue}", updating AI organized message...`);

              // Update the existing AI organized message with new pickup time
              const updatedMessageText = formatOrderMessage(analysis.orderDetails);

              // Update the message in the messages array
              const updatedMessages = messages.map(msg =>
                msg.id === existingAIOrganizedMessage.id
                  ? { ...msg, text: updatedMessageText, timestamp: new Date().toISOString() }
                  : msg
              );

              // Update conversation with new messages array
              const updatedConversation = await storage.getOrderConversation(userId, orderId);
              if (updatedConversation) {
                await db.update(orderConversations)
                  .set({
                    messages: updatedMessages,
                    updatedAt: new Date()
                  })
                  .where(and(
                    eq(orderConversations.userId, userId),
                    eq(orderConversations.orderId, orderId)
                  ));
              }

              // Update pickup time detected flag
              await storage.updatePickupTimeDetected(orderId, true);

              // Send updated pickup time to frontend via WebSocket
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'pickup_time_detected',
                  orderId: orderId,
                  pickupTime: pickupTimeValue,
                  timestamp: new Date().toISOString(),
                }));
                console.log(`[Order Detection] ✓ Sent updated pickup time "${pickupTimeValue}" to frontend for order ${orderId}`);

                // Also send the updated AI organized message
                ws.send(JSON.stringify({
                  type: 'message_received',
                  text: updatedMessageText,
                  timestamp: new Date().toISOString(),
                  isAIOrganized: true,
                }));
                console.log(`[Order Detection] ✓ Sent updated AI organized message via WebSocket for order ${orderId}`);
              }

              console.log(`[Order Detection] ✓ Pickup time updated successfully for order ${orderId}`);
              resolve();
              return;
            } else {
              console.log(`[Order Detection] Pickup time unchanged (${pickupTimeValue}), skipping update`);
              resolve();
              return;
            }
          }

          // If order doesn't exist yet, create it normally
          if (!orderAlreadyExists) {
            // Final check before creating message
            const finalOrderCheck = await storage.getOrderById(userId, orderId);
            if (finalOrderCheck && finalOrderCheck.orderMade === true) {
              console.log(`[Order Detection] Order ${orderId} was processed by another process, skipping`);
              resolve();
              return;
            }

            // Format and save AI organized message
            const orderMessageText = formatOrderMessage(analysis.orderDetails);
            console.log(`[Order Detection] Formatted order message for order ${orderId}:`, orderMessageText.substring(0, 100));

            const orderMessage: Message = {
              id: randomUUID(),
              text: orderMessageText,
              isOutgoing: false,
              timestamp: new Date().toISOString(),
              isAIOrganized: true,
            };

            // Save the AI organized message
            console.log(`[Order Detection] Saving AI organized message to database for order ${orderId}...`);
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

            // Send to client via WebSocket if available and open
            if (ws) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'message_received',
                  text: orderMessageText,
                  timestamp: orderMessage.timestamp,
                  isAIOrganized: true,
                }));
                console.log(`[Order Detection] ✓ Sent AI organized message via WebSocket for order ${orderId}`);
              } else {
                console.log(`[Order Detection] WebSocket not open (state: ${ws.readyState}) for order ${orderId}, message saved to DB only`);
              }
            } else {
              console.log(`[Order Detection] No WebSocket provided for order ${orderId}, message saved to DB only`);
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

  // Summarize order (manually trigger order detection)
  app.post("/api/orders/:orderId/summarize", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Trigger order detection manually
      console.log(`[API] Manual summarization requested for order ${orderId}`);
      await checkForOrderDetection(userId, orderId);

      // Wait a moment for updates to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if pickup time was updated by looking at the conversation messages
      const conversation = await storage.getOrderConversation(userId, orderId);
      let updatedPickupTime: string | undefined;

      if (conversation && conversation.messages) {
        const messages = conversation.messages as Message[];
        const aiOrganizedMessage = messages.find(msg => msg.isAIOrganized === true);
        if (aiOrganizedMessage) {
          const pickupTimeMatch = aiOrganizedMessage.text.match(/Pickup Time:\s*(.+?)(?:\n|$)/i);
          if (pickupTimeMatch && pickupTimeMatch[1]) {
            updatedPickupTime = pickupTimeMatch[1].trim();
          }
        }
      }

      res.json({
        success: true,
        message: 'Order summarization triggered',
        pickupTime: updatedPickupTime
      });
    } catch (error) {
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
      // Note: Order detection happens after AI/customer responds, not after Rod sends

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

        // Check for pickup time detection automatically (independent of order detection)
        console.log(`[API] Triggering automatic pickup time detection check for order ${orderId} after AI response`);
        checkForPickupTimeDetection(userId, orderId);

        // Note: Order detection is now manual - user clicks the Summarizer button
      } else {
        // Regular chat (non-AI) - customer messages come from external sources
        // Check for pickup time detection automatically when customer messages are received
        console.log(`[API] Triggering automatic pickup time detection check for order ${orderId} after customer message`);
        checkForPickupTimeDetection(userId, orderId);
        // Order detection will be triggered when user clicks Summarizer button
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

        } else if (type === 'summarize') {
          // Manual order summarization triggered by user
          console.log(`[WebSocket] Manual summarization requested for order ${orderId}`);
          await checkForOrderDetection(userId, orderId, ws);

          // Note: Pickup time detection runs automatically on every message, so we don't need to trigger it here
          // But if order detection found a pickup time, it will have set the flag, so pickup time detection will skip

        } else if (type === 'send_message') {
          // Rod sends a message to the AI customer
          const context = aiConversationContexts.get(orderId);

          if (!context) {
            ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }));
            return;
          }

          // Save Rod's message (only if it's not empty)
          if (text && text.trim()) {
            const rodMessage: Message = {
              id: randomUUID(),
              text: text.trim(),
              isOutgoing: false,
              timestamp: new Date().toISOString(),
            };
            await storage.addMessageToOrder(userId, orderId, rodMessage);
            await storage.updateOrderLastMessage(orderId, new Date());
            // Note: Order detection happens after AI/customer responds, not after Rod sends
          }

          // Add Rod's message to context (use the text or a default prompt if empty)
          const contextMessage = text && text.trim()
            ? `Rod (restaurant manager) says: ${text.trim()}`
            : "Rod (restaurant manager) sent the initial greeting";
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
              text: aiResponse,
            }));
          }

          // Send stream complete signal
          ws.send(JSON.stringify({
            type: 'message_stream_complete',
            messageId: aiMessageId,
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

          // Check for pickup time detection automatically (independent of order detection)
          console.log(`[WebSocket] Triggering automatic pickup time detection check for order ${orderId} after AI response`);
          checkForPickupTimeDetection(userId, orderId, ws);

          // Note: Order detection is now manual - user clicks the Summarizer button
        }
      } catch (error: any) {
        console.error('WebSocket error:', error);
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  return httpServer;
}
