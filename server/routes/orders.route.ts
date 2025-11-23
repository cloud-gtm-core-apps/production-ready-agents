import type { Express } from "express";
import { isAuthenticated } from "../utils.js";
import { getOrderCountsController, getOrdersByStatusController, sendOrderToPreparationController, markOrderAsReadyController, markOrderAsPickedUpController, getOrderHistoryController, deleteOrderController } from "../controllers/orders.controller.js";

export function registerOrdersRoutes(app: Express) {
  // Get order counts for all statuses
  app.get("/api/orders/counts", isAuthenticated, getOrderCountsController);

  // Get orders by status
  app.get("/api/orders/:status", isAuthenticated, getOrdersByStatusController);

  // Send order to preparation (update status, create customer, stats, history)
  app.post("/api/orders/:orderId/send-to-preparation", isAuthenticated, sendOrderToPreparationController);

  // Mark order as ready for pickup
  app.post("/api/orders/:orderId/mark-ready", isAuthenticated, markOrderAsReadyController);

  // Mark order as picked up (completed)
  app.post("/api/orders/:orderId/mark-picked-up", isAuthenticated, markOrderAsPickedUpController);

  // Get order history with pagination
  app.get("/api/order-history", isAuthenticated, getOrderHistoryController);

  // Delete an order
  app.delete("/api/orders/:orderId", isAuthenticated, deleteOrderController);
}

