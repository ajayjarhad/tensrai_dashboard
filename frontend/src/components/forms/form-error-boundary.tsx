import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

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

export function FormErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={FormErrorFallback}
      onError={(error, info) => console.error('Form Error Boundary caught an error:', error, info)}
    >
      {children}
    </ErrorBoundary>
  );
}
