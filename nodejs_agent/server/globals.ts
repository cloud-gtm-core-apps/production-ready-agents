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

// Twilio Campaign Opt-In Management Types
export type OptInStatus = 'opted-in' | 'pending' | 'opted-out';

// Cache for Twilio campaign opt-in status by phone number
// Values: 'opted-in' | 'pending' | 'opted-out' | undefined (no status)
export const twilioOptInCache = new Map<string, OptInStatus>();

// Messaging service URL from environment variable
// Trim quotes, semicolons, and whitespace that might be in the env var
export const MESSAGING_SERVICE_URL = process.env.MESSAGING_SERVICE_URL 
  ? process.env.MESSAGING_SERVICE_URL.trim().replace(/^["']|["']$/g, '').replace(/;+$/, '')
  : "";