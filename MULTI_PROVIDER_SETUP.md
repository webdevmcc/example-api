# Multi-Provider Setup Guide

## Overview

This implementation provides a complete multi-provider architecture for a sports betting odds and markets API that integrates with an existing betting API. The system provides:

✅ **Multiple data providers** for live scores, markets, and settlement data  
✅ **Configurable polling intervals** by sport, league, and match  
✅ **Data aggregation** from multiple sources with confidence scoring  
✅ **Provider health monitoring** and automatic failover  
✅ **Real-time updates** via WebSocket (odds changes, suspensions, scores)  
✅ **Bet validation** against current market state  
✅ **Bet grading** with aggregated settlement data  
✅ **High performance** using Bun + Fastify  

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mobile App                                     │
│  • Display odds & markets                                        │
│  • WebSocket for live updates                                    │
└──────────────┬───────────────────────┬──────────────────────────┘
               │                         │
               │ REST API                │ WebSocket
               │                         │
    ┌──────────▼──────────┐   ┌─────────▼──────────┐
    │   Betting API       │   │  Odds & Markets API │
    │  (Existing)         │   │  (This Service)     │
    │  • Place bets       │   │  • Surface odds     │
    │  • User accounts    │   │  • Live updates     │
    └──────────┬──────────┘   │  • Validate bets    │
               │               │  • Grade bets      │
               │               └─────────┬──────────┘
               │                         │
               │  Validate/Grade         │
               └──────────┬──────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                     │
┌───────▼────────┐                  ┌───────▼────────┐
│  Polling        │                  │  Data          │
│  Manager        │                  │  Aggregator    │
│  • Hierarchical │                  │  • Merge data  │
│    intervals    │                  │  • Confidence  │
│  • Health check │                  │  • Best odds  │
└───────┬────────┘                  └───────┬────────┘
        │                                     │
        │  ┌──────────────────────────────────┘
        │  │
┌───────▼──▼──────────────────────────────────────┐
│         Data Providers                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Provider A │  │ Provider B │  │ Provider │ │
│  │ • Scores   │  │ • Scores   │  │ C        │ │
│  │ • Markets  │  │            │  │ • Markets│ │
│  │ • Settlement│ │            │  │ • Settlement│
│  └────────────┘  └────────────┘  └──────────┘ │
└─────────────────────────────────────────────────┘
```

## Key Features

### 1. Multiple Providers

- **Live Score Providers**: Can have multiple providers for the same data
- **Market Providers**: Different providers for betting markets
- **Independent Configuration**: Each provider has its own config, API keys, timeouts

### 2. Configurable Polling

Polling intervals configured at multiple levels:

```typescript
{
  defaultInterval: 30000,           // 30 seconds (global default)
  
  sportIntervals: {
    'football': 10000,               // 10 seconds
    'basketball': 5000,              // 5 seconds
  },
  
  leagueIntervals: {
    'nfl': 5000,                     // 5 seconds
    'nba': 3000,                     // 3 seconds
  },
  
  matchIntervals: {
    'match-super-bowl-2024': 2000,   // 2 seconds (most specific)
  },
}
```

**Priority Order** (most specific wins):
1. Match ID → `matchIntervals['match-123']`
2. League → `leagueIntervals['nfl']`
3. Sport → `sportIntervals['football']`
4. Default → `defaultInterval`

### 3. Data Aggregation

- **Live Scores**: Matched by team names and timestamps
- **Markets**: Matched by event, market type, and selection
- **Settlement Data**: Aggregated from multiple providers for bet grading
- **Confidence Scores**: Calculated based on agreement between providers
- **Best Odds**: Tracked across all providers for markets

### 4. Bet Validation

- Validates bet attempts against current market state
- Checks odds match (within tolerance)
- Verifies market is active and not suspended
- Ensures selection is valid

### 5. Bet Grading

- Aggregates settlement data from multiple providers
- Provides confidence scores for settlement outcomes
- Handles conflicts between provider settlements

### 4. Provider Health

Each provider tracks:
- Status: `healthy` | `degraded` | `down`
- Response times
- Error rates
- Consecutive failures

Unhealthy providers are automatically skipped.

## Setup Instructions

### 1. Install Dependencies

```bash
cd sports-betting-api-example
bun install
```

### 2. Configure Providers

Edit `src/index.ts` to add your providers:

```typescript
const liveScoreProviders = [
  new ProviderALiveScores({
    id: 'provider-a-scores',
    name: 'Provider A - Live Scores',
    baseUrl: process.env.PROVIDER_A_SCORES_URL,
    apiKey: process.env.PROVIDER_A_API_KEY,
    enabled: true,
    priority: 1,
  }),
  // Add more providers...
];

const marketProviders = [
  new ProviderAMarkets({
    id: 'provider-a-markets',
    name: 'Provider A - Markets',
    baseUrl: process.env.PROVIDER_A_MARKETS_URL,
    apiKey: process.env.PROVIDER_A_API_KEY,
    enabled: true,
    priority: 1,
  }),
  // Add more providers...
];
```

### 3. Configure Polling Intervals

Edit `src/config/polling-config.ts`:

```typescript
export const pollingConfig: PollingConfig = {
  defaultInterval: 30000,
  
  sportIntervals: {
    'football': 10000,
    'basketball': 5000,
    // Add your sports...
  },
  
  leagueIntervals: {
    'nfl': 5000,
    'nba': 3000,
    // Add your leagues...
  },
  
  matchIntervals: {
    // Add specific matches for high-frequency updates
  },
};
```

### 4. Register Polling Tasks

In `src/index.ts`, register polling tasks:

```typescript
// Poll for football scores
pollingManager.registerLiveScorePolling(
  'football-live-scores',
  liveScoreProviders,
  { sport: 'football' },
  async (scores) => {
    // Handle aggregated scores
    for (const score of scores) {
      liveScoresCache.set(score.matchId, score);
      await fastify.redis.publish(`match:${score.matchId}`, JSON.stringify(score));
    }
  }
);

// Poll for NBA markets
pollingManager.registerMarketPolling(
  'nba-markets',
  marketProviders,
  { sport: 'basketball', league: 'nba' },
  async (markets) => {
    marketsCache.set('basketball:nba', markets);
    await fastify.redis.publish('markets:basketball:nba', JSON.stringify(markets));
  }
);
```

### 5. Set Environment Variables

```bash
# Provider A
PROVIDER_A_SCORES_URL=https://api.provider-a.com
PROVIDER_A_MARKETS_URL=https://api.provider-a.com
PROVIDER_A_API_KEY=your-api-key

# Provider B
PROVIDER_B_SCORES_URL=https://api.provider-b.com
PROVIDER_B_API_KEY=your-api-key

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sportsbetting
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
JWT_SECRET=your-secret-key
```

### 6. Run the Server

```bash
bun dev
```

## API Endpoints

### Health & Status

```bash
# Overall health
GET /health

# Provider health
GET /api/providers/health

# Polling status
GET /api/polling/status
```

### Live Scores

```bash
# Get live score for a match
GET /api/scores/:matchId

# WebSocket for real-time updates (scores, odds changes, suspensions)
WS /live/:matchId

# WebSocket for market updates by sport
WS /markets/:sport
```

### Markets & Odds

```bash
# Get markets by sport
GET /api/markets/:sport?league=nfl

# Get current odds for a market
GET /api/markets/:marketId/odds

# Example: Get NFL markets
GET /api/markets/football?league=nfl
```

### Bet Validation & Grading

```bash
# Validate a bet attempt
POST /api/bets/validate
{
  "marketId": "market-123",
  "selection": "home_team",
  "odds": 2.5,
  "stake": 100
}

# Get settlement data for grading
GET /api/bets/:betId/settlement
GET /api/markets/:marketId/settlement
```

### Polling Management

```bash
# Update polling interval
POST /api/polling/update
{
  "taskId": "nba-markets",
  "interval": 2000
}
```

## Adding a New Provider

### Step 1: Create Provider Class

Create `src/providers/your-provider.ts`:

```typescript
import { BaseProvider } from './base.js';
import type { LiveScoreProvider, LiveScore, ProviderConfig } from './types.js';

export class YourProvider extends BaseProvider implements LiveScoreProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/health');
      return response.status === 'ok';
    } catch {
      return false;
    }
  }

  async fetchLiveScores(params: {
    sport?: string;
    league?: string;
    matchIds?: string[];
  }): Promise<LiveScore[]> {
    // Implement your provider's API calls
    const response = await this.makeRequest('/scores', {
      method: 'GET',
      // ...
    });

    // Transform to common format
    return response.data.map(item => ({
      matchId: `your-provider-${item.id}`,
      providerMatchId: item.id,
      provider: this.id,
      sport: item.sport,
      // ... map all fields
    }));
  }

  async fetchMatchScore(matchId: string): Promise<LiveScore | null> {
    // Implement single match fetch
  }
}
```

### Step 2: Register Provider

In `src/index.ts`:

```typescript
import { YourProvider } from './providers/your-provider.js';

const liveScoreProviders = [
  // ... existing providers
  new YourProvider({
    id: 'your-provider',
    name: 'Your Provider',
    baseUrl: process.env.YOUR_PROVIDER_URL,
    apiKey: process.env.YOUR_PROVIDER_API_KEY,
    enabled: true,
    priority: 3,
  }),
];
```

### Step 3: Add to Polling

The provider will automatically be included in existing polling tasks that use `liveScoreProviders`.

## Example: Different Providers for Different Data

```typescript
// Provider A for scores, Provider C for markets
const liveScoreProviders = [new ProviderALiveScores({ ... })];
const marketProviders = [new ProviderCMarkets({ ... })];

// Separate polling tasks
pollingManager.registerLiveScorePolling(
  'scores',
  liveScoreProviders,
  { sport: 'football' },
  handleScoreUpdate
);

pollingManager.registerMarketPolling(
  'markets',
  marketProviders,
  { sport: 'football' },
  handleMarketUpdate
);
```

## Example: Multiple Providers for Same Data

```typescript
// Both Provider A and B provide live scores
const liveScoreProviders = [
  new ProviderALiveScores({ ... }),
  new ProviderBLiveScores({ ... }),
];

// Polling manager fetches from both in parallel
pollingManager.registerLiveScorePolling(
  'football-scores',
  liveScoreProviders,  // Both providers
  { sport: 'football' },
  async (aggregatedScores) => {
    // Aggregated scores include:
    // - sources: ['provider-a-scores', 'provider-b-scores']
    // - confidence: 0.95 (based on agreement)
    // - Best data from both providers
  }
);
```

## Dynamic Configuration

Update polling intervals at runtime:

```bash
# Make NBA markets update every 2 seconds
curl -X POST http://localhost:3000/api/polling/update \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "nba-markets",
    "interval": 2000
  }'
```

## Monitoring

### Provider Health

```bash
curl http://localhost:3000/api/providers/health
```

Response:
```json
{
  "liveScoreProviders": [
    {
      "id": "provider-a-scores",
      "status": "healthy",
      "averageResponseTime": 150,
      "errorRate": 0.01
    }
  ],
  "marketProviders": [...]
}
```

### Polling Status

```bash
curl http://localhost:3000/api/polling/status
```

Response:
```json
{
  "tasks": [
    {
      "id": "nba-markets",
      "interval": 3000,
      "lastRun": "2024-01-01T12:00:00Z",
      "nextRun": "2024-01-01T12:00:03Z",
      "running": false
    }
  ]
}
```

## Performance Tips

1. **Adjust polling intervals** based on:
   - Provider rate limits
   - Data update frequency
   - User demand

2. **Use match-level intervals** for high-profile games:
   ```typescript
   matchIntervals: {
     'match-super-bowl-2024': 2000,  // 2 seconds
   }
   ```

3. **Monitor provider health** and adjust priorities

4. **Cache aggressively** - Redis caching reduces provider load

5. **Use WebSockets** for real-time updates instead of polling clients

## Integration with Betting API

This service integrates with your existing betting API:

1. **Odds Display**: Mobile app calls this API to display current odds
2. **Live Updates**: Mobile app subscribes to WebSocket for real-time updates
3. **Bet Validation**: Betting API calls `/api/bets/validate` before accepting bets
4. **Bet Grading**: Betting API calls `/api/markets/:marketId/settlement` after events complete

See the main README for detailed integration flow diagrams.

## Next Steps

- [ ] Add your actual provider implementations
- [ ] Configure polling intervals for your sports/leagues
- [ ] Set up database schema for persistent storage (markets, scores, settlements)
- [ ] Implement bet validation endpoint with odds tolerance logic
- [ ] Implement settlement data aggregation for bet grading
- [ ] Add market suspension detection and propagation
- [ ] Configure WebSocket authentication if needed
- [ ] Set up monitoring and alerting
- [ ] Configure production environment variables
- [ ] Integrate with your betting API

