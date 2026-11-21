import React, { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForNewBuild } from '../lib/chunk-reload';
import { Link } from 'react-router';
import { CopyDiagnosticsButton } from './CopyDiagnosticsButton';
import { AlertCircleIcon } from './icons';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // A chunk from the previous build is gone after a deploy: load the new build once.
    if (isChunkLoadError(error) && reloadOnceForNewBuild()) return;
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        'Unhandled React Error in ErrorBoundary:',
        error,
        errorInfo,
      );
    }
  }

  handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const pathname =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const diagData = {
        route: pathname,
        errorCode: 'UNHANDLED_REACT_ERROR',
        errorMessage: this.state.error?.message ?? 'Unknown runtime error',
        extra: {
          errorName: this.state.error?.name,
          errorStack: this.state.error?.stack?.slice(0, 500),
        },
      };

      return (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="error-boundary-card"
          className="mx-auto my-12 max-w-xl px-4 text-center sm:px-6"
        >
          <div className="rounded-card border border-hairline bg-surface-1 p-6 shadow-elev-card">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger mb-4">
              <AlertCircleIcon className="size-6" />
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
              Something went wrong
            </h1>

            <p className="mt-2 text-xs text-text-muted leading-relaxed sm:text-sm">
              An unexpected error occurred while rendering this view. You can
              copy diagnostic details to help troubleshoot or reload the page.
            </p>

            {this.state.error && (
              <div className="mt-4 rounded-well border border-hairline bg-surface-2 p-3 text-left font-mono text-xs text-danger break-words">
                {this.state.error.message}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-pill bg-olive px-4 py-2 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer"
              >
                Reload Page
              </button>

              <Link
                to="/"
                onClick={this.handleReset}
                className="rounded-pill border border-hairline bg-surface-2 px-4 py-2 text-xs font-semibold text-text hover:bg-surface-3 transition-colors"
              >
                ← Back to Swap
              </Link>

              <CopyDiagnosticsButton data={diagData} />
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
