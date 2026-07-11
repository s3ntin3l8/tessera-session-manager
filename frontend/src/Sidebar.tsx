import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useDashboardStore } from "./store.js";
import type { Project, Session } from "./api.js";

// A native window.confirm() blocks the entire tab (including our own WS
// connections and any automated testing) until dismissed, and looks jarring
// against the app's own dark theme — an in-app "click again to confirm"
// pattern avoids both. Auto-disarms after a few seconds so a stray second
// click well after the fact can't fire it by surprise.
function ConfirmButton({
  onConfirm,
  title,
  children,
}: {
  onConfirm: () => void;
  title: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      className={`danger${armed ? " armed" : ""}`}
      title={armed ? "Click again to confirm" : title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? "confirm?" : children}
    </button>
  );
}

interface SidebarProps {
  onOpenSession: (session: Session) => void;
  onSessionEnded: (session: Session) => void;
}

export function Sidebar({ onOpenSession, onSessionEnded }: SidebarProps) {
  const { projects, sessions, refreshProjects, refreshSessions } = useDashboardStore();

  useEffect(() => {
    void refreshProjects();
    void refreshSessions();
  }, [refreshProjects, refreshSessions]);

  return (
    <div className="sidebar">
      <h2>Projects</h2>
      {projects.map((project) => (
        <ProjectSection
          key={project.id}
          project={project}
          sessions={sessions.filter((s) => s.projectId === project.id)}
          onOpenSession={onOpenSession}
          onSessionEnded={onSessionEnded}
        />
      ))}
      <NewProjectForm />
    </div>
  );
}

function ProjectSection({
  project,
  sessions,
  onOpenSession,
  onSessionEnded,
}: {
  project: Project;
  sessions: Session[];
  onOpenSession: (session: Session) => void;
  onSessionEnded: (session: Session) => void;
}) {
  const { deleteProject, deleteSession } = useDashboardStore();
  const [showNewSession, setShowNewSession] = useState(false);

  return (
    <div className="project-section">
      <div className="project-header">
        <span className="project-name" title={project.cwd}>
          {project.name}
        </span>
        <button onClick={() => setShowNewSession((v) => !v)}>+ Session</button>
        <ConfirmButton
          title={`Delete project "${project.name}" and all its sessions`}
          onConfirm={() => {
            const endedSessions = sessions;
            void deleteProject(project.id).then(() => {
              endedSessions.forEach(onSessionEnded);
            });
          }}
        >
          ×
        </ConfirmButton>
      </div>

      {showNewSession && (
        <NewSessionForm
          projectId={project.id}
          onCreated={(session) => {
            setShowNewSession(false);
            onOpenSession(session);
          }}
        />
      )}

      <ul className="session-list">
        {sessions
          .filter((s) => s.status === "active")
          .map((session) => (
            <li key={session.id} className="session-item">
              <span
                className={`status-dot ${session.alive ? "alive" : "detached"}`}
                title={session.alive ? "attached" : "detached (still running)"}
              />
              <button className="session-open" onClick={() => onOpenSession(session)}>
                {session.name || session.command}
              </button>
              <ConfirmButton
                title="End this session (the program will be terminated)"
                onConfirm={() => {
                  void deleteSession(session.id).then(() => onSessionEnded(session));
                }}
              >
                ×
              </ConfirmButton>
            </li>
          ))}
      </ul>
    </div>
  );
}

function NewSessionForm({
  projectId,
  onCreated,
}: {
  projectId: number;
  onCreated: (session: Session) => void;
}) {
  const { createSession } = useDashboardStore();
  const [command, setCommand] = useState("bash");
  const [name, setName] = useState("");

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void createSession(projectId, command, name || undefined).then(onCreated);
      }}
    >
      <input
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="command (bash, claude, codex, ...)"
      />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name (optional)" />
      <button type="submit">Launch</button>
    </form>
  );
}

function NewProjectForm() {
  const { createProject } = useDashboardStore();
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");

  return (
    <form
      className="inline-form new-project"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !cwd) return;
        void createProject(name, cwd).then(() => {
          setName("");
          setCwd("");
        });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="project name" />
      <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/project" />
      <button type="submit">+ Project</button>
    </form>
  );
}
