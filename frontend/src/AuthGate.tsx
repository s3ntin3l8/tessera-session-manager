import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import { App } from "./App.js";

type GateState = "loading" | "unauthenticated" | "authenticated";

/**
 * Wraps <App/> (the actual dashboard) so its data-fetching effects — which
 * fire unconditionally on mount and would otherwise flood the console with
 * 401s — never run until we know whether a session is required. GET
 * /api/auth/me is the one endpoint reachable regardless of auth state (see
 * src/plugins/auth.ts's own /api/auth/ prefix exemption — a request can't
 * authenticate itself against a gate that also blocks the endpoint that
 * authenticates it), so it's safe to call before anything else mounts.
 *
 * With TESSERA_AUTH_TOKEN unset (the default), authMode is "none" and this
 * renders <App/> immediately — identical to before this feature existed.
 */
export function AuthGate() {
  const [state, setState] = useState<GateState>("loading");

  const checkStatus = () => {
    return api
      .getAuthStatus()
      .then((status) => {
        setState(
          status.authMode === "none" || status.authenticated ? "authenticated" : "unauthenticated",
        );
      })
      .catch(() => {
        // Backend unreachable (not a 401 — request() only throws ApiError
        // for a non-ok response, and a network failure throws something
        // else entirely). Fall through to <App/>, which already has its own
        // "Tessera server unreachable" banner (store.ts's live-refresh
        // poll) — a login screen here would just hide that behind a second,
        // less informative failure mode.
        setState("authenticated");
      });
  };

  useEffect(() => {
    void checkStatus();
  }, []);

  if (state === "loading") return null;
  if (state === "unauthenticated") return <Login onLoggedIn={() => setState("authenticated")} />;
  return <App />;
}

function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Enter your access token.");
      return;
    }
    setSubmitting(true);
    setError(null);
    void api
      .login(trimmed)
      .then(onLoggedIn)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.statusCode === 401
            ? "Invalid token."
            : "Could not sign in.",
        );
        setSubmitting(false);
      });
  };

  return (
    // Reuses CreateHostModal's create-modal-* shell for a consistent look —
    // there's no dashboard mounted behind this to dim, so the backdrop's
    // own centering/padding just becomes this screen's layout.
    <div className="create-modal-backdrop">
      <div className="create-modal">
        <div className="create-modal-header">
          <span className="create-modal-header-text">
            <span className="create-modal-title">Sign in</span>
            <span className="create-modal-subtitle">
              This Tessera instance requires an access token.
            </span>
          </span>
        </div>

        <div className="create-modal-body">
          <label className="create-modal-field">
            <span className="create-modal-field-label">Access token</span>
            <span className="create-modal-input-row">
              <input
                ref={inputRef}
                className="mono"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </span>
          </label>

          {error && (
            <div style={{ fontSize: 12, color: "var(--r)" }} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="create-modal-footer">
          <span className="create-modal-footer-hint">
            Matches this server's TESSERA_AUTH_TOKEN.
          </span>
          <button className="create-modal-submit" onClick={submit} disabled={submitting}>
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
