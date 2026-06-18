'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Dashboard render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
            <p className="font-semibold">Something went wrong rendering this section.</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-3 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
