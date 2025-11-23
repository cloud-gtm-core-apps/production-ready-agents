import type { Express } from "express";
import { storage } from "../storage.js";
import { isAuthenticated } from "../utils.js";

export function registerAnalyticsRoutes(app: Express) {
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
}

