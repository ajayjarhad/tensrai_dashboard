/**
 * System Health Dashboard
 * Comprehensive monitoring dashboard for all system components
 */

import { useEffect, useState } from 'react';
import { CircuitState, useCircuitBreaker } from '../services/circuitBreaker';
import { useErrorHandler } from '../services/errorHandler';
import { usePerformanceOptimizer } from '../services/performanceOptimizer';
import { useRollbackService } from '../services/rollbackService';

interface SystemHealthDashboardProps {
  showDetails?: boolean;
  className?: string;
}

interface HealthStatus {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: any;
}

/**
 * Calculate error handler health status
 */
function calculateErrorHandlerStatus(
  getErrorStats: () => any,
  getUnresolvedErrors: () => any[]
): HealthStatus {
  const errorStats = getErrorStats();
  const unresolvedErrors = getUnresolvedErrors();
  const criticalErrors = unresolvedErrors.filter(e => e.severity === 'critical');
  const highErrors = unresolvedErrors.filter(e => e.severity === 'high');

  if (criticalErrors.length > 0) {
    return {
      component: 'Error Handler',
      status: 'critical',
      message: `${criticalErrors.length} critical errors`,
      details: {
        critical: criticalErrors.length,
        high: highErrors.length,
        total: errorStats.totalErrors,
      },
    };
  }

  if (highErrors.length > 5 || errorStats.totalErrors > 50) {
    return {
      component: 'Error Handler',
      status: 'warning',
      message: `${highErrors.length} high severity errors`,
      details: { critical: 0, high: highErrors.length, total: errorStats.totalErrors },
    };
  }

  return {
    component: 'Error Handler',
    status: 'healthy',
    message: `${errorStats.totalErrors} total errors handled`,
    details: { critical: 0, high: highErrors.length, total: errorStats.totalErrors },
  };
}

/**
 * Calculate circuit breaker health status
 */
function calculateCircuitBreakerStatus(
  getAllStats: () => any,
  getCircuitBreakersInState: (state: CircuitState) => any[]
): HealthStatus {
  const allCircuitStats = getAllStats();
  const openCircuits = getCircuitBreakersInState(CircuitState.OPEN);
  const halfOpenCircuits = getCircuitBreakersInState(CircuitState.HALF_OPEN);

  if (openCircuits.length > 0) {
    return {
      component: 'Circuit Breakers',
      status: 'critical',
      message: `${openCircuits.length} circuits open`,
      details: {
        open: openCircuits.length,
        halfOpen: halfOpenCircuits.length,
        total: Object.keys(allCircuitStats).length,
      },
    };
  }

  if (halfOpenCircuits.length > 2) {
    return {
      component: 'Circuit Breakers',
      status: 'warning',
      message: `${halfOpenCircuits.length} circuits half-open`,
      details: {
        open: 0,
        halfOpen: halfOpenCircuits.length,
        total: Object.keys(allCircuitStats).length,
      },
    };
  }

  return {
    component: 'Circuit Breakers',
    status: 'healthy',
    message: 'All circuits operational',
    details: {
      open: 0,
      halfOpen: halfOpenCircuits.length,
      total: Object.keys(allCircuitStats).length,
    },
  };
}

/**
 * Calculate performance health status
 */
function calculatePerformanceStatus(
  getPerfStats: () => any,
  isPerfOptimal: () => boolean,
  getRecommendations: () => any[]
): HealthStatus {
  const perfStats = getPerfStats();
  const perfOptimal = isPerfOptimal();
  const perfRecommendations = getRecommendations();

  if (!perfOptimal && perfRecommendations.length > 3) {
    return {
      component: 'Performance',
      status: 'critical',
      message: 'Multiple performance issues',
      details: {
        fps: perfStats.fps,
        memoryUsage: perfStats.memoryUsage.percentage,
        recommendations: perfRecommendations.length,
      },
    };
  }

  if (perfOptimal) {
    return {
      component: 'Performance',
      status: 'healthy',
      message: `${perfStats.fps.toFixed(1)} FPS`,
      details: {
        fps: perfStats.fps,
        memoryUsage: perfStats.memoryUsage.percentage,
        recommendations: 0,
      },
    };
  }

  return {
    component: 'Performance',
    status: 'warning',
    message: 'Performance suboptimal',
    details: {
      fps: perfStats.fps,
      memoryUsage: perfStats.memoryUsage.percentage,
      recommendations: perfRecommendations.length,
    },
  };
}

// /**
//  * Calculate state sync health status
//  */
// function calculateStateSyncStatus(getSyncStats: () => any): HealthStatus {
//   const syncStats = getSyncStats();
//   const syncFailureRate =
//     syncStats.totalOperations > 0
//       ? (syncStats.failedOperations / syncStats.totalOperations) * 100
//       : 0;

//   if (syncFailureRate > 20) {
//     return {
//       component: 'State Sync',
//       status: 'critical',
//       message: `${syncFailureRate.toFixed(1)}% sync failures`,
//       details: { ...syncStats, failureRate: syncFailureRate },
//     };
//   }

//   if (syncFailureRate > 5 || syncStats.conflictsDetected > 10) {
//     return {
//       component: 'State Sync',
//       status: 'warning',
//       message: `${syncFailureRate.toFixed(1)}% sync failures`,
//       details: { ...syncStats, failureRate: syncFailureRate },
//     };
//   }

//   return {
//     component: 'State Sync',
//     status: 'healthy',
//     message: `${syncStats.successfulOperations} successful syncs`,
//     details: { ...syncStats, failureRate: syncFailureRate },
//   };
// }

/**
 * Calculate rollback service health status
 */
function calculateRollbackStatus(getRollbackStats: () => any): HealthStatus {
  const rollbackStats = getRollbackStats();
  const rollbackSuccessRate =
    rollbackStats.rollbacksPerformed > 0
      ? (rollbackStats.rollbackSuccessCount / rollbackStats.rollbacksPerformed) * 100
      : 100;

  if (rollbackSuccessRate < 70 && rollbackStats.rollbacksPerformed > 0) {
    return {
      component: 'Rollback Service',
      status: 'warning',
      message: `${rollbackSuccessRate.toFixed(1)}% success rate`,
      details: rollbackStats,
    };
  }

  return {
    component: 'Rollback Service',
    status: 'healthy',
    message: `${rollbackStats.snapshotsCreated} snapshots`,
    details: rollbackStats,
  };
}

export function SystemHealthDashboard({
  showDetails = true,
  className = '',
}: SystemHealthDashboardProps) {
  const { getStats: getErrorStats, getUnresolvedErrors, clearAllErrors } = useErrorHandler();
  const { getAllStats, getCircuitBreakersInState, resetAll } = useCircuitBreaker();
  const {
    getStats: getPerfStats,
    isOptimal: isPerfOptimal,
    getRecommendations,
  } = usePerformanceOptimizer();
  const { getStats: getRollbackStats, createSnapshot } = useRollbackService();

  const [healthStatuses, setHealthStatuses] = useState<HealthStatus[]>([]);

  useEffect(() => {
    const updateHealthStatus = () => {
      const statuses: HealthStatus[] = [
        calculateErrorHandlerStatus(getErrorStats, getUnresolvedErrors),
        calculateCircuitBreakerStatus(getAllStats, getCircuitBreakersInState),
        calculatePerformanceStatus(getPerfStats, isPerfOptimal, getRecommendations),
        // calculateStateSyncStatus(getSyncStats), // Simplified state sync removed
        calculateRollbackStatus(getRollbackStats),
      ];

      setHealthStatuses(statuses);
    };

    updateHealthStatus();
    const interval = setInterval(updateHealthStatus, 5000);

    return () => clearInterval(interval);
  }, [
    getErrorStats,
    getUnresolvedErrors,
    getAllStats,
    getCircuitBreakersInState,
    getPerfStats,
    isPerfOptimal,
    getRecommendations,
    // getSyncStats, // Simplified state sync removed
    getRollbackStats,
  ]);

  const getStatusColor = (status: HealthStatus['status']) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500';
      case 'warning':
        return 'text-yellow-500';
      case 'critical':
        return 'text-red-500';
    }
  };

  const getStatusBgColor = (status: HealthStatus['status']) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100';
      case 'warning':
        return 'bg-yellow-100';
      case 'critical':
        return 'bg-red-100';
    }
  };

  const overallStatus = healthStatuses.some(s => s.status === 'critical')
    ? 'critical'
    : healthStatuses.some(s => s.status === 'warning')
      ? 'warning'
      : 'healthy';

  return (
    <div className={`system-health-dashboard ${className}`}>
      {/* Overall Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">System Health</div>
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${getStatusColor(overallStatus).replace('text', 'bg')}`}
          />
          <span className={`text-xs font-medium capitalize ${getStatusColor(overallStatus)}`}>
            {overallStatus}
          </span>
        </div>
      </div>

      {/* Component Statuses */}
      <div className="space-y-2">
        {healthStatuses.map(status => (
          <div
            key={status.component}
            className={`p-2 rounded border ${getStatusBgColor(status.status)} border-opacity-50`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(status.status).replace('text', 'bg')}`}
                />
                <span className="text-xs font-medium">{status.component}</span>
              </div>
              <span className={`text-xs ${getStatusColor(status.status)}`}>{status.message}</span>
            </div>

            {/* Detailed Information */}
            {showDetails && status.details && (
              <div className="mt-1 text-xs text-gray-600 space-y-1">
                {Object.entries(status.details).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                    <span className="font-mono">
                      {typeof value === 'number' ? value.toFixed(1) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      {showDetails && overallStatus !== 'healthy' && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold mb-2">Quick Actions</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
              onClick={() => {
                // Clear all errors
                clearAllErrors();
              }}
            >
              Clear Errors
            </button>
            <button
              type="button"
              className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
              onClick={() => {
                // Reset all circuit breakers
                resetAll();
              }}
            >
              Reset Circuits
            </button>
            <button
              type="button"
              className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
              onClick={() => {
                // Create system snapshot
                createSnapshot('Manual system snapshot');
              }}
            >
              Create Snapshot
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
