import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Best-effort owner/repo derivation from a checkout's `origin` remote
// (issue #27) — same "read-only, never throw, missing file is the normal
// case" philosophy as project-config.ts. This is the ONE place in the repo
// that reads .git/config; deliberately a narrow, hand-rolled parse of just
// the `[remote "origin"] url = ...` line rather than a general INI parser
// or a `git remote get-url origin` child_process call — this repo has
// neither a gitconfig-parsing dependency nor any existing git-CLI shell-out
// (project-config.ts's only git awareness is an `existsSync(.git)` check).

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

// SSH form: git@github.com:owner/repo(.git). HTTPS form: (optionally
// user@-prefixed, e.g. a PAT-in-URL remote) https://github.com/owner/repo(.git)(/).
// Neither matches a GitHub Enterprise host, GitLab, Bitbucket, etc. — those
// fall through to null, same as a missing remote (the widget just doesn't
// render; see routes/projects.ts's GET .../github).
const SSH_REMOTE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;
const HTTPS_REMOTE = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

function parseRemoteUrl(url: string): GitHubRepoRef | null {
  const ssh = url.match(SSH_REMOTE);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(HTTPS_REMOTE);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

/**
 * Reads `<cwd>/.git/config` and extracts `[remote "origin"]`'s `url`,
 * returning `{ owner, repo }` for a github.com remote or `null` for
 * anything else — a missing .git/config, no `origin` remote, or a
 * non-github.com host. Never throws: a malformed config is exactly as
 * "no GitHub repo here" as a missing one.
 */
export function parseGitRemote(cwd: string): GitHubRepoRef | null {
  const configPath = path.join(cwd, ".git", "config");
  if (!existsSync(configPath)) return null;

  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch {
    return null;
  }

  // Scoped to exactly this one section/key rather than a full INI parse —
  // matches to the next `[section]` header or end of file.
  const sectionMatch = content.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/);
  if (!sectionMatch) return null;
  const urlMatch = sectionMatch[1].match(/^\s*url\s*=\s*(.+)$/m);
  if (!urlMatch) return null;

  return parseRemoteUrl(urlMatch[1].trim());
}
