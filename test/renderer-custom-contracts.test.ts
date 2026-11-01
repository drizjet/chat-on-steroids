import { expect, it, vi } from 'vitest';
import { mountChat, waitFor } from './renderer-state.harness.js';

vi.mock('../src/renderer/workspace-terminal.js', () => ({ createWorkspaceTerminal: () => ({
  update: vi.fn(), show: vi.fn(), hide: vi.fn(), newTab: vi.fn(() => null),
  tabs: vi.fn(() => []), selectTab: vi.fn(), closeTab: vi.fn()
}) }));
// Native animation/media APIs are covered by pet DOM and real Electron tests.
vi.mock('../src/renderer/pet.js', () => ({ initPet: () => Object.assign(() => {}, { toggle: () => {}, isVisible: () => false }) }));



it('loads, preserves and saves standing Core and Desktop connector instructions', async () => {
  const mounted = await mountChat();
  const doc = mounted.window.document;
  const text = 'Use the default worker model unless I specify an account-available alternative.';
  const newChatPersonality = 'This wording belongs only in new chats.';
  const newChatWritingStyle = 'Keep the separate new-chat writing style.';
  const pushed = structuredClone(mounted.state) as any;
  pushed.config.mcp = { instructions: text, persistentUrls: true };
  pushed.config.ui.chatPersonality = newChatPersonality;
  pushed.config.ui.chatWritingStyle = newChatWritingStyle;
  mounted.push(pushed);

  const field = doc.getElementById('mcpInstructions') as HTMLTextAreaElement;
  expect(field.value).toBe(text);
  expect(field.maxLength).toBe(4000);
  expect(doc.querySelector('label[for="mcpInstructions"]')).not.toBeNull();
  expect(field.getAttribute('aria-describedby')).toBe('mcpInstructionsHint');
  expect(doc.getElementById('mcpInstructionsHint')?.textContent).toContain('Added to Core and Desktop instructions.');

  const developerMode = doc.getElementById('developerMode') as HTMLInputElement;
  developerMode.checked = true;
  developerMode.dispatchEvent(new mounted.window.Event('change', { bubbles: true }));
  await waitFor(() => expect(mounted.calls.at(-1)?.mcp).toEqual({ instructions: text, persistentUrls: true }));
  expect(mounted.calls.at(-1)?.ui.chatPersonality).toBe(newChatPersonality);
  expect(mounted.calls.at(-1)?.ui.chatWritingStyle).toBe(newChatWritingStyle);

  const edited = `${text}\nRun the relevant tests before reporting completion.`;
  field.value = edited;
  field.dispatchEvent(new mounted.window.Event('change', { bubbles: true }));
  await waitFor(() => expect(mounted.calls.at(-1)?.mcp).toEqual({ instructions: edited, persistentUrls: true }));
  expect(mounted.calls.at(-1)?.ui.chatPersonality).toBe(newChatPersonality);
  expect(mounted.calls.at(-1)?.ui.chatWritingStyle).toBe(newChatWritingStyle);
});

it('describes a protected update as held for compatibility review and hides Get it', async () => {
  const { window: w, state, push } = await mountChat();
  const next = structuredClone(state) as any;
  next.update = { ...next.update, latest: '2.1.48', stage: 'failed',
    error: 'COORDINATOR_UPDATE_REVIEW_REQUIRED: prepare and verify a compatible coordinator build before activation' };

  push(next);

  const line = w.document.getElementById('updateLine')!;
  expect(line.textContent).toContain('held for compatibility review');
  expect(line.textContent).toContain('compatible coordinator build');
  expect(line.textContent).not.toContain('could not be downloaded');
  expect(line.textContent).not.toContain('GitHub');
  expect((w.document.getElementById('updateGet') as HTMLButtonElement).hidden).toBe(true);
  expect((w.document.getElementById('updateInstall') as HTMLButtonElement).hidden).toBe(true);

  const appRow = w.document.querySelector('[data-update-part="app"]')!.textContent!;
  expect(appRow).toContain('Held for compatibility review');
  expect(appRow).toContain('A compatible coordinator build needs review');
  expect(appRow).toContain('Prepare and verify a compatible coordinator build');

  const ordinaryFailure = structuredClone(next) as any;
  ordinaryFailure.update.error = 'GitHub could not be reached';
  push(ordinaryFailure);
  expect((w.document.getElementById('updateGet') as HTMLButtonElement).hidden).toBe(false);
  expect(w.document.getElementById('updateLine')!.textContent).toContain('could not be downloaded');
});
