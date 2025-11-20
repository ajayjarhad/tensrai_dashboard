// Error Handling Types

export interface ErrorInfo {
  id: string;
  message: string;
  stack?: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
}

export interface ErrorRule {
  id: string;
  condition: (error: ErrorInfo) => boolean;
  action: (error: ErrorInfo) => void;
  enabled: boolean;
}

export interface ErrorStats {
  total: number;
  bySeverity: Record<ErrorInfo['severity'], number>;
  recent: ErrorInfo[];
}
