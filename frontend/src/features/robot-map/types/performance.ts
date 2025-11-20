// Performance Optimizer Types

export interface PerformanceConfig {
  enableBatching: boolean;
  batchSize: number;
  maxConcurrentBatches: number;
  debounceMs?: number;
  throttleMs?: number;
}

export interface PerformanceStats {
  totalOperations: number;
  batchedOperations: number;
  averageBatchSize: number;
  maxBatchSize: number;
  processingTimeMs: number;
  errors: number;
}

export interface BatchedOperation {
  id: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: unknown;
}
