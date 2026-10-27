import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Maintenance entrypoint is deliberately dependency-free JavaScript.
import { archiveSafety, inspect } from '../scripts/coordinator-preflight.mjs';
const dirs: string[] = [];
const helperNames = ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1', 'CoS-GuiLease.ps1', 'hardened-canary/CoS-JobRunner.cs'];
async function helpers(registry: string) {
  const files = [];
  for (const name of helperNames) {
    const file = path.join(registry, name), content = `synthetic helper ${name}`;
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    files.push({ path: name, sha256: createHash('sha256').update(content).digest('hex') });
  }
  await fs.writeFile(path.join(registry, 'COORDINATOR_COMPONENTS.json'), JSON.stringify({ build: 'COS_COORDINATOR_BUILD_20261027_R2', files }));
}
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function archive(main: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-preflight-')); dirs.push(dir);
  const bytes = Buffer.from(main);
  const json = Buffer.from(JSON.stringify({ files: { out: { files: { main: { files: { 'index.js': { offset: '0', size: bytes.length } } } } } } }));
  const prefix = Buffer.alloc(16); prefix.writeUInt32LE(json.length + 8, 4); prefix.writeUInt32LE(json.length, 12);
  const file = path.join(dir, 'app.asar'); await fs.writeFile(file, Buffer.concat([prefix, json, bytes])); return file;
}
it('detects a vendor update that removed the integration even when the version still looks valid', async () => {
  expect((await archiveSafety(await archive('app version 2.1.46; stock terminal ownership'))).present).toBe(false);
});
it('requires every safety feature marker and rejects a truncated package', async () => {
  const file = await archive('COS_COORDINATOR_BUILD_20261027_R2 CROSS_AGENT_WRITE_ACK_REQUIRED GUI_LEASE_RELEASE_FAILED coordinator_acquire COORDINATOR_UPDATE_REVIEW_REQUIRED');
  expect((await archiveSafety(file)).present).toBe(true);
  await fs.truncate(file, 16); await expect(archiveSafety(file)).rejects.toThrow();
});
it('does not mistake saved flags for active runtime flags after an external config edit', async () => {
  const file = await archive('COS_COORDINATOR_BUILD_20261027_R2 CROSS_AGENT_WRITE_ACK_REQUIRED GUI_LEASE_RELEASE_FAILED coordinator_acquire COORDINATOR_UPDATE_REVIEW_REQUIRED');
  const root = path.dirname(file), data = path.join(root, 'data'), registry = path.join(root, 'registry');
  await fs.mkdir(path.join(root, 'resources')); await fs.copyFile(file, path.join(root, 'resources', 'app.asar'));
  await fs.mkdir(path.join(data, 'control-api'), { recursive: true }); await fs.mkdir(path.join(registry, 'agents'), { recursive: true });
  await helpers(registry);
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({ coordinator: { enabled: true, root: registry, autoRegisterSessions: true, protectUpdates: true } }));
  await fs.writeFile(path.join(data, 'control-api', 'endpoint.json'), JSON.stringify({ port: 1234 }));
  await fs.writeFile(path.join(data, 'control-api', 'token'), 'synthetic-local-token');
  const safety = { enabled: true, build: 'COS_COORDINATOR_BUILD_20261027_R2', autoRegisterSessions: false, protectUpdates: false,
    registryFingerprint: createHash('sha256').update(path.resolve(registry).toLowerCase()).digest('hex') };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ safetyCoordinator: safety }))));
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('degraded');
  safety.autoRegisterSessions = true; safety.protectUpdates = true;
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('ready-cooperative');
  const other = path.join(root, 'other-registry'); await fs.mkdir(path.join(other, 'agents'), { recursive: true });
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({ coordinator: { enabled: true, root: other, autoRegisterSessions: true, protectUpdates: true } }));
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('degraded');
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({ coordinator: { enabled: true, root: registry, autoRegisterSessions: true, protectUpdates: true } }));
  expect((await inspect({ appRoot: root, dataRoot: data, registryRoot: other })).state).toBe('degraded');
  expect((await inspect({ appRoot: root, dataRoot: data, offline: true })).state).toBe('configured-offline');
  await fs.unlink(path.join(registry, 'CoS-Agent.ps1'));
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('degraded');
  await helpers(registry);
  await fs.appendFile(path.join(registry, 'CoS-WorkspacePolicy.ps1'), '\nchanged');
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('degraded');
  await helpers(registry);
  await fs.unlink(path.join(registry, 'COORDINATOR_COMPONENTS.json'));
  expect((await inspect({ appRoot: root, dataRoot: data })).state).toBe('degraded');
});
