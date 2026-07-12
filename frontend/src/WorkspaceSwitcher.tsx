import { useState } from "react";
import { useDashboardStore } from "./store.js";
import { ConfirmButton } from "./ConfirmButton.js";
import type { Workspace } from "./api.js";

// Workspaces (named, persistent split-layouts — cmux's own "tab" concept)
// and Projects/Sessions (the folder-grouped inventory of durable terminals
// you pull *into* a workspace) are two orthogonal, independently-scoped
// trees: a session can appear in any number of workspaces' layouts, and a
// workspace's layout can reference sessions from any project. This section
// sits above the Projects tree in the sidebar as the primary "which layout
// am I looking at" navigation, matching that ordering.
export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, createWorkspace, renameWorkspace, deleteWorkspace, setActiveWorkspaceId } =
    useDashboardStore();
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);

  return (
    <div className="workspace-switcher">
      <div className="workspace-switcher-header">
        <h2>Workspaces</h2>
        <button title="New workspace" onClick={() => setShowNewWorkspace((v) => !v)}>
          + Workspace
        </button>
      </div>

      {showNewWorkspace && (
        <NewWorkspaceForm
          onCreated={(workspace) => {
            setShowNewWorkspace(false);
            setActiveWorkspaceId(workspace.id);
          }}
          createWorkspace={createWorkspace}
        />
      )}

      <ul className="workspace-list">
        {workspaces.map((workspace) => (
          <WorkspaceItem
            key={workspace.id}
            workspace={workspace}
            active={workspace.id === activeWorkspaceId}
            onSelect={() => setActiveWorkspaceId(workspace.id)}
            onRename={(name) => void renameWorkspace(workspace.id, name)}
            onDelete={() => {
              // If the active workspace is deleted, App.tsx's own
              // fallback effect picks the next available workspace (or
              // creates a fresh Default if none remain) once the list
              // refreshes — no special-casing needed here.
              void deleteWorkspace(workspace.id);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function WorkspaceItem({
  workspace,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  workspace: Workspace;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);

  if (editing) {
    return (
      <li className="workspace-item">
        <input
          autoFocus
          className="workspace-rename-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draftName.trim()) onRename(draftName.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              setDraftName(workspace.name);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (draftName.trim() && draftName !== workspace.name) onRename(draftName.trim());
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`workspace-item${active ? " active" : ""}`}>
      <button className="workspace-open" onClick={onSelect} onDoubleClick={() => setEditing(true)}>
        {workspace.name}
      </button>
      <ConfirmButton title={`Delete workspace "${workspace.name}"`} onConfirm={onDelete}>
        ×
      </ConfirmButton>
    </li>
  );
}

// An inline form instead of window.prompt() — a native prompt() blocks the
// entire tab (same hazard as window.confirm(), fixed the same way in M3's
// ConfirmButton) until dismissed, freezing our own WS connections along
// with it.
function NewWorkspaceForm({
  onCreated,
  createWorkspace,
}: {
  onCreated: (workspace: Workspace) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
}) {
  const [name, setName] = useState("");

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void createWorkspace(name.trim()).then(onCreated);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="workspace name"
      />
      <button type="submit">Create</button>
    </form>
  );
}
