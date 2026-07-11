import { useCallback, useRef } from "react";
import { DockviewReact } from "dockview-react";
import type { DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Sidebar } from "./Sidebar.js";
import { TerminalPane } from "./TerminalPane.js";
import type { TerminalPaneParams } from "./TerminalPane.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import type { Session } from "./api.js";

// Wrapped per-panel (not once around the whole dockview area) so a crash in
// one session's terminal can't take out sibling panes too.
const components = {
  terminal: (props: IDockviewPanelProps<TerminalPaneParams>) => (
    <ErrorBoundary>
      <TerminalPane {...props} />
    </ErrorBoundary>
  ),
};

export function App() {
  const dockviewApi = useRef<DockviewApi | null>(null);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    dockviewApi.current = event.api;
  }, []);

  const onOpenSession = useCallback((session: Session) => {
    const api = dockviewApi.current;
    if (!api) return;

    const panelId = `session-${session.id}`;
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }

    api.addPanel({
      id: panelId,
      component: "terminal",
      title: session.name || session.command,
      params: { sessionId: session.id },
    });
  }, []);

  // A session ended via the sidebar's explicit "end session" action (as
  // opposed to just closing its panel, which only detaches) should also
  // close its panel if one happens to be open — otherwise the pane is left
  // showing a terminal for a program that no longer exists.
  const onSessionEnded = useCallback((session: Session) => {
    dockviewApi.current?.getPanel(`session-${session.id}`)?.api.close();
  }, []);

  return (
    <div className="app">
      <Sidebar onOpenSession={onOpenSession} onSessionEnded={onSessionEnded} />
      <div className="dockview-container">
        <DockviewReact
          className="dockview-theme-dark"
          components={components}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
