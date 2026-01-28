import type { Request, Response, NextFunction } from "express";
import { getOrderCounts, getOrdersByStatus, sendOrderToPreparation, markOrderAsReady, markOrderAsPickedUp, getOrderHistory, deleteOrder } from "../services/orders.service.js";

export async function getOrderCountsController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const counts = await getOrderCounts(userId);
    res.json(counts);
  } catch (error) {
    next(error);
  }
}

export async function getOrdersByStatusController(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = req.params;
    const userId = (req.user as any).id;

    const ordersWithConversations = await getOrdersByStatus(userId, status);

    res.json(ordersWithConversations);
  } catch (error: any) {
    console.error('[API] Error fetching orders:', error);
    if (error.message === 'Invalid status') {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
}

export async function sendOrderToPreparationController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;
    const { orderDetails } = req.body;

    await sendOrderToPreparation(userId, orderId, orderDetails);

    res.json({
      success: true,
      message: 'Order sent to preparation successfully'
    });
  } catch (error: any) {
    console.error('Error sending order to preparation:', error);
    if (error.message === 'Order not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

export async function markOrderAsReadyController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;

    await markOrderAsReady(userId, orderId);

    res.json({ success: true, message: 'Order marked as ready' });
  } catch (error: any) {
    console.error('Error marking order as ready:', error);
    if (error.message === 'Order not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

export async function markOrderAsPickedUpController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;

    await markOrderAsPickedUp(userId, orderId);

    res.json({ success: true, message: 'Order marked as picked up' });
  } catch (error: any) {
    console.error('Error marking order as picked up:', error);
    if (error.message === 'Order not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

export async function getOrderHistoryController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await getOrderHistory(userId, page, limit);

    res.json(result);
  } catch (error) {
    console.error('Error fetching order history:', error);
    next(error);
  }
}

export async function deleteOrderController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;

    await deleteOrder(userId, orderId);
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    next(error);
  }
}

