// Resume job vocabulary for Compact & Resume.
//
// These types describe what the page is told while one press of Compact & Resume is in
// flight. They live apart from bridge.ts so the stage mapping (and its exhaustiveness over
// the journal's states) has one home; the bridge keeps only the per-session token cache and
// the job assembly.

import type { ContinuationSendState, ContinuationView } from '../session/continuation.js';

/**
 * One press of Compact & Resume, followed from the press to the fresh chat.
 *
 * The button used to be fire-and-forget, and the browser half guessed when it was done
 * by waiting a second and a half. A real compaction runs for minutes, so the user got an
 * enabled button back long before anything happened, pressed it again, and every press
 * became its own handoff and its own fresh tab — tabs that then arrived minutes later,
 * several at once. The job is the thing the page waits on instead of guessing: one per
 * session, from the press until the fresh chat has actually been opened, failed or been
 * cancelled.
 */
export type ResumeStage =
  /** ChatGPT was asked for the brief and has not finished writing it yet. */
  | 'handoff-pending'
  | 'opening'
  | 'waiting-for-browser'
  | 'done'
  | 'failed';

/**
 * What the page is told about a Compact & Resume in flight.
 *
 * Derived, never stored. The continuation transaction is the state — it knows whether a
 * brief exists, whether a replacement chat has claimed it and whether the move landed — and
 * this reads it, adding only the one thing the transaction cannot know: whether the browser
 * has actually been given the command yet. A job record of its own was a second copy of that
 * state, and the two could disagree about whether a session had moved.
 */
export interface ResumeJobView {
  sessionId: string;
  token: string;
  stage: ResumeStage;
  startedAt: number;
  /** True only for a threshold-triggered ticket; Auto Off may cancel only these. */
  automatic: boolean;
  /** True while the button must stay disabled. */
  busy: boolean;
  handoffId: string | null;
  sourceSend: {
    state: ContinuationSendState;
    messageId: string | null;
  };
  destinationSend: {
    state: ContinuationSendState;
    conversationId: string | null;
    messageId: string | null;
  };
  error: string | null;
}

/** Stages in which the Compact & Resume button must stay disabled. */
export const RUNNING_STAGES: ReadonlySet<ResumeStage> = new Set(['handoff-pending', 'opening', 'waiting-for-browser']);

/** Total over the journal's states: a new ContinuationState must be classified here. */
export function resumeStageOf(entry: ContinuationView, browserWaiting: boolean): ResumeStage {
  switch (entry.state) {
    case 'committed': return 'done';
    case 'aborted': return 'failed';
    case 'awaiting-summary': return 'handoff-pending';
    case 'awaiting-chat':
    case 'claimed':
    case 'committing':
      return browserWaiting ? 'waiting-for-browser' : 'opening';
  }
}
