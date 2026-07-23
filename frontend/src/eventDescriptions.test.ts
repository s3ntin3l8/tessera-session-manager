import { describe, it, expect } from "vitest";
import { describeEvent, describeLatestEvent, notifyKind } from "./eventDescriptions.js";
import type { NotificationEvent } from "./api.js";

function makeEvent(overrides: Partial<NotificationEvent>): NotificationEvent {
  return {
    seq: 1,
    sessionId: 1,
    kind: "attention",
    ts: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe("eventDescriptions (Phase 2, issue #176)", () => {
  describe("describeEvent — hookNotification signal", () => {
    it("shows title and body when both present", () => {
      const event = makeEvent({
        kind: "attention",
        payload: {
          attention: true,
          signal: "hookNotification",
          title: "Build done",
          body: "0 errors",
        },
      });
      expect(describeEvent(event)).toEqual({ text: "Build done — 0 errors", attention: true });
    });

    it("falls back to title alone when body is missing", () => {
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "hookNotification", title: "Build done" },
      });
      expect(describeEvent(event)).toEqual({ text: "Build done", attention: true });
    });

    it("falls back to a generic message when neither is present", () => {
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "hookNotification" },
      });
      expect(describeEvent(event)).toEqual({ text: "Sent a notification", attention: true });
    });

    it("falls back to a generic message for an empty-string title, not blank text", () => {
      // Regression test: `title ?? fallback` would NOT fall back here since
      // "" is non-null/non-undefined — only `title || fallback` catches it.
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "hookNotification", title: "" },
      });
      expect(describeEvent(event)).toEqual({ text: "Sent a notification", attention: true });
    });
  });

  describe("describeEvent — reviewGate signal (the attention-flip half)", () => {
    it("shows the prompt when present", () => {
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "reviewGate", prompt: "Run rm -rf?" },
      });
      expect(describeEvent(event)).toEqual({
        text: "Waiting for review: Run rm -rf?",
        attention: true,
      });
    });

    it("falls back to a generic message with no prompt", () => {
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "reviewGate" },
      });
      expect(describeEvent(event)).toEqual({ text: "Waiting for review", attention: true });
    });
  });

  describe("describeEvent — status_change progress phase", () => {
    it("describes a hook progress phase", () => {
      const event = makeEvent({ kind: "status_change", payload: { phase: "thinking" } });
      expect(describeEvent(event)).toEqual({ text: "Agent: thinking", attention: false });
    });
  });

  describe("describeEvent — file_change", () => {
    it.each([
      ["modify", "Changed"],
      ["create", "Created"],
      ["delete", "Deleted"],
    ] as const)("describes action %s as %s", (action, verb) => {
      const event = makeEvent({
        kind: "file_change",
        payload: { path: "src/index.ts", action },
      });
      expect(describeEvent(event)).toEqual({
        text: `${verb} src/index.ts`,
        attention: false,
      });
    });

    it("returns null when path is missing (future/malformed payload)", () => {
      const event = makeEvent({ kind: "file_change", payload: { action: "modify" } });
      expect(describeEvent(event)).toBeNull();
    });
  });

  describe("describeEvent — review_gate", () => {
    it("describes state waiting as attention-worthy, with the prompt", () => {
      const event = makeEvent({
        kind: "review_gate",
        payload: { state: "waiting", prompt: "Deploy to prod?" },
      });
      expect(describeEvent(event)).toEqual({
        text: "Waiting for review: Deploy to prod?",
        attention: true,
      });
    });

    it("describes state approved as resolved, not attention-worthy", () => {
      const event = makeEvent({ kind: "review_gate", payload: { state: "approved", prompt: "x" } });
      expect(describeEvent(event)).toEqual({ text: "Review approved", attention: false });
    });

    it("describes state denied as resolved, not attention-worthy", () => {
      const event = makeEvent({ kind: "review_gate", payload: { state: "denied", prompt: "x" } });
      expect(describeEvent(event)).toEqual({ text: "Review denied", attention: false });
    });
  });

  describe("describeLatestEvent — walks back through Phase 2 kinds too", () => {
    it("prefers the newest describable event across mixed kinds", () => {
      const events: NotificationEvent[] = [
        makeEvent({ seq: 1, kind: "file_change", payload: { path: "a.ts", action: "modify" } }),
        makeEvent({
          seq: 2,
          kind: "review_gate",
          payload: { state: "waiting", prompt: "Merge?" },
        }),
      ];
      expect(describeLatestEvent(events)).toEqual({
        text: "Waiting for review: Merge?",
        attention: true,
      });
    });
  });

  describe("notifyKind", () => {
    it("counts review_gate waiting as notification-worthy (attention)", () => {
      const event = makeEvent({ kind: "review_gate", payload: { state: "waiting", prompt: "x" } });
      expect(notifyKind(event)).toBe("attention");
    });

    it("does not count review_gate approved/denied as notification-worthy", () => {
      expect(
        notifyKind(makeEvent({ kind: "review_gate", payload: { state: "approved", prompt: "x" } })),
      ).toBeNull();
      expect(
        notifyKind(makeEvent({ kind: "review_gate", payload: { state: "denied", prompt: "x" } })),
      ).toBeNull();
    });

    it("does not count file_change as notification-worthy (routine, like title_change)", () => {
      const event = makeEvent({
        kind: "file_change",
        payload: { path: "a.ts", action: "modify" },
      });
      expect(notifyKind(event)).toBeNull();
    });

    it("counts a hook notification (kind attention, payload.attention true) as notification-worthy", () => {
      const event = makeEvent({
        kind: "attention",
        payload: { attention: true, signal: "hookNotification", title: "x", body: "y" },
      });
      expect(notifyKind(event)).toBe("attention");
    });
  });
});
