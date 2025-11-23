// Core Node Modules
import { randomUUID } from "crypto";
import type { Express, Response } from "express";
import { createServer, type Server } from "http";

// External Packages
import { eq } from "drizzle-orm";

// Internal: Auth & Storage
import { storage } from "../storage.js";

// Internal: Database & Schema
import { db } from "../db.js";
import {
  type Message,
  users,
  orders
} from "@shared/schema";

// Internal: Utilities
import {
  getRecentSSEEvents,
  setupRedisSSESubscription,
  getOptInStatus,
  setOptInStatus,
  sendSSEToClients,
  emitSSE,
  triggerDebouncedOrderDetection,
} from "../utils.js";
import { isAuthenticated } from "../utils.js";
import { sendMessageThroughRelay } from "../utils.js";

// Internal: AI Functions
import {
  generateAISuggestedResponse
} from "../aiFunctions.js";

// Internal: Globals
import {
  sseClients,
  aiSuggestedResponses,
} from "../globals.js";

// Internal: Route Handlers
import { registerAuthRoutes } from "./auth.routes.js";
import { registerMenuRoutes } from "./menu.routes.js";
import { registerOrdersRoutes } from "./orders.route.js";
import { registerConversationsRoutes } from "./conversations.route.js";
import { registerTwilioRoutes } from "./twilio.routes.js";
import { registerAnalyticsRoutes } from "./analytics.routes.js";
import { registerCloverRoutes } from "./clover.routes.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Redis SSE subscription (if PRODUCTION=true)
  if (process.env.PRODUCTION === 'true') {
    setupRedisSSESubscription((userId, event, data) => {
      const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
      sendSSEToClients(userId, payload);
    });
  }
  // Auth routes
  registerAuthRoutes(app);

  // Menu routes
  registerMenuRoutes(app);

  // Orders routes
  registerOrdersRoutes(app);

  // Conversations routes
  registerConversationsRoutes(app);

  // Twilio routes
  registerTwilioRoutes(app);

  // Analytics routes
  registerAnalyticsRoutes(app);

  // Clover routes
  registerCloverRoutes(app);

  app.get("/api/events", isAuthenticated, async (req, res) => {
    const userId = (req.user as any).id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();

    res.write(`data: ${JSON.stringify({ event: "connected" })}\n\n`);

    // Send any recent events from Redis (if PRODUCTION=true)
    if (process.env.PRODUCTION === 'true') {
      try {
        const recentEvents = await getRecentSSEEvents(userId);
        // Send events in reverse order (oldest first) so client processes them chronologically
        for (const sseEvent of recentEvents.reverse()) {
          const payload = `data: ${JSON.stringify({ event: sseEvent.event, data: sseEvent.data })}\n\n`;
          res.write(payload);
        }
        if (recentEvents.length > 0) {
          console.log(`[SSE] Sent ${recentEvents.length} recent events to userId ${userId}`);
        }
      } catch (error) {
        console.error(`[SSE] Error sending recent events to userId ${userId}:`, error);
      }
    }

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

      // Create message object first
      const message: Message = {
        id: randomUUID(),
        text: messageText,
        isOutgoing: true,
        timestamp: new Date().toISOString(),
      };

      // Check if Twilio Campaign mode is enabled
      const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';

      // Handle Twilio Campaign opt-in flow keywords BEFORE creating/getting order
      let shouldProcessNormally = true;
      let confirmationMessage: string | null = null;
      let shouldSendOptInReminder = false;

      if (isTwilioCampaign) {
        const optInStatus = await getOptInStatus(incomingNumber);
        const upperMessage = messageText.toUpperCase().trim();

        // Handle STOP keyword (always processed first)
        if (upperMessage === 'STOP') {
          await setOptInStatus(incomingNumber, 'opted-out');
          console.log(`[Twilio Campaign] ${incomingNumber} opted out`);
          shouldProcessNormally = false; // Don't process through normal flow, but still save message
        }
        // Handle ORDER keyword (initial opt-in request)
        else if (upperMessage === 'ORDER') {
          await setOptInStatus(incomingNumber, 'pending');
          confirmationMessage = "OrderBot: Reply YES to confirm you want to place orders & receive order confirmations/replies via text from OrderBot. Msg&Data rates may apply. Reply STOP to unsubscribe.";
          shouldProcessNormally = false; // Don't process through normal flow, but still save message
        }
        // Handle YES/Y confirmation (must be in pending state)
        else if ((upperMessage === 'YES' || upperMessage === 'Y') && optInStatus === 'pending') {
          await setOptInStatus(incomingNumber, 'opted-in');
          console.log(`[Twilio Campaign] ${incomingNumber} confirmed opt-in`);
          shouldProcessNormally = true; // Now they can proceed with normal flow
        }
        // User has opted out - ignore the message
        else if (optInStatus === 'opted-out') {
          console.log(`[Twilio Campaign] Ignoring message from opted-out user ${incomingNumber}`);
          res.status(200).type('text/xml').send('<Response></Response>');
          return; // Don't save or emit SSE for opted-out users
        }
        // User is in pending state but didn't send YES/Y
        else if (optInStatus === 'pending') {
          console.log(`[Twilio Campaign] Ignoring message from ${incomingNumber} - still pending opt-in confirmation`);
          shouldProcessNormally = false; // Don't process through normal flow, but still save message
          shouldSendOptInReminder = true; // Send reminder to reply YES
        }
        // If status is not opted-in and not pending, user hasn't started opt-in process
        else if (optInStatus !== 'opted-in') {
          console.log(`[Twilio Campaign] Ignoring message from ${incomingNumber} - not opted in`);
          shouldProcessNormally = false; // Don't process through normal flow, but still save message
        }
      }

      // Find or create order first (we need this for saving messages and emitting SSE)
      // We ALWAYS create/get order and save message, even for opt-in flow messages
      const existingOrder = await db.select().from(orders).where(eq(orders.number, incomingNumber)).limit(1);

      let userId: string;
      let orderId: string;
      let isNewOrder = false;

      if (existingOrder.length > 0) {
        const order = existingOrder[0];
        userId = order.userId;
        orderId = order.id;

        // Only reset order status if we're processing normally (not opt-in flow)
        if (shouldProcessNormally) {
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
      // We ALWAYS save the message, even for opt-in flow messages
      await storage.addMessageToOrder(userId, orderId, message);
      await storage.updateOrderLastMessage(orderId, new Date());

      // Emit SSE event immediately so frontend sees the message right away
      // We ALWAYS emit SSE, even for opt-in flow messages
      await emitSSE(userId, 'order-message', {
        orderId,
        message,
        number: incomingNumber,
        source: 'incoming',
        isNewOrder,
        aiSuggestedResponse: null, // Will be updated asynchronously
      });

      // Send confirmation message if needed (for ORDER keyword)
      if (confirmationMessage) {
        (async () => {
          try {
            // Send via SMS
            await sendMessageThroughRelay(incomingNumber, confirmationMessage);
            console.log(`[Twilio Campaign] Sent confirmation message to ${incomingNumber}`);

            // Save confirmation message to database as restaurant message (isOutgoing: false)
            const confirmationMsg: Message = {
              id: randomUUID(),
              text: confirmationMessage,
              isOutgoing: false, // false = restaurant messages (Rod's messages)
              timestamp: new Date().toISOString(),
            };
            await storage.addMessageToOrder(userId, orderId, confirmationMsg);
            await storage.updateOrderLastMessage(orderId, new Date());

            // Emit SSE event so frontend sees the confirmation message
            await emitSSE(userId, 'order-message', {
              orderId,
              message: confirmationMsg,
              number: incomingNumber,
              source: 'outgoing',
              aiSuggestedResponse: null,
            });
          } catch (error) {
            console.error(`[Twilio Campaign] Failed to send confirmation message to ${incomingNumber}:`, error);
          }
        })();
      }

      // Send opt-in reminder if user is in pending state and sent a message
      if (shouldSendOptInReminder) {
        (async () => {
          try {
            const reminderMessage = "Please reply YES to confirm you want to place orders and receive order confirmations via text. Reply STOP to unsubscribe.";

            // Send via SMS
            await sendMessageThroughRelay(incomingNumber, reminderMessage);
            console.log(`[Twilio Campaign] Sent opt-in reminder to ${incomingNumber}`);

            // Save reminder message to database as restaurant message (isOutgoing: false)
            const reminderMsg: Message = {
              id: randomUUID(),
              text: reminderMessage,
              isOutgoing: false, // false = restaurant messages (Rod's messages)
              timestamp: new Date().toISOString(),
            };
            await storage.addMessageToOrder(userId, orderId, reminderMsg);
            await storage.updateOrderLastMessage(orderId, new Date());

            // Emit SSE event so frontend sees the reminder message
            await emitSSE(userId, 'order-message', {
              orderId,
              message: reminderMsg,
              number: incomingNumber,
              source: 'outgoing',
              aiSuggestedResponse: null,
            });
          } catch (error) {
            console.error(`[Twilio Campaign] Failed to send opt-in reminder to ${incomingNumber}:`, error);
          }
        })();
      }

      // Send response immediately to prevent webhook timeouts and retries
      res.status(200).type('text/xml').send('<Response></Response>');

      // Process everything else asynchronously (fire and forget) to avoid blocking
      // This ensures messages are never stuck in queue
      // Only process normal order flow if shouldProcessNormally is true (opted-in users)
      if (shouldProcessNormally) {
        (async () => {
          try {
            // Trigger order detection (non-blocking)
            await triggerDebouncedOrderDetection(userId, orderId);

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
                  await emitSSE(userId, 'order-message', {
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
      }
    } catch (error) {
      console.error('[SMS Reply] Error handling incoming SMS:', error);
      res
        .status(500)
        .type('text/xml')
        .send('<Response></Response>');
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}

