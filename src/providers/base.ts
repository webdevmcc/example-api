import type { ProviderConfig, ProviderHealth, DataProvider } from './types.js';

export abstract class BaseProvider implements DataProvider {
  public readonly id: string;
  public readonly config: ProviderConfig;
  private health: ProviderHealth;
  private responseTimes: number[] = [];
  private readonly maxResponseTimeHistory = 100;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.config = config;
    this.health = {
      providerId: config.id,
      status: 'healthy',
      consecutiveFailures: 0,
      errorRate: 0,
    };
  }

  abstract healthCheck(): Promise<boolean>;

  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  protected async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const startTime = Date.now();
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(this.config.timeout || 10000),
      });

      const responseTime = Date.now() - startTime;
      this.recordResponseTime(responseTime);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as T;
      this.recordSuccess();
      return data;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }

    const avg = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    this.health.averageResponseTime = Math.round(avg);
  }

  private recordSuccess(): void {
    this.health.lastSuccess = new Date();
    this.health.consecutiveFailures = 0;
    
    // Update status based on error rate
    if (this.health.errorRate > 0.5) {
      this.health.status = 'degraded';
    } else if (this.health.errorRate > 0.1) {
      this.health.status = 'degraded';
    } else {
      this.health.status = 'healthy';
    }
  }

  private recordFailure(error: unknown): void {
    this.health.lastFailure = new Date();
    this.health.consecutiveFailures++;
    
    // Calculate error rate (simple moving average)
    // In production, you'd want a more sophisticated calculation
    if (this.health.consecutiveFailures > 3) {
      this.health.status = 'down';
    } else if (this.health.consecutiveFailures > 1) {
      this.health.status = 'degraded';
    }
    
    // Update error rate (simplified - in production use proper windowing)
    this.health.errorRate = Math.min(1, this.health.consecutiveFailures / 10);
  }
}

