import type { Express } from "express";
import { isAuthenticated } from "../utils.js";
import { authorizeCloverController, cloverOAuthCallbackController, checkCloverStatusController, disconnectCloverController, syncCloverMenuController } from "../controllers/clover.controller.js";

export function registerCloverRoutes(app: Express) {
  // Initiate OAuth flow - redirect to Clover
  app.get("/api/integrations/clover/authorize", isAuthenticated, authorizeCloverController);

  // OAuth callback endpoint
  app.get("/oauth/callback", cloverOAuthCallbackController);

  // Check Clover connection status
  app.get("/api/integrations/clover/status", isAuthenticated, checkCloverStatusController);

  // Disconnect Clover (remove token)
  app.delete("/api/integrations/clover/disconnect", isAuthenticated, disconnectCloverController);

  // Sync menu items from Clover
  app.post("/api/integrations/clover/sync-menu", isAuthenticated, syncCloverMenuController);
}

