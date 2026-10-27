import { beforeEach, expect, it, vi } from 'vitest';
const settings = vi.hoisted(() => ({ coordinator: undefined as undefined | { enabled: boolean; protectUpdates: boolean } }));
vi.mock('../src/main/config.js', () => ({ getConfig: () => settings }));
vi.mock('../src/main/logger.js', () => ({ logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: true } }));
import { coordinatorUpdateProtected, updateStatus } from '../src/main/update.js';
beforeEach(() => { settings.coordinator = undefined; });
it('requires a compatible safety build before a vendor installer can replace custom controls', () => {
  settings.coordinator = { enabled: true, protectUpdates: true };
  expect(coordinatorUpdateProtected()).toBe(true);
  expect(updateStatus()).toMatchObject({ stage: 'failed', error: expect.stringContaining('COORDINATOR_UPDATE_REVIEW_REQUIRED') });
});
it('preserves ordinary updater behavior for unmodified installations and an explicitly disabled guard', () => {
  expect(coordinatorUpdateProtected()).toBe(false);
  settings.coordinator = { enabled: false, protectUpdates: true }; expect(coordinatorUpdateProtected()).toBe(false);
  settings.coordinator = { enabled: true, protectUpdates: false }; expect(coordinatorUpdateProtected()).toBe(false);
});
