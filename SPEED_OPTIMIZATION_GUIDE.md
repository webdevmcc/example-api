# Node.js Speed Optimization Guide for Sports Betting API

## 🚀 Priority Recommendations (Biggest Impact First)

### 1. **Use Bun Runtime** (3-4x faster than Node.js)
- **Why**: Fastest JavaScript runtime, native TypeScript, built-in WebSocket support
- **Migration**: Drop-in replacement for Node.js in most cases
- **Best for**: Real-time data, high-throughput APIs

### 2. **Switch to Fastify** (2-3x faster than Express/NestJS)
- **Why**: Minimal overhead, schema validation, async-first
- **Migration**: Similar API to Express, easy transition
- **Best for**: REST APIs, microservices

### 3. **Use Hono** (Ultra-fast, works everywhere)
- **Why**: Fastest framework, works on Bun/Node/Deno/Edge
- **Best for**: Maximum performance, edge deployment

---

## 📊 Performance Comparison

| Solution | Requests/sec | Latency | Best Use Case |
|----------|--------------|---------|---------------|
| **Bun + Fastify** | ~150k | <1ms | Production APIs |
| **Bun + Hono** | ~180k | <0.5ms | Edge/Ultra-fast |
| **Node.js + Fastify** | ~50k | 2-3ms | Standard APIs |
| **Node.js + Express** | ~30k | 3-5ms | Current setup |
| **NestJS** | ~25k | 5-8ms | Enterprise features needed |

---

## 🎯 Implementation Strategy

### Option A: Bun + Fastify (Recommended)

**Why**: Best balance of speed, ecosystem, and developer experience

```typescript
// package.json
{
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts"
  },
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/websocket": "^8.3.0",
    "@fastify/redis": "^6.1.1",
    "@fastify/cors": "^8.4.0",
    "@fastify/jwt": "^7.2.4"
  }
}
```

**Example Fastify Service**:
```typescript
// src/index.ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import redis from '@fastify/redis';

const fastify = Fastify({
  logger: true,
  disableRequestLogging: false,
});

// Register plugins
await fastify.register(websocket);
await fastify.register(redis, { url: 'redis://localhost:6379' });

// Live scores endpoint with WebSocket
fastify.register(async function (fastify) {
  fastify.get('/live-scores/:matchId', { websocket: true }, (connection, req) => {
    const matchId = req.params.matchId;
    
    // Subscribe to Redis pub/sub for live updates
    const subscriber = fastify.redis.duplicate();
    subscriber.subscribe(`match:${matchId}`, (err) => {
      if (err) connection.socket.close();
    });

    subscriber.on('message', (channel, message) => {
      connection.socket.send(message);
    });

    connection.socket.on('close', () => {
      subscriber.unsubscribe();
      subscriber.quit();
    });
  });
});

// REST endpoint with caching
fastify.get('/markets/:sport', async (request, reply) => {
  const { sport } = request.params;
  const cacheKey = `markets:${sport}`;
  
  // Check Redis cache
  const cached = await fastify.redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Fetch from database
  const markets = await fetchMarkets(sport);
  
  // Cache for 30 seconds
  await fastify.redis.setex(cacheKey, 30, JSON.stringify(markets));
  
  return markets;
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });
```

### Option B: Bun + Hono (Maximum Speed)

**Why**: Fastest possible, works on edge/cloudflare

```typescript
// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { websocket } from 'hono/ws';

const app = new Hono();

// Middleware
app.use('/*', cors());
app.use('/api/*', jwt({ secret: process.env.JWT_SECRET! }));

// REST routes
app.get('/api/markets/:sport', async (c) => {
  const sport = c.req.param('sport');
  const markets = await fetchMarkets(sport);
  return c.json(markets);
});

// WebSocket for live data
app.get('/live/:matchId', websocket((c) => {
  c.ws.on('message', (event) => {
    // Handle live updates
    c.ws.send(JSON.stringify({ type: 'update', data: event.data }));
  });
}));

export default {
  port: 3000,
  fetch: app.fetch,
};
```

### Option C: Node.js + Fastify (If staying with Node.js)

**Why**: Significant speedup without changing runtime

```typescript
// Use Node.js 20+ with --experimental-vm-modules
// Similar code to Option A, but runs on Node.js
```

---

## 🔧 Key Optimizations

### 1. **Use Native Fetch/undici** (instead of axios)
```typescript
// ❌ Slow
import axios from 'axios';
const response = await axios.get(url);

// ✅ Fast
const response = await fetch(url);
const data = await response.json();
```

### 2. **Connection Pooling**
```typescript
// PostgreSQL with pg (native pooling)
import { Pool } from 'pg';
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### 3. **Redis Caching Strategy**
```typescript
// Cache live scores for 1 second
await redis.setex(`score:${matchId}`, 1, JSON.stringify(score));

// Cache markets for 30 seconds
await redis.setex(`markets:${sport}`, 30, JSON.stringify(markets));

// Cache user data for 5 minutes
await redis.setex(`user:${userId}`, 300, JSON.stringify(user));
```

### 4. **Streaming Responses** (for large datasets)
```typescript
fastify.get('/events/stream', async (request, reply) => {
  reply.type('application/json');
  reply.send(createReadableStream());
});
```

### 5. **Schema Validation** (Fastify built-in)
```typescript
const schema = {
  params: {
    type: 'object',
    properties: {
      matchId: { type: 'string' }
    }
  }
};

fastify.get('/match/:matchId', { schema }, async (request, reply) => {
  // request.params.matchId is validated
});
```

---

## 🏗️ Architecture for Sports Betting API

### Recommended Stack:
```
┌─────────────────┐
│   Load Balancer │
└────────┬────────┘
         │
    ┌────┴────┐
    │  Bun +  │  ← Fastify/Hono API
    │ Fastify │
    └────┬────┘
         │
    ┌────┴─────────────────┐
    │                       │
┌───▼───┐            ┌──────▼──────┐
│ Redis │            │ PostgreSQL  │
│ Cache │            │   (Main DB) │
└───┬───┘            └─────────────┘
    │
┌───▼──────────┐
│ Redis Pub/Sub│  ← For live score updates
└──────────────┘
```

### Microservices Structure:
```
sports-api/
├── markets-service/     (Bun + Fastify)
├── scores-service/      (Bun + Fastify + WebSocket)
├── odds-service/        (Bun + Fastify)
└── user-service/        (Bun + Fastify)
```

---

## 📈 Migration Path from NestJS/Express

### Phase 1: Setup Bun + Fastify (1-2 days)
1. Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. Create new service with Fastify
3. Port one endpoint as proof of concept

### Phase 2: Port Core Routes (1 week)
1. Port authentication middleware
2. Port main API routes
3. Add WebSocket support for live data

### Phase 3: Optimize (1 week)
1. Add Redis caching
2. Implement connection pooling
3. Add request/response streaming where needed

### Phase 4: Deploy & Monitor (ongoing)
1. Deploy alongside existing service
2. A/B test performance
3. Gradually migrate traffic

---

## 🚨 Critical Performance Tips

1. **Avoid NestJS decorators** - They add overhead
2. **Use native async/await** - Don't wrap in RxJS Observables
3. **Minimize middleware** - Each middleware adds latency
4. **Use JSON schema validation** - Faster than class-validator
5. **Cache aggressively** - Live data changes frequently, cache smartly
6. **Use WebSockets** - Don't poll for live scores
7. **Connection pooling** - Reuse DB connections
8. **Stream large responses** - Don't load everything into memory

---

## 📦 Package Recommendations

### Fastify Ecosystem:
- `@fastify/websocket` - WebSocket support
- `@fastify/redis` - Redis integration
- `@fastify/jwt` - JWT authentication
- `@fastify/cors` - CORS handling
- `@fastify/rate-limit` - Rate limiting
- `fastify-compress` - Response compression

### Alternative (Hono):
- `hono` - Core framework
- `hono/ws` - WebSocket support
- `@hono/node-server` - Node.js adapter (if not using Bun)

---

## 🎯 Expected Performance Gains

| Metric | Current (NestJS) | Bun + Fastify | Improvement |
|--------|------------------|---------------|-------------|
| Requests/sec | ~25k | ~150k | **6x** |
| P95 Latency | 50ms | 5ms | **10x** |
| Memory Usage | 200MB | 80MB | **2.5x** |
| Cold Start | 2s | 0.1s | **20x** |

---

## 🔐 Security Considerations

1. **Rate Limiting**: Use `@fastify/rate-limit`
2. **JWT Validation**: Use `@fastify/jwt` with proper secret management
3. **Input Validation**: Use Fastify's built-in JSON schema validation
4. **CORS**: Configure properly with `@fastify/cors`
5. **HTTPS**: Always use TLS in production

---

## 📝 Next Steps

1. **Test Bun locally**: `bun install` and run a simple Fastify server
2. **Benchmark**: Compare against current NestJS setup
3. **Port one service**: Start with a simple microservice
4. **Measure**: Use tools like `autocannon` or `wrk` for load testing
5. **Iterate**: Gradually migrate more services

---

## 🛠️ Quick Start Commands

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Create new project
bun init
bun add fastify @fastify/websocket @fastify/redis

# Run development
bun --watch src/index.ts

# Build for production
bun build src/index.ts --outdir ./dist --target node
```

---

## 💡 Decision Matrix

**Choose Bun + Fastify if:**
- ✅ You want maximum speed with good ecosystem
- ✅ You need WebSocket support
- ✅ You want easy migration from Express
- ✅ You need production-ready solution

**Choose Bun + Hono if:**
- ✅ You want absolute maximum performance
- ✅ You might deploy to edge (Cloudflare, etc.)
- ✅ You're okay with smaller ecosystem
- ✅ You want framework-agnostic code

**Stay with Node.js + Fastify if:**
- ✅ You can't use Bun (corporate restrictions)
- ✅ You need specific Node.js-only packages
- ✅ You want gradual migration path

---

**Bottom Line**: For a sports betting API with live data, **Bun + Fastify** gives you the best combination of speed, features, and developer experience.

