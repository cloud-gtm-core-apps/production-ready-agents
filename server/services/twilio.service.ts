import { getRedisClient } from "../redis.js";
import { twilioOptInCache, OptInStatus } from "../globals.js";

// Gets Twilio opt-in status for a phone number (checks Redis cache first, then in-memory cache)
export async function getOptInStatus(phoneNumber: string): Promise<OptInStatus | undefined> {
  const redis = getRedisClient();
  const cacheKey = `twilio:optin:${phoneNumber}`;

  // Try Redis first if available
  if (redis) {
    try {
      const status = await redis.get(cacheKey);
      if (status) {
        return status as OptInStatus;
      }
    } catch (error) {
      console.error(`[Twilio Opt-In] Redis get error for ${phoneNumber}:`, error);
    }
  }

  // Fallback to in-memory cache
  return twilioOptInCache.get(phoneNumber);
}

// Sets Twilio opt-in status for a phone number (stores in Redis and in-memory cache)
export async function setOptInStatus(phoneNumber: string, status: OptInStatus): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = `twilio:optin:${phoneNumber}`;

  // Store in Redis if available (with long TTL - 1 year for compliance)
  if (redis) {
    try {
      // Store with TTL of 1 year (31536000 seconds)
      await redis.setex(cacheKey, 31536000, status);
      console.log(`[Twilio Opt-In] Stored status '${status}' in Redis for ${phoneNumber}`);
    } catch (error) {
      console.error(`[Twilio Opt-In] Redis set error for ${phoneNumber}:`, error);
    }
  }

  // Also store in in-memory cache as fallback
  twilioOptInCache.set(phoneNumber, status);
}

