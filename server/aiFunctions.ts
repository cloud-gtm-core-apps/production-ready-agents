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
    OpenAIConditionalOutput,
    TrucubeConditionalOutput,
} from "./utils.js";

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
     - Use exact menu item names
     - Include the price from the menu for each item in the format: "Item Name: $X.XX"
     - For quantities, include quantity and calculate total price: "2x Item Name: $X.XX" (where $X.XX is the total for that quantity)
     - Include customizations or modifications in the item name: "Item Name (customization): $X.XX"
     - If an item is mentioned but not in the menu, do not include it as mentioned (without price if unknown)
  3. Pickup time (if mentioned):
     - If relative time is mentioned (e.g., "in 1 hour", "30 minutes", "15 min", "half an hour"), convert it to absolute time based on current time (${currentTimeString})
     - If absolute time is mentioned (e.g., "3:30 PM", "5pm"), use it as-is
     - If time is mentioned WITHOUT AM/PM (e.g., "3", "3:00", "5", "12"), intelligently infer AM/PM:
       * If the time is within 1-2 hours of current time, use the same period (AM/PM) as current time
       * If the time is far from current time, assume PM for times 1-9 (business hours) and AM for times 10-11 (morning)
       * For "12" without AM/PM: if current time is before noon, assume "12 PM" (noon); if after noon, assume "12 PM" next day
       * Restaurant is typically open 10 AM - 9 PM, so prefer PM for afternoon/evening times
       * Example: Current time is 2:00 PM, customer says "3" → return "3:00 PM"
       * Example: Current time is 10:00 PM, customer says "3" → return "3:00 PM" (next day, not 3 AM)
       * Example: Current time is 11:00 AM, customer says "12" → return "12:00 PM" (noon)
       * Example: Current time is 1:00 PM, customer says "12" → return "12:00 PM" (next day, not midnight)
     - Format as "HH:MM AM/PM" (e.g., "3:30 PM", "5:00 PM", "12:00 PM")
     - Example: If current time is 2:00 PM and customer says "in 1 hour", return "3:00 PM"
     - Example: If current time is 2:00 PM and customer says "in 30 minutes", return "2:30 PM"
     - Pay strict attention to the entire conversation and note when the pickup time changes.
  4. Any special notes or instructions

IMPORTANT EDGE CASES TO CHECK:
1. Half Sandwich Request:
   - IMPORTANT ORDERING RULES: All sandwiches are sold whole. The Lunch special is the only way someone can get a ½ sandwich.
   - If a customer requests half a sandwich, locate the Lunch special in the menu and add it to the items.
   - The Lunch special should be added with the correct price from the menu.

If an edge case is detected, you must:
1. Convert any half sandwich requests to just the lunch special.

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

function findExplicitTimes(text: string): string[] {
    const matches: string[] = [];
    // Updated regex to catch:
    // - Times with AM/PM: "3 PM", "3:30 PM", "3pm", "3:30pm"
    // - Times without AM/PM: "3", "3:00", "12", "12:30" (standalone numbers that look like times)
    // - Context: "pickup at 3", "for 3", "by 3", "around 3", etc.
    const regex =
        /\b((?:pickup|for|at|by|around|before|after)\s+)?((?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        // Extract just the time part (group 2), ignore the context word (group 1)
        if (match[2]) {
            matches.push(match[2]);
        }
    }

    // Also catch standalone numbers that could be times (1-12, optionally followed by :00 or :30)
    // But only if they appear in time-related contexts
    const standaloneRegex = /\b(pickup|for|at|by|around|before|after|ready)\s+(\d{1,2})(?::(\d{2}))?\b/gi;
    let standaloneMatch: RegExpExecArray | null;
    while ((standaloneMatch = standaloneRegex.exec(text)) !== null) {
        const hour = parseInt(standaloneMatch[2], 10);
        const minute = standaloneMatch[3] || '00';
        // Only include if it's a valid hour (1-12 or 0-23)
        if (hour >= 0 && hour <= 23) {
            const timeStr = hour.toString() + (standaloneMatch[3] ? `:${minute}` : '');
            // Avoid duplicates
            if (!matches.includes(timeStr)) {
                matches.push(timeStr);
            }
        }
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

    // Intelligently infer AM/PM if not specified
    if (!period) {
        if (fallbackPeriod) {
            period = fallbackPeriod;
        } else {
            // Smart inference based on current time and business hours
            const currentHour = reference.getHours();
            const currentMinute = reference.getMinutes();
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const targetTotalMinutes = hour * 60 + minute;

            // Calculate time difference (handling next day)
            let diffMinutes = targetTotalMinutes - currentTotalMinutes;
            if (diffMinutes < 0) {
                diffMinutes += 24 * 60; // Next day
            }

            // If within 1-2 hours, use same period as current time
            if (diffMinutes <= 120) {
                period = currentHour >= 12 ? "PM" : "AM";
            } else {
                // For times far from current time, use business logic:
                // Restaurant hours typically 10 AM - 9 PM
                // Times 1-9: usually PM (afternoon/evening)
                // Times 10-11: could be AM (morning) or PM (evening)
                // Time 12: usually PM (noon)

                if (hour === 12) {
                    // "12" without AM/PM is usually noon (12 PM), not midnight
                    period = "PM";
                } else if (hour >= 1 && hour <= 9) {
                    // Times 1-9 are usually PM for restaurant pickup
                    period = "PM";
                } else if (hour === 10 || hour === 11) {
                    // 10-11 could be AM or PM, but if current time is afternoon/evening, likely PM
                    // If current time is morning, could be AM
                    if (currentHour >= 12) {
                        period = "PM"; // Afternoon/evening, so 10-11 is likely PM
                    } else {
                        // Morning: if target is close (within 3 hours), use AM; otherwise PM
                        if (diffMinutes <= 180) {
                            period = "AM";
                        } else {
                            period = "PM"; // Far in future, likely PM
                        }
                    }
                } else {
                    // Default: use current period
                    period = currentHour >= 12 ? "PM" : "AM";
                }
            }
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
export async function detectPickupTimeFromConversation(
    messages: Message[],
    options?: { referenceTime?: Date }
): Promise<string | null> {
    const { getRestaurantDateTimeComponents } = await import("./timezone.js");
    let reference: Date;
    if (options?.referenceTime) {
        const components = getRestaurantDateTimeComponents(options.referenceTime);
        reference = new Date(
            components.year,
            components.month,
            components.day,
            components.hours,
            components.minutes,
            components.seconds
        );
    } else {
        const components = getRestaurantDateTimeComponents();
        reference = new Date(
            components.year,
            components.month,
            components.day,
            components.hours,
            components.minutes,
            components.seconds
        );
    }

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