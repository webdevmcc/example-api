import type { PollingConfig } from '../providers/types.js';

/**
 * Configurable polling intervals
 * 
 * Hierarchy (most specific wins):
 * 1. matchIntervals (by match ID)
 * 2. leagueIntervals (by league)
 * 3. sportIntervals (by sport)
 * 4. defaultInterval (global default)
 * 
 * Times are in milliseconds
 */
export const pollingConfig: PollingConfig = {
  // Global default: 30 seconds
  defaultInterval: 30000,

  // By sport (more frequent for popular sports)
  sportIntervals: {
    'football': 10000,      // 10 seconds - very popular
    'basketball': 5000,     // 5 seconds - fast-paced
    'soccer': 15000,        // 15 seconds
    'baseball': 30000,      // 30 seconds - slower pace
    'hockey': 10000,        // 10 seconds
    'tennis': 5000,         // 5 seconds - very fast
    'cricket': 60000,       // 60 seconds - slow pace
  },

  // By league (more specific than sport)
  leagueIntervals: {
    // Football
    'nfl': 5000,            // 5 seconds - most popular
    'ncaa-football': 10000, // 10 seconds
    
    // Basketball
    'nba': 3000,            // 3 seconds - very fast-paced
    'ncaa-basketball': 5000, // 5 seconds
    
    // Soccer
    'premier-league': 10000, // 10 seconds
    'champions-league': 10000,
    'mls': 15000,           // 15 seconds
    
    // Baseball
    'mlb': 30000,           // 30 seconds
    
    // Tennis
    'atp': 3000,            // 3 seconds
    'wta': 3000,            // 3 seconds
  },

  // By specific match (most granular - for high-profile games)
  matchIntervals: {
    // Example: Super Bowl
    // 'match-super-bowl-2024': 2000, // 2 seconds
    
    // Example: NBA Finals Game 7
    // 'match-nba-finals-g7': 2000,   // 2 seconds
  },

  // By provider (if different providers have different rate limits)
  providerIntervals: {
    'provider-a': 5000,     // Provider A allows 5s intervals
    'provider-b': 10000,    // Provider B requires 10s intervals
  },
};

/**
 * Load polling config from environment or database
 * This allows runtime configuration updates
 */
export function loadPollingConfig(): PollingConfig {
  // In production, load from database or config service
  // For now, return the static config
  
  // You can override with environment variables:
  // Note: In Bun, use Bun.env instead of process.env
  try {
    // @ts-ignore - Bun global
    const envDefault = typeof Bun !== 'undefined' ? Bun.env.POLLING_DEFAULT_INTERVAL : undefined;
    if (envDefault) {
      return {
        ...pollingConfig,
        defaultInterval: parseInt(envDefault, 10),
      };
    }
  } catch {
    // Fallback if Bun.env not available
  }
  
  return pollingConfig;
}

/**
 * Update polling config at runtime
 * Useful for dynamic configuration changes
 */
export function updatePollingConfig(
  updates: Partial<PollingConfig>
): PollingConfig {
  return {
    ...pollingConfig,
    ...updates,
    sportIntervals: {
      ...pollingConfig.sportIntervals,
      ...updates.sportIntervals,
    },
    leagueIntervals: {
      ...pollingConfig.leagueIntervals,
      ...updates.leagueIntervals,
    },
    matchIntervals: {
      ...pollingConfig.matchIntervals,
      ...updates.matchIntervals,
    },
  };
}

