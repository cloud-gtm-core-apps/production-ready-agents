import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
    // Only initialize Redis if PRODUCTION is true
    if (process.env.PRODUCTION !== 'true') {
        return null;
    }

    // Return existing client if already initialized
    if (redisClient) {
        return redisClient;
    }

    // Initialize Redis client
    try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisClient = new Redis(redisUrl, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3,
        });

        redisClient.on('error', (err) => {
            console.error('[Redis] Error:', err);
        });

        redisClient.on('connect', () => {
            console.log('[Redis] Connected successfully');
        });

        return redisClient;
    } catch (error) {
        console.error('[Redis] Failed to initialize:', error);
        return null;
    }
}

export function closeRedisClient(): Promise<void> {
    if (redisClient) {
        return redisClient.quit().then(() => undefined);
    }
    return Promise.resolve();
}

