import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorId: string;
}

function generateErrorId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorId: '' };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorId = generateErrorId();
    this.setState({ errorId });
    console.error('[ErrorBoundary]', errorId, error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-surface-page px-6"
          data-testid="error-boundary-fallback"
        >
          <div className="w-full max-w-md rounded-xl border border-border-default bg-surface-card p-8 shadow-lg">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-tint">
                <svg
                  className="h-5 w-5 text-danger"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-fg-primary">Something went wrong</h1>
            </div>

            <p className="mb-6 text-sm text-fg-secondary">
              We&apos;re sorry, but an unexpected error has occurred. Please try reloading the page.
            </p>

            <div className="mb-6 rounded-lg bg-surface-sunken px-4 py-3">
              <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider">
                Error ID
              </p>
              <p className="mt-1 font-mono text-sm text-fg-primary">
                {this.state.errorId || generateErrorId()}
              </p>
            </div>

            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-fg-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
