import { Message } from "@shared/schema";
import {
    formatConversation,
    buildMenuContext,
    convertRelativeTimeToAbsolute,
    OpenAIOrderSummary,
    TrucubeOrderSummary,
    shouldGenerateAISuggestion,
    OpenAISuggestedResponse,
    TrucubeSuggestedResponse,
} from "./utils";

type Meridiem = "AM" | "PM";

const AFFIRMATION_REGEX =
    /\b(yes|yep|yeah|yah|ya|sure|ok|okay|alright|sounds good|sounds great|that works|works for me|works|perfect|great|awesome|fine|cool|do it|go ahead|absolutely|definitely|of course|for sure|makes sense|correct|confirmed|please do|please|yup|yea)\b/i;

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

function buildOrderSummaryPrompt(currentTimeString: string, menuContext: string) {
    return `You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.
  
  IMPORTANT: Current time is ${currentTimeString}. When a pickup time is mentioned, you MUST convert it to an absolute time.${menuContext}
  
  If an order has been placed, extract:
  1. Customer name (if mentioned)
  2. All items ordered (be specific, include quantities, and prices):
     - Match items mentioned in the conversation to the menu items provided above
     - Use exact menu item names when possible
     - Include the price from the menu for each item in the format: "Item Name: $X.XX"
     - For quantities, include quantity and calculate total price: "2x Item Name: $X.XX" (where $X.XX is the total for that quantity)
     - Include customizations or modifications in the item name: "Item Name (customization): $X.XX"
     - If an item is mentioned but not in the menu, do not include it as mentioned (without price if unknown)
  3. Pickup time (if mentioned):
     - If relative time is mentioned (e.g., "in 1 hour", "30 minutes", "15 min", "half an hour"), convert it to absolute time based on current time (${currentTimeString})
     - If absolute time is mentioned (e.g., "3:30 PM", "5pm"), use it as-is
     - Format as "HH:MM AM/PM" (e.g., "3:30 PM", "5:00 PM")
     - Example: If current time is 2:00 PM and customer says "in 1 hour", return "3:00 PM"
     - Example: If current time is 2:00 PM and customer says "in 30 minutes", return "2:30 PM"
     - Pay strict attention to the entire conversation and note when the pickup time changes.
  4. Any special notes or instructions

Return only valid JSON, no markdown code blocks, and no explanations.
JSON format:
{
  "orderMade": boolean,
  "orderDetails": {
      "customerName": string,
      "items": string[],
      "pickupTime"?: string,
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
    const currentTime = new Date();
    const currentTimeString = currentTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });

    const conversationText = formatConversation(messages);
    const menuContext = buildMenuContext(menuItems);
    const systemPrompt = buildOrderSummaryPrompt(currentTimeString, menuContext);

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
            const convertedTime = convertRelativeTimeToAbsolute(pickupTime, currentTime);
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

function findExplicitTimes(text: string): string[] {
    const matches: string[] = [];
    const regex =
        /\b((?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:a\.?m\.?|p\.?m\.?))?|(?:[01]?\d)(?:\s*(?:a\.?m\.?|p\.?m\.?)))\b/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}

function normalizeExplicitTime(
    raw: string,
    fallbackPeriod: Meridiem | null,
    reference: Date
): { normalized: string | null; period: Meridiem | null } {
    const cleaned = raw.trim().toLowerCase().replace(/\./g, "");
    const timeMatch = cleaned.match(/(2[0-3]|1[0-2]|0?[0-9])(?::([0-5][0-9]))?/);
    if (!timeMatch) {
        return { normalized: null, period: fallbackPeriod };
    }

    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

    let period: Meridiem | null = null;
    const ampmMatch = cleaned.match(/\b(am|pm)\b/);
    if (ampmMatch) {
        period = ampmMatch[1] === "am" ? "AM" : "PM";
    }

    if (hour === 0) {
        hour = 12;
        period = "AM";
    } else if (hour === 12 && !period) {
        period = "PM";
    } else if (hour > 12) {
        hour = hour - 12;
        period = "PM";
    }

    if (!period) {
        if (fallbackPeriod) {
            period = fallbackPeriod;
        } else {
            period = reference.getHours() >= 12 ? "PM" : "AM";
        }
    }

    const hoursString = hour.toString();
    const minutesString = minute.toString().padStart(2, "0");
    const normalized = `${hoursString}:${minutesString} ${period}`;
    return { normalized, period };
}

/**
 * Inspects the conversation to find the most recent pickup time agreed upon.
 * This logic is deterministic (non-AI) and complements the AI summary.
 */
export function detectPickupTimeFromConversation(
    messages: Message[],
    options?: { referenceTime?: Date }
): string | null {
    const reference = options?.referenceTime ?? new Date();

    let lastPeriod: Meridiem | null = null;
    let pendingOwnerProposal: { normalized: string; index: number } | null = null;
    let confirmedPickup: string | null = null;

    messages.forEach((message, index) => {
        if (message.isAIOrganized) {
            return;
        }

        const text = message.text || "";
        const explicitTimes = findExplicitTimes(text);
        const cleanedText = text.replace(/\s+/g, " ").trim();

        if (message.isOutgoing === true) {
            // Customer message
            if (explicitTimes.length > 0) {
                explicitTimes.forEach((raw) => {
                    const { normalized, period } = normalizeExplicitTime(raw, lastPeriod, reference);
                    if (!normalized) {
                        return;
                    }
                    lastPeriod = period ?? lastPeriod;
                    confirmedPickup = normalized;
                    pendingOwnerProposal = null;
                });
            } else if (
                pendingOwnerProposal &&
                pendingOwnerProposal.index < index &&
                AFFIRMATION_REGEX.test(cleanedText) &&
                findExplicitTimes(cleanedText).length === 0
            ) {
                confirmedPickup = pendingOwnerProposal.normalized;
                pendingOwnerProposal = null;
            }
        } else {
            // Owner/restaurant message
            if (explicitTimes.length > 0) {
                explicitTimes.forEach((raw) => {
                    const { normalized, period } = normalizeExplicitTime(raw, lastPeriod, reference);
                    if (!normalized) {
                        return;
                    }
                    lastPeriod = period ?? lastPeriod;
                    pendingOwnerProposal = { normalized, index };
                });
            }
        }
    });

    return confirmedPickup;
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