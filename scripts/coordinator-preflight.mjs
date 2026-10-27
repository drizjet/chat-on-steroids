/** Read-only, dependency-free inspection of the installed archive and live safety receipt. */
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const BUILD = 'COS_COORDINATOR_BUILD_20261027_R2';
const REQUIRED_HELPERS = ['CoS-Agent.ps1', 'CoS-WorkspacePolicy.ps1', 'CoS-GuiLease.ps1', 'hardened-canary/CoS-JobRunner.cs'];

async function helperIntegrity(root) {
  try {
    const receipt = JSON.parse((await readFile(path.join(root, 'COORDINATOR_COMPONENTS.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (receipt.build !== BUILD || !Array.isArray(receipt.files) || receipt.files.length !== REQUIRED_HELPERS.length) throw new Error('Invalid helper receipt');
    const files = await Promise.all(REQUIRED_HELPERS.map(async name => {
      const entries = receipt.files.filter(item => item.path === name);
      if (entries.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256)) throw new Error('Invalid helper receipt');
      const digest = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
      return { path: name, matches: digest === entries[0].sha256 };
    }));
    return { verified: files.every(item => item.matches), files, error: files.some(item => !item.matches) ? 'Helper bytes differ from installation receipt' : null };
  } catch (error) { return { verified: false, files: [], error: error.message }; }
}

export async function archiveSafety(archive) {
  const file = await open(archive, 'r');
  try {
    const prefix = Buffer.alloc(16); await file.read(prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (headerSize > 32 * 1024 * 1024 || jsonSize > headerSize - 8 || jsonSize < 2) throw new Error('Invalid archive header');
    const json = Buffer.alloc(jsonSize); await file.read(json, 0, jsonSize, 16);
    const header = JSON.parse(json.toString());
    const entry = header.files.out.files.main.files['index.js'];
    if (entry.unpacked || !Number.isSafeInteger(entry.size) || entry.size > 20 * 1024 * 1024) throw new Error('Invalid main bundle');
    const main = Buffer.alloc(entry.size);
    const result = await file.read(main, 0, entry.size, 8 + headerSize + Number(entry.offset));
    if (result.bytesRead !== entry.size) throw new Error('Truncated main bundle');
    const text = main.toString();
    const markers = ['COS_COORDINATOR_BUILD_20261027_R2', 'CROSS_AGENT_WRITE_ACK_REQUIRED', 'GUI_LEASE_RELEASE_FAILED', 'coordinator_acquire', 'COORDINATOR_UPDATE_REVIEW_REQUIRED'];
    return { present: markers.every(marker => text.includes(marker)), missingMarkers: markers.filter(marker => !text.includes(marker)) };
  } finally { await file.close(); }
}

export async function inspect({ appRoot, dataRoot, registryRoot, offline = false }) {
  const config = JSON.parse(await readFile(path.join(dataRoot, 'config.json'), 'utf8'));
  const code = await archiveSafety(path.join(appRoot, 'resources', 'app.asar'));
  const settings = config.coordinator;
  const root = registryRoot ?? settings?.root;
  const helpers = root && path.isAbsolute(root) ? await helperIntegrity(root) : { verified: false, files: [], error: 'Missing absolute registry root' };
  let registrations = [], registryError = root && path.isAbsolute(root) ? null : 'Missing absolute registry root', lastAuditUtc = null;
  let shared = [];
  if (registryRoot && settings?.root && path.resolve(registryRoot).toLowerCase() !== path.resolve(settings.root).toLowerCase()) registryError = 'Requested registry differs from configured registry';
  if (root) {
    try {
      let policy = {};
      try { policy = JSON.parse((await readFile(path.join(root, 'WORKSPACE_POLICY.json'), 'utf8')).replace(/^\uFEFF/, '')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      shared = policy.SharedRoots ?? [];
      if (!Array.isArray(shared) || shared.length > 32 || shared.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('Invalid shared-root policy');
      for (const name of (await readdir(path.join(root, 'agents'))).filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
        const row = JSON.parse(await readFile(path.join(root, 'agents', name), 'utf8'));
        if (!row.AgentId || typeof row.Workspace !== 'string' || !path.isAbsolute(row.Workspace)) throw new Error('Invalid workspace registration');
        registrations.push(row);
      }
      lastAuditUtc = (await stat(path.join(root, 'TOOL_POLICY_AUDIT.jsonl')).catch(() => null))?.mtime.toISOString() ?? null;
    } catch (error) { registryError = error.message; }
  }
  let live = null, liveError = null;
  if (!offline) {
    try {
      const endpoint = JSON.parse(await readFile(path.join(dataRoot, 'control-api', 'endpoint.json'), 'utf8'));
      if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('Invalid control port');
      const token = (await readFile(path.join(dataRoot, 'control-api', 'token'), 'utf8')).trim();
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Control API HTTP ${response.status}`);
      const status = await response.json();
      live = { appVersion: status.appVersion, safety: status.safetyCoordinator ?? null, toolCalls: status.toolCalls };
    } catch (error) { liveError = error.message; }
  }
  const configuredFingerprint = typeof settings?.root === 'string' && path.isAbsolute(settings.root)
    ? createHash('sha256').update(path.resolve(settings.root).toLowerCase()).digest('hex') : null;
  const registryFingerprintMatches = offline ? null : configuredFingerprint !== null && live?.safety?.registryFingerprint === configuredFingerprint;
  const ready = code.present && settings?.enabled === true && settings.autoRegisterSessions === true && settings.protectUpdates === true
    && helpers.verified && !registryError && (offline || (live?.safety?.enabled === true && live.safety.build === BUILD
      && live.safety.autoRegisterSessions === true && live.safety.protectUpdates === true && registryFingerprintMatches));
  return { state: ready ? (offline ? 'configured-offline' : 'ready-cooperative') : 'degraded', archive: code, helpers,
    configured: { enabled: settings?.enabled === true, autoRegisterSessions: settings?.autoRegisterSessions === true, protectUpdates: settings?.protectUpdates === true, managedWorkerWorktrees: config.multiAgent?.autoWorktrees === true },
    registry: { count: registrations.length, sessionBound: registrations.filter(row => row.SessionId || row.Principal?.startsWith('session:')).length,
      sharedRoots: shared.length, sharedRootRegistrations: registrations.filter(row => shared.some(value => path.resolve(value).toLowerCase() === path.resolve(row.Workspace).toLowerCase())).length,
      fingerprintMatches: registryFingerprintMatches, error: registryError },
    lastAuditUtc, live, liveError, allExecutorsGoverned: false,
    limits: ['Trusted shell commands can use undeclared paths.', 'External executors and human input do not automatically participate.', 'Managed worker worktrees apply to newly allocated workers.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = flag => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
  try {
    const result = await inspect({ appRoot: value('--app') ?? path.join(process.env.LOCALAPPDATA, 'Programs', 'Chat On Steroids'),
      dataRoot: value('--data') ?? path.join(process.env.APPDATA, 'chat-on-steroids'), registryRoot: value('--root'), offline: args.includes('--offline') });
    console.log(JSON.stringify(result, null, 2)); process.exitCode = ['ready-cooperative', 'configured-offline'].includes(result.state) ? 0 : 2;
  } catch (error) { console.error(JSON.stringify({ state: 'degraded', error: error.message })); process.exitCode = 2; }
}
