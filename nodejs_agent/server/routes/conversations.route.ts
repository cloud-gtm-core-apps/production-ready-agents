import type { Express } from "express";
import { isAuthenticated } from "../utils.js";
import { sendMessageController, getAISuggestedReplyController, getAIOrderSummaryController } from "../controllers/conversations.controller.js";

export function registerConversationsRoutes(app: Express) {
  // Send a message to an order conversation
  app.post("/api/orders/:orderId/message", isAuthenticated, sendMessageController);

  // Get the AI suggested reply for an order conversation
  app.get("/api/orders/:orderId/ai-suggested-reply", isAuthenticated, getAISuggestedReplyController);

  // Get the AI order summary for an order conversation
  app.get("/api/orders/:orderId/ai-order-summary", isAuthenticated, getAIOrderSummaryController);
}

