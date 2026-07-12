import { create } from "zustand";
import { api } from "./api.js";
import type { Project, Session, Workspace } from "./api.js";

// Which workspace was last active survives a reload via localStorage (not
// the DB — it's a per-browser UI preference, not shared server state).
const ACTIVE_WORKSPACE_STORAGE_KEY = "crs.activeWorkspaceId";

function readStoredActiveWorkspaceId(): number | null {
  const raw = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

interface DashboardState {
  projects: Project[];
  sessions: Session[];
  workspaces: Workspace[];
  // May reference a workspace that no longer exists (deleted in another
  // tab, or a stale localStorage value) — App.tsx is responsible for
  // falling back to first-available/create-default when that happens.
  activeWorkspaceId: number | null;
  refreshProjects: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  createProject: (name: string, cwd: string) => Promise<Project>;
  deleteProject: (id: number) => Promise<void>;
  createSession: (
    projectId: number,
    command: string,
    name?: string,
  ) => Promise<Session>;
  renameSession: (id: number, name: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (id: number, name: string) => Promise<void>;
  deleteWorkspace: (id: number) => Promise<void>;
  // Fire-and-forget from App.tsx's debounced autosave — deliberately does
  // not refresh the workspaces list afterward (called frequently; the
  // store's own layout copy isn't read by anything that needs it fresh).
  saveWorkspaceLayout: (id: number, layout: Record<string, unknown>) => Promise<void>;
  setActiveWorkspaceId: (id: number | null) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  projects: [],
  sessions: [],
  workspaces: [],
  activeWorkspaceId: readStoredActiveWorkspaceId(),

  refreshProjects: async () => {
    set({ projects: await api.listProjects() });
  },

  refreshSessions: async () => {
    set({ sessions: await api.listSessions() });
  },

  createProject: async (name, cwd) => {
    const project = await api.createProject(name, cwd);
    await get().refreshProjects();
    return project;
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    await Promise.all([get().refreshProjects(), get().refreshSessions()]);
  },

  createSession: async (projectId, command, name) => {
    const session = await api.createSession(projectId, command, name);
    await get().refreshSessions();
    return session;
  },

  renameSession: async (id, name) => {
    await api.renameSession(id, name);
    await get().refreshSessions();
  },

  deleteSession: async (id) => {
    await api.deleteSession(id);
    await get().refreshSessions();
  },

  refreshWorkspaces: async () => {
    set({ workspaces: await api.listWorkspaces() });
  },

  createWorkspace: async (name) => {
    const workspace = await api.createWorkspace(name);
    await get().refreshWorkspaces();
    return workspace;
  },

  renameWorkspace: async (id, name) => {
    await api.renameWorkspace(id, name);
    await get().refreshWorkspaces();
  },

  deleteWorkspace: async (id) => {
    await api.deleteWorkspace(id);
    await get().refreshWorkspaces();
  },

  saveWorkspaceLayout: async (id, layout) => {
    await api.saveWorkspaceLayout(id, layout);
  },

  setActiveWorkspaceId: (id) => {
    set({ activeWorkspaceId: id });
    if (id === null) {
      localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, String(id));
    }
  },
}));
