import { type User, type InsertUser, type Order, type InsertOrder, type OrderConversation, type InsertOrderConversation, type MenuItem, type InsertMenuItem, type Customer, type InsertCustomer, type OrderHistory, type InsertOrderHistory, type CustomerStats, type InsertCustomerStats, type MenuItemPopularityAggregate, type InsertMenuItemPopularityAggregate, type Message, users, orders, orderConversations, menuItems, customers, orderHistory, customerStats, menuItemPopularityAggregates } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, ne, gte, lt, lte, inArray, isNull } from "drizzle-orm";
import postgres from "postgres";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getOrdersByStatus(userId: string, status: 'New' | 'Confirmed' | 'Ready' | 'Completed'): Promise<Order[]>;
  getOrderConversation(userId: string, orderId: string): Promise<OrderConversation | undefined>;
  getOrderCounts(userId: string): Promise<{ new: number; confirmed: number; ready: number; }>;
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
  updateOrderDetails(orderId: string, updates: { orderPrice?: string; items?: string[]; notes?: string; pickupTime?: Date; cloverOrderId?: string }): Promise<void>;
  getCustomerByPhoneNumber(userId: string, phoneNumber: string): Promise<Customer | undefined>;
  createCustomer(userId: string, customer: InsertCustomer): Promise<Customer>;
  getCustomerStats(customerId: string): Promise<CustomerStats | undefined>;
  createCustomerStats(customerId: string, stats: InsertCustomerStats): Promise<CustomerStats>;
  updateCustomerStats(customerId: string, stats: Partial<InsertCustomerStats>): Promise<void>;
  createOrderHistory(history: InsertOrderHistory): Promise<OrderHistory>;
  getLatestOrderHistoryByCustomer(customerId: string): Promise<OrderHistory | undefined>;
  updateOrderHistory(historyId: string, updates: Partial<InsertOrderHistory>): Promise<void>;
  getOrderHistoryPaginated(userId: string, page: number, limit: number): Promise<{ orders: Array<OrderHistory & { customer?: Customer }>; total: number; hasMore: boolean }>;
  refreshMenuItemPopularityAggregates(userId: string, startDate?: Date, endDate?: Date): Promise<void>;
  getMenuItemPopularity(userId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month'): Promise<Array<{ date: string; items: Array<{ menuItemName: string; orderCount: number; quantity: number }> }>>;
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await db.select()
      .from(orders)
      .where(and(
        eq(orders.userId, userId),
        eq(orders.status, status),
        gte(orders.lastMessage, today),
        lt(orders.lastMessage, tomorrow)
      ))
      .orderBy(desc(orders.lastMessage));
    return result;
  }

  async getOrderCounts(userId: string): Promise<{ new: number; confirmed: number; ready: number; }> {

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const allOrders = await db.select()
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.lastMessage, today), lt(orders.lastMessage, tomorrow)));

    return {
      new: allOrders.filter(o => o.status === 'New').length,
      confirmed: allOrders.filter(o => o.status === 'Confirmed').length,
      ready: allOrders.filter(o => o.status === 'Ready').length,
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
    // Type assertion needed because Drizzle's type inference for jsonb fields with optional properties
    // (like isAIOrganized?: boolean in Message[]) can be overly strict with TypeScript's type checking.
    // This is a known limitation when using .$type<>() with jsonb fields that have optional properties.
    // The conversation parameter is already typed as InsertOrderConversation, so this is safe.
    const result = await db.insert(orderConversations).values(conversation as any).returning();
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
      // Ensure message conforms to Message type explicitly
      const typedMessage: Message = message.isAIOrganized !== undefined
        ? {
            id: message.id,
            text: message.text,
            isOutgoing: message.isOutgoing,
            timestamp: message.timestamp,
            isAIOrganized: typeof message.isAIOrganized === 'boolean' 
              ? message.isAIOrganized 
              : Boolean(message.isAIOrganized)
          }
        : {
            id: message.id,
            text: message.text,
            isOutgoing: message.isOutgoing,
            timestamp: message.timestamp
          };
      const messagesArray: Message[] = [typedMessage];
      
      const conversationData: InsertOrderConversation = {
        userId,
        orderId,
        number: order.number,
        messages: messagesArray,
        updatedAt: new Date(),
      };
      
      conversation = await this.createOrderConversation(conversationData);
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

  async getLatestOrderHistoryByCustomer(customerId: string): Promise<OrderHistory | undefined> {
    const result = await db.select()
      .from(orderHistory)
      .where(eq(orderHistory.customerId, customerId))
      .orderBy(desc(orderHistory.createdAt))
      .limit(1);
    return result[0];
  }

  async updateOrderHistory(historyId: string, updates: Partial<InsertOrderHistory>): Promise<void> {
    await db.update(orderHistory)
      .set(updates)
      .where(eq(orderHistory.id, historyId));
  }

  async getOrderHistoryPaginated(userId: string, page: number, limit: number): Promise<{ orders: Array<OrderHistory & { customer?: Customer }>; total: number; hasMore: boolean }> {
    // Get order history entries with customer information
    // We need to join with customers table, but customers are linked by customerId
    // First get all customers for this user, then get their order history
    const userCustomers = await db.select()
      .from(customers)
      .where(eq(customers.userId, userId));

    const customerIds = userCustomers.map(c => c.id);

    if (customerIds.length === 0) {
      return { orders: [], total: 0, hasMore: false };
    }

    // Get total count
    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(orderHistory)
      .where(inArray(orderHistory.customerId, customerIds));

    const total = Number(totalResult[0]?.count || 0);

    // Get paginated order history with customer info
    const offset = (page - 1) * limit;
    const historyEntries = await db.select()
      .from(orderHistory)
      .where(inArray(orderHistory.customerId, customerIds))
      .orderBy(desc(orderHistory.createdAt))
      .limit(limit)
      .offset(offset);

    // Map customer info to each history entry
    const ordersWithCustomers = historyEntries.map(entry => {
      const customer = userCustomers.find(c => c.id === entry.customerId);
      return {
        ...entry,
        customer
      };
    });

    const hasMore = offset + limit < total;

    return {
      orders: ordersWithCustomers,
      total,
      hasMore
    };
  }

  async refreshMenuItemPopularityAggregates(userId: string, startDate?: Date, endDate?: Date): Promise<void> {
    // If no dates provided, refresh last 90 days
    const end = endDate || new Date();
    const start = startDate || new Date();
    if (!startDate) {
      start.setDate(start.getDate() - 90);
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    console.log(`[Analytics] Refreshing aggregates for user ${userId} from ${start.toISOString()} to ${end.toISOString()}`);

    // Get all order history entries for this user's customers within date range
    const userCustomers = await db.select()
      .from(customers)
      .where(eq(customers.userId, userId));

    if (userCustomers.length === 0) {
      console.log(`[Analytics] No customers found for user ${userId}`);
      return;
    }

    const customerIds = userCustomers.map(c => c.id);
    console.log(`[Analytics] Found ${customerIds.length} customers`);

    // Get order history entries within date range
    const orderHistories = await db.select()
      .from(orderHistory)
      .where(and(
        inArray(orderHistory.customerId, customerIds),
        gte(orderHistory.createdAt, start),
        lte(orderHistory.createdAt, end)
      ));

    console.log(`[Analytics] Found ${orderHistories.length} order history entries`);

    // Get all menu items for this user to match item names (do once outside loop)
    const allMenuItems = await db.select()
      .from(menuItems)
      .where(eq(menuItems.userId, userId));

    // Process each order history entry and aggregate by date and menu item
    const aggregatesMap = new Map<string, { userId: string; menuItemId: string | null; menuItemName: string; date: Date; orderCount: number; quantity: number }>();

    for (const history of orderHistories) {
      const orderSummary = history.orderSummary as any;
      const items = orderSummary?.items || [];

      if (!items || items.length === 0) {
        console.log(`[Analytics] Order history ${history.id} has no items`);
        continue;
      }

      const orderDate = new Date(history.createdAt);
      // Normalize to start of day for daily aggregation
      orderDate.setHours(0, 0, 0, 0);

      console.log(`[Analytics] Processing order ${history.id} with ${items.length} items on ${orderDate.toISOString()}`);

      for (const itemStr of items) {
        // Parse item string (could be "Item Name", "2x Item Name", "Item Name: $5.00", etc.)
        const quantityMatch = itemStr.match(/^(\d+)x\s*(.+?)(?:\s*:\s*\$|$)/i);
        const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
        const itemName = quantityMatch ? quantityMatch[2].trim() : itemStr.split(':')[0].trim();

        // Try to find matching menu item
        let menuItem = allMenuItems.find(mi =>
          mi.name.toLowerCase() === itemName.toLowerCase() ||
          itemName.toLowerCase().includes(mi.name.toLowerCase()) ||
          mi.name.toLowerCase().includes(itemName.toLowerCase())
        );

        const menuItemId = menuItem?.id || null;
        const menuItemName = menuItem?.name || itemName;

        // Create key for aggregate: userId_menuItemId_date
        const key = `${userId}_${menuItemId || itemName}_${orderDate.toISOString().split('T')[0]}`;

        if (aggregatesMap.has(key)) {
          const existing = aggregatesMap.get(key)!;
          existing.orderCount += 1;
          existing.quantity += quantity;
        } else {
          aggregatesMap.set(key, {
            userId,
            menuItemId,
            menuItemName,
            date: new Date(orderDate),
            orderCount: 1,
            quantity,
          });
        }
      }
    }

    console.log(`[Analytics] Created ${aggregatesMap.size} aggregates to upsert`);

    // Upsert aggregates into database
    // Use raw SQL client for proper ON CONFLICT handling
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set');
    }
    const sqlClient = postgres(process.env.DATABASE_URL);

    try {
      let upserted = 0;
      for (const aggregate of aggregatesMap.values()) {
        // Check if record exists first (handling NULL menu_item_id)
        let existing;
        if (aggregate.menuItemId === null) {
          existing = await sqlClient`
            SELECT id, order_count, quantity FROM menu_item_popularity_aggregates
            WHERE user_id = ${aggregate.userId}
              AND menu_item_id IS NULL
              AND DATE(date) = DATE(${aggregate.date})
              AND menu_item_name = ${aggregate.menuItemName}
            LIMIT 1
          `;
        } else {
          existing = await sqlClient`
            SELECT id, order_count, quantity FROM menu_item_popularity_aggregates
            WHERE user_id = ${aggregate.userId}
              AND menu_item_id = ${aggregate.menuItemId}
              AND DATE(date) = DATE(${aggregate.date})
              AND menu_item_name = ${aggregate.menuItemName}
            LIMIT 1
          `;
        }

        if (existing.length > 0) {
          // Update existing
          await sqlClient`
            UPDATE menu_item_popularity_aggregates
            SET order_count = order_count + ${aggregate.orderCount},
                quantity = quantity + ${aggregate.quantity},
                last_updated = NOW()
            WHERE id = ${existing[0].id}
          `;
        } else {
          // Insert new - handle NULL menu_item_id explicitly
          if (aggregate.menuItemId === null) {
            await sqlClient`
              INSERT INTO menu_item_popularity_aggregates (user_id, menu_item_id, menu_item_name, date, order_count, quantity, last_updated)
              VALUES (${aggregate.userId}, NULL, ${aggregate.menuItemName}, ${aggregate.date}, ${aggregate.orderCount}, ${aggregate.quantity}, NOW())
            `;
          } else {
            await sqlClient`
              INSERT INTO menu_item_popularity_aggregates (user_id, menu_item_id, menu_item_name, date, order_count, quantity, last_updated)
              VALUES (${aggregate.userId}, ${aggregate.menuItemId}, ${aggregate.menuItemName}, ${aggregate.date}, ${aggregate.orderCount}, ${aggregate.quantity}, NOW())
            `;
          }
        }
        upserted++;
      }
      console.log(`[Analytics] Successfully upserted ${upserted} aggregates`);
    } finally {
      await sqlClient.end();
    }
  }

  async getMenuItemPopularity(userId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month'): Promise<Array<{ date: string; items: Array<{ menuItemName: string; orderCount: number; quantity: number }> }>> {
    // Normalize dates to start of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Build SQL query based on groupBy
    let dateGrouping: string;
    switch (groupBy) {
      case 'day':
        dateGrouping = `DATE(date)`;
        break;
      case 'week':
        dateGrouping = `DATE_TRUNC('week', date)`;
        break;
      case 'month':
        dateGrouping = `DATE_TRUNC('month', date)`;
        break;
      default:
        dateGrouping = `DATE(date)`;
    }

    // Get all aggregates for the date range
    const allAggregates = await db.select()
      .from(menuItemPopularityAggregates)
      .where(and(
        eq(menuItemPopularityAggregates.userId, userId),
        gte(menuItemPopularityAggregates.date, start),
        lte(menuItemPopularityAggregates.date, end)
      ))
      .orderBy(menuItemPopularityAggregates.date, menuItemPopularityAggregates.menuItemName);

    // Group by date and aggregate
    const groupedByDate = new Map<string, Map<string, { menuItemName: string; orderCount: number; quantity: number }>>();

    for (const agg of allAggregates) {
      const aggDate = new Date(agg.date);
      let dateKey: string;

      switch (groupBy) {
        case 'day':
          dateKey = aggDate.toISOString().split('T')[0];
          break;
        case 'week':
          // Get start of week (Monday)
          const weekStart = new Date(aggDate);
          const dayOfWeek = weekStart.getDay();
          const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          weekStart.setDate(diff);
          weekStart.setHours(0, 0, 0, 0);
          dateKey = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          dateKey = `${aggDate.getFullYear()}-${String(aggDate.getMonth() + 1).padStart(2, '0')}-01`;
          break;
        default:
          dateKey = aggDate.toISOString().split('T')[0];
      }

      if (!groupedByDate.has(dateKey)) {
        groupedByDate.set(dateKey, new Map());
      }

      const dateMap = groupedByDate.get(dateKey)!;
      const itemKey = agg.menuItemName;

      if (dateMap.has(itemKey)) {
        const existing = dateMap.get(itemKey)!;
        existing.orderCount += agg.orderCount;
        existing.quantity += agg.quantity;
      } else {
        dateMap.set(itemKey, {
          menuItemName: agg.menuItemName,
          orderCount: agg.orderCount,
          quantity: agg.quantity,
        });
      }
    }

    // Convert to array and sort by date
    return Array.from(groupedByDate.entries())
      .map(([date, itemsMap]) => ({
        date,
        items: Array.from(itemsMap.values()).sort((a, b) => b.orderCount - a.orderCount), // Sort by order count descending
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

export const storage = new DbStorage();
