// Core Node Modules
import type { Express } from "express";
import { createServer, type Server } from "http";

// Internal: Utilities
import {
  setupRedisSSESubscription,
  sendSSEToClients,
} from "../utils.js";
import { isAuthenticated } from "../utils.js";

// Internal: Route Handlers
import { registerAuthRoutes } from "./auth.routes.js";
import { registerMenuRoutes } from "./menu.routes.js";
import { registerOrdersRoutes } from "./orders.route.js";
import { registerConversationsRoutes } from "./conversations.route.js";
import { registerTwilioRoutes } from "./twilio.routes.js";
import { registerAnalyticsRoutes } from "./analytics.routes.js";
import { registerCloverRoutes } from "./clover.routes.js";
import { handleSSEConnectionController, handleSMSReplyController } from "../controllers/main.controller.js";

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

  // SSE connection endpoint
  app.get("/api/events", isAuthenticated, handleSSEConnectionController);

  // SMS webhook endpoint (Twilio)
  app.post("/sms/reply", handleSMSReplyController);

  const httpServer = createServer(app);

  return httpServer;
}

