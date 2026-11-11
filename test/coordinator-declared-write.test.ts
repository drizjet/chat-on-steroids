import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// B1 (MASTER_FIX_20261111): a command whose workdir is a shared/approved umbrella declares its real
// project folder only through workspace_policy.write_paths. That folder must be claimed by the
// proven session, so a second chat cannot silently write into it, while folders outside every
// umbrella are never auto-claimed.
const state = vi.hoisted(() => ({ config: {} as any, caller: {} as any }));
vi.mock('../src/main/config.js', () => ({ getConfig: () => state.config }));
vi.mock('../src/main/mcp/call-context.js', () => ({ currentCall: () => ({ caller: state.caller }) }));
vi.mock('../src/main/session/correlation.js', () => ({ requestCorrelation: () => null }));
vi.mock('../src/main/logger.js', () => ({ logWarn: vi.fn() }));
import { checkCoordinatorCommand, withCoordinatorOperation } from '../src/main/safety-coordinator.js';

const pilot = process.env.COS_COORDINATOR_PILOT_SOURCE;
const real = it.skipIf(process.platform !== 'win32' || !pilot);
let base: string, outsideBase: string, root: string, shared: string;
const rows = async () => Promise.all((await fs.readdir(path.join(root, 'agents')))
  .map(async name => JSON.parse(await fs.readFile(path.join(root, 'agents', name), 'utf8'))));
const exec = (writePaths: string[], cwd: string) =>
  withCoordinatorOperation('exec_command', { workspace_policy: { write_paths: writePaths } }, () => checkCoordinatorCommand(cwd));

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-declared-'));
  outsideBase = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-outside-'));
});
afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
  await fs.rm(outsideBase, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(base, 'registry-'));
  shared = await fs.mkdtemp(path.join(base, 'shared-'));
  await fs.mkdir(path.join(root, 'agents'));
  for (const name of ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1']) await fs.copyFile(path.join(pilot!, name), path.join(root, name));
  await fs.writeFile(path.join(root, 'WORKSPACE_POLICY.json'), JSON.stringify({ SharedRoots: [shared] }));
  state.config = { coordinator: { enabled: true, root, autoRegisterSessions: true }, roots: [{ name: 'test', path: base }] };
  state.caller = { sessionId: 'run-owner' };
});

real('claims a declared project folder below a shared root when the command runs at the umbrella', async () => {
  const project = path.join(shared, 'RUN_A'); await fs.mkdir(project);
  await exec([path.join(project, 'out.txt')], shared);
  const claimed = (await rows()).filter(row => row.SessionId === 'run-owner');
  expect(claimed).toHaveLength(1);
  expect(claimed[0].Workspace.toLowerCase()).toBe((await fs.realpath(project)).toLowerCase());
  // The claim is what makes the boundary real: another chat now needs an acknowledged reason.
  state.caller = { sessionId: 'second-chat' };
  await expect(exec([path.join(project, 'out.txt')], shared)).rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
});

real('accepts a relative declared write path against the umbrella workdir', async () => {
  await fs.mkdir(path.join(shared, 'RUN_REL'));
  await exec(['RUN_REL\\result.json'], shared);
  expect((await rows()).map(row => path.basename(row.Workspace))).toEqual(['RUN_REL']);
});

real('never claims a folder outside every shared or approved umbrella', async () => {
  const stray = await fs.mkdtemp(path.join(outsideBase, 'stray-'));
  await exec([path.join(stray, 'file.txt')], shared);
  expect(await rows()).toEqual([]);
});

real('never claims the umbrella itself for a file written directly into it', async () => {
  await exec([path.join(shared, 'summary.txt')], shared);
  expect(await rows()).toEqual([]);
});

real('does not take over a folder another session already owns', async () => {
  const project = path.join(shared, 'RUN_B'); await fs.mkdir(project);
  state.caller = { sessionId: 'first' }; await exec([path.join(project, 'a.txt')], shared);
  state.caller = { sessionId: 'second' };
  await expect(exec([path.join(project, 'nested', 'b.txt')], shared)).rejects.toThrow('CROSS_AGENT_WRITE_ACK_REQUIRED');
  expect((await rows()).map(row => row.SessionId)).toEqual(['first']);
});

real('read-only declarations never create a claim', async () => {
  const project = path.join(shared, 'RUN_READ'); await fs.mkdir(project);
  await withCoordinatorOperation('exec_command', { workspace_policy: { read_paths: [project] } }, () => checkCoordinatorCommand(shared));
  expect(await rows()).toEqual([]);
});
