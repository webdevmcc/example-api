# Multi-Provider Architecture Guide

This document explains how the multi-provider system works with configurable polling intervals for aggregating odds, markets, and settlement data from multiple sports data providers.

## System Overview

This API serves as the data layer for a sports betting platform, providing odds, markets, live updates, bet validation, and settlement data to an existing betting API that handles bet placement.

## Architecture Overview

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
│  • Health check │                  │  • Best odds   │
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

## Key Components

### 1. Provider Abstraction

All providers implement a common interface:

- `LiveScoreProvider` - Fetches live scores and match status
- `MarketProvider` - Fetches betting markets with odds
- `SettlementProvider` - Fetches settlement data for grading bets (optional, can be part of MarketProvider)
- `BaseProvider` - Common functionality (health checks, request handling, error tracking)

### 2. Polling Manager

Manages configurable polling intervals with hierarchy:

1. **Match-level** (most specific) - e.g., Super Bowl every 2 seconds
2. **League-level** - e.g., NBA every 3 seconds
3. **Sport-level** - e.g., Basketball every 5 seconds
4. **Default** - Global default (30 seconds)

### 3. Data Aggregator

Merges data from multiple providers:
- **Live Scores**: Matches scores from different providers by team names and timestamps
- **Markets & Odds**: Matches markets by event ID, market type, and selection; tracks best odds across providers
- **Settlement Data**: Aggregates settlement data from multiple providers for bet grading
- **Confidence Scores**: Calculates confidence based on provider agreement
- **Conflict Resolution**: Uses most recent data, provider priority, and consensus when available

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

### Settlement Data

Settlement data is matched by:
- Event ID
- Market ID
- Provider-specific settlement identifiers

Confidence calculated based on:
- Agreement between providers on outcome
- Provider reliability scores
- Timestamp of settlement data

## Bet Validation Flow

When the betting API needs to validate a bet attempt:

```
1. Betting API receives bet request from mobile app
   ↓
2. Betting API calls POST /api/bets/validate
   {
     marketId: "market-123",
     selection: "home_team",
     odds: 2.5,
     stake: 100
   }
   ↓
3. Odds API checks:
   - Market exists and is active
   - Market is not suspended
   - Selection is valid
   - Current odds match (within tolerance)
   - Market hasn't been settled
   ↓
4. Returns validation result:
   {
     valid: true/false,
     currentOdds: 2.5,
     marketSuspended: false,
     reason: "odds_mismatch" (if invalid)
   }
   ↓
5. Betting API processes bet if valid
```

## Bet Grading Flow

After an event completes, the betting API grades bets:

```
1. Event completes
   ↓
2. Providers publish settlement data
   ↓
3. Polling manager aggregates settlement from all providers
   ↓
4. Betting API calls GET /api/markets/:marketId/settlement
   ↓
5. Odds API returns aggregated settlement:
   {
     settlementStatus: "won" | "lost" | "void" | "push",
     settlementData: { ... },
     providerSettlements: [ ... ],
     confidence: 0.95
   }
   ↓
6. Betting API grades bet based on settlement data
```

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

## Live Updates (WebSocket)

The system publishes real-time updates via Redis pub/sub for:

- **Score Updates**: Live score changes during matches
- **Odds Changes**: When odds change for a market
- **Market Suspensions**: When markets are suspended (injury, weather, etc.)
- **Market Resumptions**: When suspended markets resume
- **Settlement Notifications**: When settlement data becomes available

Clients subscribe via WebSocket to receive these updates in real-time.

## Future Enhancements

- **Database-backed config**: Store polling config in database for runtime updates
- **Provider failover**: Automatic failover to backup providers
- **Rate limit tracking**: Track and respect provider rate limits
- **Webhook support**: Some providers may support webhooks instead of polling
- **More granular config**: Match-level, team-level, or event-level intervals
- **Settlement provider priority**: Weight settlement data by provider reliability
- **Odds change detection**: Detect and publish only significant odds movements
- **Market suspension prediction**: Predict likely suspensions based on game state

