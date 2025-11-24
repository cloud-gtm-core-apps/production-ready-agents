import { randomUUID } from "crypto";
import { type Message } from "@shared/schema";
import { storage } from "../storage.js";
import { generateAISuggestedResponse, analyzeOrderSummaryFromConversation, detectPickupTimeFromConversation, detectHalfSandwichRequest } from "../aiFunctions.js";
import { aiSuggestedResponses } from "../globals.js";
import { sendMessageThroughRelay, emitSSE, triggerDebouncedOrderDetection, getMenuItemsWithCache, formatOrderMessage, validateAndTrimMessage } from "../utils.js";
import { getOptInStatus } from "./twilio.service.js";

// Gets order from database and validates it has a contact number
async function getOrderWithContactNumber(userId: string, orderId: string): Promise<{ number: string }> {
  const order = await storage.getOrderById(userId, orderId);

  if (!order) {
    throw new Error('Order not found');
  }

  if (!order.number) {
    throw new Error('Order does not have a contact number');
  }

  return order;
}

// Checks opt-in status if Twilio Campaign is enabled (throws error if not opted-in)
async function checkOptInStatusForMessaging(phoneNumber: string): Promise<void> {
  const isTwilioCampaign = process.env.TWILIO_CAMPAIGN === 'true';
  if (!isTwilioCampaign) {
    return; // No opt-in check needed if Twilio Campaign is not enabled
  }

  const optInStatus = await getOptInStatus(phoneNumber);
  if (optInStatus !== 'opted-in') {
    const error: any = new Error(
      optInStatus === 'opted-out'
        ? 'Customer has opted out. Messages cannot be sent.'
        : 'Customer has not opted in. Messages cannot be sent.'
    );
    error.statusCode = 403;
    throw error;
  }
}

// Sends message through relay service with proper error handling
async function sendMessageThroughRelayWithErrorHandling(
  phoneNumber: string,
  messageText: string,
  orderId: string
): Promise<void> {
  try {
    await sendMessageThroughRelay(phoneNumber, messageText);
  } catch (error) {
    console.error("[Messaging Service] Failed to send message", {
      error,
      orderId,
      to: phoneNumber,
    });

    const relayError: any = new Error("Failed to deliver message via messaging service");
    relayError.statusCode = 502;
    throw relayError;
  }
}

// Creates a message object for Rod (restaurant owner) to send to customer
function createRodMessage(messageText: string): Message {
  return {
    id: randomUUID(),
    text: messageText,
    isOutgoing: false, // false = from restaurant (appears on right side)
    timestamp: new Date().toISOString(),
  };
}

// Saves Rod's message to database and updates order's last message timestamp
async function saveRodMessageToOrder(userId: string, orderId: string, message: Message): Promise<void> {
  await storage.addMessageToOrder(userId, orderId, message);
  await storage.updateOrderLastMessage(orderId, new Date());
}

// Emits SSE event to notify clients about the new message
async function emitMessageSSE(userId: string, orderId: string, message: Message): Promise<void> {
  await emitSSE(userId, 'order-message', {
    orderId,
    message,
    source: 'outgoing',
    aiSuggestedResponse: null,
  });
}

// Main function: sends a message from restaurant to customer, saves it, and triggers order detection
export async function sendMessageToOrder(userId: string, orderId: string, message: string): Promise<void> {
  // Validate and trim the message
  const trimmedMessage = validateAndTrimMessage(message);

  // Get order and validate it has a contact number
  const order = await getOrderWithContactNumber(userId, orderId);

  // Check opt-in status if Twilio Campaign is enabled
  await checkOptInStatusForMessaging(order.number);

  // Send message through relay service
  await sendMessageThroughRelayWithErrorHandling(order.number, trimmedMessage, orderId);

  // Clear AI suggested response cache (since Rod is sending a message)
  aiSuggestedResponses.delete(orderId);

  // Create and save Rod's message to database
  const rodMessage = createRodMessage(trimmedMessage);
  await saveRodMessageToOrder(userId, orderId, rodMessage);

  // Emit SSE event to notify clients
  await emitMessageSSE(userId, orderId, rodMessage);

  // Trigger debounced order detection after Rod's message (to detect if customer responds with an order)
  await triggerDebouncedOrderDetection(userId, orderId);
}

export async function getAISuggestedReply(userId: string, orderId: string): Promise<string | null> {
  // Get the conversation
  const conversation = await storage.getOrderConversation(userId, orderId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const allMessages = (conversation.messages as Message[]) || [];

  // Check cache first
  let suggestion = aiSuggestedResponses.get(orderId) ?? null;

  // If no cached suggestion, generate one
  if (!suggestion) {
    suggestion = await generateAISuggestedResponse(allMessages, userId, orderId);

    // Store or remove the suggestion
    if (suggestion && suggestion.trim()) {
      aiSuggestedResponses.set(orderId, suggestion.trim());
    } else {
      aiSuggestedResponses.delete(orderId);
      suggestion = null;
    }
  }

  return suggestion;
}

// Gets order and conversation from database and validates they exist
async function getOrderAndConversation(userId: string, orderId: string): Promise<{ order: any; messages: Message[] }> {
  const order = await storage.getOrderById(userId, orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  const conversation = await storage.getOrderConversation(userId, orderId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const messages = (conversation.messages as Message[]) || [];
  return { order, messages };
}

// Analyzes conversation messages to extract order summary and pickup time using AI
async function analyzeOrderFromConversation(
  messages: Message[],
  customerName: string | undefined,
  menuItems: any[]
): Promise<{
  summaryResult: any;
  pickupTime: string | null;
  lunchspecialrequest: boolean;
}> {
  const summaryResult = await analyzeOrderSummaryFromConversation(messages, customerName, menuItems);
  const pickupTime = await detectPickupTimeFromConversation(messages, { referenceTime: new Date() });
  const lunchspecialrequest = await detectHalfSandwichRequest(messages);
  console.log(`[Order Detection2] Lunch special request: ${lunchspecialrequest}`);

  // If lunch special is requested, add it to summaryResult.orderDetails.items
  if (lunchspecialrequest && summaryResult.orderDetails && menuItems && menuItems.length > 0) {
    const lunchSpecial = menuItems.find(item => 
      item.name.toLowerCase().includes('lunch') && 
      item.name.toLowerCase().includes('special')
    );

    if (lunchSpecial) {
      // Check if lunch special is already in the items
      const lunchSpecialName = lunchSpecial.name.toLowerCase();
      const alreadyPresent = summaryResult.orderDetails.items?.some((item: string) => {
        const itemName = item.toLowerCase();
        return itemName.includes(lunchSpecialName) || 
               (itemName.includes('lunch') && itemName.includes('special'));
      });

      if (!alreadyPresent) {
        // Add lunch special with price in the format "Item Name: $X.XX"
        const priceNum = parseFloat(lunchSpecial.price.replace(/[^0-9.]/g, ''));
        const formattedPrice = priceNum.toFixed(2);
        const lunchSpecialItem = `${lunchSpecial.name}: $${formattedPrice}`;
        
        // Ensure items array exists
        if (!summaryResult.orderDetails.items) {
          summaryResult.orderDetails.items = [];
        }
        
        summaryResult.orderDetails.items.push(lunchSpecialItem);
        console.log(`[Order Detection] Added lunch special to summaryResult.orderDetails.items: ${lunchSpecialItem}`);
      }
    }
  }

  return { summaryResult, pickupTime, lunchspecialrequest };
}

// Builds order details with default values (customer name and pickup time if missing)
function buildOrderDetailsWithDefaults(
  orderDetails: any,
  order: any,
  pickupTime: string | null
): any {
  const enrichedDetails = { ...orderDetails };

  // Use order's first name or phone number as customer name if not in order details
  if (!enrichedDetails.customerName) {
    enrichedDetails.customerName = order.firstName || order.number || "Customer";
  }

  // Add pickup time if detected from conversation
  if (pickupTime) {
    enrichedDetails.pickupTime = pickupTime;
  }

  return enrichedDetails;
}

// Main function: gets AI-generated order summary from conversation (analyzes messages to extract order details)
export async function getAIOrderSummary(userId: string, orderId: string): Promise<{
  orderMade: boolean;
  summary: string | null;
  details: any;
  lunchspecialrequest: boolean;
}> {
  // Get order and conversation from database
  const { order, messages } = await getOrderAndConversation(userId, orderId);

  // Get menu items for price matching
  const menuItems = await getMenuItemsWithCache(userId);

  // Analyze conversation messages to extract order summary and pickup time
  const { summaryResult, pickupTime, lunchspecialrequest } = await analyzeOrderFromConversation(
    messages,
    order.firstName || undefined,
    menuItems
  );

  // If lunch special is requested but no order was detected, create an order with just the lunch special
  if (lunchspecialrequest && (!summaryResult.orderMade || !summaryResult.orderDetails)) {
    const lunchSpecial = menuItems.find(item => 
      item.name.toLowerCase().includes('lunch') && 
      item.name.toLowerCase().includes('special')
    );

    if (lunchSpecial) {
      const priceNum = parseFloat(lunchSpecial.price.replace(/[^0-9.]/g, ''));
      const formattedPrice = priceNum.toFixed(2);
      const lunchSpecialItem = `${lunchSpecial.name}: $${formattedPrice}`;
      
      // Create order details with just the lunch special
      const orderDetails: any = {
        customerName: order.firstName || order.number || "Customer",
        items: [lunchSpecialItem],
      };

      // Add pickup time if detected
      if (pickupTime) {
        orderDetails.pickupTime = pickupTime;
      }

      const summary = formatOrderMessage(orderDetails, menuItems);
      
      console.log(`[Order Detection] Created order from lunch special request: ${lunchSpecialItem}`);
      
      return {
        orderMade: true,
        summary,
        details: orderDetails,
        lunchspecialrequest: lunchspecialrequest,
      };
    }
  }

  // If no order was detected in conversation, return early
  if (!summaryResult.orderMade || !summaryResult.orderDetails) {
    return {
      orderMade: false,
      summary: null,
      details: summaryResult.orderDetails ?? null,
      lunchspecialrequest: lunchspecialrequest,
    };
  }

  // Build order details with default values (customer name, pickup time)
  const orderDetails = buildOrderDetailsWithDefaults(summaryResult.orderDetails, order, pickupTime);

  // Format order details into human-readable summary message
  const summary = formatOrderMessage(orderDetails, menuItems);

  return {
    orderMade: true,
    summary,
    details: orderDetails,
    lunchspecialrequest: lunchspecialrequest,
  };
}

