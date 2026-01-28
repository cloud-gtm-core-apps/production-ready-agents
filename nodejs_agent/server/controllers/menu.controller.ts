import type { Request, Response, NextFunction } from "express";
import { getAllMenuItems, getMenuItemById, createMenuItem, updateMenuItem, deleteMenuItem } from "../services/menu.service.js";

export async function getAllMenuItemsController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const items = await getAllMenuItems(userId);
    res.json(items);
  } catch (error) {
    next(error);
  }
}

export async function getMenuItemByIdController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const { itemId } = req.params;
    const item = await getMenuItemById(userId, itemId);
    res.json(item);
  } catch (error: any) {
    if (error.message === 'Menu item not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

export async function createMenuItemController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const { item, isNew } = await createMenuItem(userId, req.body);
    
    if (isNew) {
      res.status(201).json(item);
    } else {
      res.status(200).json(item);
    }
  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
}

export async function updateMenuItemController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const { itemId } = req.params;
    const result = await updateMenuItem(userId, itemId, req.body);
    res.json(result);
  } catch (error: any) {
    // Return user-friendly error message for duplicate items
    if (error.message && error.message.includes('already exists')) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
}

export async function deleteMenuItemController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const { itemId } = req.params;
    await deleteMenuItem(userId, itemId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

