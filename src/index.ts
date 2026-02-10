import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import redis from '@fastify/redis';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';

// Provider system
import { PollingManager } from './polling/polling-manager.js';
import { DataAggregator } from './providers/aggregator.js';
import { loadPollingConfig } from './config/polling-config.js';
import {
  ProviderALiveScores,
  ProviderBLiveScores,
  ProviderAMarkets,
} from './providers/example-providers.js';
import type { AggregatedLiveScore, AggregatedMarket } from './providers/types.js';

// Initialize Fastify with performance optimizations
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined
  },
  disableRequestLogging: process.env.NODE_ENV === 'production',
  requestIdLogLabel: 'reqId',
  requestIdHeader: 'x-request-id',
});

// Database connection pool
const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'sportsbetting',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize provider system
const pollingConfig = loadPollingConfig();
const aggregator = new DataAggregator();
const pollingManager = new PollingManager(pollingConfig, aggregator);

// Initialize providers (in production, load from config/database)
const liveScoreProviders = [
  new ProviderALiveScores({
    id: 'provider-a-scores',
    name: 'Provider A - Live Scores',
    baseUrl: process.env.PROVIDER_A_SCORES_URL || 'https://api.provider-a.com',
    apiKey: process.env.PROVIDER_A_API_KEY,
    enabled: true,
    priority: 1,
    timeout: 10000,
  }),
  new ProviderBLiveScores({
    id: 'provider-b-scores',
    name: 'Provider B - Live Scores',
    baseUrl: process.env.PROVIDER_B_SCORES_URL || 'https://api.provider-b.com',
    apiKey: process.env.PROVIDER_B_API_KEY,
    enabled: true,
    priority: 2,
    timeout: 10000,
  }),
];

const marketProviders = [
  new ProviderAMarkets({
    id: 'provider-a-markets',
    name: 'Provider A - Markets',
    baseUrl: process.env.PROVIDER_A_MARKETS_URL || 'https://api.provider-a.com',
    apiKey: process.env.PROVIDER_A_API_KEY,
    enabled: true,
    priority: 1,
    timeout: 10000,
  }),
];

// Register plugins
async function setupPlugins() {
  await fastify.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
  });

  await fastify.register(redis, {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  await fastify.register(websocket);
}

// Store aggregated data in memory (in production, use Redis/DB)
const liveScoresCache = new Map<string, AggregatedLiveScore>();
const marketsCache = new Map<string, AggregatedMarket[]>();

// Setup polling tasks
function setupPolling() {
  // Poll for all active football matches
  pollingManager.registerLiveScorePolling(
    'football-live-scores',
    liveScoreProviders,
    { sport: 'football' },
    async (scores: AggregatedLiveScore[]) => {
      // Update cache
      for (const score of scores) {
        liveScoresCache.set(score.matchId, score);
        
        // Publish to Redis for WebSocket clients
        try {
          await fastify.redis.publish(
            `match:${score.matchId}`,
            JSON.stringify(score)
          );
        } catch (error) {
          fastify.log.warn({ error, matchId: score.matchId }, 'Failed to publish score update');
        }
      }
      
      fastify.log.debug({ count: scores.length }, 'Updated live scores');
    }
  );

  // Poll for NBA markets (more frequent)
  pollingManager.registerMarketPolling(
    'nba-markets',
    marketProviders,
    { sport: 'basketball', league: 'nba' },
    async (markets: AggregatedMarket[]) => {
      marketsCache.set('basketball:nba', markets);
      
      // Publish market updates
      try {
        await fastify.redis.publish(
          'markets:basketball:nba',
          JSON.stringify(markets)
        );
      } catch (error) {
        fastify.log.warn({ error }, 'Failed to publish market update');
      }
      
      fastify.log.debug({ count: markets.length }, 'Updated NBA markets');
    }
  );

  // Poll for NFL markets
  pollingManager.registerMarketPolling(
    'nfl-markets',
    marketProviders,
    { sport: 'football', league: 'nfl' },
    async (markets: AggregatedMarket[]) => {
      marketsCache.set('football:nfl', markets);
      
      try {
        await fastify.redis.publish(
          'markets:football:nfl',
          JSON.stringify(markets)
        );
      } catch (error) {
        fastify.log.warn({ error }, 'Failed to publish market update');
      }
      
      fastify.log.debug({ count: markets.length }, 'Updated NFL markets');
    }
  );

  // Start polling manager
  pollingManager.start();
  fastify.log.info('Polling manager started');
}

// REST API Routes

fastify.get('/health', async () => {
  const providerHealth = [
    ...liveScoreProviders.map(p => ({ id: p.id, ...p.getHealth() })),
    ...marketProviders.map(p => ({ id: p.id, ...p.getHealth() })),
  ];
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: providerHealth,
    polling: pollingManager.getStatus(),
  };
});

// Get markets (from aggregated cache)
fastify.get<{ Params: { sport: string; league?: string } }>('/api/markets/:sport', {
  schema: {
    params: {
      type: 'object',
      properties: {
        sport: { type: 'string' },
        league: { type: 'string' },
      },
      required: ['sport'],
    },
    querystring: {
      type: 'object',
      properties: {
        league: { type: 'string' },
      },
    },
  },
}, async (request, reply) => {
  const { sport } = request.params;
  const league = request.query.league || request.params.league;
  const cacheKey = league ? `${sport}:${league}` : sport;
  const cacheKeyFull = `markets:${cacheKey}`;

  // Check Redis cache first
  try {
    const cached = await fastify.redis.get(cacheKeyFull);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return JSON.parse(cached);
    }
  } catch (error) {
    fastify.log.warn({ error }, 'Redis cache miss');
  }

  // Check in-memory cache
  const cached = marketsCache.get(cacheKey);
  if (cached) {
    reply.header('X-Cache', 'HIT');
    // Also update Redis cache
    try {
      await fastify.redis.setex(cacheKeyFull, 30, JSON.stringify(cached));
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to cache in Redis');
    }
    return cached;
  }

  // If not cached, fetch from providers directly (fallback)
  try {
    const results = await Promise.allSettled(
      marketProviders
        .filter(p => p.getHealth().status !== 'down')
        .map(p => p.fetchMarkets({ sport, league }))
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
      .flatMap(r => r.value.map(m => ({ provider: marketProviders[0], data: [m] })));

    const aggregated = aggregator.aggregateMarkets(successful);
    
    // Cache results
    marketsCache.set(cacheKey, aggregated);
    try {
      await fastify.redis.setex(cacheKeyFull, 30, JSON.stringify(aggregated));
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to cache in Redis');
    }

    reply.header('X-Cache', 'MISS');
    return aggregated;
  } catch (error) {
    fastify.log.error({ error, sport, league }, 'Failed to fetch markets');
    reply.code(500);
    return { error: 'Failed to fetch markets' };
  }
});

// Get live scores (from aggregated cache)
fastify.get<{ Params: { matchId: string } }>('/api/scores/:matchId', {
  schema: {
    params: {
      type: 'object',
      properties: {
        matchId: { type: 'string' },
      },
      required: ['matchId'],
    },
  },
}, async (request, reply) => {
  const { matchId } = request.params;
  const cacheKey = `score:${matchId}`;

  // Check Redis cache
  try {
    const cached = await fastify.redis.get(cacheKey);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return JSON.parse(cached);
    }
  } catch (error) {
    fastify.log.warn({ error }, 'Redis cache miss');
  }

  // Check in-memory cache
  const cached = liveScoresCache.get(matchId);
  if (cached) {
    reply.header('X-Cache', 'HIT');
    try {
      await fastify.redis.setex(cacheKey, 1, JSON.stringify(cached));
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to cache in Redis');
    }
    return cached;
  }

  // Fallback: fetch from providers
  try {
    const results = await Promise.allSettled(
      liveScoreProviders
        .filter(p => p.getHealth().status !== 'down')
        .map(p => p.fetchMatchScore(matchId))
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<any> => 
        r.status === 'fulfilled' && r.value !== null
      )
      .map(r => ({ provider: liveScoreProviders[0], data: [r.value] }));

    if (successful.length === 0) {
      reply.code(404);
      return { error: 'Match not found' };
    }

    const aggregated = aggregator.aggregateLiveScores(successful);
    const score = aggregated[0];

    // Cache
    liveScoresCache.set(matchId, score);
    try {
      await fastify.redis.setex(cacheKey, 1, JSON.stringify(score));
    } catch (error) {
      fastify.log.warn({ error }, 'Failed to cache in Redis');
    }

    reply.header('X-Cache', 'MISS');
    return score;
  } catch (error) {
    fastify.log.error({ error, matchId }, 'Failed to fetch score');
    reply.code(500);
    return { error: 'Failed to fetch score' };
  }
});

// Get provider health status
fastify.get('/api/providers/health', async () => {
  return {
    liveScoreProviders: liveScoreProviders.map(p => ({
      id: p.id,
      ...p.getHealth(),
    })),
    marketProviders: marketProviders.map(p => ({
      id: p.id,
      ...p.getHealth(),
    })),
  };
});

// Get polling status
fastify.get('/api/polling/status', async () => {
  return {
    tasks: pollingManager.getStatus(),
    config: pollingConfig,
  };
});

// Update polling interval for a task
fastify.post<{ Body: { taskId: string; interval: number } }>('/api/polling/update', {
  schema: {
    body: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        interval: { type: 'number' },
      },
      required: ['taskId', 'interval'],
    },
  },
}, async (request, reply) => {
  const { taskId, interval } = request.body;
  
  if (interval < 1000) {
    reply.code(400);
    return { error: 'Interval must be at least 1000ms' };
  }

  pollingManager.updatePollingInterval(taskId, interval);
  
  return {
    success: true,
    taskId,
    newInterval: interval,
  };
});

// WebSocket endpoint for live score updates
fastify.register(async function (fastify) {
  fastify.get<{ Params: { matchId: string } }>('/live/:matchId', { websocket: true }, (connection, req) => {
    const { matchId } = req.params;
    fastify.log.info({ matchId }, 'WebSocket connection opened');

    const subscriber = fastify.redis.duplicate();
    
    subscriber.subscribe(`match:${matchId}`, (err) => {
      if (err) {
        fastify.log.error({ err, matchId }, 'Failed to subscribe to match updates');
        connection.socket.close();
        return;
      }
      fastify.log.info({ matchId }, 'Subscribed to match updates');
    });

    subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        connection.socket.send(JSON.stringify({
          type: 'score_update',
          matchId,
          data,
          timestamp: new Date().toISOString(),
        }));
      } catch (error) {
        fastify.log.error({ error, message }, 'Failed to parse Redis message');
      }
    });

    connection.socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'ping') {
          connection.socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        fastify.log.warn({ error }, 'Invalid WebSocket message');
      }
    });

    connection.socket.on('close', () => {
      fastify.log.info({ matchId }, 'WebSocket connection closed');
      subscriber.unsubscribe();
      subscriber.quit();
    });

    connection.socket.on('error', (error) => {
      fastify.log.error({ error, matchId }, 'WebSocket error');
      subscriber.unsubscribe();
      subscriber.quit();
    });
  });
});

// Start server
async function start() {
  try {
    await setupPlugins();
    
    // Setup polling after plugins are registered
    setupPolling();
    
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    fastify.log.info(`🚀 Server running on http://${host}:${port}`);
    fastify.log.info(`📊 Health check: http://${host}:${port}/health`);
    fastify.log.info(`🔌 WebSocket: ws://${host}:${port}/live/:matchId`);
    fastify.log.info(`📡 Polling tasks: ${pollingManager.getStatus().length} active`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down gracefully');
  pollingManager.stop();
  await fastify.close();
  await dbPool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  fastify.log.info('SIGINT received, shutting down gracefully');
  pollingManager.stop();
  await fastify.close();
  await dbPool.end();
  process.exit(0);
});

start();
