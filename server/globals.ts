import type { Response } from "express";


// Debounce timers for automatic order detection (2 seconds after last message)
export const orderDetectionTimers = new Map<string, NodeJS.Timeout>();

// Cache for menu items with expiration (1 day)
export interface MenuItemCache {
    items: Array<{ name: string; price: string; category: string | null }>;
    expiresAt: number;
}

export const menuItemsCache = new Map<string, MenuItemCache>();

export const sseClients = new Map<string, Set<Response>>();

// Cache for latest AI suggested responses per order
export const aiSuggestedResponses = new Map<string, string>();