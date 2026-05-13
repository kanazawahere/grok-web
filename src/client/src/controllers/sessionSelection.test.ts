import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { InMemorySessionSelectionMemory, markSessionArchived, selectPreferredSession, selectionAfterArchivingSession } from "./sessionSelection";

describe("selectPreferredSession", () => {
  it("prefers an explicit target session by id", () => {
    const sessions = [testSession("s1"), testSession("s2")];

    expect(selectPreferredSession(sessions, { targetSessionId: "s2", latestSessionId: "s1" })?.id).toBe("s2");
  });

  it("matches explicit target sessions by id prefix", () => {
    const session = testSession("abcdef");

    expect(selectPreferredSession([session], { targetSessionId: "abc" })).toBe(session);
  });

  it("remembers the latest selected session when no explicit target is provided", () => {
    const sessions = [testSession("s1"), testSession("s2")];

    expect(selectPreferredSession(sessions, { latestSessionId: "s2" })?.id).toBe("s2");
  });

  it("can remember an archived selected session", () => {
    const sessions = [{ ...testSession("s1"), archived: true }, testSession("s2")];

    expect(selectPreferredSession(sessions, { latestSessionId: "s1" })?.id).toBe("s1");
  });

  it("falls back to the first active session when the remembered session no longer exists", () => {
    const sessions = [{ ...testSession("s1"), archived: true }, testSession("s2")];

    expect(selectPreferredSession(sessions, { latestSessionId: "old" })?.id).toBe("s2");
  });

  it("returns undefined for an invalid explicit target", () => {
    const sessions = [testSession("s1"), testSession("s2")];

    expect(selectPreferredSession(sessions, { targetSessionId: "old", latestSessionId: "s2" })).toBeUndefined();
  });
});

describe("InMemorySessionSelectionMemory", () => {
  it("remembers and forgets the latest selected session per cwd", () => {
    const memory = new InMemorySessionSelectionMemory();

    memory.rememberSession({ ...testSession("s1"), cwd: "/tmp/one" });
    memory.rememberSession({ ...testSession("s2"), cwd: "/tmp/two" });

    expect(memory.latestSessionId("/tmp/one")).toBe("s1");
    expect(memory.latestSessionId("/tmp/two")).toBe("s2");

    memory.forgetWorkspace("/tmp/one");

    expect(memory.latestSessionId("/tmp/one")).toBeUndefined();
    expect(memory.latestSessionId("/tmp/two")).toBe("s2");
  });
});

describe("markSessionArchived", () => {
  it("marks the matching session archived without mutating the original", () => {
    const sessions = [testSession("s1"), testSession("s2")];

    const next = markSessionArchived(sessions, "s1", "later");

    expect(next).toEqual([{ ...sessions[0], archived: true, archivedAt: "later" }, sessions[1]]);
    expect(sessions[0]?.archived).toBeUndefined();
  });
});

describe("selectionAfterArchivingSession", () => {
  it("leaves selection unchanged when archiving an unselected session", () => {
    expect(selectionAfterArchivingSession([testSession("s1"), testSession("s2")], "s1", "s2")).toEqual({ type: "unchanged" });
  });

  it("selects the first active session when archiving the selected session", () => {
    const s2 = testSession("s2");

    expect(selectionAfterArchivingSession([testSession("s1"), s2], "s1", "s1")).toEqual({ type: "select", session: s2 });
  });

  it("skips archived sessions when choosing the next selected session", () => {
    const s3 = testSession("s3");

    expect(selectionAfterArchivingSession([testSession("s1"), { ...testSession("s2"), archived: true }, s3], "s1", "s1")).toEqual({ type: "select", session: s3 });
  });

  it("clears selection when no active session remains", () => {
    expect(selectionAfterArchivingSession([testSession("s1")], "s1", "s1")).toEqual({ type: "clear" });
  });
});

function testSession(id: string): SessionInfo {
  return { id, path: `/tmp/project/.pi/sessions/${id}`, cwd: "/tmp/project", created: "now", modified: "now", messageCount: 0, firstMessage: "" };
}
