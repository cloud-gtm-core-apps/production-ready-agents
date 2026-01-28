/**
 * Timezone utilities for handling restaurant local time
 * The restaurant is in Dearborn, MI (America/Detroit timezone - Eastern Time)
 */

// Get restaurant timezone from environment variable, default to America/Detroit (Eastern Time)
export const RESTAURANT_TIMEZONE = process.env.RESTAURANT_TIMEZONE || 'America/Detroit';

/**
 * Get current time string in restaurant's timezone formatted as "H:MM AM/PM"
 * This is used for AI prompts to tell the AI what the current time is in the restaurant's timezone
 */
export function getCurrentRestaurantTimeString(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
        timeZone: RESTAURANT_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Get current date/time components in restaurant's timezone
 * Returns an object with year, month, day, hours, minutes, seconds
 */
export function getRestaurantDateTimeComponents(date: Date = new Date()): {
    year: number;
    month: number; // 0-11
    day: number;
    hours: number;
    minutes: number;
    seconds: number;
} {
    // Use Intl.DateTimeFormat to get components in restaurant timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: RESTAURANT_TIMEZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => {
        const part = parts.find(p => p.type === type);
        return part ? parseInt(part.value, 10) : 0;
    };

    return {
        year: getPart('year'),
        month: getPart('month') - 1, // JavaScript months are 0-indexed
        day: getPart('day'),
        hours: getPart('hour'),
        minutes: getPart('minute'),
        seconds: getPart('second')
    };
}

/**
 * Parse a time string (e.g., "3:30 PM") and create a Date object for today in restaurant's timezone
 * Returns a Date object (in UTC) that represents the specified time in the restaurant's timezone
 * 
 * This function uses a simpler approach: it creates a date string and uses the fact that
 * we can calculate the timezone offset by comparing UTC and restaurant timezone representations
 */
export function parseTimeInRestaurantTimezone(timeStr: string): Date | null {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) {
        return null;
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period === 'AM' && hours === 12) {
        hours = 0;
    }

    // Get current date components in restaurant timezone
    const now = new Date();
    const components = getRestaurantDateTimeComponents(now);

    // Build ISO-like date string: YYYY-MM-DDTHH:mm:ss
    const year = components.year;
    const month = String(components.month + 1).padStart(2, '0');
    const day = String(components.day).padStart(2, '0');
    const hour = String(hours).padStart(2, '0');
    const minute = String(minutes).padStart(2, '0');
    
    // Create a date string for the target time (as if it were UTC)
    const targetDateStr = `${year}-${month}-${day}T${hour}:${minute}:00Z`;
    const targetDateUTC = new Date(targetDateStr);
    
    // Now we need to find what UTC time corresponds to this local time in restaurant timezone
    // We'll use a binary search-like approach: try different UTC times until we find one
    // that when converted to restaurant timezone gives us our target time
    
    // Simpler method: calculate the offset by creating a test date
    // Get the current time in restaurant timezone
    const currentRestaurantStr = now.toLocaleString('en-US', {
        timeZone: RESTAURANT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // Parse it
    const [cDate, cTime] = currentRestaurantStr.split(', ');
    const [cMonth, cDay, cYear] = cDate.split('/');
    const [cHour, cMin, cSec] = cTime.split(':');
    const currentRestaurantAsLocal = new Date(
        parseInt(cYear),
        parseInt(cMonth) - 1,
        parseInt(cDay),
        parseInt(cHour),
        parseInt(cMin),
        parseInt(cSec)
    );
    
    // Calculate offset: difference between UTC now and restaurant timezone now
    const offsetMs = currentRestaurantAsLocal.getTime() - now.getTime();
    
    // Apply the offset to our target time
    // If restaurant is behind UTC (negative offset), we need to add the offset
    // If restaurant is ahead of UTC (positive offset), we need to subtract the offset
    const targetDate = new Date(targetDateUTC.getTime() - offsetMs);
    
    return targetDate;
}

/**
 * Get hours and minutes from a Date object as if it were in restaurant timezone
 */
export function getRestaurantHoursAndMinutes(date: Date): { hours: number; minutes: number } {
    const components = getRestaurantDateTimeComponents(date);
    return { hours: components.hours, minutes: components.minutes };
}

/**
 * Format a date/time in restaurant's timezone as "HH:MM AM/PM"
 */
export function formatRestaurantTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
        timeZone: RESTAURANT_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

