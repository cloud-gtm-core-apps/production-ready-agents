import { type User, type InsertUser, type Order, type InsertOrder, type OrderConversation, type InsertOrderConversation, type MenuItem, type InsertMenuItem, type Customer, type InsertCustomer, type OrderHistory, type InsertOrderHistory, type CustomerStats, type InsertCustomerStats, type Message, users, orders, orderConversations, menuItems, customers, orderHistory, customerStats } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, ne } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getOrdersByStatus(userId: string, status: 'New' | 'Confirmed' | 'Ready' | 'Completed'): Promise<Order[]>;
  getOrderConversation(userId: string, orderId: string): Promise<OrderConversation | undefined>;
  getOrderCounts(userId: string): Promise<{ new: number; confirmed: number; ready: number; completed: number }>;
  createOrder(order: InsertOrder): Promise<Order>;
  createOrderConversation(conversation: InsertOrderConversation): Promise<OrderConversation>;
  updateOrderLastMessage(orderId: string, lastMessage: Date): Promise<void>;
  updateOrderMade(orderId: string, orderMade: boolean): Promise<void>;
  updateOrderPickupTime(orderId: string, pickupTime: Date): Promise<void>;
  updatePickupTimeDetected(orderId: string, pickupTimeDetected: boolean): Promise<void>;
  addMessageToOrder(userId: string, orderId: string, message: Message): Promise<void>;
  getOrderByPhoneNumber(userId: string, phoneNumber: string): Promise<Order | undefined>;
  getOrderById(userId: string, orderId: string): Promise<Order | undefined>;
  deleteOrder(userId: string, orderId: string): Promise<void>;
  getMenuItems(userId: string): Promise<MenuItem[]>;
  getMenuItemById(userId: string, itemId: string): Promise<MenuItem | undefined>;
  createMenuItem(userId: string, item: InsertMenuItem): Promise<MenuItem>;
  updateMenuItem(userId: string, itemId: string, item: Partial<InsertMenuItem>): Promise<MenuItem>;
  deleteMenuItem(userId: string, itemId: string): Promise<void>;
  updateOrderStatus(orderId: string, status: 'New' | 'Confirmed' | 'Ready' | 'Completed'): Promise<void>;
  updateOrderDetails(orderId: string, updates: { orderPrice?: string; items?: string[]; notes?: string; pickupTime?: Date }): Promise<void>;
  getCustomerByPhoneNumber(userId: string, phoneNumber: string): Promise<Customer | undefined>;
  createCustomer(userId: string, customer: InsertCustomer): Promise<Customer>;
  getCustomerStats(customerId: string): Promise<CustomerStats | undefined>;
  createCustomerStats(customerId: string, stats: InsertCustomerStats): Promise<CustomerStats>;
  updateCustomerStats(customerId: string, stats: Partial<InsertCustomerStats>): Promise<void>;
  createOrderHistory(history: InsertOrderHistory): Promise<OrderHistory>;
}

export class DbStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email));
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async getOrdersByStatus(userId: string, status: 'New' | 'Confirmed' | 'Ready' | 'Completed'): Promise<Order[]> {
    const result = await db.select()
      .from(orders)
      .where(and(
        eq(orders.userId, userId),
        eq(orders.status, status)
      ))
      .orderBy(desc(orders.lastMessage));
    return result;
  }

  async getOrderCounts(userId: string): Promise<{ new: number; confirmed: number; ready: number; completed: number }> {
    const allOrders = await db.select()
      .from(orders)
      .where(eq(orders.userId, userId));
    
    return {
      new: allOrders.filter(o => o.status === 'New').length,
      confirmed: allOrders.filter(o => o.status === 'Confirmed').length,
      ready: allOrders.filter(o => o.status === 'Ready').length,
      completed: allOrders.filter(o => o.status === 'Completed').length,
    };
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const result = await db.insert(orders).values(order).returning();
    return result[0];
  }

  async updateOrderLastMessage(orderId: string, lastMessage: Date): Promise<void> {
    await db.update(orders)
      .set({ lastMessage })
      .where(eq(orders.id, orderId));
  }

  async updateOrderMade(orderId: string, orderMade: boolean): Promise<void> {
    await db.update(orders)
      .set({ orderMade })
      .where(eq(orders.id, orderId));
  }

  async updateOrderPickupTime(orderId: string, pickupTime: Date): Promise<void> {
    await db.update(orders)
      .set({ pickupTime })
      .where(eq(orders.id, orderId));
  }

  async updatePickupTimeDetected(orderId: string, pickupTimeDetected: boolean): Promise<void> {
    await db.update(orders)
      .set({ pickupTimeDetected })
      .where(eq(orders.id, orderId));
  }

  async getOrderConversation(userId: string, orderId: string): Promise<OrderConversation | undefined> {
    const result = await db.select()
      .from(orderConversations)
      .where(and(
        eq(orderConversations.userId, userId),
        eq(orderConversations.orderId, orderId)
      ))
      .limit(1);
    return result[0];
  }

  async createOrderConversation(conversation: InsertOrderConversation): Promise<OrderConversation> {
    const result = await db.insert(orderConversations).values(conversation).returning();
    return result[0];
  }

  async addMessageToOrder(userId: string, orderId: string, message: Message): Promise<void> {
    // Get or create conversation row for this order
    let conversation = await this.getOrderConversation(userId, orderId);

    if (!conversation) {
      // Need to get order to get phone number
      const order = await this.getOrderById(userId, orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Create new conversation row with the first message
      conversation = await this.createOrderConversation({
        userId,
        orderId,
        number: order.number,
        messages: [message],
        updatedAt: new Date(),
      });
    } else {
      // Get current messages array
      const currentMessages: Message[] = (conversation.messages as Message[]) || [];

      // Add new message to messages array
      const updatedMessages = [...currentMessages, message];

      // Update conversation row with new messages array
      await db.update(orderConversations)
        .set({ 
          messages: updatedMessages,
          updatedAt: new Date()
        })
        .where(and(
          eq(orderConversations.userId, userId),
          eq(orderConversations.orderId, orderId)
        ));
    }
  }

  async getOrderByPhoneNumber(userId: string, phoneNumber: string): Promise<Order | undefined> {
    const result = await db.select()
      .from(orders)
      .where(and(
        eq(orders.userId, userId),
        eq(orders.number, phoneNumber)
      ))
      .limit(1);
    return result[0];
  }

  async getOrderById(userId: string, orderId: string): Promise<Order | undefined> {
    const result = await db.select()
      .from(orders)
      .where(and(
        eq(orders.userId, userId),
        eq(orders.id, orderId)
      ))
      .limit(1);
    return result[0];
  }

  async deleteOrder(userId: string, orderId: string): Promise<void> {
    const order = await db.select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.userId, userId)
      ))
      .limit(1);

    if (order.length === 0) {
      throw new Error('Order not found');
    }

    // Delete conversation row for this order
    await db.delete(orderConversations)
      .where(and(
        eq(orderConversations.userId, userId),
        eq(orderConversations.orderId, orderId)
      ));

    // Delete the order
    await db.delete(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.userId, userId)
      ));
  }

  async getMenuItems(userId: string): Promise<MenuItem[]> {
    const result = await db.select()
      .from(menuItems)
      .where(eq(menuItems.userId, userId))
      .orderBy(menuItems.category, menuItems.name as any);
    return result;
  }

  async getMenuItemById(userId: string, itemId: string): Promise<MenuItem | undefined> {
    const result = await db.select()
      .from(menuItems)
      .where(and(
        eq(menuItems.id, itemId),
        eq(menuItems.userId, userId)
      ))
      .limit(1);
    return result[0];
  }

  async createMenuItem(userId: string, item: InsertMenuItem): Promise<MenuItem> {
    // Check if a menu item with the same name already exists for this user
    const existingItem = await db.select()
      .from(menuItems)
      .where(and(
        eq(menuItems.userId, userId),
        eq(menuItems.name, item.name)
      ))
      .limit(1);
    
    if (existingItem.length > 0) {
      throw new Error(`A menu item with the name "${item.name}" already exists`);
    }
    
    const result = await db.insert(menuItems).values({ ...item, userId }).returning();
    return result[0];
  }

  async updateMenuItem(userId: string, itemId: string, item: Partial<InsertMenuItem>): Promise<MenuItem> {
    // If name is being updated, check if another item with the same name already exists
    if (item.name) {
      const existingItem = await db.select()
        .from(menuItems)
        .where(and(
          eq(menuItems.userId, userId),
          eq(menuItems.name, item.name),
          // Exclude the current item being updated
          ne(menuItems.id, itemId)
        ))
        .limit(1);
      
      if (existingItem.length > 0) {
        throw new Error(`A menu item with the name "${item.name}" already exists`);
      }
    }
    
    const updatedItem = { ...item, updatedAt: new Date() };
    const result = await db.update(menuItems)
      .set(updatedItem)
      .where(and(
        eq(menuItems.id, itemId),
        eq(menuItems.userId, userId)
      ))
      .returning();
    
    if (!result[0]) {
      throw new Error('Menu item not found');
    }
    return result[0];
  }

  async deleteMenuItem(userId: string, itemId: string): Promise<void> {
    const result = await db.delete(menuItems)
      .where(and(
        eq(menuItems.id, itemId),
        eq(menuItems.userId, userId)
      ))
      .returning();
    
    if (!result[0]) {
      throw new Error('Menu item not found');
    }
  }

  async updateOrderStatus(orderId: string, status: 'New' | 'Confirmed' | 'Ready' | 'Completed'): Promise<void> {
    await db.update(orders)
      .set({ status })
      .where(eq(orders.id, orderId));
  }

  async updateOrderDetails(orderId: string, updates: { orderPrice?: string; items?: string[]; notes?: string; pickupTime?: Date }): Promise<void> {
    await db.update(orders)
      .set(updates)
      .where(eq(orders.id, orderId));
  }

  async getCustomerByPhoneNumber(userId: string, phoneNumber: string): Promise<Customer | undefined> {
    const result = await db.select()
      .from(customers)
      .where(and(
        eq(customers.userId, userId),
        eq(customers.phoneNumber, phoneNumber)
      ))
      .limit(1);
    return result[0];
  }

  async createCustomer(userId: string, customer: InsertCustomer): Promise<Customer> {
    const result = await db.insert(customers)
      .values({ ...customer, userId })
      .returning();
    return result[0];
  }

  async getCustomerStats(customerId: string): Promise<CustomerStats | undefined> {
    const result = await db.select()
      .from(customerStats)
      .where(eq(customerStats.customerId, customerId))
      .limit(1);
    return result[0];
  }

  async createCustomerStats(customerId: string, stats: InsertCustomerStats): Promise<CustomerStats> {
    const result = await db.insert(customerStats)
      .values({ ...stats, customerId })
      .returning();
    return result[0];
  }

  async updateCustomerStats(customerId: string, stats: Partial<InsertCustomerStats>): Promise<void> {
    await db.update(customerStats)
      .set(stats)
      .where(eq(customerStats.customerId, customerId));
  }

  async createOrderHistory(history: InsertOrderHistory): Promise<OrderHistory> {
    const result = await db.insert(orderHistory)
      .values(history)
      .returning();
    return result[0];
  }
}

export const storage = new DbStorage();
