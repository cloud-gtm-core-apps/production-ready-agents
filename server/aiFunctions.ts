import { Message } from "@shared/schema";
import {
    formatConversation,
    buildMenuContext,
    OpenAIOrderSummary,
    TrucubeOrderSummary,
    shouldGenerateAISuggestion,
    OpenAISuggestedResponse,
    TrucubeSuggestedResponse,
    OpenAIConditionalOutput,
    TrucubeConditionalOutput,
    OpenAIPickupTime,
    TrucubePickupTime,
    OpenAIHalfSandwich,
    TrucubeHalfSandwich,
} from "./utils.js";

export type OrderSummaryDetails = {
    customerName: string;
    items: string[];
    pickupTime?: string;
    notes?: string;
};

export type OrderSummaryResult = {
    orderMade: boolean;
    orderDetails?: OrderSummaryDetails;
};

function buildOrderSummaryPrompt(menuContext: string) {
    return `You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.
  
  IMPORTANT: ${menuContext}
  
  CRITICAL RULES:
  - ONLY include items that are in the menu provided above. NEVER include items that are not in the menu.
  - NEVER include 1/2 sandwich requests, half sandwich requests, or any variation of half sandwich orders.
  - If a customer mentions a 1/2 sandwich, half sandwich, or any half portion request, completely ignore it and do not include it in the order.
  - If an item mentioned is not found in the menu, exclude it completely from the order.
  
  If an order has been placed, extract:
  1. Customer name (if mentioned)
  2. All items ordered (be specific, include quantities, and prices):
     - Match items mentioned in the conversation to the menu items provided above
     - Use exact menu item names
     - Include the price from the menu for each item in the format: "Item Name: $X.XX"
     - For quantities, include quantity and calculate total price: "2x Item Name: $X.XX" (where $X.XX is the total for that quantity)
     - Include customizations or modifications in the item name: "Item Name (customization): $X.XX"
     - If an item is mentioned but not in the menu, do not include it as mentioned (without price if unknown)
     - NEVER include half portions, 1/2 sandwiches, or any items not in the menu
  3. Any special notes or instructions

Return only valid JSON, no markdown code blocks, and no explanations.
JSON format:
{
  "orderMade": boolean,
  "orderDetails": {
      "customerName": string,
      "items": string[],
      "notes"?: string
  }
}

If no order has been made, return: {"orderMade": false}`;
}

/**
 * Analyze the conversation and return an AI-generated order summary (items, notes, pickup time).
 * This function does NOT attempt to reconcile pickup-time changes; see `detectPickupTimeFromConversation`.
 */
export async function analyzeOrderSummaryFromConversation(
    messages: Message[],
    customerName?: string,
    menuItems?: Array<{ name: string; price: string; category: string | null }>
): Promise<OrderSummaryResult> {
    const { getCurrentRestaurantTimeString, getRestaurantDateTimeComponents } = await import("./timezone.js");
    const currentTimeString = getCurrentRestaurantTimeString();
    const currentTimeComponents = getRestaurantDateTimeComponents();
    // Create a Date object representing current time in restaurant timezone for calculations
    const currentTime = new Date(
        currentTimeComponents.year,
        currentTimeComponents.month,
        currentTimeComponents.day,
        currentTimeComponents.hours,
        currentTimeComponents.minutes,
        currentTimeComponents.seconds
    );

    const conversationText = formatConversation(messages);
    const menuContext = buildMenuContext(menuItems);
    const systemPrompt = buildOrderSummaryPrompt(menuContext);

    try {
        const getOrderSummary =
            process.env.MODEL === "TRUCUBE" ? TrucubeOrderSummary : OpenAIOrderSummary;

        const response: OrderSummaryResult = await getOrderSummary(
            systemPrompt,
            conversationText,
            customerName
        );

        if (response.orderMade && response.orderDetails) {
            response.orderDetails.customerName =
                response.orderDetails.customerName?.trim() ||
                customerName ||
                "Customer";
        }

        const pickupTime = response.orderDetails?.pickupTime;
        if (response.orderMade && pickupTime) {
            const { convertRelativeTimeToAbsolute } = await import("./utils.js");
            const convertedTime = await convertRelativeTimeToAbsolute(pickupTime, currentTime);
            if (convertedTime) {
                response.orderDetails!.pickupTime = convertedTime;
                console.log(
                    `[Order Detection] Converted relative time "${pickupTime}" to absolute time "${convertedTime}"`
                );
            }
        }

        return response;
    } catch (error) {
        console.error("Error analyzing order:", error);
        return { orderMade: false };
    }
}

/**
 * Inspects the conversation to find the most recent confirmed pickup time using AI.
 * Returns the confirmed pickup time if detected, otherwise null.
 */
export async function detectPickupTimeFromConversation(
    messages: Message[],
    options?: { referenceTime?: Date }
): Promise<string | null> {
    const { getCurrentRestaurantTimeString } = await import("./timezone.js");
    const currentTimeString = getCurrentRestaurantTimeString();

    // Filter out AI-organized messages
    const conversationMessages = messages.filter(msg => !msg.isAIOrganized);
    
    if (conversationMessages.length === 0) {
        return null;
    }

    const conversationText = formatConversation(conversationMessages);

    // Build system prompt for pickup time detection
    const systemPrompt = `You are a pickup time detection system for a restaurant. Analyze the conversation and extract the pickup time if mentioned.

Current time is ${currentTimeString}.

Pickup time rules:
- If a relative time is mentioned (e.g., "in 1 hour", "30 minutes", "15 min", "half an hour"), convert it to an absolute time based on ${currentTimeString}.
- If an absolute time is mentioned (e.g., "3:30 PM", "5pm"), use it directly.
- Always format the final time as "HH:MM AM/PM".
- Pay strict attention to the entire conversation and detect if the pickup time changes. Return the most recent confirmed pickup time.
- If the restaurant owner proposes a time and the customer confirms it (with words like "yes", "sounds good", "ok", etc.), that is the confirmed pickup time.
- If the customer directly mentions a pickup time, that is the confirmed pickup time.

Examples:
- Current time 2:00 PM + "in 1 hour" → "3:00 PM"
- Current time 2:00 PM + "in 30 minutes" → "2:30 PM"
- Current time 2:00 PM + "3:30 PM" → "3:30 PM"
- Restaurant: "Ready at 5 PM?" Customer: "Yes" → "5:00 PM"

Return only valid JSON:
{
  "pickupTimeDetected": boolean,
  "pickupTime"?: string
}

If no pickup time is mentioned or confirmed, return:
{"pickupTimeDetected": false}`;

    try {
        const getPickupTime = process.env.MODEL === "TRUCUBE" ? TrucubePickupTime : OpenAIPickupTime;
        
        const response = await getPickupTime(systemPrompt, conversationText);

        if (response.pickupTimeDetected && response.pickupTime) {
            // Convert relative time to absolute if needed
            const { convertRelativeTimeToAbsolute } = await import("./utils.js");
            const referenceTime = options?.referenceTime || new Date();
            const convertedTime = await convertRelativeTimeToAbsolute(response.pickupTime, referenceTime);
            
            if (convertedTime) {
                return convertedTime;
            }
            
            // If conversion failed but we have a time, return it as-is (might already be absolute)
            return response.pickupTime;
        }

        return null;
    } catch (error) {
        console.error("Error detecting pickup time from conversation:", error);
        return null;
    }
}

/**
 * Detects if customer wants a half sandwich from conversation.
 * Returns true if the customer currently intends to order a 1/2 sandwich, otherwise false.
 */
export async function detectHalfSandwichRequest(
    messages: Message[]
): Promise<boolean> {
    // Filter out AI-organized messages
    const conversationMessages = messages.filter(msg => !msg.isAIOrganized);
    
    if (conversationMessages.length === 0) {
        return false;
    }
    const conversationText = formatConversation(conversationMessages);

    // Build system prompt for half sandwich detection
    const systemPrompt = `You are a 1/2-sandwich detection system for a restaurant ordering assistant.
You will be given the full conversation history between a customer and the system.

Your ONLY job is to determine whether the customer **currently intends to order a 1/2 sandwich**.

IMPORTANT RULES & EDGE CASES:

- The customer may change their mind at any time. You must consider ONLY the *latest* intention expressed in the conversation.
- If the user first requests a 1/2 sandwich but later cancels, rejects, modifies, or switches to another item, the final result must be false.
- If the customer expresses uncertainty ("maybe a half?", "not sure") you must treat it as **false** unless they explicitly confirm they want it.
- If a customer asks a question ("do you have half sandwiches?") this does NOT count as ordering.
- If the customer mentions "half" in a non-food context, it must be ignored.
- If the user orders multiple items, return true only if one of them is a 1/2 sandwich.
- If they ask to modify or customize a 1/2 sandwich, treat it as true unless they later cancel.
- If the final state of the conversation is ambiguous, return false.

The response must ALWAYS be a JSON object in this format:

{
  "wantsHalfSandwich": true | false
}

You MUST respond with nothing else.`;

    try {
        const getHalfSandwich = process.env.MODEL === "TRUCUBE" ? TrucubeHalfSandwich : OpenAIHalfSandwich;
        
        const response = await getHalfSandwich(systemPrompt, conversationText);
        return response.wantsHalfSandwich || false;
    } catch (error) {
        console.error("Error detecting half sandwich request from conversation:", error);
        return false;
    }
}

export type ConditionalAIOutput = {
    orderSummary?: OrderSummaryResult;
    suggestedResponse?: string | null;
};

/**
 * Check for specific edge cases in the conversation and generate conditional AI outputs.
 * If an edge case matches, this will override the standard AIOrderSummary and AISuggestedResponse.
 */
export async function analyzeConditionalAIOutput(
    messages: Message[],
    userId: string,
    orderId: string,
    customerName?: string,
    menuItems?: Array<{ name: string; price: string; category: string | null }>
): Promise<ConditionalAIOutput | null> {
    try {
        const currentTime = new Date();
        const currentTimeString = currentTime.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });

        const conversationText = formatConversation(messages);
        const menuContext = buildMenuContext(menuItems);

        // Build system prompt for edge case detection and handling
        const systemPrompt = `You are an order detection system for a restaurant. Analyze the conversation and check for specific edge cases.

IMPORTANT: Current time is ${currentTimeString}. When a pickup time is mentioned, you MUST convert it to an absolute time.${menuContext}

EDGE CASES TO CHECK:
1. Half Sandwich Request:
   - IMPORTANT ORDERING RULES: All sandwiches are sold whole. The Lunch special is the only way someone can get a ½ sandwich.
   - If a customer requests half a sandwich, locate the Lunch special in the menu and add it to the items.
   - The Lunch special should be added with the correct price from the menu.

If an edge case is detected, you must:
1. Convert any half sandwich requests to just the lunch special.
2. Generate a suggested response for the restaurant manager to send

Return only valid JSON, no markdown code blocks, and no explanations.
JSON format:
{
  "edgeCaseDetected": boolean,
  "edgeCaseType"?: string (e.g., "half_sandwich_request"),
  "orderDetails"?: {
    "customerName": string,
    "items": string[],
    "pickupTime"?: string,
    "notes"?: string
  },
  "suggestedResponse"?: string
}

If no edge case is detected, return: {"edgeCaseDetected": false}`;

        const getConditionalOutput = process.env.MODEL === "TRUCUBE"
            ? TrucubeConditionalOutput
            : OpenAIConditionalOutput;

        const response = await getConditionalOutput(systemPrompt, conversationText, customerName);

        if (!response || !response.edgeCaseDetected) {
            return null;
        }

        const result: ConditionalAIOutput = {};

        // Process order summary if order details exist
        if (response.orderDetails) {
            const orderSummary: OrderSummaryResult = {
                orderMade: true,
                orderDetails: {
                    customerName: response.orderDetails.customerName?.trim() || customerName || "Customer",
                    items: response.orderDetails.items || [],
                    pickupTime: response.orderDetails.pickupTime,
                    notes: response.orderDetails.notes,
                },
            };

            // Convert relative pickup time if needed
            if (orderSummary.orderDetails) {
                const pickupTime = orderSummary.orderDetails.pickupTime;
                if (pickupTime) {
                    const { convertRelativeTimeToAbsolute } = await import("./utils.js");
                    const convertedTime = await convertRelativeTimeToAbsolute(pickupTime, currentTime);
                    if (convertedTime) {
                        orderSummary.orderDetails.pickupTime = convertedTime;
                        console.log(
                            `[Conditional AI] Converted relative time "${pickupTime}" to absolute time "${convertedTime}"`
                        );
                    }
                }
            }

            result.orderSummary = orderSummary;
        }

        // Add suggested response if provided
        if (response.suggestedResponse) {
            result.suggestedResponse = response.suggestedResponse.trim();
        }

        console.log(`[Conditional AI] Edge case detected: ${response.edgeCaseType} for order ${orderId}`);
        return result;
    } catch (error) {
        console.error(`[Conditional AI] Error analyzing conditional output for order ${orderId}:`, error);
        return null;
    }
}

// Helper function to generate AI suggested response
export async function generateAISuggestedResponse(
    messages: Message[],
    userId: string,
    orderId: string
): Promise<string | null> {
    try {

        // Only generate suggestions when the last message is from the customer (not the owner)
        if (!shouldGenerateAISuggestion(messages)) {
            return null;
        }

        // Format conversation for AI analysis
        const conversationText = formatConversation(messages);

        const systemPrompt = `You are helping a restaurant manager write responses to customers. Generate a short, natural, human-sounding response based on the conversation.
  
  Guidelines:
  - Keep it brief (under 40 words, ideally 10-20 words)
  - Sound natural and casual, like a real person texting
  - Be helpful but not overly excited or enthusiastic
  - Use normal, everyday language - no exclamation points unless truly needed
  - Match the tone of the conversation - if customer is casual, be casual
  - Don't be overly formal or corporate-sounding
  - Just provide the response text itself - no prefixes or labels
  
  Think: "How would a real restaurant manager text back to a customer?" - natural, brief, helpful.`;

        const getSuggestedResponse = process.env.MODEL === 'TRUCUBE'
            ? TrucubeSuggestedResponse
            : OpenAISuggestedResponse;

        const suggestedResponse = await getSuggestedResponse(systemPrompt, conversationText);

        if (suggestedResponse) {
            console.log(`[AI Suggested Response] Generated suggestion for order ${orderId}: ${suggestedResponse.substring(0, 50)}...`);
            return suggestedResponse;
        }

        return null;
    } catch (error) {
        console.error(`[AI Suggested Response] Error generating suggestion for order ${orderId}:`, error);
        // Don't throw - this is a non-critical feature
        return null;
    }
}