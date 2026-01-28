import { randomUUID } from "crypto";
import { type Message } from "@shared/schema";
import { storage } from "../storage.js";
import { aiSuggestedResponses } from "../globals.js";
import { sendMessageThroughRelay, validateAndNormalizeStatus, formatMessages, formatCustomerName, calculateOrderCount, buildOrderDetails, formatPickupTimeForMessage, createConfirmationMessage, removePickupTimeFromNotes, isValidPickupTimeFormat, extractQuantityFromItemString, extractPriceFromItemString } from "../utils.js";
import { getOptInStatus } from "./twilio.service.js";
import { IStorage } from "../storage.js";
import { oauthTokens } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";

export async function getOrderCounts(userId: string) {
  const counts = await storage.getOrderCounts(userId);
  return counts;
}

// Enriches a single order with conversation data and formatted fields for API response
async function enrichOrderWithConversation(userId: string, order: any) {
  // Fetch conversation for this order
  const conversationRow = await storage.getOrderConversation(userId, order.id);
  const messages: Message[] = (conversationRow?.messages as Message[]) || [];
  const formattedMessages = formatMessages(messages);

  // Build the enriched order object
  return {
    id: order.id,
    phoneNumber: order.number,
    lastMessage: order.lastMessage ? new Date(order.lastMessage).toISOString() : null,
    customerName: formatCustomerName(order.firstName, order.lastName),
    orderStatus: order.status?.toLowerCase(),
    orderCount: calculateOrderCount(order.tag),
    messages: formattedMessages,
    orderDetails: buildOrderDetails(order),
    aiSuggestedResponse: aiSuggestedResponses.get(order.id) ?? undefined,
  };
}

// Fetches orders by status and enriches each with conversation data (validates status, case-insensitive)
export async function getOrdersByStatus(userId: string, status: string) {
  // Validate and normalize status (handles "new", "NEW", "New", etc.)
  const normalizedStatus = validateAndNormalizeStatus(status);

  // Fetch orders from database
  const ordersList = await storage.getOrdersByStatus(userId, normalizedStatus as any);
  console.log(`[API] Fetching orders for status: ${normalizedStatus}, found ${ordersList.length} orders`);

  // Enrich each order with conversation data and formatted fields
  const ordersWithConversations = await Promise.all(
    ordersList.map(order => enrichOrderWithConversation(userId, order))
  );

  console.log(`[API] Returning ${ordersWithConversations.length} orders with conversations`);
  return ordersWithConversations;
}

// Updates order with new details (status, price, items, notes, pickup time) - service-specific logic
// Appends formatted pickup time to existing notes (format: "PICKUP_TIME: 10:00 PM")
function appendPickupTimeToNotes(existingNotes: string | null | undefined, pickupTime: string): string {
  const cleanedNotes = removePickupTimeFromNotes(existingNotes ?? null);
  const separator = cleanedNotes ? '\n\n' : '';
  return cleanedNotes + separator + `PICKUP_TIME: ${pickupTime.trim()}`;
}

// Builds base update data object from order details (total, items, basic notes)
function buildBaseUpdateData(orderDetails?: {
  total?: string;
  items?: string[];
  notes?: string | null;
  pickupTime?: string | Date;
}): {
  orderPrice?: string;
  items?: string[];
  notes?: string | null;
  pickupTime?: Date;
} {
  const updateData: {
    orderPrice?: string;
    items?: string[];
    notes?: string | null;
    pickupTime?: Date;
  } = {};

  // Map total to orderPrice
  if (orderDetails?.total) {
    updateData.orderPrice = orderDetails.total;
  }

  // Add items if provided and not empty
  if (orderDetails?.items && orderDetails.items.length > 0) {
    updateData.items = orderDetails.items;
  }

  // Add basic notes (without pickup time handling)
  if (orderDetails?.notes !== undefined) {
    updateData.notes = orderDetails.notes || null;
  }

  return updateData;
}

// Handles pickup time formatting and appending to notes
function handlePickupTimeInNotes(
  orderDetails: { notes?: string | null; pickupTime?: string | Date },
  updateData: { notes?: string | null }
): void {
  // Only process if pickupTime is a string (not a Date object)
  if (orderDetails.pickupTime && typeof orderDetails.pickupTime === 'string') {
    const pickupTimeStr = orderDetails.pickupTime.trim();

    // Validate format before processing
    if (isValidPickupTimeFormat(pickupTimeStr)) {
      // Remove old pickup time entry and append new one
      const existingNotes = orderDetails.notes || '';
      updateData.notes = appendPickupTimeToNotes(existingNotes, pickupTimeStr);
    }
  }
}

// Cleans notes by removing old PICKUP_TIME entries (when notes are updated without pickup time)
function cleanNotesIfNeeded(
  orderDetails: { notes?: string | null; pickupTime?: string | Date },
  updateData: { notes?: string | null }
): void {
  // Only clean if notes are provided but pickup time is not a string
  const hasNotes = orderDetails.notes !== undefined;
  const hasPickupTimeString = orderDetails.pickupTime && typeof orderDetails.pickupTime === 'string';

  if (hasNotes && !hasPickupTimeString) {
    // Remove any old PICKUP_TIME entries from notes
    updateData.notes = removePickupTimeFromNotes(orderDetails.notes ?? null) || null;
  }
}

// Main function: updates order with new details (price, items, notes, pickup time) and optionally updates status
export async function updateOrderFromDetails(
  storage: any,
  orderId: string,
  orderDetails?: {
    total?: string;
    items?: string[];
    notes?: string | null;
    pickupTime?: string | Date;
  },
  options?: {
    skipStatusUpdate?: boolean;
  }
) {
  // Build base update data (total, items, basic notes)
  const updateData = buildBaseUpdateData(orderDetails);

  // Handle pickup time formatting and appending to notes
  if (orderDetails) {
    handlePickupTimeInNotes(orderDetails, updateData);
  }

  // Clean notes if they're updated without a pickup time string
  if (orderDetails) {
    cleanNotesIfNeeded(orderDetails, updateData);
  }

  // Update order in database if there's any data to update
  if (Object.keys(updateData).length > 0) {
    await storage.updateOrderDetails(orderId, updateData);
  }

  // Update order status to "Confirmed" unless explicitly skipped
  if (!options?.skipStatusUpdate) {
    await storage.updateOrderStatus(orderId, 'Confirmed');
  }
}

// Gets Clover access token and merchant ID from database (returns null if not connected)
async function getCloverTokenAndMerchantId(userId: string): Promise<{ accessToken: string; merchantId: string } | null> {
  const tokenRecord = await db.select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
    .limit(1);

  if (!tokenRecord[0]) return null; // No Clover token, not connected

  const accessToken = process.env.MERCHENT_API_KEY || "";
  const merchantId = tokenRecord[0].merchantId || 'H4RW04034BGH1';

  return { accessToken, merchantId };
}

// Finds matching menu item and returns its price, or returns default price if not found
function findMenuItemPrice(itemName: string, menuItems: any[]): number {
  const matchingMenuItem = menuItems.find(mi =>
    mi.name.toLowerCase() === itemName.toLowerCase() ||
    itemName.toLowerCase().includes(mi.name.toLowerCase())
  );

  if (matchingMenuItem) {
    // Extract numeric price from menu item (remove currency symbols)
    return parseFloat(matchingMenuItem.price.replace(/[^0-9.]/g, ''));
  }

  // Default price if no match found
  return 9.99;
}

// Parses a single order item string into Clover line items (handles quantity, price extraction, menu matching)
function parseOrderItemToLineItems(
  itemStr: string,
  menuItems: any[]
): Array<{ name: string; price: number }> {
  console.log(`[Clover] Creating line item: ${itemStr}`);

  // Extract quantity (e.g., "Burger x2" -> quantity: 2)
  const { quantity, itemNameWithoutQuantity } = extractQuantityFromItemString(itemStr);

  // Extract price if present (e.g., "Burger: $9.99" -> totalPrice: 9.99)
  const { totalPrice, itemNameWithoutPrice } = extractPriceFromItemString(itemNameWithoutQuantity);

  // Get clean item name (without quantity and price)
  const itemName = itemNameWithoutPrice.trim();

  // Calculate unit price: use extracted price if available, otherwise find from menu items
  let unitPrice: number;
  if (totalPrice !== null) {
    unitPrice = totalPrice / quantity;
  } else {
    unitPrice = findMenuItemPrice(itemName, menuItems);
  }

  console.log(`[Clover] Creating line item: ${itemName} - Unit price: ${unitPrice}, Quantity: ${quantity}`);

  // Create one line item per quantity (Clover expects individual line items, not quantity field)
  const lineItems: Array<{ name: string; price: number }> = [];
  for (let i = 0; i < quantity; i++) {
    const priceInCents = Math.round(unitPrice * 100); // Clover expects price in cents
    if (priceInCents > 0) {
      lineItems.push({ name: itemName, price: priceInCents });
    } else {
      console.warn(`[Clover] Skipping invalid price line item: ${itemName} (${priceInCents})`);
    }
  }

  return lineItems;
}

// Converts all order items to Clover line items format
function buildLineItemsFromOrder(orderItems: string[], menuItems: any[]): Array<{ name: string; price: number }> {
  const allLineItems: Array<{ name: string; price: number }> = [];

  for (const itemStr of orderItems) {
    const lineItems = parseOrderItemToLineItems(itemStr, menuItems);
    allLineItems.push(...lineItems);
  }

  return allLineItems;
}

// Builds Clover atomic order payload with line items, customer name, and notes
function buildCloverOrderPayload(
  lineItems: Array<{ name: string; price: number }>,
  order: any,
  orderDetails?: any
): any {
  const atomicOrderPayload: any = {
    orderCart: {
      lineItems,
      clientCreatedTime: Date.now(),
    },
  };

  // Add customer name as order title if available
  if (order.firstName || order.lastName) {
    atomicOrderPayload.title = `Order from ${order.firstName || ''} ${order.lastName || ''}`.trim();
  }

  // Add order notes if available
  if (orderDetails?.notes || order.notes) {
    atomicOrderPayload.note = orderDetails?.notes || order.notes;
  }

  return atomicOrderPayload;
}

// Sends order to Clover API and returns the response
async function sendOrderToCloverAPI(
  merchantId: string,
  accessToken: string,
  payload: any
): Promise<{ success: boolean; cloverOrderId?: string; error?: string }> {
  console.log(`[Clover] Creating atomic order for merchant ${merchantId} with ${payload.orderCart.lineItems.length} items`);

  const cloverResponse = await fetch(
    `https://sandbox.dev.clover.com/v3/merchants/${merchantId}/atomic_order/orders`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (cloverResponse.ok) {
    const cloverOrder = await cloverResponse.json() as { id?: string };
    console.log(`[Clover] ✓ Successfully created order ${cloverOrder.id} in Clover`);
    return { success: true, cloverOrderId: cloverOrder.id };
  } else {
    const errorText = await cloverResponse.text();
    console.error(`[Clover] Failed to create order in Clover (${cloverResponse.status}):`, errorText);
    return { success: false, error: errorText };
  }
}

// Saves Clover order ID back to the order record in database
async function saveCloverOrderIdToOrder(
  storage: IStorage,
  orderId: string,
  cloverOrderId: string
): Promise<void> {
  await storage.updateOrderDetails(orderId, { cloverOrderId });
  console.log(`[Clover] Saved Clover order ID ${cloverOrderId} to order ${orderId}`);
}

// Main function: creates order in Clover POS system (if Clover integration is connected)
export async function createCloverOrder(
  storage: IStorage,
  userId: string,
  order: any,
  orderDetails?: any
) {
  try {
    // Check if Clover is connected (get token and merchant ID)
    const cloverConfig = await getCloverTokenAndMerchantId(userId);
    if (!cloverConfig) {
      return; // No Clover token, skip silently
    }

    const { accessToken, merchantId } = cloverConfig;

    // Get order items (from orderDetails or order)
    const orderItems = orderDetails?.items || order.items || [];
    if (orderItems.length === 0) {
      console.log('[Clover] Skipping Clover order creation - no items in order');
      return;
    }

    // Fetch menu items for price matching
    const menuItems = await storage.getMenuItems(userId);

    // Convert order items to Clover line items format
    const lineItems = buildLineItemsFromOrder(orderItems, menuItems);
    if (lineItems.length === 0) {
      console.log('[Clover] Skipping Clover order creation - no valid line items parsed');
      return;
    }

    // Build Clover order payload
    const atomicOrderPayload = buildCloverOrderPayload(lineItems, order, orderDetails);

    // Send order to Clover API
    const result = await sendOrderToCloverAPI(merchantId, accessToken, atomicOrderPayload);

    // Save Clover order ID back to our order record if successful
    if (result.success && result.cloverOrderId) {
      await saveCloverOrderIdToOrder(storage, order.id, result.cloverOrderId);
    }
  } catch (error) {
    console.error('[Clover] Error creating order in Clover:', error);
  }
}

// Saves confirmation message to database and updates order's last message timestamp
async function saveConfirmationMessage(userId: string, orderId: string, message: Message): Promise<void> {
  await storage.addMessageToOrder(userId, orderId, message);
  await storage.updateOrderLastMessage(orderId, new Date());
  console.log(`[Send to Preparation] Confirmation message prepared for order ${orderId}`);
}

// Sends confirmation message via messaging service, checking opt-in status if Twilio Campaign is enabled
async function sendConfirmationMessageToCustomer(phoneNumber: string | null, messageText: string, orderId: string): Promise<void> {
  if (!phoneNumber) {
    console.warn(`[Send to Preparation] Order ${orderId} is missing a contact number; skipping messaging service send.`);
    return;
  }

  // Check opt-in status if Twilio Campaign is enabled
  const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
  if (isTwilioCampaign) {
    const optInStatus = await getOptInStatus(phoneNumber);
    if (optInStatus !== 'opted-in') {
      console.log(`[Send to Preparation] Skipping confirmation message - customer ${phoneNumber} opt-in status: ${optInStatus}`);
      return;
    }
  }

  // Send message through relay service
  await sendMessageThroughRelay(phoneNumber, messageText);
  console.log(`[Send to Preparation] Sent confirmation message via messaging service to ${phoneNumber}`);
}

// Main function: sends order to preparation by updating order, creating Clover order, and sending confirmation message
export async function sendOrderToPreparation(userId: string, orderId: string, orderDetails: any): Promise<void> {
  // Get the order and validate it exists
  const order = await storage.getOrderById(userId, orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // Update order with new details (status, price, pickup time, items, notes)
  await updateOrderFromDetails(storage, orderId, orderDetails);

  // Create order in Clover POS system (if Clover integration is connected)
  await createCloverOrder(storage, userId, order, orderDetails);

  // Format pickup time for the confirmation message
  const formattedTime = await formatPickupTimeForMessage(orderDetails, order);

  // Create and send confirmation message to customer
  try {
    const confirmationMessage = createConfirmationMessage(formattedTime);

    // Save message to database
    await saveConfirmationMessage(userId, orderId, confirmationMessage);

    // Send message via messaging service (with opt-in checking)
    try {
      await sendConfirmationMessageToCustomer(order.number, confirmationMessage.text, orderId);
    } catch (error) {
      console.error('[Send to Preparation] Failed to deliver confirmation message via messaging service', {
        error,
        orderId,
        number: order.number,
      });
    }
  } catch (error) {
    console.error('[Send to Preparation] Error sending confirmation message:', error);
    // Don't fail the request if message sending fails - order was already updated
  }
}

// Creates a ready message object for the customer
function createReadyMessage(): Message {
  return {
    id: randomUUID(),
    text: 'Your order is all set! Come by anytime to pick it up.',
    isOutgoing: false, // false = from business (appears on right side)
    timestamp: new Date().toISOString(),
  };
}

// Saves ready message to database and updates order's last message timestamp
async function saveReadyMessage(userId: string, orderId: string, message: Message): Promise<void> {
  await storage.addMessageToOrder(userId, orderId, message);
  await storage.updateOrderLastMessage(orderId, new Date());
  console.log(`[Mark Ready] Ready message prepared for order ${orderId}`);
}

// Sends ready message via messaging service, checking opt-in status if Twilio Campaign is enabled
async function sendReadyMessageToCustomer(phoneNumber: string | null, messageText: string, orderId: string): Promise<void> {
  if (!phoneNumber) {
    console.warn(`[Mark Ready] Order ${orderId} is missing a contact number; skipping messaging service send.`);
    return;
  }

  // Check opt-in status if Twilio Campaign is enabled
  const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
  if (isTwilioCampaign) {
    const optInStatus = await getOptInStatus(phoneNumber);
    if (optInStatus !== 'opted-in') {
      console.log(`[Mark Ready] Skipping ready message - customer ${phoneNumber} opt-in status: ${optInStatus}`);
      return;
    }
  }

  // Send message through relay service
  await sendMessageThroughRelay(phoneNumber, messageText);
  console.log(`[Mark Ready] Sent ready message via messaging service to ${phoneNumber}`);
}

// Main function: marks order as ready for pickup by updating status and sending notification to customer
export async function markOrderAsReady(userId: string, orderId: string): Promise<void> {
  // Get the order and validate it exists
  const order = await storage.getOrderById(userId, orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // Update order status to Ready
  await storage.updateOrderStatus(orderId, 'Ready');

  // Create and send ready message to customer
  try {
    const readyMessage = createReadyMessage();

    // Save message to database
    await saveReadyMessage(userId, orderId, readyMessage);

    // Send message via messaging service (with opt-in checking)
    try {
      await sendReadyMessageToCustomer(order.number, readyMessage.text, orderId);
    } catch (error) {
      console.error('[Mark Ready] Failed to deliver ready message via messaging service', {
        error,
        orderId,
        number: order.number,
      });
    }
  } catch (error) {
    console.error('[Mark Ready] Error sending ready message:', error);
    // Don't fail the request if message sending fails - order status was already updated
  }
}

export async function markOrderAsPickedUp(userId: string, orderId: string): Promise<void> {
  // Get the order
  const order = await storage.getOrderById(userId, orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // Update order status to Completed and update lastMessage to track completion date
  await storage.updateOrderStatus(orderId, 'Completed');
  await storage.updateOrderLastMessage(orderId, new Date());
}

export async function getOrderHistory(userId: string, page: number, limit: number) {
  const result = await storage.getOrderHistoryPaginated(userId, page, limit);
  return result;
}

export async function deleteOrder(userId: string, orderId: string): Promise<void> {
  await storage.deleteOrder(userId, orderId);
}

