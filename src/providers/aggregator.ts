import type {
  LiveScore,
  Market,
  LiveScoreProvider,
  MarketProvider,
  AggregatedLiveScore,
  AggregatedMarket,
} from './types.js';

export class DataAggregator {
  /**
   * Aggregate live scores from multiple providers
   * Matches scores by team names and timestamps
   */
  aggregateLiveScores(
    scores: Array<{ provider: LiveScoreProvider; data: LiveScore[] }>
  ): AggregatedLiveScore[] {
    const scoreMap = new Map<string, AggregatedLiveScore>();

    for (const { provider, data } of scores) {
      for (const score of data) {
        // Create a key based on teams and sport (fuzzy matching)
        const key = this.createScoreKey(score);

        if (scoreMap.has(key)) {
          const existing = scoreMap.get(key)!;
          
          // Merge data from multiple providers
          existing.sources.push(provider.id);
          
          // Use most recent score if timestamps differ
          if (new Date(score.timestamp) > new Date(existing.timestamp)) {
            existing.homeScore = score.homeScore;
            existing.awayScore = score.awayScore;
            existing.period = score.period;
            existing.status = score.status;
            existing.timestamp = score.timestamp;
          }
          
          // Calculate confidence based on agreement
          existing.confidence = this.calculateScoreConfidence(existing, score);
        } else {
          scoreMap.set(key, {
            ...score,
            sources: [provider.id],
            confidence: 1.0, // Single source
          });
        }
      }
    }

    return Array.from(scoreMap.values());
  }

  /**
   * Aggregate markets from multiple providers
   * Matches markets by event and market type
   */
  aggregateMarkets(
    markets: Array<{ provider: MarketProvider; data: Market[] }>
  ): AggregatedMarket[] {
    const marketMap = new Map<string, AggregatedMarket>();

    for (const { provider, data } of markets) {
      for (const market of data) {
        // Create a key based on event, market type, and selection
        const key = this.createMarketKey(market);

        if (marketMap.has(key)) {
          const existing = marketMap.get(key)!;
          
          existing.sources.push(provider.id);
          
          // Track best and average odds
          const allOdds = [...existing.sources.map(() => existing.odds), market.odds];
          existing.bestOdds = Math.max(...allOdds);
          existing.averageOdds = allOdds.reduce((a, b) => a + b, 0) / allOdds.length;
          
          // Use best odds as primary
          if (market.odds > existing.odds) {
            existing.odds = market.odds;
            existing.provider = market.provider;
            existing.providerId = market.providerId;
          }
          
          // Calculate confidence based on odds agreement
          existing.confidence = this.calculateMarketConfidence(existing, market);
        } else {
          marketMap.set(key, {
            ...market,
            sources: [provider.id],
            bestOdds: market.odds,
            averageOdds: market.odds,
            confidence: 1.0,
          });
        }
      }
    }

    return Array.from(marketMap.values());
  }

  private createScoreKey(score: LiveScore): string {
    // Normalize team names for matching
    const home = score.homeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const away = score.awayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${score.sport}:${home}:${away}`;
  }

  private createMarketKey(market: Market): string {
    return `${market.eventId}:${market.marketType}:${market.selection}`;
  }

  private calculateScoreConfidence(
    existing: AggregatedLiveScore,
    newScore: LiveScore
  ): number {
    // Confidence increases with more sources
    const sourceCount = existing.sources.length + 1;
    
    // Check if scores match (within reasonable tolerance)
    const scoreMatches =
      existing.homeScore === newScore.homeScore &&
      existing.awayScore === newScore.awayScore;
    
    if (scoreMatches) {
      return Math.min(1.0, 0.5 + sourceCount * 0.15);
    }
    
    // Scores differ - lower confidence
    return Math.max(0.3, 1.0 - sourceCount * 0.1);
  }

  private calculateMarketConfidence(
    existing: AggregatedMarket,
    newMarket: Market
  ): number {
    const sourceCount = existing.sources.length + 1;
    
    // Odds within 5% are considered similar
    const oddsDiff = Math.abs(existing.odds - newMarket.odds) / existing.odds;
    const oddsMatch = oddsDiff < 0.05;
    
    if (oddsMatch) {
      return Math.min(1.0, 0.6 + sourceCount * 0.1);
    }
    
    // Odds differ significantly - lower confidence
    return Math.max(0.4, 1.0 - oddsDiff * 2);
  }
}

