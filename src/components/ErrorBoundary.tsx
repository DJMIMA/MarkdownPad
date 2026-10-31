import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Shows a message instead of a blank window when rendering fails. Reloading
 * offers this window's unsaved text again from its recovery snapshot.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MarkdownPad crashed while rendering", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="crash-screen" role="alert">
        <h1>表示中に問題が発生しました</h1>
        <p>
          再読み込みすると、保存されていない内容を復元できます。
        </p>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }
}
