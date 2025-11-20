/**
 * Real-time Error Boundary
 * Functional error boundary for real-time robot integration components using react-error-boundary
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type FallbackProps, ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

interface RealTimeErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: ((error: Error, errorInfo: { componentStack?: string | null }) => void) | undefined;
  onRecovery?: () => void;
  maxRetries?: number;
  retryDelay?: number;
}

interface RealTimeErrorState {
  error: Error | null;
  errorInfo: { componentStack?: string | null } | null;
  retryCount: number;
  lastErrorTime: Date | null;
  isAutoRetrying: boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 2000; // 2 seconds

/**
 * Check if error is suitable for auto-retry
 */
function shouldAutoRetry(
  error: Error,
  retryCount: number,
  maxRetries: number,
  lastErrorTime: Date | null
): boolean {
  // Don't retry if we've exceeded max retries
  if (retryCount >= maxRetries) {
    return false;
  }

  // Don't retry if last error was very recent
  if (lastErrorTime && Date.now() - lastErrorTime.getTime() < 1000) {
    return false;
  }

  // Check for retryable errors
  const retryableErrors = [
    'NetworkError',
    'TypeError', // Often network-related
    'WebSocket connection failed',
    'Failed to fetch',
    'Connection refused',
    'Timeout',
  ];

  return retryableErrors.some(
    retryableError => error.message.includes(retryableError) || error.name.includes(retryableError)
  );
}

/**
 * Real-time error fallback component
 */
function RealTimeErrorFallback({
  error,
  resetErrorBoundary,
  retryCount = 0,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelay = DEFAULT_RETRY_DELAY,
  isAutoRetrying = false,
  onManualRetry,
}: FallbackProps & {
  retryCount?: number;
  maxRetries?: number;
  retryDelay?: number;
  isAutoRetrying?: boolean;
  onManualRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-red-50 border-2 border-red-200 rounded-lg p-8">
      <div className="text-center max-w-md">
        <div className="text-red-600 mb-6">
          <svg
            className="w-16 h-16 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <h3 className="text-xl font-semibold mb-2">Real-time Integration Error</h3>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-300 rounded p-4 mb-6">
            <p className="text-sm text-red-800 font-mono break-all">{error.message}</p>
          </div>
        )}

        <div className="space-y-3">
          {isAutoRetrying && retryCount < maxRetries ? (
            <div className="text-sm text-gray-600">
              Auto-retrying in {(retryDelay * 2 ** retryCount) / 1000} seconds...
              <div className="mt-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mx-auto"></div>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={onManualRetry}
                className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium"
              >
                Retry Connection
              </button>
              <button
                type="button"
                onClick={resetErrorBoundary}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Reset Interface
              </button>
            </>
          )}
        </div>

        {retryCount > 0 && (
          <div className="mt-4 text-xs text-gray-500">
            Retry attempts: {retryCount}/{maxRetries}
          </div>
        )}

        <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-xs text-yellow-800">
            <strong>Troubleshooting tips:</strong>
            <br />• Check ROS bridge connection at ws://localhost:9090
            <br />• Verify ROS topics are being published
            <br />• Check network connectivity
            <br />• Refresh the page if issues persist
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Real-time Error Boundary Component
 *
 * @param props - Component props
 * @param props.children - Child components to wrap
 * @param props.fallback - Optional custom fallback component
 * @param props.onError - Optional error handler callback
 * @param props.onRecovery - Optional recovery callback
 * @param props.maxRetries - Maximum retry attempts (default: 3)
 * @param props.retryDelay - Base retry delay in milliseconds (default: 2000)
 */
export function RealTimeErrorBoundary({
  children,
  fallback,
  onError,
  onRecovery,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelay = DEFAULT_RETRY_DELAY,
}: RealTimeErrorBoundaryProps) {
  const [errorState, setErrorState] = useState<RealTimeErrorState>({
    error: null,
    errorInfo: null,
    retryCount: 0,
    lastErrorTime: null,
    isAutoRetrying: false,
  });

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attemptRecovery = useCallback(() => {
    setErrorState(prevState => ({
      ...prevState,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
      isAutoRetrying: false,
    }));

    // Call recovery handler if provided
    if (onRecovery) {
      try {
        onRecovery();
      } catch (recoveryError) {
        console.error('Error in recovery handler:', recoveryError);
      }
    }
  }, [onRecovery]);

  const handleError = useCallback(
    (error: Error, info: { componentStack?: string | null }) => {
      console.error('Real-time integration error:', error, info);

      setErrorState({
        error,
        errorInfo: info,
        retryCount: errorState.retryCount,
        lastErrorTime: new Date(),
        isAutoRetrying: false,
      });

      // Call error handler if provided
      if (onError) {
        try {
          onError(error, info);
        } catch (handlerError) {
          console.error('Error in error handler:', handlerError);
        }
      }

      // Auto-retry if within limits and it's a network-related error
      if (shouldAutoRetry(error, errorState.retryCount, maxRetries, errorState.lastErrorTime)) {
        setErrorState(prev => ({ ...prev, isAutoRetrying: true }));

        // Clear any existing timer
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
        }

        retryTimerRef.current = setTimeout(
          () => {
            attemptRecovery();
          },
          retryDelay * 2 ** errorState.retryCount
        ); // Exponential backoff
      }
    },
    [
      errorState.retryCount,
      errorState.lastErrorTime,
      maxRetries,
      retryDelay,
      onError,
      attemptRecovery,
    ]
  );

  const handleManualRetry = useCallback(() => {
    attemptRecovery();
  }, [attemptRecovery]);

  const handleReset = useCallback(() => {
    setErrorState({
      error: null,
      errorInfo: null,
      retryCount: 0,
      lastErrorTime: null,
      isAutoRetrying: false,
    });
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const fallbackComponent = fallback
    ? () => <>{fallback}</>
    : (fallbackProps: FallbackProps) => (
        <RealTimeErrorFallback
          {...fallbackProps}
          retryCount={errorState.retryCount}
          maxRetries={maxRetries}
          retryDelay={retryDelay}
          isAutoRetrying={errorState.isAutoRetrying}
          onManualRetry={handleManualRetry}
        />
      );

  return (
    <ReactErrorBoundary
      FallbackComponent={fallbackComponent}
      onError={handleError}
      onReset={() => {
        // Optional: perform any cleanup before retry
        console.log('Resetting real-time error boundary');
        handleReset();
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

/**
 * Hook for using real-time error boundary functionality
 *
 * @param onError - Optional error handler callback
 * @returns Error state and handler functions
 */
export function useRealTimeErrorBoundary(
  onError?: (error: Error, errorInfo: { componentStack?: string | null }) => void
) {
  const wrapWithErrorBoundary = useCallback(
    (component: ReactNode, errorBoundaryProps?: Omit<RealTimeErrorBoundaryProps, 'children'>) => {
      return (
        <RealTimeErrorBoundary onError={onError} {...errorBoundaryProps}>
          {component}
        </RealTimeErrorBoundary>
      );
    },
    [onError]
  );

  return {
    wrapWithErrorBoundary,
  };
}

// Export the ErrorBoundary component for advanced usage
export { ReactErrorBoundary as BaseRealTimeErrorBoundary };
