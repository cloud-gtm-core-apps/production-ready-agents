import { randomUUID } from "crypto";
import type { Express } from "express";
import { type Message } from "@shared/schema";
import { storage } from "../storage.js";
import { isAuthenticated, updateOrderFromDetails, createCloverOrder, getOptInStatus, sendMessageThroughRelay } from "../utils.js";
import { aiSuggestedResponses } from "../globals.js";

export function registerOrdersRoutes(app: Express) {
  // Get order counts for all statuses
  app.get("/api/orders/counts", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const counts = await storage.getOrderCounts(userId);
      res.json(counts);
    } catch (error) {
      next(error);
    }
  });

  // Get orders by status
  app.get("/api/orders/:status", isAuthenticated, async (req, res, next) => {
    try {
      const { status } = req.params;
      const userId = (req.user as any).id;

      // Validate status - handle both lowercase and capitalized
      const validStatuses = ['New', 'Confirmed', 'Ready', 'Completed'];
      const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

      if (!validStatuses.includes(capitalizedStatus)) {
        return res.status(400).json({ message: 'Invalid status' });
      }

      const ordersList = await storage.getOrdersByStatus(userId, capitalizedStatus as any);

      console.log(`[API] Fetching orders for status: ${capitalizedStatus}, found ${ordersList.length} orders`);

      // For each order, get its conversations from the orderConversations table
      const ordersWithConversations = await Promise.all(
        ordersList.map(async (order) => {
          // Get conversation row for this order
          const conversationRow = await storage.getOrderConversation(userId, order.id);

          // Get messages from the conversation row - keep timestamps as-is (ISO strings)
          const messages: Message[] = (conversationRow?.messages as Message[]) || [];

          // Format messages - keep timestamps exactly as stored
          const formattedMessages = messages.map((msg) => ({
            id: msg.id,
            text: msg.text,
            isOutgoing: msg.isOutgoing,
            timestamp: msg.timestamp, // Keep as ISO string, no conversion
            isAIOrganized: msg.isAIOrganized
          }));

          return {
            id: order.id,
            phoneNumber: order.number,
            lastMessage: order.lastMessage ? new Date(order.lastMessage).toISOString() : null, // Keep as ISO string
            customerName: order.firstName && order.lastName
              ? `${order.firstName} ${order.lastName}`
              : order.firstName || null,
            orderStatus: order.status?.toLowerCase(),
            orderCount: order.tag === 'VIP (8x)' ? 8 : parseInt(order.tag?.charAt(0) || '1'),
            messages: formattedMessages,
            orderDetails: order.orderPrice ? {
              items: order.items || [],
              // Extract pickup time string from notes (format: "PICKUP_TIME: 10:00 PM")
              pickupTime: (() => {
                if (order.notes) {
                  const match = order.notes.match(/PICKUP_TIME:\s*([\d:]+?\s*(AM|PM))/i);
                  if (match) {
                    return match[1].trim();
                  }
                }
                // Fallback: if stored as Date, convert to string (but this shouldn't happen)
                if (order.pickupTime) {
                  return new Date(order.pickupTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                }
                return null;
              })(),
              pickupTimestamp: order.pickupTime ? new Date(order.pickupTime).getTime() : null, // Keep as timestamp number
              total: order.orderPrice,
              notes: order.notes ? order.notes.replace(/PICKUP_TIME:\s*[\d:]+?\s*(AM|PM)/i, '').trim() : '' // Remove pickup time from notes display
            } : undefined,
            aiSuggestedResponse: aiSuggestedResponses.get(order.id) ?? undefined,
          };
        })
      );

      console.log(`[API] Returning ${ordersWithConversations.length} orders with conversations`);
      res.json(ordersWithConversations);
    } catch (error) {
      console.error('[API] Error fetching orders:', error);
      next(error);
    }
  });

  // Send order to preparation (update status, create customer, stats, history)
  app.post("/api/orders/:orderId/send-to-preparation", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;
      const { orderDetails } = req.body;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Create or update customer, stats, and history
      // const customer = await processCustomerOrder(storage, userId, order, orderDetails);

      // Update order status, price, pickup time, items, and notes
      await updateOrderFromDetails(storage, orderId, orderDetails);

      // 5. Create order in Clover (if Clover is connected)
      await createCloverOrder(storage, userId, order, orderDetails);

      let formattedTime = 'a later time today';

      // Use pickup time from orderDetails (it's already a string like "10:00 PM")
      if (orderDetails?.pickupTime && typeof orderDetails.pickupTime === 'string') {
        formattedTime = orderDetails.pickupTime.trim();
      } else if (order.pickupTime) {
        // Fallback: if stored as Date, convert to string
        const { formatRestaurantTime } = await import("../timezone.js");
        formattedTime = formatRestaurantTime(new Date(order.pickupTime));
      }

      // 6. Send confirmation message to customer
      try {
        const confirmationMessageId = randomUUID();
        const confirmationMessage: Message = {
          id: confirmationMessageId,
          text: `Thanks for ordering! Your order is confirmed and will be ready for pickup at ${formattedTime}.`,
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save confirmation message to database
        await storage.addMessageToOrder(userId, orderId, confirmationMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        console.log(`[Send to Preparation] Confirmation message prepared for order ${orderId}`);

        try {
          if (order.number) {
            // Check opt-in status if Twilio Campaign is enabled
            const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
            if (isTwilioCampaign) {
              const optInStatus = await getOptInStatus(order.number);
              if (optInStatus !== 'opted-in') {
                console.log(`[Send to Preparation] Skipping confirmation message - customer ${order.number} opt-in status: ${optInStatus}`);
              } else {
                await sendMessageThroughRelay(order.number, confirmationMessage.text);
                console.log(`[Send to Preparation] Sent confirmation message via messaging service to ${order.number}`);
              }
            } else {
              await sendMessageThroughRelay(order.number, confirmationMessage.text);
              console.log(`[Send to Preparation] Sent confirmation message via messaging service to ${order.number}`);
            }
          } else {
            console.warn(`[Send to Preparation] Order ${orderId} is missing a contact number; skipping messaging service send.`);
          }
        } catch (error) {
          console.error('[Send to Preparation] Failed to deliver confirmation message via messaging service', {
            error,
            orderId,
            number: order.number,
          });
        }
      } catch (error) {
        console.error('[Send to Preparation] Error sending confirmation message:', error);
        // Don't fail the request if message sending fails
      }

      res.json({
        success: true,
        message: 'Order sent to preparation successfully'
      });
    } catch (error) {
      console.error('Error sending order to preparation:', error);
      next(error);
    }
  });

  // Mark order as ready for pickup
  app.post("/api/orders/:orderId/mark-ready", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Update order status to Ready
      await storage.updateOrderStatus(orderId, 'Ready');

      // // Get updated order with latest details (including cloverOrderId)
      // const updatedOrder = await storage.getOrderById(userId, orderId);
      // if (!updatedOrder) {
      //   return res.status(404).json({ message: 'Order not found after update' });
      // }

      // console.log('[Mark Ready] Updated order:', updatedOrder);

      // // Build orderDetails from the current order
      // const orderDetails = {
      //   items: updatedOrder.items || [],
      //   notes: updatedOrder.notes || null,
      //   pickupTime: updatedOrder.pickupTime || undefined,
      //   total: updatedOrder.orderPrice || undefined,
      // };
      // await updateCloverOrder(storage, userId, updatedOrder, orderDetails);

      // Send ready for pickup message to customer
      try {
        // Format pickup time if available
        let messageText = 'Your order is all set! Come by anytime to pick it up.';

        const readyMessageId = randomUUID();
        const readyMessage: Message = {
          id: readyMessageId,
          text: messageText,
          isOutgoing: false, // false = from business (appears on right side)
          timestamp: new Date().toISOString(),
        };

        // Save ready message to database
        await storage.addMessageToOrder(userId, orderId, readyMessage);
        await storage.updateOrderLastMessage(orderId, new Date());

        console.log(`[Mark Ready] Ready message prepared for order ${orderId}`);

        try {
          if (order.number) {
            // Check opt-in status if Twilio Campaign is enabled
            const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
            if (isTwilioCampaign) {
              const optInStatus = await getOptInStatus(order.number);
              if (optInStatus !== 'opted-in') {
                console.log(`[Mark Ready] Skipping ready message - customer ${order.number} opt-in status: ${optInStatus}`);
              } else {
                await sendMessageThroughRelay(order.number, readyMessage.text);
                console.log(`[Mark Ready] Sent ready message via messaging service to ${order.number}`);
              }
            } else {
              await sendMessageThroughRelay(order.number, readyMessage.text);
              console.log(`[Mark Ready] Sent ready message via messaging service to ${order.number}`);
            }
          } else {
            console.warn(`[Mark Ready] Order ${orderId} is missing a contact number; skipping messaging service send.`);
          }
        } catch (error) {
          console.error('[Mark Ready] Failed to deliver ready message via messaging service', {
            error,
            orderId,
            number: order.number,
          });
        }
      } catch (error) {
        console.error('[Mark Ready] Error sending ready message:', error);
        // Don't fail the request if message sending fails
      }

      res.json({ success: true, message: 'Order marked as ready' });
    } catch (error) {
      console.error('Error marking order as ready:', error);
      next(error);
    }
  });

  // Mark order as picked up (completed)
  app.post("/api/orders/:orderId/mark-picked-up", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      // Get the order
      const order = await storage.getOrderById(userId, orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }

      // Update order status to Completed and update lastMessage to track completion date
      await storage.updateOrderStatus(orderId, 'Completed');
      await storage.updateOrderLastMessage(orderId, new Date());

      res.json({ success: true, message: 'Order marked as picked up' });
    } catch (error) {
      console.error('Error marking order as picked up:', error);
      next(error);
    }
  });

  // Get order history with pagination
  app.get("/api/order-history", isAuthenticated, async (req, res, next) => {
    try {
      const userId = (req.user as any).id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await storage.getOrderHistoryPaginated(userId, page, limit);

      res.json(result);
    } catch (error) {
      console.error('Error fetching order history:', error);
      next(error);
    }
  });

  // Delete an order
  app.delete("/api/orders/:orderId", isAuthenticated, async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = (req.user as any).id;

      await storage.deleteOrder(userId, orderId);
      res.json({ message: 'Order deleted successfully' });
    } catch (error) {
      next(error);
    }
  });
}

