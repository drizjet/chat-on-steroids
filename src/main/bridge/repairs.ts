// Silence and activity window policy for recovery, moved out of bridge.ts.
//
// What deliberately stays in bridge.ts: the grant map (`activeUntil`), the unattributed-incident
// machinery, repair handouts and the recovery sweep — all of which read sessions, live
// conversations, the command queue and timers. This module holds the windows those decisions
// compare against and the once-per-grant silence log, so a policy change has one home.
import { CHAT_ACTIVE_MS, CHAT_SILENCE_MS } from '../../shared/session.js';
import { logInfo } from '../logger.js';

/** How long a provider access limit with no Retry-After holds the silence watch ("wait a few minutes"). */
export const ACCESS_LIMIT_HOLD_MS = 5 * 60_000;
export const PRO_SILENCE_MS = 10 * 60_000;
export const PRO_ACTIVITY_MS = 10 * 60_000;
/**
 * Silence recovery for a non-Pro turn at `xhigh`, `max` or `ultra` (#786).
 *
 * Longer than Pro's ten minutes on purpose: such a turn can think for more than ten minutes
 * without touching the page, and a reload at Pro's boundary interrupts it. Still bounded, so a
 * genuinely dead page is recovered. It is a silence window only; `model` stays `other`.
 */
export const DELIBERATE_SILENCE_MS = 20 * 60_000;

/** Failure shortens Pro silence; it never counts as new model work. */
export function silenceWindowMs(grant: { model: 'pro' | 'other' | 'unknown'; thinkingFailed?: true; deliberate?: true }): number {
  if (grant.model === 'pro') return grant.thinkingFailed ? 5 * 60_000 : PRO_SILENCE_MS;
  // A turn thinking above high effort is quiet for minutes between tool calls, and two
  // minutes of that used to buy it a reload that killed the stream. See `deliberate`.
  // Thinking failed proves the thinking is over, so it keeps the ordinary window.
  return grant.deliberate && !grant.thinkingFailed ? DELIBERATE_SILENCE_MS : CHAT_SILENCE_MS;
}

/** Display can outlive the silence deadline without granting a browser action. */
export function activityDeadline(grant: { model: 'pro' | 'other' | 'unknown'; evidenceAt: number }): number {
  return grant.evidenceAt + (grant.model === 'pro' ? PRO_ACTIVITY_MS : CHAT_ACTIVE_MS);
}

/**
 * One log line per (chat, turn, session, reason): the silence sweep runs on every tick and its
 * reasons repeat while a chat stays held. The cap keeps a long-lived process bounded.
 */
const silenceNotes = new Set<string>();
export function noteSilence(conversationId: string, grant: { turnId: string | null; sessionId: string }, reason: string): void {
  const key = `${conversationId}:${grant.turnId ?? '-'}:${grant.sessionId}:${reason}`;
  if (silenceNotes.has(key)) return;
  silenceNotes.add(key);
  if (silenceNotes.size > 500) for (const old of [...silenceNotes].slice(0, 100)) silenceNotes.delete(old);
  logInfo(`bridge: silence recovery for ${conversationId} — ${reason}`);
}
