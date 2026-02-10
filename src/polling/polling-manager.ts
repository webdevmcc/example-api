import type {
  PollingConfig,
  LiveScoreProvider,
  MarketProvider,
} from '../providers/types.js';
import { DataAggregator } from '../providers/aggregator.js';

interface PollingTask {
  id: string;
  interval: number;
  lastRun?: Date;
  nextRun: Date;
  running: boolean;
  execute: () => Promise<void>;
}

export class PollingManager {
  private tasks: Map<string, PollingTask> = new Map();
  private config: PollingConfig;
  private aggregator: DataAggregator;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(
    config: PollingConfig,
    aggregator: DataAggregator
  ) {
    this.config = config;
    this.aggregator = aggregator;
  }

  /**
   * Register a live score polling task
   */
  registerLiveScorePolling(
    id: string,
    providers: LiveScoreProvider[],
    params: {
      sport?: string;
      league?: string;
      matchIds?: string[];
    },
    onUpdate: (scores: any[]) => Promise<void>
  ): void {
    const interval = this.getPollingInterval({
      sport: params.sport,
      league: params.league,
      matchIds: params.matchIds,
    });

    const task: PollingTask = {
      id,
      interval,
      nextRun: new Date(Date.now() + interval),
      running: false,
      execute: async () => {
        if (task.running) return;
        task.running = true;
        task.lastRun = new Date();

        try {
          // Fetch from all providers in parallel
          const results = await Promise.allSettled(
            providers
              .filter(p => p.getHealth().status !== 'down')
              .map(async (provider) => {
                try {
                  const data = await provider.fetchLiveScores(params);
                  return { provider, data };
                } catch (error) {
                  console.error(`Provider ${provider.id} failed:`, error);
                  return { provider, data: [] };
                }
              })
          );

          // Aggregate results
          const successful = results
            .filter((r): r is PromiseFulfilledResult<{ provider: LiveScoreProvider; data: any[] }> => 
              r.status === 'fulfilled'
            )
            .map(r => r.value);

          const aggregated = this.aggregator.aggregateLiveScores(successful);
          
          // Call update handler
          await onUpdate(aggregated);
        } catch (error) {
          console.error(`Polling task ${id} failed:`, error);
        } finally {
          task.running = false;
          task.nextRun = new Date(Date.now() + interval);
        }
      },
    };

    this.tasks.set(id, task);
  }

  /**
   * Register a market polling task
   */
  registerMarketPolling(
    id: string,
    providers: MarketProvider[],
    params: {
      sport?: string;
      league?: string;
      eventIds?: string[];
      marketTypes?: string[];
    },
    onUpdate: (markets: any[]) => Promise<void>
  ): void {
    const interval = this.getPollingInterval({
      sport: params.sport,
      league: params.league,
    });

    const task: PollingTask = {
      id,
      interval,
      nextRun: new Date(Date.now() + interval),
      running: false,
      execute: async () => {
        if (task.running) return;
        task.running = true;
        task.lastRun = new Date();

        try {
          // Fetch from all providers in parallel
          const results = await Promise.allSettled(
            providers
              .filter(p => p.getHealth().status !== 'down')
              .map(async (provider) => {
                try {
                  const data = await provider.fetchMarkets(params);
                  return { provider, data };
                } catch (error) {
                  console.error(`Provider ${provider.id} failed:`, error);
                  return { provider, data: [] };
                }
              })
          );

          // Aggregate results
          const successful = results
            .filter((r): r is PromiseFulfilledResult<{ provider: MarketProvider; data: any[] }> => 
              r.status === 'fulfilled'
            )
            .map(r => r.value);

          const aggregated = this.aggregator.aggregateMarkets(successful);
          
          // Call update handler
          await onUpdate(aggregated);
        } catch (error) {
          console.error(`Polling task ${id} failed:`, error);
        } finally {
          task.running = false;
          task.nextRun = new Date(Date.now() + interval);
        }
      },
    };

    this.tasks.set(id, task);
  }

  /**
   * Update polling interval for a task
   */
  updatePollingInterval(
    id: string,
    newInterval: number
  ): void {
    const task = this.tasks.get(id);
    if (task) {
      task.interval = newInterval;
      task.nextRun = new Date(Date.now() + newInterval);
    }
  }

  /**
   * Remove a polling task
   */
  unregister(id: string): void {
    this.tasks.delete(id);
  }

  /**
   * Start the polling manager
   */
  start(): void {
    if (this.intervalId) return;

    // Run every second to check for tasks that need execution
    this.intervalId = setInterval(() => {
      const now = Date.now();
      
      for (const task of this.tasks.values()) {
        if (task.nextRun.getTime() <= now && !task.running) {
          task.execute().catch(error => {
            console.error(`Error executing task ${task.id}:`, error);
          });
        }
      }
    }, 1000);
  }

  /**
   * Stop the polling manager
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Get polling interval based on configuration hierarchy
   */
  private getPollingInterval(params: {
    sport?: string;
    league?: string;
    matchIds?: string[];
  }): number {
    // Most specific: match-level
    if (params.matchIds && params.matchIds.length === 1) {
      const matchInterval = this.config.matchIntervals?.[params.matchIds[0]];
      if (matchInterval) return matchInterval;
    }

    // League-level
    if (params.league) {
      const leagueInterval = this.config.leagueIntervals?.[params.league];
      if (leagueInterval) return leagueInterval;
    }

    // Sport-level
    if (params.sport) {
      const sportInterval = this.config.sportIntervals?.[params.sport];
      if (sportInterval) return sportInterval;
    }

    // Default
    return this.config.defaultInterval;
  }

  /**
   * Get status of all polling tasks
   */
  getStatus(): Array<{
    id: string;
    interval: number;
    lastRun?: Date;
    nextRun: Date;
    running: boolean;
  }> {
    return Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      interval: task.interval,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      running: task.running,
    }));
  }
}

