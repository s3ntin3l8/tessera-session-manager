import { create } from "zustand";
import { api } from "./api.js";
import type { Project, Session } from "./api.js";

interface DashboardState {
  projects: Project[];
  sessions: Session[];
  refreshProjects: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  createProject: (name: string, cwd: string) => Promise<Project>;
  deleteProject: (id: number) => Promise<void>;
  createSession: (
    projectId: number,
    command: string,
    name?: string,
  ) => Promise<Session>;
  renameSession: (id: number, name: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  projects: [],
  sessions: [],

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
}));
