import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { menuItems } from "@shared/schema";
import { storage } from "../storage.js";

export async function getAllMenuItems(userId: string) {
  const items = await storage.getMenuItems(userId);
  return items;
}

export async function getMenuItemById(userId: string, itemId: string) {
  const item = await storage.getMenuItemById(userId, itemId);
  if (!item) {
    throw new Error('Menu item not found');
  }
  return item;
}

export async function createMenuItem(userId: string, menuItemData: any): Promise<{ item: any; isNew: boolean }> {
  try {
    const result = await storage.createMenuItem(userId, menuItemData);
    return { item: result, isNew: true };
  } catch (error: any) {
    // Make endpoint idempotent: if item already exists, return the existing item
    if (error.message && error.message.includes('already exists')) {
      // Query for the existing menu item
      const existingItems = await db.select()
        .from(menuItems)
        .where(and(
          eq(menuItems.userId, userId),
          eq(menuItems.name, menuItemData.name)
        ))
        .limit(1);

      if (existingItems.length > 0) {
        return { item: existingItems[0], isNew: false };
      }
      // Fallback to error if item not found (shouldn't happen)
      throw error;
    }
    throw error;
  }
}

export async function updateMenuItem(userId: string, itemId: string, menuItemData: any) {
  const result = await storage.updateMenuItem(userId, itemId, menuItemData);
  return result;
}

export async function deleteMenuItem(userId: string, itemId: string): Promise<void> {
  await storage.deleteMenuItem(userId, itemId);
}

