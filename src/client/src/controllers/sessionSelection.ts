import type { SessionInfo } from "../api";

export interface SessionSelectionMemory {
  latestSessionId(cwd: string): string | undefined;
  rememberSession(session: SessionInfo): void;
  forgetWorkspace(cwd: string): void;
}

export class InMemorySessionSelectionMemory implements SessionSelectionMemory {
  private readonly sessionIdsByCwd = new Map<string, string>();

  latestSessionId(cwd: string): string | undefined {
    return this.sessionIdsByCwd.get(cwd);
  }

  rememberSession(session: SessionInfo): void {
    this.sessionIdsByCwd.set(session.cwd, session.id);
  }

  forgetWorkspace(cwd: string): void {
    this.sessionIdsByCwd.delete(cwd);
  }
}

export function selectPreferredSession(sessions: SessionInfo[], options?: { targetSessionId?: string | undefined; latestSessionId?: string | undefined }): SessionInfo | undefined {
  const targetSessionId = options?.targetSessionId;
  if (targetSessionId !== undefined && targetSessionId !== "") return sessionByIdOrPrefix(sessions, targetSessionId);

  const latestSessionId = options?.latestSessionId;
  if (latestSessionId !== undefined && latestSessionId !== "") return sessions.find((session) => session.id === latestSessionId) ?? sessions.find((session) => session.archived !== true);

  return sessions.find((session) => session.archived !== true);
}

function sessionByIdOrPrefix(sessions: SessionInfo[], sessionId: string): SessionInfo | undefined {
  return sessions.find((session) => session.id === sessionId || session.id.startsWith(sessionId));
}

export type ArchiveSelectionChange =
  | { type: "unchanged" }
  | { type: "select"; session: SessionInfo }
  | { type: "clear" };

export function markSessionArchived(sessions: SessionInfo[], sessionId: string, archivedAt: string): SessionInfo[] {
  return sessions.map((session) => session.id === sessionId ? { ...session, archived: true, archivedAt } : session);
}

export function selectionAfterArchivingSession(sessions: SessionInfo[], selectedSessionId: string | undefined, archivedSessionId: string): ArchiveSelectionChange {
  if (selectedSessionId !== archivedSessionId) return { type: "unchanged" };

  const nextSession = sessions.find((session) => session.id !== archivedSessionId && session.archived !== true);
  return nextSession === undefined ? { type: "clear" } : { type: "select", session: nextSession };
}
