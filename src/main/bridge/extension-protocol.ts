// Extension version, build and announcement bookkeeping, carved out of bridge.ts.
//
// What stays in bridge.ts deliberately: browser presence and Setup evidence (the server, the
// wake channel, the chosen browser and the persisted proof) and the protocol/log lines. This
// module owns only the small structures those decisions read and write — the version map per
// browser, the announced (version, build) pairs and the last-seen build stamps — so the
// bookkeeping has one home and the routes never reach into bridge state for it.
import type { IncomingMessage } from 'node:http';
import { isNewer } from '../../shared/types.js';

export const EXTENSION_ANNOUNCE_MS = 30 * 60_000;
export const STALE_COMPANION_WINDOW_MS = 60_000;

/**
 * The extension version each browser last reported, by its browser id (the CoS browser and a
 * peer without an id share one entry each). Two browsers may run different versions - Firefox
 * updates its add-on on its own schedule - and one shared value followed whichever asked last.
 */
const extensionVersions = new Map<string, { version: string; engine?: 'gecko'; seenAt: number }>();
/**
 * When each (version, build) pair was last announced. Two browsers with the extension installed
 * alternate requests, and a single "current" pair would turn every alternation into a fresh
 * "connected" line, a repeated mismatch warning and a renderer push: measured 2026-09-26, a
 * normal and a debugging Chrome on different builds wrote ~80 of each per minute for an hour.
 */
const announcedExtensions = new Map<string, number>();
/** When each extension build last made a request, to tell a stale companion from a lone one. */
const extensionBuildSeenAt = new Map<string, number>();

/** The `x-extension-build` stamp of a request, or null when it is absent or malformed. */
export function extensionBuildOf(req: IncomingMessage): string | null {
  const build = req.headers['x-extension-build'];
  return typeof build === 'string' && /^[0-9a-f]{12}$/.test(build) ? build : null;
}

/** When this build last made a request, for the stale-companion window; undefined if unseen. */
export function buildSeenAt(build: string): number | undefined {
  return extensionBuildSeenAt.get(build);
}

export function noteExtensionBuild(stamp: string): void {
  extensionBuildSeenAt.delete(stamp);
  extensionBuildSeenAt.set(stamp, Date.now());
  if (extensionBuildSeenAt.size > 16) extensionBuildSeenAt.delete(extensionBuildSeenAt.keys().next().value!);
}

/**
 * The version the app reports: the oldest among browsers heard from recently, so an outdated copy
 * keeps its notice while a current one polls too. With none recent, the last one heard from: a
 * mismatched companion can fail the protocol gate before it ever counts as present.
 */
export function reportedExtension(presentMs: number): { version: string; engine?: 'gecko' } | null {
  const now = Date.now();
  let oldest: { version: string; engine?: 'gecko'; seenAt: number } | null = null;
  let latest: { version: string; engine?: 'gecko'; seenAt: number } | null = null;
  for (const entry of extensionVersions.values()) {
    if (!latest || entry.seenAt >= latest.seenAt) latest = entry;
    if (now - entry.seenAt < presentMs && (!oldest || isNewer(oldest.version, entry.version))) oldest = entry;
  }
  const chosen = oldest ?? latest;
  return chosen && { version: chosen.version, ...(chosen.engine ? { engine: chosen.engine } : {}) };
}

/**
 * Records one browser's version and reports whether the app-visible version changed.
 * The caller keeps presence, warnings and renderer pushes; this only updates the map.
 */
export function recordExtensionVersion(
  source: string,
  entry: { version: string; engine?: 'gecko'; seenAt: number },
  presentMs: number
): boolean {
  const before = reportedExtension(presentMs);
  extensionVersions.delete(source);
  extensionVersions.set(source, entry);
  if (extensionVersions.size > 16) extensionVersions.delete(extensionVersions.keys().next().value!);
  const after = reportedExtension(presentMs);
  return before?.version !== after?.version || before?.engine !== after?.engine;
}

/** Every recorded sighting time, for the presence-expiry timer. */
export function versionSeenTimes(): number[] {
  return [...extensionVersions.values()].map(entry => entry.seenAt);
}

/** True when this (version, build) pair should be announced now; records the announcement. */
export function extensionAnnounceDue(version: string, stamp: string | null): boolean {
  const key = `${version}\u0000${stamp ?? ''}`;
  const announcedAt = announcedExtensions.get(key);
  if (announcedAt !== undefined && Date.now() - announcedAt < EXTENSION_ANNOUNCE_MS) return false;
  announcedExtensions.delete(key);
  announcedExtensions.set(key, Date.now());
  if (announcedExtensions.size > 16) announcedExtensions.delete(announcedExtensions.keys().next().value!);
  return true;
}

/** Test seam: bridge.ts's reset clears all three structures too. */
export function clearExtensionProtocolState(): void {
  extensionVersions.clear();
  announcedExtensions.clear();
  extensionBuildSeenAt.clear();
}
