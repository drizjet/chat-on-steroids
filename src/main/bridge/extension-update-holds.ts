// Why the extension has not yet reloaded into the build this app ships — logged once per
// browser and shipped build, again when the reason changes. The hold vocabulary lives here so
// bridge.ts keeps only the request handler that reports it.
import { shippedExtensionBuild } from '../extension-path.js';
import { logInfo } from '../logger.js';

/** Why the extension has not yet reloaded into the build this app ships, in the log's words. */
const EXTENSION_UPDATE_HOLDS: Record<string, string> = {
  'app-busy': 'a tool call is running in this app',
  sending: 'a message is being sent',
  commands: 'a browser command is still pending',
  'chat-busy': 'a ChatGPT tab is still answering',
  'already-tried': 'it already tried this update once; reload it in chrome://extensions',
  'folder-not-ready': 'its folder does not hold the new build yet',
  'browser-updates-itself': 'Firefox updates the signed add-on itself (about:addons → Check for Updates)'
};
/**
 * The hold last logged per browser, for the build this app ships. With two browsers reporting in turn,
 * one shared value made the browser without a hold reset the other's (2.1.39). A report without a hold
 * no longer resets it either: Firefox suspends the add-on between polls, each wake first reported no
 * hold, and the same reason was logged 907 times in 36 hours (VM, 2026-10-21).
 */
const extensionUpdateHoldLogged = new Map<string, { reason: string; build: string | null; at: number }>();
/** The same reason is said again after this long, so a long wait still shows in a recent log. */
const EXTENSION_UPDATE_HOLD_RELOG_MS = 6 * 60 * 60_000;

/** Logs once per browser and shipped build why an offered extension update is waiting, again when the reason changes. */
export function noteExtensionUpdateHold(hold: unknown, browser: string | null = null): void {
  const reason = typeof hold === 'string' && Object.hasOwn(EXTENSION_UPDATE_HOLDS, hold) ? hold : null;
  if (!reason) return;
  const key = browser ?? '';
  const build = shippedExtensionBuild();
  const last = extensionUpdateHoldLogged.get(key);
  const now = Date.now();
  if (last && last.reason === reason && last.build === build && now - last.at < EXTENSION_UPDATE_HOLD_RELOG_MS) return;
  extensionUpdateHoldLogged.delete(key);
  extensionUpdateHoldLogged.set(key, { reason, build, at: now });
  if (extensionUpdateHoldLogged.size > 16) extensionUpdateHoldLogged.delete(extensionUpdateHoldLogged.keys().next().value!);
  logInfo(`bridge: the browser extension waits to update: ${EXTENSION_UPDATE_HOLDS[reason]}`);
}
