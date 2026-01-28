import type { Request, Response, NextFunction } from "express";
import { sendMessageToOrder, getAISuggestedReply, getAIOrderSummary } from "../services/conversations.services.js";

export async function sendMessageController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const { message } = req.body;
    const userId = (req.user as any).id;

    await sendMessageToOrder(userId, orderId, message);

    res.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Message is required') {
      return res.status(400).json({ message: error.message });
    }
    if (error.message === 'Order not found') {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === 'Order does not have a contact number') {
      return res.status(400).json({ message: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ message: error.message });
    }
    if (error.statusCode === 502) {
      return res.status(502).json({ message: error.message });
    }
    next(error);
  }
}

export async function getAISuggestedReplyController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;

    const suggestion = await getAISuggestedReply(userId, orderId);

    res.json({ suggestion });
  } catch (error: any) {
    console.error('Error generating AI suggested reply:', error);
    if (error.message === 'Conversation not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

export async function getAIOrderSummaryController(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    const userId = (req.user as any).id;

    const result = await getAIOrderSummary(userId, orderId);

    res.json(result);
  } catch (error: any) {
    console.error('Error generating AI order summary:', error);
    if (error.message === 'Order not found' || error.message === 'Conversation not found') {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
}

