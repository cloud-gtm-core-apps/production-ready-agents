import Redis from 'ioredis';

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;

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

export function getRedisSubscriber(): Redis | null {
    // Only initialize Redis subscriber if PRODUCTION is true
    if (process.env.PRODUCTION !== 'true') {
        return null;
    }

    // Return existing subscriber if already initialized
    if (redisSubscriber) {
        return redisSubscriber;
    }

    // Initialize Redis subscriber (separate connection for pub/sub)
    try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisSubscriber = new Redis(redisUrl, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3,
        });

        redisSubscriber.on('error', (err) => {
            console.error('[Redis Subscriber] Error:', err);
        });

        redisSubscriber.on('connect', () => {
            console.log('[Redis Subscriber] Connected successfully');
        });

        redisSubscriber.on('close', () => {
            console.log('[Redis Subscriber] Connection closed, will reconnect automatically');
        });

        redisSubscriber.on('reconnecting', (delay: number) => {
            console.log(`[Redis Subscriber] Reconnecting in ${delay}ms`);
        });

        return redisSubscriber;
    } catch (error) {
        console.error('[Redis Subscriber] Failed to initialize:', error);
        return null;
    }
}

export function closeRedisClient(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (redisClient) {
        promises.push(redisClient.quit().then(() => undefined));
    }

    if (redisSubscriber) {
        promises.push(redisSubscriber.quit().then(() => undefined));
    }

    return Promise.all(promises).then(() => undefined);
}

