// Rollback Service Types

export interface Snapshot {
  id: string;
  timestamp: Date;
  state: Record<string, unknown>;
  description?: string;
}

export interface RollbackConfig {
  maxSnapshots: number;
  retentionHours?: number;
  autoPrune?: boolean;
}

export interface RollbackStats {
  totalSnapshots: number;
  prunedSnapshots: number;
  lastRollback?: Date;
  failures: number;
}
