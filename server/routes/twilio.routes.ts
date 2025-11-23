import type { Express } from "express";
import { storage } from "../storage.js";
import { isAuthenticated, getOptInStatus } from "../utils.js";

export function registerTwilioRoutes(app: Express) {
  // Get opt-in status for an order
  app.get("/api/orders/:orderId/opt-in-status", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Check if Twilio Campaign is enabled
      const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
      if (!isTwilioCampaign) {
        return res.json({
          twilioCampaignEnabled: false,
          optInStatus: null
        });
      }

      // Get the order to find the phone number
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      if (!order.number) {
        return res.json({
          twilioCampaignEnabled: true,
          optInStatus: null
        });
      }

      const optInStatus = await getOptInStatus(order.number);
      return res.json({
        twilioCampaignEnabled: true,
        optInStatus: optInStatus || null
      });
    } catch (error) {
      next(error);
    }
  });
}

