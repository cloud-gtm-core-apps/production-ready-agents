import { Message } from "@shared/schema";
import { formatConversation, buildMenuContext, convertRelativeTimeToAbsolute, OpenAIOrderSummary, TrucubeOrderSummary, shouldGenerateAISuggestion, OpenAISuggestedResponse, TrucubeSuggestedResponse } from "./utils";

// Function to analyze conversation and detect if an order has been made
export async function analyzeOrderFromConversation(
    messages: Message[],
    customerName?: string,
    menuItems?: Array<{ name: string; price: string; category: string | null }>
): Promise<{ orderMade: boolean; orderDetails?: { customerName: string; items: string[]; pickupTime?: string; notes?: string } }> {


    // Get current time to convert relative times
    const currentTime = new Date();
    const currentTimeString = currentTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    // Format conversation and build menu context
    const conversationText = formatConversation(messages);
    const menuContext = buildMenuContext(menuItems);

    const systemPrompt = `You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.
  
  IMPORTANT: Current time is ${currentTimeString}. When a pickup time is mentioned, you MUST convert it to an absolute time.${menuContext}
  
  If an order has been placed, extract:
  1. Customer name (if mentioned)
  2. All items ordered (be specific, include quantities, prices, and customizations):
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

    try {
        // Choose the correct AI summary function
        const getOrderSummary = process.env.MODEL === 'TRUCUBE'
            ? TrucubeOrderSummary
            : OpenAIOrderSummary;

        // Call the AI to get the order summary
        const response: {
            orderMade: boolean;
            orderDetails?: {
                customerName: string;
                items: string[];
                pickupTime?: string;
                notes?: string;
            };
        } = await getOrderSummary(systemPrompt, conversationText, customerName);

        // Convert relative pickup time to absolute as a fallback
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
        console.error('Error analyzing order:', error);
        return { orderMade: false };
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