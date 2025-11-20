/**
 * Circuit Breaker Service
 * Implements circuit breaker pattern for resilient error handling
 */

import type {
  CallResult,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitStats,
} from '../types/circuit-breaker';
import { CircuitState } from '../types/circuit-breaker';

export { CircuitState };

const circuitBreakers = new Map<string, CircuitBreakerState>();

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000,
  monitoringPeriod: 300000,
  halfOpenMaxCalls: 3,
  successThreshold: 2,
  enabled: true,
};

/**
 * Get or create circuit breaker state
 */
function getCircuitBreakerState(
  serviceName: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreakerState {
  let state = circuitBreakers.get(serviceName);

  if (!state) {
    state = {
      serviceName,
      config: { ...DEFAULT_CONFIG, ...config },
      state: CircuitState.CLOSED,
      failures: [],
      successes: [],
      callHistory: [],
      halfOpenCallCount: 0,
      stats: {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        totalCalls: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        averageResponseTime: 0,
        failureRate: 0,
      },
    };
    circuitBreakers.set(serviceName, state);
  } else if (config) {
    state.config = { ...state.config, ...config };
  }

  return state;
}

/**
 * Update derived statistics
 */
function updateStats(state: CircuitBreakerState): void {
  if (state.callHistory.length === 0) {
    state.stats.failureRate = 0;
    state.stats.averageResponseTime = 0;
    return;
  }

  const failures = state.callHistory.filter(call => !call.success);
  state.stats.failureRate = (failures.length / state.callHistory.length) * 100;

  const totalDuration = state.callHistory.reduce((sum, call) => sum + call.duration, 0);
  state.stats.averageResponseTime = totalDuration / state.callHistory.length;

  state.stats.state = state.state;
}

/**
 * Trim old call history to prevent memory leaks
 */
function trimCallHistory(state: CircuitBreakerState): void {
  const cutoff = Date.now() - state.config.monitoringPeriod;
  state.callHistory = state.callHistory.filter(call => call.timestamp > cutoff);
}

/**
 * Record a call result for statistics
 */
function recordCall<T>(
  state: CircuitBreakerState,
  success: boolean,
  error: Error | undefined,
  startTime: number,
  result?: T
): void {
  const duration = Date.now() - startTime;
  const callResult: CallResult<T> = {
    success,
    timestamp: Date.now(),
    duration,
    ...(error ? { error } : {}),
  };

  if (result !== undefined) {
    callResult.result = result;
  }

  state.callHistory.push(callResult);
  trimCallHistory(state);

  state.stats.totalCalls++;
  if (success) {
    state.stats.successCount++;
    state.stats.lastSuccessTime = Date.now();
  } else {
    state.stats.failureCount++;
    state.stats.lastFailureTime = Date.now();
  }

  updateStats(state);
}

/**
 * Transition circuit states
 */
function transitionToOpen(state: CircuitBreakerState): void {
  console.warn(
    `🔴 Circuit breaker OPEN for service: ${state.serviceName} (failures: ${state.failures.length})`
  );
  state.state = CircuitState.OPEN;
  state.halfOpenCallCount = 0;
  state.stats.state = CircuitState.OPEN;
}

function transitionToHalfOpen(state: CircuitBreakerState): void {
  console.info(`🟡 Circuit breaker HALF-OPEN for service: ${state.serviceName}`);
  state.state = CircuitState.HALF_OPEN;
  state.halfOpenCallCount = 0;
  state.stats.state = CircuitState.HALF_OPEN;
}

function transitionToClosed(state: CircuitBreakerState): void {
  console.info(`🟢 Circuit breaker CLOSED for service: ${state.serviceName}`);
  state.state = CircuitState.CLOSED;
  state.failures = [];
  state.halfOpenCallCount = 0;
  state.stats.state = CircuitState.CLOSED;
}

/**
 * Check if we should attempt to reset the circuit
 */
function shouldAttemptReset(state: CircuitBreakerState): boolean {
  if (!state.stats.lastFailureTime) {
    return false;
  }

  return Date.now() - state.stats.lastFailureTime >= state.config.resetTimeout;
}

/**
 * Handle failed call
 */
function handleFailure(state: CircuitBreakerState): void {
  const now = Date.now();
  state.failures.push(now);

  state.failures = state.failures.filter(
    timestamp => now - timestamp < state.config.monitoringPeriod
  );

  if (state.failures.length >= state.config.failureThreshold) {
    transitionToOpen(state);
  } else if (state.state === CircuitState.HALF_OPEN) {
    transitionToOpen(state);
  }
}

/**
 * Handle successful call in different states
 */
function handleHalfOpenSuccess(state: CircuitBreakerState): void {
  state.halfOpenCallCount++;

  if (state.halfOpenCallCount >= state.config.successThreshold) {
    transitionToClosed(state);
  }
}

/**
 * Handle successful call in closed state
 */
function handleSuccess(state: CircuitBreakerState): void {
  const now = Date.now();
  state.failures = state.failures.filter(
    timestamp => now - timestamp < state.config.monitoringPeriod
  );
}

/**
 * Execute a function with circuit breaker protection
 */
export async function execute<T>(
  serviceName: string,
  fn: () => Promise<T>,
  _context?: string,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const state = getCircuitBreakerState(serviceName, config);

  if (!state.config.enabled) {
    return fn();
  }

  const startTime = Date.now();

  if (state.state === CircuitState.OPEN) {
    if (shouldAttemptReset(state)) {
      transitionToHalfOpen(state);
    } else {
      const error = new Error(`Circuit breaker OPEN for service: ${serviceName}`);
      recordCall(state, false, error, startTime);
      throw error;
    }
  }

  if (
    state.state === CircuitState.HALF_OPEN &&
    state.halfOpenCallCount >= state.config.halfOpenMaxCalls
  ) {
    const error = new Error(`Circuit breaker HALF-OPEN limit reached for service: ${serviceName}`);
    recordCall(state, false, error, startTime);
    throw error;
  }

  try {
    const result = await fn();
    recordCall(state, true, undefined, startTime, result);

    if (state.state === CircuitState.HALF_OPEN) {
      handleHalfOpenSuccess(state);
    } else {
      handleSuccess(state);
    }

    return result;
  } catch (error) {
    recordCall(state, false, error as Error, startTime);
    handleFailure(state);
    throw error;
  }
}

/**
 * Get current circuit breaker statistics
 */
export function getStats(serviceName: string): CircuitStats | undefined {
  const state = circuitBreakers.get(serviceName);
  return state ? { ...state.stats } : undefined;
}

/**
 * Force circuit to a specific state (for testing or manual control)
 */
export function forceState(serviceName: string, newState: CircuitState): void {
  const state = getCircuitBreakerState(serviceName);
  switch (newState) {
    case CircuitState.OPEN:
      transitionToOpen(state);
      break;
    case CircuitState.HALF_OPEN:
      transitionToHalfOpen(state);
      break;
    case CircuitState.CLOSED:
      transitionToClosed(state);
      break;
  }
}

/**
 * Reset circuit breaker to initial state
 */
export function reset(serviceName: string): void {
  const state = circuitBreakers.get(serviceName);
  if (state) {
    state.state = CircuitState.CLOSED;
    state.failures = [];
    state.successes = [];
    state.callHistory = [];
    state.halfOpenCallCount = 0;
    state.stats = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      totalCalls: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      averageResponseTime: 0,
      failureRate: 0,
    };
  }
}

/**
 * Check if circuit is currently allowing calls
 */
export function isAvailable(serviceName: string): boolean {
  const state = circuitBreakers.get(serviceName);
  if (!state) return true; // Default to available if not initialized

  return (
    state.state === CircuitState.CLOSED ||
    (state.state === CircuitState.HALF_OPEN &&
      state.halfOpenCallCount < state.config.halfOpenMaxCalls)
  );
}

/**
 * Update configuration
 */
export function updateConfig(serviceName: string, newConfig: Partial<CircuitBreakerConfig>): void {
  const state = getCircuitBreakerState(serviceName);
  state.config = { ...state.config, ...newConfig };
}

/**
 * Get all circuit breaker statistics
 */
export function getAllStats(): Record<string, CircuitStats> {
  const stats: Record<string, CircuitStats> = {};

  for (const [serviceName, state] of Array.from(circuitBreakers)) {
    stats[serviceName] = { ...state.stats };
  }

  return stats;
}

/**
 * Reset all circuit breakers
 */
export function resetAll(): void {
  for (const serviceName of Array.from(circuitBreakers.keys())) {
    reset(serviceName);
  }
}

/**
 * Get circuit breakers in a specific state
 */
export function getCircuitBreakersInState(state: CircuitState): string[] {
  return Array.from(circuitBreakers.values())
    .filter(cb => cb.state === state)
    .map(cb => cb.serviceName);
}

/**
 * Get services with high failure rates
 */
export function getHighFailureServices(
  threshold: number = 50
): Array<{ serviceName: string; stats: CircuitStats }> {
  return Array.from(circuitBreakers.values())
    .filter(cb => cb.stats.failureRate >= threshold)
    .map(cb => ({ serviceName: cb.serviceName, stats: { ...cb.stats } }));
}

/**
 * Hook for using circuit breaker
 */
export function useCircuitBreaker() {
  return {
    execute,
    getStats,
    forceState,
    reset,
    isAvailable,
    updateConfig,
    getAllStats,
    resetAll,
    getCircuitBreakersInState,
    getHighFailureServices,
    getCircuitBreaker: (serviceName: string, config?: Partial<CircuitBreakerConfig>) => ({
      execute: <T>(fn: () => Promise<T>, context?: string) =>
        execute(serviceName, fn, context, config),
      getStats: () => getStats(serviceName),
      forceState: (state: CircuitState) => forceState(serviceName, state),
      reset: () => reset(serviceName),
      isAvailable: () => isAvailable(serviceName),
      updateConfig: (newConfig: Partial<CircuitBreakerConfig>) =>
        updateConfig(serviceName, newConfig),
      getServiceName: () => serviceName,
      getState: () => {
        const state = circuitBreakers.get(serviceName);
        return state ? state.state : CircuitState.CLOSED;
      },
    }),
  };
}

/**
 * Backward compatibility object
 */
export const circuitBreakerManager = {
  getCircuitBreaker: (serviceName: string, config?: Partial<CircuitBreakerConfig>) => ({
    execute: <T>(fn: () => Promise<T>, context?: string) =>
      execute(serviceName, fn, context, config),
    getStats: () => getStats(serviceName),
    forceState: (state: CircuitState) => forceState(serviceName, state),
    reset: () => reset(serviceName),
    isAvailable: () => isAvailable(serviceName),
    updateConfig: (newConfig: Partial<CircuitBreakerConfig>) =>
      updateConfig(serviceName, newConfig),
    getServiceName: () => serviceName,
    getState: () => {
      const state = circuitBreakers.get(serviceName);
      return state ? state.state : CircuitState.CLOSED;
    },
  }),
  getAllStats,
  resetAll,
  getCircuitBreakersInState: (state: CircuitState) => {
    return getCircuitBreakersInState(state).map(serviceName => ({
      getServiceName: () => serviceName,
      getState: () => {
        const s = circuitBreakers.get(serviceName);
        return s ? s.state : CircuitState.CLOSED;
      },
      getStats: () =>
        getStats(serviceName) || {
          state: CircuitState.CLOSED,
          failureCount: 0,
          successCount: 0,
          totalCalls: 0,
          lastFailureTime: null,
          lastSuccessTime: null,
          averageResponseTime: 0,
          failureRate: 0,
        },
    }));
  },
  getHighFailureServices,
};
