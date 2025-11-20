/**
 * Error Boundary for Map Components
 * Functional error boundary using react-error-boundary
 * Catches and handles rendering errors in map components
 */

import type { ReactNode } from 'react';
import { type FallbackProps, ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

interface MapErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}

/**
 * Default error fallback component
 */
function MapErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50 border-2 border-red-200 rounded-lg">
      <div className="text-center p-6">
        <div className="text-red-600 mb-4">
          <svg
            className="w-12 h-12 mx-auto mb-4"
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
          <h3 className="text-lg font-semibold">Map Rendering Error</h3>
        </div>
        <p className="text-gray-600 text-sm mb-4">
          {error?.message || 'An error occurred while rendering the map'}
        </p>
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/**
 * Map Error Boundary Component
 *
 * @param props - Component props
 * @param props.children - Child components to wrap
 * @param props.fallback - Optional custom fallback component
 * @param props.onError - Optional error handler callback
 */
export function MapErrorBoundary({ children, fallback, onError }: MapErrorBoundaryProps) {
  const handleError = (error: Error, info: { componentStack: string }) => {
    console.error('Map rendering error:', error, info);
    onError?.(error, info);
  };

  const fallbackComponent = fallback
    ? (_props: FallbackProps) => <>{fallback}</>
    : MapErrorFallback;

  return (
    <ReactErrorBoundary
      FallbackComponent={fallbackComponent}
      // @ts-expect-error
      onError={handleError}
      onReset={() => {
        // Optional: perform any cleanup before retry
        console.log('Resetting map error boundary');
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

/**
 * Hook for handling errors in functional components
 *
 * @param onError - Optional error handler callback
 * @returns Error state and handler functions
 */
export function useMapErrorHandler(onError?: (error: Error) => void) {
  const handleError = (error: Error) => {
    console.error('Map component error:', error);
    onError?.(error);
  };

  return {
    handleError,
  };
}

// Export the ErrorBoundary component for advanced usage
export { ReactErrorBoundary as BaseErrorBoundary };
