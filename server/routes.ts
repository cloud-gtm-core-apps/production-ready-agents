import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import passport from "./auth";
import { storage } from "./storage";
import { insertUserSchema, type Message, type MenuItem } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { users, oauthTokens, menuItemPopularityAggregates, orders } from "@shared/schema";
import { isAuthenticated } from "./utils";
import { encrypt, decrypt, getMenuItemsWithCache, formatOrderMessage, generateRandomName, generateRandomPhoneNumber, processCustomerOrder, updateOrderFromDetails, createCloverOrder, updateCloverOrder } from "./utils";
import { openai } from "./clients";
import { aiConversationContexts, orderDetectionTimers, menuItemsCache, sseClients, aiSuggestedResponses } from "./globals";
import { analyzeOrderSummaryFromConversation, detectPickupTimeFromConversation, generateAISuggestedResponse } from "./aiFunctions";
const MESSAGING_SERVICE_URL = "https://macgateway.ngrok.app/send";

async function sendMessageThroughRelay(to: string, message: string): Promise<void> {
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

const INITIAL_TEST_GREETING = "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.";

function emitSSE(userId: string, event: string, data: unknown) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  const staleClients: Response[] = [];

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

function calculateTotalFromItems(items?: string[]): string | undefined {
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
function triggerDebouncedOrderDetection(userId: string, orderId: string) {
  // Clear existing timer if any
  const existingTimer = orderDetectionTimers.get(orderId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer for 2 seconds
  const timer = setTimeout(async () => {
    console.log(`[Order Detection] Debounce timer expired for order ${orderId}, triggering analysis...`);
    await checkForOrderDetection(userId, orderId);
    orderDetectionTimers.delete(orderId);
  }, 2000); // 2 second debounce

  orderDetectionTimers.set(orderId, timer);
  console.log(`[Order Detection] Debounce timer started for order ${orderId} (2 seconds)`);
}

// Helper function to check for order detection asynchronously
async function checkForOrderDetection(
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

        const analysis = {
          orderMade: summaryResult.orderMade,
          orderDetails: summaryResult.orderDetails ? { ...summaryResult.orderDetails } : undefined,
        };

        const detectedPickupTime = detectPickupTimeFromConversation(messages, { referenceTime: new Date() });
        if (analysis.orderDetails) {
          if (!analysis.orderDetails.customerName) {
            analysis.orderDetails.customerName = order.firstName || order.number || "Customer";
          }

          if (detectedPickupTime) {
            analysis.orderDetails.pickupTime = detectedPickupTime;
          }
        }

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
              console.log(`[Order Detection] Prepared structured order details for order ${orderId}:`, {
                items: orderDetails.items,
                notes: orderDetails.notes,
                pickupTime: orderDetails.pickupTime,
              });

              try {
                const derivedTotal = calculateTotalFromItems(orderDetails.items);
                const updatePayload: {
                  items?: string[];
                  notes?: string | null;
                  pickupTime?: string | Date;
                  total?: string;
                } = {
                  items: orderDetails.items,
                  pickupTime: orderDetails.pickupTime,
                  total: derivedTotal,
                };

                if (orderDetails.notes !== undefined) {
                  updatePayload.notes = orderDetails.notes ?? null;
                }

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
            } : undefined,
            aiSuggestedResponse: aiSuggestedResponses.get(order.id) ?? undefined,
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

      // Create or update customer, stats, and history
      // const customer = await processCustomerOrder(storage, userId, order, orderDetails);

      // Update order status, price, pickup time, items, and notes
      await updateOrderFromDetails(storage, orderId, orderDetails);

      // 5. Create order in Clover (if Clover is connected)
      await createCloverOrder(storage, userId, order, orderDetails);

      let formattedTime = 'a later time today';

      if (order.pickupTime) {
        const pickupTime = new Date(order.pickupTime);
        const hours = pickupTime.getHours();
        const minutes = pickupTime.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;
        formattedTime = `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
      }

      // 6. Send confirmation message to customer
      try {
        const confirmationMessageId = randomUUID();
        const confirmationMessage: Message = {
          id: confirmationMessageId,
          text: `Thanks for ordering! Your order is confirmed and will be ready for pickup at ${formattedTime}.`,
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save confirmation message to database
        await storage.addMessageToOrder(userId, orderId, confirmationMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        console.log(`[Send to Preparation] Confirmation message prepared for order ${orderId}`);

        try {
          if (order.number) {
            await sendMessageThroughRelay(order.number, confirmationMessage.text);
            console.log(`[Send to Preparation] Sent confirmation message via messaging service to ${order.number}`);
          } else {
            console.warn(`[Send to Preparation] Order ${orderId} is missing a contact number; skipping messaging service send.`);
          }
        } catch (error) {
          console.error('[Send to Preparation] Failed to deliver confirmation message via messaging service', {
            error,
            orderId,
            number: order.number,
          });
        }
      } catch (error) {
        console.error('[Send to Preparation] Error sending confirmation message:', error);
        // Don't fail the request if message sending fails
      }

      res.json({
        success: true,
        message: 'Order sent to preparation successfully'
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

      // // Get updated order with latest details (including cloverOrderId)
      // const updatedOrder = await storage.getOrderById(userId, orderId);
      // if (!updatedOrder) {
      //   return res.status(404).json({ message: 'Order not found after update' });
      // }

      // console.log('[Mark Ready] Updated order:', updatedOrder);

      // // Build orderDetails from the current order
      // const orderDetails = {
      //   items: updatedOrder.items || [],
      //   notes: updatedOrder.notes || null,
      //   pickupTime: updatedOrder.pickupTime || undefined,
      //   total: updatedOrder.orderPrice || undefined,
      // };
      // await updateCloverOrder(storage, userId, updatedOrder, orderDetails);

      // Send ready for pickup message to customer
      try {
        // Format pickup time if available
        let messageText = 'Your order is all set! Come by anytime to pick it up.';

        const readyMessageId = randomUUID();
        const readyMessage: Message = {
          id: readyMessageId,
          text: messageText,
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save ready message to database
        await storage.addMessageToOrder(userId, orderId, readyMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        console.log(`[Mark Ready] Ready message prepared for order ${orderId}`);

        try {
          if (order.number) {
            await sendMessageThroughRelay(order.number, readyMessage.text);
            console.log(`[Mark Ready] Sent ready message via messaging service to ${order.number}`);
          } else {
            console.warn(`[Mark Ready] Order ${orderId} is missing a contact number; skipping messaging service send.`);
          }
        } catch (error) {
          console.error('[Mark Ready] Failed to deliver ready message via messaging service', {
            error,
            orderId,
            number: order.number,
          });
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

      // Generate AI suggested response and return it to the client
      const suggestedResponse = await generateAISuggestedResponse(messages, userId, orderId);

      if (suggestedResponse && suggestedResponse.trim()) {
        aiSuggestedResponses.set(orderId, suggestedResponse.trim());
      } else {
        aiSuggestedResponses.delete(orderId);
      }

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

      const trimmedMessage =
        typeof message === "string" ? message.trim() : "";

      if (!trimmedMessage) {
        return res.status(400).json({ message: 'Message is required' });
      }

      // Get the order to find the phone number
      const order = await storage.getOrderById(userId, orderId);

      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      if (!order.number) {
        return res.status(400).json({ message: 'Order does not have a contact number' });
      }

      try {
        await sendMessageThroughRelay(order.number, trimmedMessage);
      } catch (error) {
        console.error("[Messaging Service] Failed to send message", {
          error,
          orderId,
          to: order.number,
        });

        if (error && typeof error === "object" && "status" in error) {
          return res.status(502).json({ message: "Failed to deliver message via messaging service" });
        }

        return res.status(502).json({ message: "Failed to deliver message via messaging service" });
      }

      aiSuggestedResponses.delete(orderId);

      // Save Rod's message to the database
      // isOutgoing: false = restaurant messages (Rod's messages)
      const rodMessage: Message = {
        id: randomUUID(),
        text: trimmedMessage,
        isOutgoing: false,
        timestamp: new Date().toISOString(),
      };
      await storage.addMessageToOrder(userId, orderId, rodMessage);
      await storage.updateOrderLastMessage(orderId, new Date());

      emitSSE(userId, 'order-message', {
        orderId,
        message: rodMessage,
        source: 'outgoing',
        aiSuggestedResponse: null,
      });

      // Trigger debounced order detection after Rod's message
      triggerDebouncedOrderDetection(userId, orderId);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/orders/:orderId/ai-suggested-reply", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      const conversation = await storage.getOrderConversation(userId, orderId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const allMessages = (conversation.messages as Message[]) || [];

      let suggestion = aiSuggestedResponses.get(orderId) ?? null;

      if (!suggestion) {
        suggestion = await generateAISuggestedResponse(allMessages, userId, orderId);

        if (suggestion && suggestion.trim()) {
          aiSuggestedResponses.set(orderId, suggestion.trim());
        } else {
          aiSuggestedResponses.delete(orderId);
          suggestion = null;
        }
      }

      res.json({ suggestion });
    } catch (error) {
      console.error('Error generating AI suggested reply:', error);
      next(error);
    }
  });

  app.get("/api/orders/:orderId/ai-order-summary", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      const conversation = await storage.getOrderConversation(userId, orderId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const messages = (conversation.messages as Message[]) || [];
      const menuItems = await getMenuItemsWithCache(userId);
      const summaryResult = await analyzeOrderSummaryFromConversation(messages, order.firstName || undefined, menuItems);
      const pickupTimeFromConversation = detectPickupTimeFromConversation(messages, { referenceTime: new Date() });

      if (!summaryResult.orderMade || !summaryResult.orderDetails) {
        return res.json({ orderMade: false, summary: null, details: summaryResult.orderDetails ?? null });
      }

      const orderDetails = { ...summaryResult.orderDetails };
      if (!orderDetails.customerName) {
        orderDetails.customerName = order.firstName || order.number || "Customer";
      }
      if (pickupTimeFromConversation) {
        orderDetails.pickupTime = pickupTimeFromConversation;
      }

      const summary = formatOrderMessage(orderDetails, menuItems);

      res.json({
        orderMade: true,
        summary,
        details: orderDetails,
      });
    } catch (error) {
      console.error('Error generating AI order summary:', error);
      next(error);
    }
  });

  app.get("/api/events", isAuthenticated, (req, res) => {
    const userId = (req.user as any).id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();

    res.write(`data: ${JSON.stringify({ event: "connected" })}\n\n`);

    const clients = sseClients.get(userId) ?? new Set<Response>();
    clients.add(res);
    sseClients.set(userId, clients);

    const keepAlive = setInterval(() => {
      res.write(":\n\n");
    }, 30000);

    req.on("close", () => {
      clearInterval(keepAlive);
      const set = sseClients.get(userId);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          sseClients.delete(userId);
        }
      }
      res.end();
    });
  });

  app.post("/sms/reply", async (req, res) => {
    try {
      const { From, To, Body } = req.body || {};

      console.log('[SMS Reply] Incoming SMS', {
        from: From,
        to: To,
        body: Body,
      });

      const incomingNumber = typeof From === 'string' ? From.trim() : '';
      const messageText = typeof Body === 'string' ? Body.trim() : '';

      if (!incomingNumber || !messageText) {
        res.status(200).type('text/xml').send('<Response></Response>');
        return;
      }

      const message: Message = {
        id: randomUUID(),
        text: messageText,
        isOutgoing: true,
        timestamp: new Date().toISOString(),
      };

      const existingOrder = await db.select().from(orders).where(eq(orders.number, incomingNumber)).limit(1);

      let userId: string;
      let orderId: string;
      let isNewOrder = false;

      if (existingOrder.length > 0) {
        const order = existingOrder[0];
        userId = order.userId;
        orderId = order.id;

        // Check if order is from a previous day (older than today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const orderLastMessage = order.lastMessage ? new Date(order.lastMessage) : null;
        const isOldOrder = orderLastMessage && orderLastMessage < today;

        // If order is completed OR if it's an old order (from yesterday or earlier), reset it to New status
        if (order.status === 'Completed' || isOldOrder) {
          const reason = order.status === 'Completed' ? 'completed' : 'old order from previous day';
          console.log(`[SMS Reply] Resetting ${reason} order ${orderId} to New status for phone number ${incomingNumber}`);

          await storage.updateOrderStatus(orderId, 'New');
          await storage.updateOrderMade(orderId, false);
          await storage.updatePickupTimeDetected(orderId, false);

          // Reset order details to start fresh
          await storage.updateOrderDetails(orderId, {
            items: [],
            orderPrice: '0.00',
            notes: '',
          });
          // Reset pickupTime to null explicitly
          await db.update(orders)
            .set({ pickupTime: null })
            .where(eq(orders.id, orderId));
        }
      } else {
        const existingUser = await db.select().from(users).limit(1);
        if (!existingUser[0]) {
          console.error('[SMS Reply] No user available to attach incoming SMS.');
          res.status(500).type('text/xml').send('<Response></Response>');
          return;
        }

        userId = existingUser[0].id;

        const newOrder = await storage.createOrder({
          userId,
          firstName: null,
          lastName: null,
          number: incomingNumber,
          firstMessage: messageText,
          status: 'New',
          lastMessage: new Date(),
          pickupTime: null,
          items: [],
          orderPrice: '0.00',
          notes: '',
          orderMade: false,
          pickupTimeDetected: false,
        });

        orderId = newOrder.id;
        isNewOrder = true;
      }

      // Save message immediately - this is the critical path
      await storage.addMessageToOrder(userId, orderId, message);
      await storage.updateOrderLastMessage(orderId, new Date());

      // Emit SSE event immediately so frontend sees the message right away
      emitSSE(userId, 'order-message', {
        orderId,
        message,
        number: incomingNumber,
        source: 'incoming',
        isNewOrder,
        aiSuggestedResponse: null, // Will be updated asynchronously
      });

      // Send response immediately to prevent webhook timeouts and retries
      res.status(200).type('text/xml').send('<Response></Response>');

      // Process everything else asynchronously (fire and forget) to avoid blocking
      // This ensures messages are never stuck in queue
      (async () => {
        try {
          // Trigger order detection (non-blocking)
          triggerDebouncedOrderDetection(userId, orderId);

          // Generate AI suggestion asynchronously
          let aiSuggestion: string | null = null;
          try {
            const conversation = await storage.getOrderConversation(userId, orderId);
            if (conversation) {
              const allMessages = (conversation.messages as Message[]) || [];
              aiSuggestion = await generateAISuggestedResponse(allMessages, userId, orderId);

              if (aiSuggestion && aiSuggestion.trim()) {
                aiSuggestion = aiSuggestion.trim();
                aiSuggestedResponses.set(orderId, aiSuggestion);
                console.log('[SMS Reply] AI suggested response refreshed for incoming SMS');

                // Emit SSE event again with AI suggestion
                emitSSE(userId, 'order-message', {
                  orderId,
                  message,
                  number: incomingNumber,
                  source: 'incoming',
                  isNewOrder,
                  aiSuggestedResponse: aiSuggestion,
                });
              } else {
                aiSuggestedResponses.delete(orderId);
              }
            } else {
              aiSuggestedResponses.delete(orderId);
            }
          } catch (error) {
            aiSuggestedResponses.delete(orderId);
            console.error('[SMS Reply] Error refreshing AI suggested response:', error);
          }
        } catch (error) {
          console.error('[SMS Reply] Error in async processing:', error);
        }
      })();
    } catch (error) {
      console.error('[SMS Reply] Error handling incoming SMS:', error);
      res
        .status(500)
        .type('text/xml')
        .send('<Response></Response>');
    }
  });

  const httpServer = createServer(app);

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
