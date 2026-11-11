import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// B10 (MASTER_FIX_20261111): each path check re-read and re-resolved the whole registry
// (~0.5 s at 943 rows, ~3.5 checks per tool call = 81% of median call time). One read per
// operation is enough, as long as a registration made inside the operation is seen at once.
const state = vi.hoisted(() => ({ config: {} as any, caller: {} as any }));
vi.mock('../src/main/config.js', () => ({ getConfig: () => state.config }));
vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => ({ caller: state.caller }) }));
vi.mock('../src/main/session/correlation.js', () => ({ requestCorrelation: () => null }));
vi.mock('../src/main/logger.js', () => ({ logWarn: vi.fn() }));
import { checkCoordinatorPath, ensureCoordinatorWorkspace, withCoordinatorOperation } from '../src/main/safety-coordinator.js';

const pilot = process.env.COS_COORDINATOR_PILOT_SOURCE;
const windows = it.skipIf(process.platform !== 'win32');
const real = it.skipIf(process.platform !== 'win32' || !pilot);
let base: string, root: string;
const agentReads = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((call: unknown[]) => String(call[0]).toLowerCase() === path.join(root, 'agents').toLowerCase()).length;

beforeAll(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-cache-')); });
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); vi.restoreAllMocks(); });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(base, 'registry-'));
  await fs.mkdir(path.join(root, 'agents'));
  if (pilot) for (const name of ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1']) await fs.copyFile(path.join(pilot, name), path.join(root, name));
  state.config = { coordinator: { enabled: true, root, autoRegisterSessions: true }, roots: [{ name: 'test', path: base }] };
  state.caller = { sessionId: 'cache-owner' };
});

windows('reads the registry once for several path checks in one operation', async () => {
  const spy = vi.spyOn(fs, 'readdir');
  spy.mockClear();
  await withCoordinatorOperation('exec_command', {}, async () => {
    for (let i = 0; i < 4; i++) await checkCoordinatorPath(path.join(base, `f${i}.txt`), 'write');
  });
  expect(agentReads(spy)).toBe(1);
  spy.mockRestore();
});

windows('a new operation sees registrations written by other processes since the last one', async () => {
  const owned = await fs.mkdtemp(path.join(base, 'owned-'));
  await withCoordinatorOperation('exec_command', {}, () => checkCoordinatorPath(owned, 'write'));
  // Another process registers the folder for a different session between operations.
  await fs.writeFile(path.join(root, 'agents', 'other.json'), JSON.stringify({ AgentId: 'other', Workspace: owned, SessionId: 'other' }));
  await expect(withCoordinatorOperation('exec_command', {}, () => checkCoordinatorPath(owned, 'write')))
    .rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
});

real('a registration made inside the operation is seen by its later checks', async () => {
  const folder = await fs.mkdtemp(path.join(base, 'mine-'));
  const result = await withCoordinatorOperation('exec_command', {}, async () => {
    await checkCoordinatorPath(folder, 'read');           // warms the per-operation read
    await ensureCoordinatorWorkspace(folder);             // registers it for this session
    await checkCoordinatorPath(path.join(folder, 'x.txt'), 'write');
    return { content: [] as { type: string; text: string }[] };
  });
  // Only the pre-registration read may warn; the write after enrolment must be "owned".
  const warnings = result.content.map(entry => entry.text).join('\n');
  expect(warnings).not.toContain('OUTSIDE_OWN_WORKSPACE: write');
});
