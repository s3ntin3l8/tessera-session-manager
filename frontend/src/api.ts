export interface Project {
  id: number;
  name: string;
  cwd: string;
  createdAt: string;
}

export interface Session {
  id: number;
  projectId: number;
  name: string | null;
  command: string;
  status: "active" | "killed";
  createdAt: string;
  lastAttachedAt: string | null;
  alive: boolean;
  subscriberCount: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // Only set this when there's actually a body — sending it on bodyless
    // requests (GET, DELETE) is invalid and some fetch layers reject it outright.
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${path} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),

  createProject: (name: string, cwd: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, cwd }),
    }),

  deleteProject: (id: number) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  listSessions: (projectId?: number) =>
    request<Session[]>(
      projectId ? `/api/sessions?projectId=${projectId}` : "/api/sessions",
    ),

  createSession: (projectId: number, command: string, name?: string) =>
    request<Session>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId, command, name }),
    }),

  renameSession: (id: number, name: string) =>
    request<Session>(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteSession: (id: number) =>
    request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
};
