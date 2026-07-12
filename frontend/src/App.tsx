import { useCallback, useEffect, useRef, useState } from "react";
import { DockviewReact } from "dockview-react";
import type { DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Sidebar } from "./Sidebar.js";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";
import { TerminalPane } from "./TerminalPane.js";
import type { TerminalPaneParams } from "./TerminalPane.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { useDashboardStore } from "./store.js";
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

const AUTOSAVE_DEBOUNCE_MS = 800;
const DEFAULT_WORKSPACE_NAME = "Default";

interface PendingSave {
  // Captured at *schedule* time, not read live at fire time — the load-
  // bearing property that keeps a fast A->B workspace switch from writing
  // A's (or a half-formed) layout into B's row, or vice versa. See the
  // flush call in the restore effect below.
  workspaceId: number;
  timer: ReturnType<typeof setTimeout>;
}

export function App() {
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  // Only meaningful below the mobile breakpoint (see styles.css) — a no-op
  // on desktop, where .sidebar-wrapper ignores this class entirely.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

  const {
    workspaces,
    activeWorkspaceId,
    refreshWorkspaces,
    createWorkspace,
    saveWorkspaceLayout,
    setActiveWorkspaceId,
  } = useDashboardStore();

  // Guards against auto-creating "Default" twice — both from React
  // StrictMode's dev-mode double-invoke of effects (refs survive that,
  // state-setters don't re-run the check reliably) and from the fetch race
  // below (workspacesLoaded flips exactly once).
  const bootstrappedRef = useRef(false);
  // True only while a programmatic fromJSON() restore is in flight, so the
  // onDidLayoutChange events it fires aren't mistaken for a real edit and
  // echoed back into an autosave.
  const restoringRef = useRef(false);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  // Which workspace id the grid currently reflects a restore for. Lets the
  // restore effect safely list `workspaces` as a dependency (needed so it
  // retries once the initial fetch resolves, if dockviewApi became ready
  // first and saw an empty list) without re-restoring — and blowing away
  // in-progress edits — every time `workspaces` changes for an unrelated
  // reason (e.g. renaming some other workspace).
  const restoredWorkspaceIdRef = useRef<number | null>(null);

  const flushPendingSave = useCallback(
    (api: DockviewApi) => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingSaveRef.current = null;
      // Read *before* the caller clears/replaces the grid — this is still
      // the outgoing workspace's own layout at this point. The API layer
      // treats layouts as opaque Record<string, unknown> (see api.ts); go
      // through `unknown` since SerializedDockview has no index signature.
      void saveWorkspaceLayout(pending.workspaceId, api.toJSON() as unknown as Record<string, unknown>);
    },
    [saveWorkspaceLayout],
  );

  const scheduleSave = useCallback(
    (api: DockviewApi, workspaceId: number) => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);
      const timer = setTimeout(() => {
        pendingSaveRef.current = null;
        void saveWorkspaceLayout(workspaceId, api.toJSON() as unknown as Record<string, unknown>);
      }, AUTOSAVE_DEBOUNCE_MS);
      pendingSaveRef.current = { workspaceId, timer };
    },
    [saveWorkspaceLayout],
  );

  const onReady = useCallback((event: DockviewReadyEvent) => {
    setDockviewApi(event.api);
  }, []);

  // Load the workspace list exactly once on mount.
  useEffect(() => {
    void refreshWorkspaces().then(() => setWorkspacesLoaded(true));
  }, [refreshWorkspaces]);

  // First-ever load (no workspaces exist at all, anywhere) auto-creates
  // "Default" and selects it. Gated on workspacesLoaded so this can't fire
  // on the pre-fetch render where `workspaces` is still `[]` merely because
  // the request hasn't resolved yet. The ref re-arms itself once the list is
  // non-empty (rather than latching permanently true), so deleting every
  // workspace later — e.g. via the sidebar's own delete button — still
  // recovers a fresh "Default" instead of leaving the app with zero
  // workspaces and a dead activeWorkspaceId pointing nowhere.
  useEffect(() => {
    if (!workspacesLoaded) return;
    if (workspaces.length > 0) {
      bootstrappedRef.current = false;
      return;
    }
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void createWorkspace(DEFAULT_WORKSPACE_NAME).then((workspace) => {
      setActiveWorkspaceId(workspace.id);
    });
  }, [workspacesLoaded, workspaces.length, createWorkspace, setActiveWorkspaceId]);

  // If activeWorkspaceId (persisted in localStorage) points at a workspace
  // that no longer exists — deleted, or a stale value from a previous
  // install — fall back to the first available one.
  useEffect(() => {
    if (workspaces.length === 0) return;
    const stillExists = workspaces.some((w) => w.id === activeWorkspaceId);
    if (!stillExists) setActiveWorkspaceId(workspaces[0].id);
  }, [workspaces, activeWorkspaceId, setActiveWorkspaceId]);

  // Restore the active workspace's saved layout whenever it changes
  // (including the first time dockview itself becomes ready). `workspaces`
  // is deliberately in the dependency array — dockviewApi frequently becomes
  // ready before the initial refreshWorkspaces() fetch resolves, and without
  // it this effect would see an empty list, bail out once, and never get a
  // second chance to run once the real data arrived. The
  // restoredWorkspaceIdRef guard is what keeps that from also re-restoring
  // (and fighting in-progress edits) on every unrelated `workspaces` refetch,
  // e.g. after renaming some other workspace.
  useEffect(() => {
    if (!dockviewApi || activeWorkspaceId === null) return;
    if (restoredWorkspaceIdRef.current === activeWorkspaceId) return;
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!workspace) return;

    // Flush the OUTGOING workspace's pending autosave synchronously before
    // tearing down its layout below.
    flushPendingSave(dockviewApi);

    restoringRef.current = true;
    try {
      dockviewApi.clear();
      if (workspace.layout) {
        dockviewApi.fromJSON(
          workspace.layout as unknown as Parameters<DockviewApi["fromJSON"]>[0],
        );
      }
    } catch (err) {
      // A corrupt or version-incompatible layout blob must never brick the
      // whole dashboard — this runs outside any panel's own ErrorBoundary,
      // since it's not inside a panel at all. Fall back to an empty grid.
      console.error("[workspace] failed to restore layout, resetting to empty grid", err);
      dockviewApi.clear();
    } finally {
      // fromJSON can fire onDidLayoutChange asynchronously for some panel
      // mount events — give it a tick before re-arming autosave so the
      // restore itself is never echoed back as a save.
      setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    }
    restoredWorkspaceIdRef.current = activeWorkspaceId;
  }, [dockviewApi, activeWorkspaceId, workspaces, flushPendingSave]);

  // Any real layout change (add/remove/move panel, or a splitter-drag
  // resize) schedules a debounced autosave, unless it's the restore
  // effect's own echo.
  useEffect(() => {
    if (!dockviewApi || activeWorkspaceId === null) return;
    const workspaceId = activeWorkspaceId;
    const disposable = dockviewApi.onDidLayoutChange(() => {
      if (restoringRef.current) return;
      scheduleSave(dockviewApi, workspaceId);
    });
    return () => disposable.dispose();
  }, [dockviewApi, activeWorkspaceId, scheduleSave]);

  const onOpenSession = useCallback(
    (session: Session) => {
      if (!dockviewApi) return;
      const panelId = `session-${session.id}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
      } else {
        dockviewApi.addPanel({
          id: panelId,
          component: "terminal",
          title: session.name || session.command,
          params: { sessionId: session.id },
        });
      }
      setSidebarOpen(false);
    },
    [dockviewApi],
  );

  // A session ended via the sidebar's explicit "end session" action (as
  // opposed to just closing its panel, which only detaches) should also
  // close its panel if one happens to be open — otherwise the pane is left
  // showing a terminal for a program that no longer exists.
  const onSessionEnded = useCallback(
    (session: Session) => {
      dockviewApi?.getPanel(`session-${session.id}`)?.api.close();
    },
    [dockviewApi],
  );

  return (
    <div className="app">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}>
        ☰
      </button>
      <div className={`sidebar-wrapper${sidebarOpen ? " open" : ""}`}>
        <WorkspaceSwitcher />
        <Sidebar onOpenSession={onOpenSession} onSessionEnded={onSessionEnded} />
      </div>
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
