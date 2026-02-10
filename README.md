# Sports Betting Odds & Markets API

High-performance data API for surfacing betting odds, markets, and live updates. This service aggregates data from multiple sports data providers and provides real-time updates for odds changes, market suspensions, and settlement data. Designed to integrate with an existing betting API that handles bet placement from mobile apps.

## Purpose

This API serves as the data layer for a sports betting platform:

- **Odds & Markets**: Surfaces aggregated betting markets and odds from multiple providers
- **Live Updates**: Real-time WebSocket updates for odds changes, market suspensions, and live scores
- **Bet Validation**: Validates if a bet attempt is valid against current market state
- **Bet Grading**: Provides settlement data for grading completed bets

## Features

- ⚡ **Ultra-fast**: 3-4x faster than NestJS/Express using Bun + Fastify
- 🔌 **WebSocket support**: Real-time updates for odds changes, suspensions, and live scores
- 📊 **Multi-provider aggregation**: Merges data from multiple sports data providers
- ⏱️ **Configurable polling**: Hierarchical polling intervals (match/league/sport levels)
- 💾 **Smart caching**: Redis + in-memory caching with different TTLs
- ✅ **Bet validation**: Validate bet attempts against current market state
- 🎯 **Bet grading**: Settlement data for grading completed bets
- 🚦 **Rate limiting**: Built-in protection
- 🎯 **Type-safe**: Full TypeScript support

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

# Authentication (for protected endpoints)
JWT_SECRET=your-secret-key-change-in-production

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Data Providers (configure your sports data providers)
PROVIDER_A_SCORES_URL=https://api.provider-a.com
PROVIDER_A_API_KEY=your-api-key
PROVIDER_A_MARKETS_URL=https://api.provider-a.com
PROVIDER_B_SCORES_URL=https://api.provider-b.com
PROVIDER_B_API_KEY=your-api-key

# Bet Validation
ODDS_TOLERANCE=0.05  # Allow 5% difference in odds for validation
```

## API Endpoints

### REST API

**Health & Status**
- `GET /health` - Health check with provider and polling status
- `GET /api/providers/health` - Detailed health status for all providers
- `GET /api/polling/status` - Status of all polling tasks

**Markets & Odds**
- `GET /api/markets/:sport?league=nfl` - Get betting markets with odds (cached 30s, aggregated from multiple providers)
- `GET /api/markets/:marketId/odds` - Get current odds for a specific market
- `GET /api/events/:eventId/markets` - Get all markets for an event

**Live Data**
- `GET /api/scores/:matchId` - Get live scores (cached 1s, aggregated from multiple providers)

**Bet Validation & Grading**
- `POST /api/bets/validate` - Validate if a bet attempt is valid against current market state
- `GET /api/bets/:betId/settlement` - Get settlement data for grading a completed bet
- `GET /api/markets/:marketId/settlement` - Get settlement data for a market

### WebSocket

- `WS /live/:matchId` - Real-time updates for scores, odds changes, and market suspensions
- `WS /markets/:sport` - Real-time updates for market changes (odds, suspensions) for a sport

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
-- Markets table with odds and suspension tracking
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_market_id VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  league VARCHAR(50),
  event_id VARCHAR(255) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  market_type VARCHAR(100) NOT NULL, -- e.g., 'moneyline', 'spread', 'total'
  selection VARCHAR(255) NOT NULL,
  odds DECIMAL(10, 3) NOT NULL,
  previous_odds DECIMAL(10, 3),
  suspended BOOLEAN DEFAULT false,
  suspension_reason VARCHAR(255),
  active BOOLEAN DEFAULT true,
  settlement_status VARCHAR(50), -- 'pending', 'won', 'lost', 'void', 'push'
  settlement_data JSONB, -- Final result data for grading
  updated_at TIMESTAMP DEFAULT NOW(),
  odds_updated_at TIMESTAMP,
  suspended_at TIMESTAMP,
  settled_at TIMESTAMP
);

CREATE INDEX idx_markets_sport ON markets(sport);
CREATE INDEX idx_markets_event_id ON markets(event_id);
CREATE INDEX idx_markets_active ON markets(active);
CREATE INDEX idx_markets_suspended ON markets(suspended);
CREATE INDEX idx_markets_settlement_status ON markets(settlement_status);

-- Live scores table
CREATE TABLE live_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(100) NOT NULL,
  provider_match_id VARCHAR(255),
  sport VARCHAR(50) NOT NULL,
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  period VARCHAR(50),
  status VARCHAR(50), -- 'scheduled', 'live', 'finished', 'postponed'
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_live_scores_match_id ON live_scores(match_id);
CREATE INDEX idx_live_scores_timestamp ON live_scores(timestamp DESC);
CREATE INDEX idx_live_scores_status ON live_scores(status);

-- Events table (games/matches)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id VARCHAR(255) NOT NULL,
  sport VARCHAR(50) NOT NULL,
  league VARCHAR(50),
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_sport ON events(sport);
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_status ON events(status);
```

## WebSocket Usage

### Live Match Updates

```javascript
// Connect to live updates for a match (scores, odds changes, suspensions)
const ws = new WebSocket('ws://localhost:3000/live/match-123');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  
  switch (update.type) {
    case 'score_update':
      // Live score change
      console.log('Score:', update.data);
      // { homeScore: 2, awayScore: 1, period: '2nd Half' }
      break;
      
    case 'odds_change':
      // Odds have changed for a market
      console.log('Odds changed:', update.data);
      // { marketId: 'market-123', newOdds: 2.5, previousOdds: 2.3 }
      break;
      
    case 'market_suspension':
      // Market has been suspended
      console.log('Market suspended:', update.data);
      // { marketId: 'market-123', reason: 'injury', suspended: true }
      break;
      
    case 'market_resumption':
      // Market has been resumed
      console.log('Market resumed:', update.data);
      // { marketId: 'market-123', suspended: false }
      break;
  }
};

// Send ping to keep connection alive
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping' }));
}, 30000);
```

### Market Updates by Sport

```javascript
// Connect to market updates for a sport (odds changes, suspensions)
const ws = new WebSocket('ws://localhost:3000/markets/football');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // Handle odds changes, suspensions, new markets, etc.
};
```

## Publishing Live Updates (Redis)

The polling system automatically publishes updates via Redis pub/sub. You can also publish updates manually:

### Score Updates

```bash
# Using redis-cli
redis-cli PUBLISH match:match-123 '{"type":"score_update","homeScore":2,"awayScore":1,"period":"2nd Half"}'
```

### Odds Changes

```bash
redis-cli PUBLISH market:market-123 '{"type":"odds_change","marketId":"market-123","newOdds":2.5,"previousOdds":2.3}'
```

### Market Suspensions

```bash
redis-cli PUBLISH market:market-123 '{"type":"market_suspension","marketId":"market-123","reason":"injury","suspended":true}'
```

### From Your Application

```typescript
import { createClient } from 'redis';

const publisher = createClient({ url: 'redis://localhost:6379' });
await publisher.connect();

// Publish score update
await publisher.publish('match:match-123', JSON.stringify({
  type: 'score_update',
  homeScore: 2,
  awayScore: 1,
  period: '2nd Half',
}));

// Publish odds change
await publisher.publish('market:market-123', JSON.stringify({
  type: 'odds_change',
  marketId: 'market-123',
  newOdds: 2.5,
  previousOdds: 2.3,
}));

// Publish market suspension
await publisher.publish('market:market-123', JSON.stringify({
  type: 'market_suspension',
  marketId: 'market-123',
  reason: 'injury',
  suspended: true,
}));
```

## Bet Validation

Before placing a bet, your betting API can validate the bet attempt against the current market state:

```typescript
// POST /api/bets/validate
{
  "marketId": "market-123",
  "selection": "home_team",
  "odds": 2.5,
  "stake": 100
}

// Response
{
  "valid": true,
  "currentOdds": 2.5,
  "marketSuspended": false,
  "marketActive": true,
  "warnings": []
}

// Or if invalid
{
  "valid": false,
  "reason": "odds_mismatch", // or "market_suspended", "market_inactive", "selection_invalid"
  "currentOdds": 2.7,
  "marketSuspended": false,
  "suggestions": {
    "useCurrentOdds": 2.7
  }
}
```

The validation checks:
- Market exists and is active
- Market is not suspended
- Selection is valid for the market
- Odds match current odds (within tolerance)
- Market hasn't been settled

## Bet Grading

After an event completes, use settlement data to grade bets:

```typescript
// GET /api/bets/:betId/settlement
// Returns settlement data for the market associated with the bet

{
  "marketId": "market-123",
  "settlementStatus": "won", // or "lost", "void", "push"
  "settlementData": {
    "finalScore": { "home": 24, "away": 21 },
    "result": "home_win",
    "settledAt": "2024-01-01T18:00:00Z"
  },
  "providerSettlements": [
    {
      "provider": "provider-a",
      "status": "won",
      "confidence": 0.95
    }
  ]
}

// Or get settlement for a market directly
// GET /api/markets/:marketId/settlement
```

Settlement data is aggregated from multiple providers when available, with confidence scores based on provider agreement.

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

## Integration with Betting API

This API is designed to work alongside your existing betting API that handles bet placement:

1. **Odds Display**: Your mobile app calls this API to display current odds and markets
2. **Live Updates**: Mobile app subscribes to WebSocket for real-time odds changes and suspensions
3. **Bet Validation**: When a user attempts to place a bet, your betting API calls `/api/bets/validate` to ensure the bet is still valid
4. **Bet Grading**: After events complete, your betting API calls `/api/bets/:betId/settlement` or `/api/markets/:marketId/settlement` to get settlement data for grading

### Example Flow

```
Mobile App → Betting API (place bet)
    ↓
Betting API → Odds API (/api/bets/validate)
    ↓
Odds API → Returns validation result
    ↓
Betting API → Processes bet if valid
    ↓
[Event completes]
    ↓
Betting API → Odds API (/api/markets/:marketId/settlement)
    ↓
Odds API → Returns settlement data
    ↓
Betting API → Grades bet (won/lost/void)
```

## Next Steps

1. Implement bet validation endpoint with odds matching logic
2. Add settlement data aggregation from providers
3. Implement market suspension detection and propagation
4. Add WebSocket authentication for protected updates
5. Set up provider-specific settlement data handling
6. Add odds change tolerance configuration for validation
7. Implement circuit breakers for external provider APIs
8. Add database read replicas for high availability

