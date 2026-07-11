import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// A crash inside one terminal pane (a WS/xterm bug, an unsupported addon
// option, whatever) shouldn't blank the entire dashboard, sidebar included —
// this is scoped around the dockview area alone so the rest of the app
// (project list, other already-open panes) stays usable.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[error-boundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#e88" }}>
          Something went wrong rendering this panel: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
