# Multi-Provider Architecture Guide

This document explains how the multi-provider system works with configurable polling intervals.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    API Server                           │
│  (Fastify + Bun)                                        │
└──────────────┬──────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────┐         ┌──────▼──────┐
│ Polling│         │  Aggregator │
│ Manager│         │             │
└───┬────┘         └──────┬──────┘
    │                     │
    │  ┌──────────────────┘
    │  │
┌───▼──▼──────────────────────────────┐
│         Data Providers               │
│  ┌────────────┐  ┌────────────┐    │
│  │ Provider A │  │ Provider B │    │
│  │ (Scores)   │  │ (Scores)   │    │
│  └────────────┘  └────────────┘    │
│  ┌────────────┐                     │
│  │ Provider A │                     │
│  │ (Markets)  │                     │
│  └────────────┘                     │
└─────────────────────────────────────┘
```

## Key Components

### 1. Provider Abstraction

All providers implement a common interface:

- `LiveScoreProvider` - Fetches live scores
- `MarketProvider` - Fetches betting markets
- `BaseProvider` - Common functionality (health checks, request handling)

### 2. Polling Manager

Manages configurable polling intervals with hierarchy:

1. **Match-level** (most specific) - e.g., Super Bowl every 2 seconds
2. **League-level** - e.g., NBA every 3 seconds
3. **Sport-level** - e.g., Basketball every 5 seconds
4. **Default** - Global default (30 seconds)

### 3. Data Aggregator

Merges data from multiple providers:
- Matches scores/markets from different providers
- Calculates confidence scores
- Handles conflicts (uses most recent data)
- Tracks best odds across providers

## Configuration

### Polling Intervals

Edit `src/config/polling-config.ts`:

```typescript
export const pollingConfig: PollingConfig = {
  defaultInterval: 30000,  // 30 seconds default
  
  sportIntervals: {
    'football': 10000,     // 10 seconds
    'basketball': 5000,    // 5 seconds
  },
  
  leagueIntervals: {
    'nfl': 5000,           // 5 seconds
    'nba': 3000,           // 3 seconds
  },
  
  matchIntervals: {
    'match-super-bowl-2024': 2000,  // 2 seconds
  },
};
```

### Adding a New Provider

1. **Create provider class** (extend `BaseProvider`):

```typescript
export class NewProvider extends BaseProvider implements LiveScoreProvider {
  async fetchLiveScores(params) {
    // Implement provider-specific API calls
    const response = await this.makeRequest('/scores', {
      method: 'GET',
      // ...
    });
    
    // Transform to common format
    return response.data.map(transformToLiveScore);
  }
}
```

2. **Register provider** in `src/index.ts`:

```typescript
const liveScoreProviders = [
  // ... existing providers
  new NewProvider({
    id: 'new-provider',
    name: 'New Provider',
    baseUrl: 'https://api.newprovider.com',
    apiKey: process.env.NEW_PROVIDER_API_KEY,
    enabled: true,
    priority: 3,
  }),
];
```

3. **Add to polling tasks**:

```typescript
pollingManager.registerLiveScorePolling(
  'new-sport-scores',
  liveScoreProviders,
  { sport: 'new-sport' },
  async (scores) => {
    // Handle updates
  }
);
```

## Polling Configuration Hierarchy

The polling manager uses this priority order (most specific wins):

1. **Match ID** - `matchIntervals['match-123']`
2. **League** - `leagueIntervals['nfl']`
3. **Sport** - `sportIntervals['football']`
4. **Default** - `defaultInterval`

Example:
- Match `match-123` in NFL (football) → Uses match interval if defined
- Otherwise uses NFL league interval if defined
- Otherwise uses football sport interval if defined
- Otherwise uses default interval

## Dynamic Configuration

Update polling intervals at runtime:

```bash
# Update polling interval for a task
curl -X POST http://localhost:3000/api/polling/update \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "nba-markets",
    "interval": 2000
  }'
```

## Provider Health Monitoring

Each provider tracks:
- Status: `healthy` | `degraded` | `down`
- Response times
- Error rates
- Consecutive failures

Unhealthy providers are automatically skipped during polling.

View provider health:

```bash
curl http://localhost:3000/api/providers/health
```

## Data Aggregation

### Live Scores

Scores from multiple providers are matched by:
- Team names (fuzzy matching)
- Sport
- Timestamp proximity

Confidence score calculated based on:
- Number of sources
- Agreement between sources

### Markets

Markets are matched by:
- Event ID
- Market type
- Selection

Best odds tracked across all providers.

## Example: Multiple Providers for Same Data

```typescript
// Provider A and B both provide live scores
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
    // Aggregated scores with sources and confidence
    // aggregatedScores[0].sources = ['provider-a-scores', 'provider-b-scores']
    // aggregatedScores[0].confidence = 0.95
  }
);
```

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

## Performance Considerations

1. **Parallel Fetching**: All providers are queried in parallel
2. **Health Checks**: Unhealthy providers are skipped automatically
3. **Caching**: Aggregated data cached in Redis and memory
4. **Configurable Intervals**: Adjust based on provider rate limits

## Future Enhancements

- **Database-backed config**: Store polling config in database for runtime updates
- **Provider failover**: Automatic failover to backup providers
- **Rate limit tracking**: Track and respect provider rate limits
- **Webhook support**: Some providers may support webhooks instead of polling
- **More granular config**: Match-level, team-level, or event-level intervals

