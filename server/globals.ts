// Store conversation contexts for AI conversations
export const aiConversationContexts = new Map<
    string,
    Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
>();

// Debounce timers for automatic order detection (2 seconds after last message)
export const orderDetectionTimers = new Map<string, NodeJS.Timeout>();

// Cache for menu items with expiration (1 day)
export interface MenuItemCache {
    items: Array<{ name: string; price: string; category: string | null }>;
    expiresAt: number;
}

export const menuItemsCache = new Map<string, MenuItemCache>();