// Resume jobs: the per-session token cache and the job view the page polls.
//
// The stage vocabulary lives beside this file in resume-stage.ts; this module owns the small
// amount of state the bridge cannot derive (which token a session last opened) and assembles
// the view from the journal entry plus the browser-waiting boolean.

import type { ContinuationView } from '../session/continuation.js';
import { RUNNING_STAGES, resumeStageOf, type ResumeJobView } from './resume-stage.js';

export interface ResumeJobDeps {
  /** The journal entry for a token this bridge opened, if the journal still holds it. */
  continuationByToken(token: string): ContinuationView | null;
  /** The open transaction for a session, for pages that never saw the token. */
  continuationForSession(sessionId: string): ContinuationView | null;
  /** True while a claimed resume command has not been handed to the browser yet. */
  browserWaiting(sessionId: string): boolean;
}

export interface ResumeJobs {
  remember(sessionId: string, token: string): void;
  tokenFor(sessionId: string): string | undefined;
  forSession(sessionId: string): ResumeJobView | null;
  clear(): void;
}

/**
 * The token of the last continuation opened for a session.
 *
 * The transaction itself is the state; this is only how the bridge finds it again, and it is
 * how a *finished* one can still be reported once — `continuationForSession` answers about
 * open transactions only, which is right for everything that acts on one, but a page polling
 * every two seconds still has to be told "that finished" rather than "there is nothing".
 */
export function createResumeJobs(deps: ResumeJobDeps): ResumeJobs {
  const sessionTokens = new Map<string, string>();

  function remember(sessionId: string, token: string): void {
    sessionTokens.set(sessionId, token);
    if (sessionTokens.size > 50) {
      const oldest = sessionTokens.keys().next();
      if (!oldest.done) sessionTokens.delete(oldest.value);
    }
  }

  /** The job for a session, if there is one worth telling the page about. */
  function forSession(sessionId: string): ResumeJobView | null {
    const token = sessionTokens.get(sessionId);
    const entry = (token ? deps.continuationByToken(token) : null) ?? deps.continuationForSession(sessionId);
    if (!entry) return null;
    const stage = resumeStageOf(entry, deps.browserWaiting(sessionId));
    return {
      sessionId,
      token: entry.token,
      stage,
      startedAt: entry.openedAt,
      automatic: entry.automatic,
      busy: RUNNING_STAGES.has(stage),
      handoffId: entry.handoffId,
      sourceSend: entry.sourceSend,
      destinationSend: entry.destinationSend,
      error: entry.error
    };
  }

  return {
    remember,
    tokenFor: (sessionId: string) => sessionTokens.get(sessionId),
    forSession,
    clear: () => sessionTokens.clear()
  };
}
