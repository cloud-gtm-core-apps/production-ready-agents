import type { Express } from "express";
import { isAuthenticated } from "../utils.js";
import { getAllMenuItemsController, getMenuItemByIdController, createMenuItemController, updateMenuItemController, deleteMenuItemController } from "../controllers/menu.controller.js";

export function registerMenuRoutes(app: Express) {
  // Get all menu items
  app.get("/api/menu-items", isAuthenticated, getAllMenuItemsController);

  // Get single menu item
  app.get("/api/menu-items/:itemId", isAuthenticated, getMenuItemByIdController);

  // Create menu item
  app.post("/api/menu-items", isAuthenticated, createMenuItemController);

  // Update menu item
  app.put("/api/menu-items/:itemId", isAuthenticated, updateMenuItemController);

  // Delete menu item
  app.delete("/api/menu-items/:itemId", isAuthenticated, deleteMenuItemController);
}

