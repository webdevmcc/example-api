# High-Performance Sports Betting API

Example implementation using **Bun + Fastify** for maximum speed with a **multi-provider architecture** for aggregating live scores and betting markets from multiple data sources.

## What This Code Represents

This is a production-ready sports betting API that demonstrates:

- **Multi-Provider System**: Aggregates data from multiple sports data providers (live scores, betting markets)
- **Configurable Polling**: Hierarchical polling intervals (match-level, league-level, sport-level, default)
- **Data Aggregation**: Merges data from multiple providers with confidence scoring
- **Real-Time Updates**: WebSocket support for live score updates via Redis pub/sub
- **High Performance**: Built with Bun runtime and Fastify framework for maximum throughput
- **Provider Health Monitoring**: Automatic failover and health tracking for data providers
- **Smart Caching**: Multi-layer caching (Redis + in-memory) with different TTLs for different data types

## Documentation

This repository includes comprehensive documentation:

- **[PROVIDER_ARCHITECTURE.md](./PROVIDER_ARCHITECTURE.md)** - Detailed explanation of the multi-provider system architecture, how providers work, polling configuration hierarchy, and data aggregation strategies
- **[MULTI_PROVIDER_SETUP.md](./MULTI_PROVIDER_SETUP.md)** - Step-by-step setup guide for configuring multiple providers, polling intervals, and adding new providers
- **[SPEED_OPTIMIZATION_GUIDE.md](./SPEED_OPTIMIZATION_GUIDE.md)** - Performance optimization guide comparing Bun, Fastify, and Hono, with migration strategies from NestJS/Express

## Features

- ⚡ **Ultra-fast**: 3-4x faster than NestJS/Express
- 🔌 **WebSocket support**: Real-time live score updates
- 💾 **Redis caching**: Smart caching strategy for different data types
- 🔐 **JWT authentication**: Secure protected routes
- 🚦 **Rate limiting**: Built-in protection
- 📊 **Connection pooling**: Optimized database connections
- 🎯 **Type-safe**: Full TypeScript support

## Source Code Structure

The codebase is organized into a modular architecture:

```
src/
├── index.ts                 # Main Fastify server, routes, and provider initialization
├── config/
│   └── polling-config.ts   # Polling interval configuration (sport/league/match levels)
├── providers/
│   ├── base.ts             # Base provider class with common functionality
│   ├── aggregator.ts       # Data aggregation logic for merging multi-provider data
│   ├── types.ts            # TypeScript interfaces for providers and data types
│   └── example-providers.ts # Example provider implementations (ProviderA, ProviderB)
└── polling/
    └── polling-manager.ts  # Manages configurable polling tasks with hierarchical intervals
```

### Key Components

- **Provider System** (`src/providers/`): Abstract base classes and interfaces for implementing data providers. Supports both `LiveScoreProvider` and `MarketProvider` interfaces. Each provider tracks health status, response times, and error rates.

- **Polling Manager** (`src/polling/polling-manager.ts`): Manages background polling tasks with configurable intervals. Supports hierarchical configuration (match → league → sport → default) and dynamic interval updates at runtime.

- **Data Aggregator** (`src/providers/aggregator.ts`): Merges data from multiple providers, calculates confidence scores based on provider agreement, handles conflicts, and tracks best odds across providers.

- **Fastify Server** (`src/index.ts`): REST API endpoints, WebSocket support, Redis integration, JWT authentication, rate limiting, and provider/polling management endpoints.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) installed
- PostgreSQL running
- Redis running

### Installation

```bash
# Install dependencies
bun install

# Set environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials

# Run development server
bun dev
```

### Environment Variables

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sportsbetting
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key-change-in-production

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

## API Endpoints

### REST API

**Health & Status**
- `GET /health` - Overall health check with provider and polling status
- `GET /api/providers/health` - Detailed health status for all providers
- `GET /api/polling/status` - Status of all polling tasks and configuration

**Data Endpoints**
- `GET /api/markets/:sport?league=nfl` - Get betting markets (cached 30s, aggregated from multiple providers)
- `GET /api/scores/:matchId` - Get live scores (cached 1s, aggregated from multiple providers)

**Management**
- `POST /api/polling/update` - Update polling interval for a specific task (requires `taskId` and `interval`)

### WebSocket

- `WS /live/:matchId` - Real-time score updates via Redis pub/sub. Sends `score_update` messages when scores change.

## Performance Benchmarks

Run benchmarks with:

```bash
# Install autocannon
npm install -g autocannon

# Benchmark markets endpoint
autocannon -c 100 -d 30 http://localhost:3000/api/markets/football

# Benchmark scores endpoint
autocannon -c 100 -d 30 http://localhost:3000/api/scores/match-123
```

Expected results:
- **Requests/sec**: ~150,000
- **Latency (p95)**: <5ms
- **Memory usage**: ~80MB

## Database Schema

```sql
-- Markets table
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport VARCHAR(50) NOT NULL,
  event VARCHAR(255) NOT NULL,
  odds DECIMAL(10, 2) NOT NULL,
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_markets_sport ON markets(sport);
CREATE INDEX idx_markets_active ON markets(active);

-- Live scores table
CREATE TABLE live_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) NOT NULL,
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  period VARCHAR(50),
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_live_scores_match_id ON live_scores(match_id);
CREATE INDEX idx_live_scores_timestamp ON live_scores(timestamp DESC);

-- Bets table
CREATE TABLE bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  market_id UUID REFERENCES markets(id),
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bets_user_id ON bets(user_id);
```

## WebSocket Usage

```javascript
// Connect to live score updates
const ws = new WebSocket('ws://localhost:3000/live/match-123');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Score update:', update);
  // {
  //   type: 'score_update',
  //   matchId: 'match-123',
  //   data: { homeScore: 2, awayScore: 1, period: '2nd Half' },
  //   timestamp: '2024-01-01T12:00:00.000Z'
  // }
};

// Send ping to keep connection alive
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping' }));
}, 30000);
```

## Publishing Live Updates (Redis)

To publish live score updates that WebSocket clients will receive:

```bash
# Using redis-cli
redis-cli PUBLISH match:match-123 '{"homeScore":2,"awayScore":1,"period":"2nd Half"}'
```

Or from your application:

```typescript
import { createClient } from 'redis';

const publisher = createClient({ url: 'redis://localhost:6379' });
await publisher.connect();

// Publish score update
await publisher.publish('match:match-123', JSON.stringify({
  homeScore: 2,
  awayScore: 1,
  period: '2nd Half',
}));
```

## Migration from NestJS

1. **Replace NestJS decorators** with Fastify route handlers
2. **Use Fastify plugins** instead of NestJS modules
3. **Replace class-validator** with Fastify's JSON schema validation
4. **Use native async/await** instead of RxJS Observables
5. **Replace Express middleware** with Fastify plugins

## Production Deployment

### Using Bun

```bash
# Build (optional, Bun can run TypeScript directly)
bun build src/index.ts --outdir ./dist --target node

# Run
bun src/index.ts
```

### Using PM2

```bash
pm2 start bun --name "sports-api" -- src/index.ts
pm2 save
```

### Docker

```dockerfile
FROM oven/bun:latest

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --production

COPY . .

EXPOSE 3000
CMD ["bun", "src/index.ts"]
```

## Monitoring

- **Health check**: `GET /health`
- **Logging**: Uses Pino (fast JSON logger)
- **Metrics**: Add Prometheus metrics if needed

## Security Checklist

- ✅ JWT authentication for protected routes
- ✅ Rate limiting (100 req/min per IP)
- ✅ CORS configuration
- ✅ Input validation via JSON schema
- ✅ SQL injection prevention (parameterized queries)
- ⚠️ Add HTTPS/TLS in production
- ⚠️ Use environment variables for secrets
- ⚠️ Implement request size limits

## Next Steps

1. Add more endpoints (odds, events, etc.)
2. Implement WebSocket authentication
3. Add Prometheus metrics
4. Set up Redis cluster for high availability
5. Add database read replicas
6. Implement circuit breakers for external APIs

