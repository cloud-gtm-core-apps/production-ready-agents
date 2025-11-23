import type { Express } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { menuItems } from "@shared/schema";
import { storage } from "../storage.js";
import { isAuthenticated } from "../utils.js";

export function registerMenuRoutes(app: Express) {
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
    const userId = (req.user as any).id;
    try {
      const result = await storage.createMenuItem(userId, req.body);
      res.status(201).json(result);
    } catch (error: any) {
      // Make endpoint idempotent: if item already exists, return the existing item
      if (error.message && error.message.includes('already exists')) {
        // Query for the existing menu item
        const existingItems = await db.select()
          .from(menuItems)
          .where(and(
            eq(menuItems.userId, userId),
            eq(menuItems.name, req.body.name)
          ))
          .limit(1);

        if (existingItems.length > 0) {
          return res.status(200).json(existingItems[0]);
        }
        // Fallback to error if item not found (shouldn't happen)
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
}

