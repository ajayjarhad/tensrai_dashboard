/**
 * Error Handler Service
 * Comprehensive error categorization and recovery strategies
 */

export enum ErrorCategory {
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  MEMORY = 'memory',
  STATE = 'state',
  WEBSOCKET = 'websocket',
  RENDERING = 'rendering',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  PERMISSION = 'permission',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  CIRCUIT_BREAK = 'circuit_break',
  ROLLBACK = 'rollback',
  GRACEFUL_DEGRADATION = 'graceful_degradation',
  USER_INTERVENTION = 'user_intervention',
  IGNORE = 'ignore',
  ESCALATE = 'escalate',
}

export interface ErrorInfo {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  context: Record<string, any>;
  timestamp: number;
  retryCount: number;
  lastRetryTime: number | null;
  resolved: boolean;
  recoveryStrategy?: RecoveryStrategy;
}

export interface ErrorRule {
  category: ErrorCategory;
  severity: ErrorSeverity;
  pattern: RegExp | string;
  recoveryStrategy: RecoveryStrategy;
  maxRetries: number;
  retryDelay: number;
  escalateAfter?: number;
  requiresUserAction?: boolean;
  customHandler?: (error: ErrorInfo) => Promise<boolean>;
}

export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  recoverySuccessRate: number;
  averageRecoveryTime: number;
  currentUnresolved: number;
}

let errors = new Map<string, ErrorInfo>();
let rules: ErrorRule[] = [];
const recoveryHandlers = new Map<RecoveryStrategy, (error: ErrorInfo) => Promise<boolean>>();
const stats: ErrorStats = {
  totalErrors: 0,
  errorsByCategory: {} as Record<ErrorCategory, number>,
  errorsBySeverity: {} as Record<ErrorSeverity, number>,
  recoverySuccessRate: 0,
  averageRecoveryTime: 0,
  currentUnresolved: 0,
};

/**
 * Initialize statistics
 */
function initializeStats(): void {
  Object.values(ErrorCategory).forEach(category => {
    stats.errorsByCategory[category] = 0;
  });

  Object.values(ErrorSeverity).forEach(severity => {
    stats.errorsBySeverity[severity] = 0;
  });
}

/**
 * Setup default error handling rules
 */
function setupDefaultRules(): void {
  rules = [
    {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      pattern: /network error|connection failed/i,
      recoveryStrategy: RecoveryStrategy.RETRY,
      maxRetries: 3,
      retryDelay: 1000,
    },
    {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.CRITICAL,
      pattern: /network error|connection failed/i,
      recoveryStrategy: RecoveryStrategy.CIRCUIT_BREAK,
      maxRetries: 0,
      retryDelay: 0,
    },
    {
      category: ErrorCategory.WEBSOCKET,
      severity: ErrorSeverity.MEDIUM,
      pattern: /websocket/i,
      recoveryStrategy: RecoveryStrategy.RETRY,
      maxRetries: 5,
      retryDelay: 2000,
    },
    {
      category: ErrorCategory.MEMORY,
      severity: ErrorSeverity.HIGH,
      pattern: /memory|quota/i,
      recoveryStrategy: RecoveryStrategy.GRACEFUL_DEGRADATION,
      maxRetries: 0,
      retryDelay: 0,
    },
    {
      category: ErrorCategory.AUTHENTICATION,
      severity: ErrorSeverity.HIGH,
      pattern: /unauthorized|authentication/i,
      recoveryStrategy: RecoveryStrategy.USER_INTERVENTION,
      maxRetries: 0,
      retryDelay: 0,
      requiresUserAction: true,
    },
    {
      category: ErrorCategory.STATE,
      severity: ErrorSeverity.HIGH,
      pattern: /state|synchronization/i,
      recoveryStrategy: RecoveryStrategy.ROLLBACK,
      maxRetries: 1,
      retryDelay: 500,
    },
  ];
}

/**
 * Delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find applicable rule for error
 */
function findRule(error: ErrorInfo): ErrorRule | null {
  return (
    rules.find(rule => {
      if (rule.category !== error.category || rule.severity !== error.severity) {
        return false;
      }

      if (typeof rule.pattern === 'string') {
        return error.message.toLowerCase().includes(rule.pattern.toLowerCase());
      } else {
        return rule.pattern.test(error.message);
      }
    }) || null
  );
}

/**
 * Update recovery statistics
 */
function updateRecoveryStats(success: boolean, recoveryTime: number): void {
  const totalRecoveries = stats.totalErrors - stats.currentUnresolved;

  if (totalRecoveries > 0) {
    stats.recoverySuccessRate =
      (stats.recoverySuccessRate * (totalRecoveries - 1) + (success ? 1 : 0)) / totalRecoveries;
    stats.averageRecoveryTime =
      (stats.averageRecoveryTime * (totalRecoveries - 1) + recoveryTime) / totalRecoveries;
  } else {
    stats.recoverySuccessRate = success ? 1 : 0;
    stats.averageRecoveryTime = recoveryTime;
  }
}

/**
 * Setup recovery handlers
 */
function setupRecoveryHandlers(): void {
  recoveryHandlers.set(RecoveryStrategy.RETRY, async (error: ErrorInfo) => {
    const rule = findRule(error);
    if (!rule || error.retryCount >= rule.maxRetries) {
      return false;
    }

    const delayTime = rule.retryDelay * 2 ** error.retryCount;
    await delay(delayTime);

    error.retryCount++;
    error.lastRetryTime = Date.now();

    console.log(
      `Retrying operation for error ${error.id} (attempt ${error.retryCount}/${rule.maxRetries})`
    );
    return false;
  });

  recoveryHandlers.set(RecoveryStrategy.CIRCUIT_BREAK, async (error: ErrorInfo) => {
    console.warn(`Circuit breaker triggered for error: ${error.message}`);
    return true;
  });

  recoveryHandlers.set(RecoveryStrategy.ROLLBACK, async (error: ErrorInfo) => {
    try {
      const { rollbackService } = await import('./rollbackService');
      const service = rollbackService.getInstance();
      return await service.autoRollback(`Error recovery: ${error.message}`);
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
      return false;
    }
  });

  recoveryHandlers.set(RecoveryStrategy.GRACEFUL_DEGRADATION, async (error: ErrorInfo) => {
    console.info(`Implementing graceful degradation for: ${error.message}`);
    return true;
  });

  recoveryHandlers.set(RecoveryStrategy.USER_INTERVENTION, async (error: ErrorInfo) => {
    console.warn(`User intervention required for: ${error.message}`);
    return false;
  });

  recoveryHandlers.set(RecoveryStrategy.IGNORE, async (error: ErrorInfo) => {
    console.debug(`Ignoring error: ${error.message}`);
    return true;
  });

  recoveryHandlers.set(RecoveryStrategy.ESCALATE, async (error: ErrorInfo) => {
    console.error(`Escalating error: ${error.message}`);
    return false;
  });
}

setupDefaultRules();
setupRecoveryHandlers();
initializeStats();

/**
 * Categorize error based on message and type
 */
function categorizeError(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  const errorPatterns = [
    {
      category: ErrorCategory.NETWORK,
      patterns: ['network', 'fetch', 'connection'],
    },
    {
      category: ErrorCategory.WEBSOCKET,
      patterns: ['websocket'],
      namePatterns: ['websocketerror'],
    },
    {
      category: ErrorCategory.AUTHENTICATION,
      patterns: ['unauthorized', 'authentication', 'token'],
    },
    {
      category: ErrorCategory.MEMORY,
      patterns: ['memory', 'out of memory'],
      namePatterns: ['quotaexceedederror'],
    },
    {
      category: ErrorCategory.TIMEOUT,
      patterns: ['timeout'],
      namePatterns: ['timeouterror'],
    },
    {
      category: ErrorCategory.PERMISSION,
      patterns: ['permission', 'forbidden', 'access denied'],
    },
    {
      category: ErrorCategory.VALIDATION,
      patterns: ['validation', 'invalid'],
      namePatterns: ['typeerror'],
    },
    {
      category: ErrorCategory.RENDERING,
      patterns: ['render', 'canvas', 'konva'],
    },
    {
      category: ErrorCategory.STATE,
      patterns: ['state', 'store', 'synchroniz'],
    },
  ];

  for (const { category, patterns, namePatterns } of errorPatterns) {
    if (patterns.some(p => message.includes(p))) {
      return category;
    }
    if (namePatterns?.some(p => name.includes(p))) {
      return category;
    }
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Determine error severity based on context
 */
function determineSeverity(error: Error, context: Record<string, any>): ErrorSeverity {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  if (message.includes('critical') || message.includes('fatal') || context['isBlocking']) {
    return ErrorSeverity.CRITICAL;
  }

  if (
    (message.includes('error') && !message.includes('warning')) ||
    (name.includes('error') && !name.includes('warning')) ||
    context['isEssential']
  ) {
    return ErrorSeverity.HIGH;
  }

  if (message.includes('failed') || message.includes('timeout') || context['isImportant']) {
    return ErrorSeverity.MEDIUM;
  }

  return ErrorSeverity.LOW;
}

/**
 * Generate unique error ID
 */
function generateErrorId(): string {
  return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create error info object
 */
function createErrorInfo(error: Error | string, context: Record<string, any>): ErrorInfo {
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  const category = categorizeError(errorObj);
  const severity = determineSeverity(errorObj, context);

  return {
    id: generateErrorId(),
    category,
    severity,
    message: errorObj.message,
    originalError: errorObj,
    context: { ...context },
    timestamp: Date.now(),
    retryCount: 0,
    lastRetryTime: null,
    resolved: false,
  };
}

/**
 * Update statistics
 */
function updateStats(error: ErrorInfo): void {
  stats.totalErrors++;
  stats.errorsByCategory[error.category]++;
  stats.errorsBySeverity[error.severity]++;
  stats.currentUnresolved = Array.from(errors.values()).filter(e => !e.resolved).length;
}

/**
 * Determine default recovery strategy
 */
function determineDefaultStrategy(error: ErrorInfo): RecoveryStrategy {
  switch (error.category) {
    case ErrorCategory.NETWORK:
    case ErrorCategory.WEBSOCKET:
      return RecoveryStrategy.RETRY;

    case ErrorCategory.MEMORY:
      return RecoveryStrategy.GRACEFUL_DEGRADATION;

    case ErrorCategory.STATE:
      return RecoveryStrategy.ROLLBACK;

    case ErrorCategory.AUTHENTICATION:
    case ErrorCategory.PERMISSION:
      return RecoveryStrategy.USER_INTERVENTION;

    case ErrorCategory.VALIDATION:
      return RecoveryStrategy.IGNORE;

    case ErrorCategory.TIMEOUT:
      return RecoveryStrategy.RETRY;

    case ErrorCategory.RENDERING:
      return RecoveryStrategy.GRACEFUL_DEGRADATION;

    default:
      return RecoveryStrategy.ESCALATE;
  }
}

/**
 * Attempt error recovery
 */
async function attemptRecovery(error: ErrorInfo, strategy: RecoveryStrategy): Promise<boolean> {
  const handler = recoveryHandlers.get(strategy);
  if (!handler) {
    console.warn(`No recovery handler for strategy: ${strategy}`);
    return false;
  }

  try {
    const startTime = Date.now();
    const success = await handler(error);
    const recoveryTime = Date.now() - startTime;

    if (success) {
      updateRecoveryStats(true, recoveryTime);
    }

    return success;
  } catch (recoveryError) {
    console.error(`Recovery handler failed for ${strategy}:`, recoveryError);
    updateRecoveryStats(false, 0);
    return false;
  }
}

/**
 * Resolve an error
 */
function resolveError(errorId: string): void {
  const error = errors.get(errorId);
  if (error) {
    error.resolved = true;
    stats.currentUnresolved--;
  }
}

/**
 * Handle an error with automatic categorization and recovery
 */
export async function handleError(
  error: Error | string,
  context: Record<string, any> = {}
): Promise<string> {
  const errorInfo = createErrorInfo(error, context);
  errors.set(errorInfo.id, errorInfo);
  updateStats(errorInfo);

  console.warn(`🚨 Error [${errorInfo.category}]: ${errorInfo.message}`, errorInfo);

  const rule = findRule(errorInfo);
  const strategy = rule?.recoveryStrategy || determineDefaultStrategy(errorInfo);

  const success = await attemptRecovery(errorInfo, strategy);

  if (success) {
    resolveError(errorInfo.id);
    console.info(`✅ Recovered from error ${errorInfo.id}: ${errorInfo.message}`);
  } else {
    console.error(`❌ Failed to recover from error ${errorInfo.id}: ${errorInfo.message}`);
  }

  return errorInfo.id;
}

/**
 * Get error statistics
 */
export function getStats(): ErrorStats {
  return { ...stats };
}

/**
 * Get unresolved errors
 */
export function getUnresolvedErrors(): ErrorInfo[] {
  return Array.from(errors.values()).filter(error => !error.resolved);
}

/**
 * Get errors by category
 */
export function getErrorsByCategory(category: ErrorCategory): ErrorInfo[] {
  return Array.from(errors.values()).filter(error => error.category === category);
}

/**
 * Get errors by severity
 */
export function getErrorsBySeverity(severity: ErrorSeverity): ErrorInfo[] {
  return Array.from(errors.values()).filter(error => error.severity === severity);
}

/**
 * Add custom error rule
 */
export function addRule(rule: ErrorRule): void {
  rules.push(rule);
}

/**
 * Clear resolved errors
 */
export function clearResolvedErrors(): void {
  const unresolved = new Map<string, ErrorInfo>();
  for (const [id, error] of Array.from(errors)) {
    if (!error.resolved) {
      unresolved.set(id, error);
    }
  }
  errors = unresolved;
}

/**
 * Clear all errors
 */
export function clearAllErrors(): void {
  errors.clear();
  stats.currentUnresolved = 0;
}

/**
 * Hook for accessing error handler
 */
export function useErrorHandler() {
  return {
    handleError,
    getStats,
    getUnresolvedErrors,
    getErrorsByCategory,
    getErrorsBySeverity,
    addRule,
    clearResolvedErrors,
    clearAllErrors,
  };
}

export const errorHandler = {
  getInstance: () => ({
    handleError,
    getStats,
    getUnresolvedErrors,
    getErrorsByCategory,
    getErrorsBySeverity,
    addRule,
    clearResolvedErrors,
    clearAllErrors,
  }),
  reset: () => {
    clearAllErrors();
  },
};
