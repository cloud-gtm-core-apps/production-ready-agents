import { randomUUID } from "crypto";
import type { Express } from "express";
import { type Message } from "@shared/schema";
import { storage } from "../storage.js";
import { isAuthenticated, getOptInStatus, sendMessageThroughRelay, emitSSE, triggerDebouncedOrderDetection, getMenuItemsWithCache, formatOrderMessage } from "../utils.js";
import { generateAISuggestedResponse, analyzeOrderSummaryFromConversation, detectPickupTimeFromConversation } from "../aiFunctions.js";
import { aiSuggestedResponses } from "../globals.js";

export function registerConversationsRoutes(app: Express) {
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

      // Check opt-in status if Twilio Campaign is enabled
      const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
      if (isTwilioCampaign) {
        const optInStatus = await getOptInStatus(order.number);
        if (optInStatus !== 'opted-in') {
          return res.status(403).json({
            message: optInStatus === 'opted-out'
              ? 'Customer has opted out. Messages cannot be sent.'
              : 'Customer has not opted in. Messages cannot be sent.'
          });
        }
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

      await emitSSE(userId, 'order-message', {
        orderId,
        message: rodMessage,
        source: 'outgoing',
        aiSuggestedResponse: null,
      });

      // Trigger debounced order detection after Rod's message
      await triggerDebouncedOrderDetection(userId, orderId);

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
      const pickupTimeFromConversation = await detectPickupTimeFromConversation(messages, { referenceTime: new Date() });

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
}

