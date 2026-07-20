// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "./AuthGate.js";

// App itself is heavy (workspaces/sessions/settings all fetched on mount) and
// already out of scope for this test — AuthGate's own job is deciding
// *whether* to mount it, not what it does once mounted. Stubbing it keeps
// this file focused on the gating logic (issue #19).
vi.mock("./App.js", () => ({
  App: () => <div data-testid="dashboard">dashboard</div>,
}));

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AuthGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the dashboard directly when in-process auth is off (authMode: none)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { authMode: "none", authenticated: true }))),
    );

    render(<AuthGate />);

    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  it("renders the dashboard directly when the session cookie is already valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { authMode: "token", authenticated: true }))),
    );

    render(<AuthGate />);

    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  it("renders a login form instead of the dashboard when auth is on and not yet authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { authMode: "token", authenticated: false }))),
    );

    render(<AuthGate />);

    // "Sign in" itself is ambiguous (both the card's title and its submit
    // button use that text) — the subtitle is unique.
    expect(
      await screen.findByText("This Tessera instance requires an access token."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("shows an inline error and stays on the login form when the token is wrong", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/me" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { authMode: "token", authenticated: false }));
      }
      if (url === "/api/auth/login" && method === "POST") {
        return Promise.resolve(jsonResponse(401, { message: "invalid token" }));
      }
      return Promise.reject(new Error(`unhandled fetch in test: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("Access token"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid token.");
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("proceeds to the dashboard after a successful login", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/me" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { authMode: "token", authenticated: false }));
      }
      if (url === "/api/auth/login" && method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`unhandled fetch in test: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("Access token"), "correct-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });
});
