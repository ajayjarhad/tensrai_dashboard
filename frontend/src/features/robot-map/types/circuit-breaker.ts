// Circuit Breaker Types

export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Circuit is open, blocking calls
  HALF_OPEN = 'half-open', // Testing if service has recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time to wait before trying again (ms)
  monitoringPeriod: number; // Time window for failure counting (ms)
  halfOpenMaxCalls: number; // Max calls allowed in half-open state
  successThreshold: number; // Success threshold for closing circuit
  enabled: boolean; // Whether circuit breaker is enabled
}

export interface CallResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  timestamp: number;
  duration: number;
}

export interface CircuitStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalCalls: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  averageResponseTime: number;
  failureRate: number;
}

// Circuit Breaker State Interface
export interface CircuitBreakerState {
  serviceName: string;
  config: CircuitBreakerConfig;
  state: CircuitState;
  failures: number[]; // Timestamps of failures
  successes: number[]; // Timestamps of successes
  callHistory: CallResult<any>[];
  halfOpenCallCount: number;
  stats: CircuitStats;
}
