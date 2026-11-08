// Sanitised companion diagnostics: the untrusted payload the extension reports after pairing,
// kept typed and bounded before anything stores or shows it. Pure functions only; the record of
// the latest report and its waiters stay in bridge.ts.

import type {
  CompanionDiagnostics,
  CompanionEnvironment,
  CompanionPageDiagnostics,
  CompanionTabDiagnostics,
  CompanionTraceEntry
} from '../shared/types.js';

export function diagnosticObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function diagnosticString(value: unknown, max = 512): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

export function diagnosticNumber(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
}

function diagnosticNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function diagnosticTrace(value: unknown): CompanionTraceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((entry) => {
    const row = diagnosticObject(entry);
    const requestId = diagnosticString(row?.requestId, 160);
    if (!row || !requestId) return [];
    return [{
      requestId,
      read: row.read === true,
      sent: row.sent === true,
      confirmed: row.confirmed === true,
      app: diagnosticString(row.app, 80),
      tool: diagnosticString(row.tool, 160)
    }];
  });
}

function diagnosticPage(value: unknown): CompanionPageDiagnostics | null {
  const page = diagnosticObject(value);
  if (!page) return null;
  const lastError = diagnosticObject(page.lastError);
  return {
    recorderVersion: diagnosticNullableNumber(page.recorderVersion),
    runId: diagnosticString(page.runId, 160),
    conversationId: diagnosticString(page.conversationId, 200),
    generating: page.generating === true,
    turnId: diagnosticString(page.turnId, 200),
    generations: diagnosticNumber(page.generations, 1_000_000),
    queued: diagnosticNumber(page.queued, 1_000_000),
    queueBytes: diagnosticNumber(page.queueBytes, 64 * 1024 * 1024),
    requestId: diagnosticString(page.requestId, 160),
    trace: diagnosticTrace(page.trace),
    overwrite: page.overwrite === true,
    painted: page.painted === true,
    events: diagnosticNumber(page.events, 10_000_000),
    calls: diagnosticNumber(page.calls, 10_000_000),
    sends: diagnosticNumber(page.sends, 10_000_000),
    failures: diagnosticNumber(page.failures, 10_000_000),
    session: diagnosticString(page.session, 160),
    lastError: lastError && typeof lastError.at === 'number' && Number.isFinite(lastError.at)
      ? { at: lastError.at, text: diagnosticString(lastError.text, 500) ?? '' }
      : null,
    blocked: diagnosticString(page.blocked, 160)
  };
}

function diagnosticTab(value: unknown): CompanionTabDiagnostics | null {
  const tab = diagnosticObject(value);
  if (!tab) return null;
  const delivery = diagnosticObject(tab.delivery);
  return {
    tab: diagnosticNullableNumber(tab.tab),
    isChat: tab.isChat === true,
    conversationId: diagnosticString(tab.conversationId, 200),
    bound: tab.bound === true,
    epoch: diagnosticNullableNumber(tab.epoch),
    terminal: tab.terminal === true,
    recorder: tab.recorder === true,
    page: diagnosticPage(tab.page),
    chatTabs: diagnosticNumber(tab.chatTabs, 10_000),
    pending: diagnosticNumber(tab.pending, 1_000_000),
    pendingAll: diagnosticNumber(tab.pendingAll, 1_000_000),
    pendingCloses: diagnosticNumber(tab.pendingCloses, 1_000_000),
    pendingCommandAcks: diagnosticNumber(tab.pendingCommandAcks, 1_000_000),
    delivery: {
      at: diagnosticNumber(delivery?.at),
      ok: delivery?.ok === true ? true : delivery?.ok === false ? false : null,
      events: diagnosticNumber(delivery?.events, 1_000_000),
      total: diagnosticNumber(delivery?.total, 100_000_000),
      status: diagnosticNumber(delivery?.status, 999),
      error: diagnosticString(delivery?.error, 200)
    }
  };
}

export function sanitiseCompanionDiagnostics(value: unknown): CompanionDiagnostics | null {
  const root = diagnosticObject(value);
  const status = diagnosticObject(root?.status);
  const preferences = diagnosticObject(root?.preferences);
  if (!root || !status || !preferences) return null;
  const pairError = diagnosticObject(status.pairError);
  return {
    capturedAt: diagnosticNumber(root.capturedAt),
    status: {
      connected: status.connected === true,
      port: diagnosticNullableNumber(status.port),
      paired: status.paired === true,
      disconnected: status.disconnected === true,
      pending: diagnosticNumber(status.pending, 1_000_000),
      pendingCommandAcks: diagnosticNumber(status.pendingCommandAcks, 1_000_000),
      compatible: status.compatible === true ? true : status.compatible === false ? false : null,
      appVersion: diagnosticString(status.appVersion, 32),
      appProtocol: diagnosticNullableNumber(status.appProtocol),
      extensionVersion: diagnosticString(status.extensionVersion, 32),
      extensionProtocol: diagnosticNullableNumber(status.extensionProtocol),
      pairError: pairError
        ? { error: diagnosticString(pairError.error, 160) ?? '', message: diagnosticString(pairError.message, 500) ?? '' }
        : null
    },
    preferences: {
      overwrite: preferences.overwrite !== false,
      durations: preferences.durations === true
    },
    tab: diagnosticTab(root.tab),
    environment: diagnosticEnvironment(root.environment),
    language: diagnosticLanguage(root.language)
  };
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
function diagnosticLanguage(value: unknown): CompanionDiagnostics['language'] {
  const root = diagnosticObject(value);
  if (!root) return null;
  const tag = (field: unknown) => typeof field === 'string' && LANGUAGE_TAG.test(field) ? field : null;
  return { applied: tag(root.applied), stored: tag(root.stored), error: diagnosticString(root.error, 200) };
}

function diagnosticEnvironment(value: unknown): CompanionEnvironment | null {
  const root = diagnosticObject(value);
  const browser = diagnosticObject(root?.browser), tabs = diagnosticObject(root?.tabs), page = diagnosticObject(root?.page);
  if (!root || !browser || !tabs) return null;
  const name = diagnosticString(browser.name, 40), version = diagnosticString(browser.version, 32);
  const count = (key: string) => Math.round(diagnosticNumber(tabs[key], 100_000));
  return {
    browser: { name: name && /^[A-Za-z0-9 ._-]{1,40}$/.test(name) ? name : 'unknown', version: version && /^[0-9][0-9.]*$/.test(version) ? version : null },
    tabs: { open: count('open'), discarded: count('discarded'), frozen: count('frozen'), loading: count('loading'), grouped: count('grouped'),
      inBackgroundWindow: count('inBackgroundWindow') },
    page: page ? {
      composer: page.composer === true, sendArea: page.sendArea === true, modelMenu: page.modelMenu === true, plusMenu: page.plusMenu === true,
      language: typeof page.language === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(page.language) ? page.language : null
    } : null
  };
}
