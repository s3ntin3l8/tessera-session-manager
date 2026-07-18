import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubApiError, getRepoStatus } from "../../src/services/github.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const ISSUE = {
  number: 27,
  title: "GitHub integration",
  html_url: "https://github.com/o/r/issues/27",
  user: { login: "s3ntin3l8" },
};
const PR = {
  number: 38,
  title: "add credential storage",
  html_url: "https://github.com/o/r/pull/38",
  user: { login: "s3ntin3l8" },
  pull_request: {},
};

describe("getRepoStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("splits issues API entries into issues vs. PRs by the pull_request field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [ISSUE, PR]));
    // Unique owner/repo per test — getRepoStatus's cache is module-level
    // (shared across tests in this file), so a repeated "o/r" key would
    // read a previous test's cached result instead of hitting the mock.
    const status = await getRepoStatus("tok", "split-owner", "split-repo");
    expect(status.openIssues).toBe(1);
    expect(status.openPRs).toBe(1);
    expect(status.issues).toEqual([
      { number: 27, title: "GitHub integration", htmlUrl: ISSUE.html_url, author: "s3ntin3l8" },
    ]);
    expect(status.pulls).toEqual([
      { number: 38, title: "add credential storage", htmlUrl: PR.html_url, author: "s3ntin3l8" },
    ]);
    expect(status.repo).toEqual({
      owner: "split-owner",
      repo: "split-repo",
      htmlUrl: "https://github.com/split-owner/split-repo",
    });
  });

  it("sends a bearer token, User-Agent, and Accept header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await getRepoStatus("my-token", "auth-owner", "auth-repo");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/auth-owner/auth-repo/issues?state=open&per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
          "User-Agent": expect.any(String),
          Accept: expect.any(String),
        }),
      }),
    );
  });

  it("caches within the TTL window without a second fetch", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [ISSUE]));
    await getRepoStatus("tok", "cache-owner", "cache-repo");
    await getRepoStatus("tok", "cache-owner", "cache-repo");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws GitHubApiError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: "Not Found" }));
    await expect(getRepoStatus("tok", "missing-owner", "missing-repo")).rejects.toThrow(
      GitHubApiError,
    );
  });

  it("throws GitHubApiError when the network request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(getRepoStatus("tok", "unreachable-owner", "unreachable-repo")).rejects.toThrow(
      GitHubApiError,
    );
  });
});
