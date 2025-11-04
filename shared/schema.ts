import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, pgEnum, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Enums for orders table
export const orderTagEnum = pgEnum('order_tag', [
  '1st order',
  '2nd order',
  '3rd order',
  '4th order',
  '5th order',
  '6th order',
  '7th order',
  'VIP (8x)'
]);

export const orderStatusEnum = pgEnum('order_status', [
  'New',
  'Confirmed',
  'Ready',
  'Completed'
]);

// Orders table
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  firstName: text("first_name"),
  lastName: text("last_name"),
  number: text("number").notNull(),
  tag: orderTagEnum("tag"),
  firstMessage: text("first_message").notNull(),
  orderPrice: text("order_price"),
  items: text("items").array(),
  notes: text("notes"),
  status: orderStatusEnum("status"),
  isLate: boolean("is_late").default(false),
  isUrgent: boolean("is_urgent").default(false),
  pickupTime: timestamp("pickup_time"),
  lastMessage: timestamp("last_message"),
  orderMade: boolean("order_made").default(false),
  pickupTimeDetected: boolean("pickup_time_detected").default(false),
});

// Order conversations table - stores all messages for an order in one row as JSON
export const orderConversations = pgTable("order_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  number: text("number").notNull(),
  messages: jsonb("messages").$type<Message[]>().notNull().default(sql`'[]'::jsonb`), // All messages stored as JSON array
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Menu items table
export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  price: text("price").notNull(),
  category: text("category"),
  description: text("description"),
  imageUrl: text("image_url"),
  isAvailable: boolean("is_available").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phoneNumber: text("phone_number").notNull().unique(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Order history table
export const orderHistory = pgTable("order_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  orderSummary: jsonb("order_summary"),
  notes: text("notes"),
  status: orderStatusEnum("status"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Customer stats table
export const customerStats = pgTable("customer_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().unique().references(() => customers.id),
  totalOrders: integer("total_orders").default(0),
  lastOrderDate: timestamp("last_order_date"),
  totalSpent: numeric("total_spent", { precision: 10, scale: 2 }).default("0.00"),
});

export const insertOrderSchema = createInsertSchema(orders);
export const insertOrderConversationSchema = createInsertSchema(orderConversations);
export const insertMenuItemSchema = createInsertSchema(menuItems);
export const insertCustomerSchema = createInsertSchema(customers);
export const insertOrderHistorySchema = createInsertSchema(orderHistory);
export const insertCustomerStatsSchema = createInsertSchema(customerStats);

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderConversation = typeof orderConversations.$inferSelect;
export type InsertOrderConversation = z.infer<typeof insertOrderConversationSchema>;
export type MenuItem = typeof menuItems.$inferSelect;
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type OrderHistory = typeof orderHistory.$inferSelect;
export type InsertOrderHistory = z.infer<typeof insertOrderHistorySchema>;
export type CustomerStats = typeof customerStats.$inferSelect;
export type InsertCustomerStats = z.infer<typeof insertCustomerStatsSchema>;

// Message conversation types for in-memory storage
export const messageSchema = z.object({
  id: z.string(),
  text: z.string(),
  isOutgoing: z.boolean(),
  timestamp: z.string(),
  isAIOrganized: z.boolean().optional(),
});

export const orderDetailsSchema = z.object({
  items: z.array(z.string()),
  pickupTime: z.string(),
  pickupTimestamp: z.number(),
  total: z.string(),
  notes: z.string().optional(),
});

export const conversationSchema = z.object({
  id: z.string(),
  phoneNumber: z.string(),
  customerName: z.string().optional(),
  messages: z.array(messageSchema),
  orderStatus: z.enum(['new', 'confirmed', 'ready', 'completed']),
  orderDetails: orderDetailsSchema.optional(),
  orderCount: z.number().default(1),
  aiSuggestedResponse: z.string().optional(),
  lastMessage: z.date().optional(),
});

export type Message = z.infer<typeof messageSchema>;
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
