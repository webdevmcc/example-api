// Provider abstraction types

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  enabled: boolean;
  priority: number; // Lower number = higher priority
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };
}

export interface PollingConfig {
  // Global defaults
  defaultInterval: number; // milliseconds
  
  // By sport
  sportIntervals?: Record<string, number>;
  
  // By league (more specific than sport)
  leagueIntervals?: Record<string, number>;
  
  // By match/event (most specific)
  matchIntervals?: Record<string, number>;
  
  // By provider (different providers may have different rate limits)
  providerIntervals?: Record<string, number>;
}

export interface LiveScore {
  matchId: string;
  providerMatchId: string; // Provider's internal ID
  provider: string;
  sport: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  status: 'scheduled' | 'live' | 'halftime' | 'finished' | 'postponed' | 'cancelled';
  startTime?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface Market {
  id: string;
  providerId: string; // Provider's internal ID
  provider: string;
  sport: string;
  league?: string;
  eventId: string;
  eventName: string;
  marketType: string; // e.g., 'moneyline', 'spread', 'total'
  selection: string; // e.g., 'home', 'away', 'over', 'under'
  odds: number;
  oddsFormat: 'decimal' | 'american' | 'fractional';
  status: 'active' | 'suspended' | 'settled';
  updatedAt: string;
  metadata?: Record<string, any>;
}

export interface ProviderHealth {
  providerId: string;
  status: 'healthy' | 'degraded' | 'down';
  lastSuccess?: Date;
  lastFailure?: Date;
  consecutiveFailures: number;
  averageResponseTime?: number;
  errorRate: number;
}

// Provider interface
export interface DataProvider {
  id: string;
  config: ProviderConfig;
  
  // Health check
  healthCheck(): Promise<boolean>;
  
  // Get provider health status
  getHealth(): ProviderHealth;
}

// Live score provider interface
export interface LiveScoreProvider extends DataProvider {
  fetchLiveScores(params: {
    sport?: string;
    league?: string;
    matchIds?: string[];
  }): Promise<LiveScore[]>;
  
  fetchMatchScore(matchId: string): Promise<LiveScore | null>;
}

// Market provider interface
export interface MarketProvider extends DataProvider {
  fetchMarkets(params: {
    sport?: string;
    league?: string;
    eventIds?: string[];
    marketTypes?: string[];
  }): Promise<Market[]>;
  
  fetchEventMarkets(eventId: string): Promise<Market[]>;
}

// Aggregated result from multiple providers
export interface AggregatedLiveScore extends LiveScore {
  sources: string[]; // Provider IDs that provided this data
  confidence: number; // 0-1, based on agreement between providers
}

export interface AggregatedMarket extends Market {
  sources: string[]; // Provider IDs that provided this market
  bestOdds: number; // Best odds across all providers
  averageOdds: number; // Average odds across all providers
  confidence: number; // 0-1, based on agreement between providers
}

