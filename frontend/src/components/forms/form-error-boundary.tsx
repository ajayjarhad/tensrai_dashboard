/**
 * Form Error Boundary
 * Functional error boundary for form components using react-error-boundary
 */

import type { ReactNode } from 'react';
import { type FallbackProps, ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

interface FormErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}

/**
 * Default form error fallback component
 */
function FormErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-destructive" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-destructive">Something went wrong</h3>
          <div className="mt-2 text-sm text-destructive/80">
            <p>There was an error with this form. Please refresh the page and try again.</p>
            {error && <p className="mt-1 text-xs text-destructive/60">Error: {error.message}</p>}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={resetErrorBoundary}
              className="text-sm text-destructive underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Form Error Boundary Component
 *
 * @param props - Component props
 * @param props.children - Child components to wrap
 * @param props.fallback - Optional custom fallback component
 * @param props.onError - Optional error handler callback
 */
export function FormErrorBoundary({ children, fallback, onError }: FormErrorBoundaryProps) {
  const handleError = (error: Error, info: { componentStack: string }) => {
    console.error('Form Error Boundary caught an error:', error, info);
    onError?.(error, info);
  };

  const fallbackComponent = fallback ? () => <>{fallback}</> : FormErrorFallback;

  return (
    <ReactErrorBoundary
      FallbackComponent={fallbackComponent}
      // @ts-expect-error
      onError={handleError}
      onReset={() => {
        // Optional: perform any cleanup before retry
        console.log('Resetting form error boundary');
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

/**
 * Hook for handling form errors in functional components
 *
 * @param onError - Optional error handler callback
 * @returns Error state and handler functions
 */
export function useFormErrorHandler(onError?: (error: Error) => void) {
  const handleError = (error: Error) => {
    console.error('Form component error:', error);
    onError?.(error);
  };

  return {
    handleError,
  };
}

// Export the ErrorBoundary component for advanced usage
export { ReactErrorBoundary as BaseFormErrorBoundary };
