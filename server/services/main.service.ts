import { randomUUID } from "crypto";
import type { Response } from "express";
import type { Message } from "@shared/schema";
import { getRecentSSEEvents, emitSSE, triggerDebouncedOrderDetection, sendMessageThroughRelay } from "../utils.js";
import { sseClients, aiSuggestedResponses } from "../globals.js";
import { storage } from "../storage.js";
import { db } from "../db.js";
import { orders, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getOptInStatus, setOptInStatus } from "./twilio.service.js";
import { generateAISuggestedResponse } from "../aiFunctions.js";

// Sets up SSE headers and sends initial connection event
export function setupSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  (res as any).flushHeaders?.();
  res.write(`data: ${JSON.stringify({ event: "connected" })}\n\n`);
}

// Sends recent events from Redis to the client (if in production mode)
export async function sendRecentSSEEvents(userId: string, res: Response): Promise<void> {
  if (process.env.PRODUCTION !== 'true') {
    return; // Only send recent events in production
  }

  try {
    const recentEvents = await getRecentSSEEvents(userId);
    // Send events in reverse order (oldest first) so client processes them chronologically
    for (const sseEvent of recentEvents.reverse()) {
      const payload = `data: ${JSON.stringify({ event: sseEvent.event, data: sseEvent.data })}\n\n`;
      res.write(payload);
    }
    if (recentEvents.length > 0) {
      console.log(`[SSE] Sent ${recentEvents.length} recent events to userId ${userId}`);
    }
  } catch (error) {
    console.error(`[SSE] Error sending recent events to userId ${userId}:`, error);
  }
}

// Registers the client connection in the SSE clients map
export function registerSSEClient(userId: string, res: Response): void {
  const clients = sseClients.get(userId) ?? new Set<Response>();
  clients.add(res);
  sseClients.set(userId, clients);
}

// Sets up keep-alive interval to prevent connection timeout
export function setupSSEKeepAlive(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    res.write(":\n\n");
  }, 30000);
}

// Handles client disconnection cleanup
export function handleSSEDisconnect(userId: string, res: Response, keepAlive: NodeJS.Timeout): void {
  clearInterval(keepAlive);
  const set = sseClients.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) {
      sseClients.delete(userId);
    }
  }
  res.end();
}

// Validates and extracts SMS data from webhook request
export function validateSMSData(reqBody: any): { incomingNumber: string; messageText: string } | null {
  const { From, Body } = reqBody || {};
  const incomingNumber = typeof From === 'string' ? From.trim() : '';
  const messageText = typeof Body === 'string' ? Body.trim() : '';

  if (!incomingNumber || !messageText) {
    return null;
  }

  return { incomingNumber, messageText };
}

// Creates a message object from incoming SMS
export function createIncomingMessage(messageText: string): Message {
  return {
    id: randomUUID(),
    text: messageText,
    isOutgoing: true, // true = from customer (appears on left side)
    timestamp: new Date().toISOString(),
  };
}

// Handles Twilio Campaign opt-in flow keywords and returns processing flags
export async function handleTwilioCampaignOptIn(
  incomingNumber: string,
  messageText: string
): Promise<{
  shouldProcessNormally: boolean;
  confirmationMessage: string | null;
  shouldSendOptInReminder: boolean;
  shouldIgnore: boolean;
}> {
  const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
  if (!isTwilioCampaign) {
    return { shouldProcessNormally: true, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: false };
  }

  const optInStatus = await getOptInStatus(incomingNumber);
  const upperMessage = messageText.toUpperCase().trim();

  // Handle STOP keyword (always processed first)
  if (upperMessage === 'STOP') {
    await setOptInStatus(incomingNumber, 'opted-out');
    console.log(`[Twilio Campaign] ${incomingNumber} opted out`);
    return { shouldProcessNormally: false, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: false };
  }

  // Handle ORDER keyword (initial opt-in request)
  if (upperMessage === 'ORDER') {
    await setOptInStatus(incomingNumber, 'pending');
    const confirmationMessage = "OrderBot: Reply YES to confirm you want to place orders & receive order confirmations/replies via text from OrderBot. Msg&Data rates may apply. Reply STOP to unsubscribe.";
    return { shouldProcessNormally: false, confirmationMessage, shouldSendOptInReminder: false, shouldIgnore: false };
  }

  // Handle YES/Y confirmation (must be in pending state)
  if ((upperMessage === 'YES' || upperMessage === 'Y') && optInStatus === 'pending') {
    await setOptInStatus(incomingNumber, 'opted-in');
    console.log(`[Twilio Campaign] ${incomingNumber} confirmed opt-in`);
    return { shouldProcessNormally: true, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: false };
  }

  // User has opted out - ignore the message
  if (optInStatus === 'opted-out') {
    console.log(`[Twilio Campaign] Ignoring message from opted-out user ${incomingNumber}`);
    return { shouldProcessNormally: false, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: true };
  }

  // User is in pending state but didn't send YES/Y
  if (optInStatus === 'pending') {
    console.log(`[Twilio Campaign] Ignoring message from ${incomingNumber} - still pending opt-in confirmation`);
    return { shouldProcessNormally: false, confirmationMessage: null, shouldSendOptInReminder: true, shouldIgnore: false };
  }

  // If status is not opted-in and not pending, user hasn't started opt-in process
  if (optInStatus !== 'opted-in') {
    console.log(`[Twilio Campaign] Ignoring message from ${incomingNumber} - not opted in`);
    return { shouldProcessNormally: false, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: false };
  }

  return { shouldProcessNormally: true, confirmationMessage: null, shouldSendOptInReminder: false, shouldIgnore: false };
}

// Finds existing order or creates a new one for the phone number
export async function findOrCreateOrder(
  incomingNumber: string,
  messageText: string,
  shouldProcessNormally: boolean
): Promise<{ userId: string; orderId: string; isNewOrder: boolean }> {
  const existingOrder = await db.select().from(orders).where(eq(orders.number, incomingNumber)).limit(1);

  if (existingOrder.length > 0) {
    const order = existingOrder[0];
    const userId = order.userId;
    const orderId = order.id;

    // Only reset order status if we're processing normally (not opt-in flow)
    if (shouldProcessNormally) {
      await resetOrderIfNeeded(orderId, order);
    }

    return { userId, orderId, isNewOrder: false };
  } else {
    // Create new order
    const existingUser = await db.select().from(users).limit(1);
    if (!existingUser[0]) {
      throw new Error('No user available to attach incoming SMS');
    }

    const userId = existingUser[0].id;
    const newOrder = await storage.createOrder({
      userId,
      firstName: null,
      lastName: null,
      number: incomingNumber,
      firstMessage: messageText,
      status: 'New',
      lastMessage: new Date(),
      pickupTime: null,
      items: [],
      orderPrice: '0.00',
      notes: '',
      orderMade: false,
      pickupTimeDetected: false,
    });

    return { userId, orderId: newOrder.id, isNewOrder: true };
  }
}

// Resets order to New status if it's completed or from a previous day
async function resetOrderIfNeeded(orderId: string, order: any): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const orderLastMessage = order.lastMessage ? new Date(order.lastMessage) : null;
  const isOldOrder = orderLastMessage && orderLastMessage < today;

  // If order is completed OR if it's an old order (from yesterday or earlier), reset it to New status
  if (order.status === 'Completed' || isOldOrder) {
    const reason = order.status === 'Completed' ? 'completed' : 'old order from previous day';
    console.log(`[SMS Reply] Resetting ${reason} order ${orderId} to New status for phone number ${order.number}`);

    await storage.updateOrderStatus(orderId, 'New');
    await storage.updateOrderMade(orderId, false);
    await storage.updatePickupTimeDetected(orderId, false);

    // Reset order details to start fresh
    await storage.updateOrderDetails(orderId, {
      items: [],
      orderPrice: '0.00',
      notes: '',
    });
    // Reset pickupTime to null explicitly
    await db.update(orders)
      .set({ pickupTime: null })
      .where(eq(orders.id, orderId));
  }
}

// Saves incoming message to database and emits SSE event
export async function saveAndEmitIncomingMessage(
  userId: string,
  orderId: string,
  message: Message,
  incomingNumber: string,
  isNewOrder: boolean
): Promise<void> {
  // Save message immediately
  await storage.addMessageToOrder(userId, orderId, message);
  await storage.updateOrderLastMessage(orderId, new Date());

  // Emit SSE event immediately so frontend sees the message right away
  await emitSSE(userId, 'order-message', {
    orderId,
    message,
    number: incomingNumber,
    source: 'incoming',
    isNewOrder,
    aiSuggestedResponse: null, // Will be updated asynchronously
  });
}

// Sends confirmation message and saves it to database (async)
export async function sendAndSaveConfirmationMessage(
  userId: string,
  orderId: string,
  incomingNumber: string,
  confirmationMessage: string
): Promise<void> {
  try {
    // Send via SMS
    await sendMessageThroughRelay(incomingNumber, confirmationMessage);
    console.log(`[Twilio Campaign] Sent confirmation message to ${incomingNumber}`);

    // Save confirmation message to database as restaurant message (isOutgoing: false)
    const confirmationMsg: Message = {
      id: randomUUID(),
      text: confirmationMessage,
      isOutgoing: false, // false = restaurant messages (Rod's messages)
      timestamp: new Date().toISOString(),
    };
    await storage.addMessageToOrder(userId, orderId, confirmationMsg);
    await storage.updateOrderLastMessage(orderId, new Date());

    // Emit SSE event so frontend sees the confirmation message
    await emitSSE(userId, 'order-message', {
      orderId,
      message: confirmationMsg,
      number: incomingNumber,
      source: 'outgoing',
      aiSuggestedResponse: null,
    });
  } catch (error) {
    console.error(`[Twilio Campaign] Failed to send confirmation message to ${incomingNumber}:`, error);
  }
}

// Sends opt-in reminder message and saves it to database (async)
export async function sendAndSaveOptInReminder(
  userId: string,
  orderId: string,
  incomingNumber: string
): Promise<void> {
  try {
    const reminderMessage = "Please reply YES to confirm you want to place orders and receive order confirmations via text. Reply STOP to unsubscribe.";

    // Send via SMS
    await sendMessageThroughRelay(incomingNumber, reminderMessage);
    console.log(`[Twilio Campaign] Sent opt-in reminder to ${incomingNumber}`);

    // Save reminder message to database as restaurant message (isOutgoing: false)
    const reminderMsg: Message = {
      id: randomUUID(),
      text: reminderMessage,
      isOutgoing: false, // false = restaurant messages (Rod's messages)
      timestamp: new Date().toISOString(),
    };
    await storage.addMessageToOrder(userId, orderId, reminderMsg);
    await storage.updateOrderLastMessage(orderId, new Date());

    // Emit SSE event so frontend sees the reminder message
    await emitSSE(userId, 'order-message', {
      orderId,
      message: reminderMsg,
      number: incomingNumber,
      source: 'outgoing',
      aiSuggestedResponse: null,
    });
  } catch (error) {
    console.error(`[Twilio Campaign] Failed to send opt-in reminder to ${incomingNumber}:`, error);
  }
}

// Processes order detection and generates AI suggestion asynchronously
export async function processOrderDetectionAndAI(
  userId: string,
  orderId: string,
  message: Message,
  incomingNumber: string,
  isNewOrder: boolean
): Promise<void> {
  try {
    // Trigger order detection (non-blocking)
    await triggerDebouncedOrderDetection(userId, orderId);

    // Generate AI suggestion asynchronously
    try {
      const conversation = await storage.getOrderConversation(userId, orderId);
      if (conversation) {
        const allMessages = (conversation.messages as Message[]) || [];
        let aiSuggestion = await generateAISuggestedResponse(allMessages, userId, orderId);

        if (aiSuggestion && aiSuggestion.trim()) {
          aiSuggestion = aiSuggestion.trim();
          aiSuggestedResponses.set(orderId, aiSuggestion);
          console.log('[SMS Reply] AI suggested response refreshed for incoming SMS');

          // Emit SSE event again with AI suggestion
          await emitSSE(userId, 'order-message', {
            orderId,
            message,
            number: incomingNumber,
            source: 'incoming',
            isNewOrder,
            aiSuggestedResponse: aiSuggestion,
          });
        } else {
          aiSuggestedResponses.delete(orderId);
        }
      } else {
        aiSuggestedResponses.delete(orderId);
      }
    } catch (error) {
      aiSuggestedResponses.delete(orderId);
      console.error('[SMS Reply] Error refreshing AI suggested response:', error);
    }
  } catch (error) {
    console.error('[SMS Reply] Error in async processing:', error);
  }
}

