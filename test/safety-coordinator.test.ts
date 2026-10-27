import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: {} as any, caller: {} as any, correlation: null as any }));
vi.mock('../src/main/config.js', () => ({ getConfig: () => state.config }));
vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => ({ caller: state.caller }) }));
vi.mock('../src/main/session/correlation.js', () => ({ requestCorrelation: () => state.correlation }));
vi.mock('../src/main/logger.js', () => ({ logWarn: vi.fn() }));
import { checkCoordinatorPath, coordinatorPrincipal, coordinatorRuntimeStatus, ensureCoordinatorWorkspace, ensureCoordinatorWriteWorkspace,
  withCoordinatorGuiLease, withCoordinatorOperation } from '../src/main/safety-coordinator.js';

let base: string;
let registry: string;
let owned: string;
beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-safety-'));
  registry = path.join(base, 'registry'); owned = path.join(base, 'owned');
  await fs.mkdir(path.join(registry, 'agents'), { recursive: true });
  await fs.mkdir(owned);
});
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });
beforeEach(async () => {
  state.config = { coordinator: { enabled: true, root: registry }, roots: [{ name: 'test', path: base }] };
  state.caller = { sessionId: 'owner', requestId: 'request-owner' }; state.correlation = null;
  for (const file of await fs.readdir(path.join(registry, 'agents'))) await fs.unlink(path.join(registry, 'agents', file));
  await fs.writeFile(path.join(registry, 'agents', 'owner.json'), JSON.stringify({ AgentId: 'owner', Workspace: owned, Principal: 'session:owner' }));
});
const windows = it.skipIf(process.platform !== 'win32');
const run = (args: unknown, fn: () => Promise<unknown>) => withCoordinatorOperation('apply_patch', args, fn);

windows('allows the owning session and refuses a foreign write before its effect', async () => {
  const file = path.join(owned, 'value.txt');
  await fs.writeFile(file, 'original');
  await run({}, () => checkCoordinatorPath(file, 'write'));
  state.caller.sessionId = 'foreign';
  await expect(run({}, async () => { await checkCoordinatorPath(file, 'write'); await fs.writeFile(file, 'wrong'); }))
    .rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
  expect(await fs.readFile(file, 'utf8')).toBe('original');
});
windows('allows cross-workspace reads and requires both acknowledgement and a reason for writes', async () => {
  state.caller.sessionId = 'foreign';
  await run({}, () => checkCoordinatorPath(owned, 'read'));
  await expect(run({ workspace_policy: { acknowledge_cross_workspace: true } }, () => checkCoordinatorPath(owned, 'write')))
    .rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
  await run({ workspace_policy: { acknowledge_cross_workspace: true, reason: 'Agreed shared artifact' } }, () => checkCoordinatorPath(owned, 'write'));
});
windows('recognizes every workspace belonging to a session, rather than only its first registration', async () => {
  const second = path.join(base, 'second'); await fs.mkdir(second, { recursive: true });
  await fs.writeFile(path.join(registry, 'agents', 'second.json'), JSON.stringify({ AgentId: 'second', Workspace: second, SessionId: 'owner' }));
  await run({}, () => checkCoordinatorPath(second, 'write'));
});
windows('resolves a junction before deciding ownership, including a missing target leaf', async () => {
  const alias = path.join(base, 'alias');
  await fs.symlink(owned, alias, 'junction');
  state.caller.sessionId = 'foreign';
  try { await expect(run({}, () => checkCoordinatorPath(path.join(alias, 'missing.txt'), 'write'))).rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED'); }
  finally { await fs.unlink(alias); }
});
windows('refuses malformed registration instead of ignoring protection', async () => {
  await fs.writeFile(path.join(registry, 'agents', 'broken.json'), '{}');
  await expect(run({}, () => checkCoordinatorPath(owned, 'write'))).rejects.toThrow('COORDINATOR_REGISTRY_INVALID');
});
windows('does not enroll unproven identities or claim approved umbrella roots', async () => {
  state.config.coordinator.autoRegisterSessions = true;
  state.caller = { requestId: 'not-yet-proven' };
  await ensureCoordinatorWorkspace(base);
  state.caller.sessionId = 'owner'; await ensureCoordinatorWorkspace(base);
  expect(await fs.readdir(path.join(registry, 'agents'))).toEqual(['owner.json']);
});
windows('recovers the exact durable principal when correlation arrived after initial attribution', async () => {
  state.caller = { requestId: 'late-proof' }; state.correlation = { sessionId: 'durable' };
  state.config.coordinator.autoRegisterSessions = true;
  await ensureCoordinatorWorkspace(base);
  expect(coordinatorPrincipal()).toBe('session:durable');
});
windows('never runs input after lease acquisition refusal', async () => {
  const effect = vi.fn();
  const send = vi.fn().mockRejectedValue(new Error('GUI_LEASE_BUSY'));
  await expect(withCoordinatorGuiLease(send, effect)).rejects.toThrow('GUI_LEASE_BUSY');
  expect(effect).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledTimes(1);
});
windows('releases the acquired lease after a failed input and does not replay the input', async () => {
  const effect = vi.fn().mockRejectedValue(new Error('input failed')); const send = vi.fn().mockResolvedValue({});
  await expect(withCoordinatorGuiLease(send, effect)).rejects.toThrow('input failed');
  expect(effect).toHaveBeenCalledTimes(1);
  expect(send.mock.calls.map(([call]) => call.op)).toEqual(['coordinator_acquire', 'coordinator_release']);
  expect(send.mock.calls[0]![0].token).toBe(send.mock.calls[1]![0].token);
});
windows('a release reporting failure never causes already completed input to run again', async () => {
  const effect = vi.fn().mockResolvedValue('done'); const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('release uncertain'));
  expect(await withCoordinatorGuiLease(send, effect)).toBe('done'); expect(effect).toHaveBeenCalledTimes(1);
});
it('publishes a capability receipt without leaking the registry path or session identity', () => {
  const status = coordinatorRuntimeStatus();
  expect(status.build).toBe('COS_COORDINATOR_BUILD_20261027');
  expect(JSON.stringify(status)).not.toContain(registry); expect(JSON.stringify(status)).not.toContain('session:owner');
});

it.skipIf(process.platform !== 'win32' || !process.env.COS_COORDINATOR_PILOT_SOURCE)(
  'enrolls six real concurrent workspaces through the existing Windows registration mutex', async () => {
    const root = path.join(base, 'real-registry'); await fs.mkdir(root);
    for (const name of ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1']) {
      await fs.copyFile(path.join(process.env.COS_COORDINATOR_PILOT_SOURCE!, name), path.join(root, name));
    }
    await fs.mkdir(path.join(root, 'agents'));
    state.config.coordinator = { enabled: true, root, autoRegisterSessions: true };
    const workspaces = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const workspace = path.join(base, `real-${i}`); await fs.mkdir(workspace); return workspace;
    }));
    await Promise.all(workspaces.map((workspace, i) => {
      state.caller = { sessionId: `real-${i}` }; return ensureCoordinatorWorkspace(workspace);
    }));
    expect(await fs.readdir(path.join(root, 'agents'))).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      state.caller = { sessionId: `real-${i}` };
      await run({}, () => checkCoordinatorPath(workspaces[i]!, 'write'));
      await expect(run({}, () => checkCoordinatorPath(workspaces[(i + 1) % 6]!, 'write'))).rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
    }
  });

it.skipIf(process.platform !== 'win32' || !process.env.COS_COORDINATOR_PILOT_SOURCE)(
  'protects the first absolute write of an unfiled chat even after learning a broad root', async () => {
    const root = path.join(base, 'first-write-registry'); await fs.mkdir(root);
    for (const name of ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1']) {
      await fs.copyFile(path.join(process.env.COS_COORDINATOR_PILOT_SOURCE!, name), path.join(root, name));
    }
    await fs.mkdir(path.join(root, 'agents'));
    state.config.coordinator = { enabled: true, root, autoRegisterSessions: true };
    const folder = path.join(base, 'first-write'); await fs.mkdir(folder);
    const file = path.join(folder, 'new.txt');
    state.caller = { sessionId: 'first-writer' };
    await ensureCoordinatorWriteWorkspace(file, base);
    await run({}, () => checkCoordinatorPath(file, 'write'));
    state.caller = { sessionId: 'second-writer' };
    await ensureCoordinatorWriteWorkspace(file, base);
    await expect(run({}, () => checkCoordinatorPath(file, 'write'))).rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
    expect(await fs.readdir(path.join(root, 'agents'))).toHaveLength(1);
    await expect(fs.stat(file)).rejects.toThrow();
  });
