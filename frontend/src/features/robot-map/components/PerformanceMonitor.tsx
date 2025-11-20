/**
 * Performance Monitor Component
 * Displays performance metrics and recommendations
 */

import { useEffect, useState } from 'react';
import type { PerformanceStats } from '../services/performanceOptimizer';
import { usePerformanceOptimizer } from '../services/performanceOptimizer';

interface PerformanceMonitorProps {
  showRecommendations?: boolean;
  showDetails?: boolean;
  className?: string;
}

export function PerformanceMonitor({
  showRecommendations = true,
  showDetails = true,
  className = '',
}: PerformanceMonitorProps) {
  const { getStats, isOptimal, getRecommendations } = usePerformanceOptimizer();
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [isHealthy, setIsHealthy] = useState(true);
  const [recommendations, setRecommendations] = useState<string[]>([]);

  // Update stats every second
  useEffect(() => {
    const updateStats = () => {
      const currentStats = getStats();
      setStats(currentStats);
      setIsHealthy(isOptimal());
      setRecommendations(getRecommendations());
    };

    updateStats(); // Initial update
    const interval = setInterval(updateStats, 1000);

    return () => clearInterval(interval);
  }, [getStats, isOptimal, getRecommendations]);

  if (!stats) {
    return (
      <div className={`performance-monitor loading ${className}`}>
        <div className="text-xs text-gray-500">Loading performance data...</div>
      </div>
    );
  }

  const getStatusColor = (value: number, threshold: number, inverted = false) => {
    if (inverted) {
      return value <= threshold
        ? 'text-green-500'
        : value <= threshold * 1.5
          ? 'text-yellow-500'
          : 'text-red-500';
    }
    return value >= threshold
      ? 'text-green-500'
      : value >= threshold * 0.8
        ? 'text-yellow-500'
        : 'text-red-500';
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className={`performance-monitor ${className} ${isHealthy ? '' : 'warning'}`}>
      {/* Status Indicator */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold">Performance</div>
        <div
          className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
        />
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* FPS */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600">FPS:</span>
          <span className={`font-mono ${getStatusColor(stats.fps, 55)}`}>
            {stats.fps.toFixed(1)}
          </span>
        </div>

        {/* Frame Time */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Frame:</span>
          <span className={`font-mono ${getStatusColor(stats.frameTime, 16.67, true)}`}>
            {stats.frameTime.toFixed(1)}ms
          </span>
        </div>

        {/* Memory Usage */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Memory:</span>
          <span className={`font-mono ${getStatusColor(stats.memoryUsage.percentage, 75, true)}`}>
            {stats.memoryUsage.percentage.toFixed(1)}%
          </span>
        </div>

        {/* Updates */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Updates:</span>
          <span className="font-mono text-gray-500">{stats.updateCount}</span>
        </div>
      </div>

      {/* Detailed Stats */}
      {showDetails && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span>Memory Used:</span>
              <span className="font-mono">{formatBytes(stats.memoryUsage.used)}</span>
            </div>
            <div className="flex justify-between">
              <span>Memory Total:</span>
              <span className="font-mono">{formatBytes(stats.memoryUsage.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Avg Update Time:</span>
              <span className="font-mono">{stats.averageUpdateTime.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between">
              <span>Batched Operations:</span>
              <span className="font-mono">{stats.batchedOperations}</span>
            </div>
            {stats.skippedFrames > 0 && (
              <div className="flex justify-between text-yellow-600">
                <span>Skipped Frames:</span>
                <span className="font-mono">{stats.skippedFrames}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {showRecommendations && recommendations.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="text-xs font-semibold text-yellow-600 mb-1">Recommendations:</div>
          <div className="text-xs text-gray-600 space-y-1">
            {recommendations.slice(0, 3).map(recommendation => (
              <div key={recommendation} className="flex items-start">
                <span className="text-yellow-500 mr-1">•</span>
                <span>{recommendation}</span>
              </div>
            ))}
            {recommendations.length > 3 && (
              <div className="text-gray-500">
                +{recommendations.length - 3} more recommendations
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
