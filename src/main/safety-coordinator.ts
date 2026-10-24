/** Optional bridge to the existing Windows coordinator. It never changes OS permissions. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getConfig } from './config.js';
import { currentCall } from './mcp/call-context.js';
import { logWarn } from './logger.js';

export const workspacePolicySchema = z.object({
  acknowledge_cross_workspace: z.boolean().optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
  read_paths: z.array(z.string().min(1).max(4096)).max(100).optional(),
  write_paths: z.array(z.string().min(1).max(4096)).max(100).optional()
}).strict().optional().describe('Coordinator access declaration. Cross-agent writes need acknowledgement and a reason; shell-derived paths must be declared because commands are trusted after launch.');

interface Operation {
  id: string;
  tool: string;
  grant: z.infer<typeof workspacePolicySchema>;
  warnings: Set<string>;
}
const operations = new AsyncLocalStorage<Operation>();
const guiLeases = new AsyncLocalStorage<string>();

export function coordinatorRoot(): string | null {
  const settings = getConfig().coordinator;
  if (process.platform !== 'win32' || !settings?.enabled) return null;
  if (!path.isAbsolute(settings.root)) throw new Error('COORDINATOR_CONFIG_INVALID: coordinator root must be absolute.');
  return settings.root;
}

export function coordinatorPrincipal(): string {
  const caller = currentCall()?.caller;
  return caller?.sessionId ? `session:${caller.sessionId}`
    : caller?.conversationId ? `chat:${caller.conversationId}`
    : caller?.requestId ? `request:${caller.requestId}` : `unattributed:${process.pid}`;
}

export function coordinatorGuiRequest(): Record<string, string> | null {
  const root = coordinatorRoot();
  return root ? { root, principal: coordinatorPrincipal(), operationId: operations.getStore()?.id ?? randomUUID(), token: guiLeases.getStore() ?? '' } : null;
}

/** The existing native helper owns the mutex across focus, clipboard, input and capture. */
export async function withCoordinatorGuiLease<T>(
  send: (request: Record<string, unknown>) => Promise<Record<string, any>>, run: () => Promise<T>
): Promise<T> {
  if (!coordinatorRoot() || guiLeases.getStore()) return run();
  const token = randomUUID().replaceAll('-', '');
  await send({ op: 'coordinator_acquire', token });
  try { return await guiLeases.run(token, run); }
  finally {
    try { await send({ op: 'coordinator_release', token }); }
    catch (error) {
      logWarn(`GUI_LEASE_RELEASE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
      operations.getStore()?.warnings.add('GUI_LEASE_RELEASE_UNCONFIRMED: input may already have completed. Inspect the result; do not replay completed input.');
    }
  }
}

async function audit(record: Record<string, unknown>): Promise<void> {
  const root = coordinatorRoot();
  if (!root) return;
  // One JSONL append per record; no command text, clipboard or typed text is stored here.
  await fs.appendFile(path.join(root, 'TOOL_POLICY_AUDIT.jsonl'), JSON.stringify({
    timestampUtc: new Date().toISOString(), principal: coordinatorPrincipal(),
    operationId: operations.getStore()?.id ?? null, tool: operations.getStore()?.tool ?? null, ...record
  }) + '\n', 'utf8');
}

/** Resolve existing ancestors, so a missing leaf below a junction has the real owner's path. */
export async function canonicalCoordinatorPath(value: string, base = process.cwd()): Promise<string> {
  let candidate = path.resolve(base, value);
  const suffix: string[] = [];
  for (;;) {
    try { return path.join(await fs.realpath(candidate), ...suffix); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

interface Registration { AgentId: string; Workspace: string; Principal?: string; SessionId?: string }
async function registrations(root: string): Promise<Registration[]> {
  const files = await fs.readdir(path.join(root, 'agents'));
  if (files.length > 5000) throw new Error('COORDINATOR_REGISTRY_INVALID: too many registrations.');
  const result: Registration[] = [];
  for (const file of files.filter(name => /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}\.json$/.test(name))) {
    const row = JSON.parse(await fs.readFile(path.join(root, 'agents', file), 'utf8')) as Registration;
    if (!row.AgentId || !row.Workspace || !path.isAbsolute(row.Workspace)) throw new Error('COORDINATOR_REGISTRY_INVALID: invalid registration.');
    result.push({ ...row, Workspace: await canonicalCoordinatorPath(row.Workspace) });
  }
  return result;
}

const contains = (parent: string, target: string): boolean => {
  const rel = path.relative(parent.toLowerCase(), target.toLowerCase());
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};

export async function checkCoordinatorPath(value: string, access: 'read' | 'write', base?: string, display = 'the requested path'): Promise<void> {
  const root = coordinatorRoot();
  if (!root) return;
  const target = await canonicalCoordinatorPath(value, base);
  const rows = await registrations(root);
  const principal = coordinatorPrincipal();
  const mine = rows.find(row => row.Principal === principal || (row.SessionId && principal === `session:${row.SessionId}`));
  const owner = rows.filter(row => contains(row.Workspace, target)).sort((a, b) => b.Workspace.length - a.Workspace.length)[0];
  const cross = owner !== undefined && owner.AgentId !== mine?.AgentId;
  const grant = operations.getStore()?.grant;
  const acknowledged = grant?.acknowledge_cross_workspace === true && Boolean(grant.reason?.trim());
  const denied = access === 'write' && cross && !acknowledged;
  const scope = owner?.AgentId === mine?.AgentId && mine ? 'owned' : cross ? 'registered-other-agent' : 'outside-registered-workspaces';
  await audit({ phase: 'path-preflight', path: target, access, agentId: mine?.AgentId ?? null,
    ownerAgent: owner?.AgentId ?? null, scope, acknowledged, reason: acknowledged ? grant!.reason : null,
    disposition: denied ? 'REQUIRES_ACKNOWLEDGEMENT' : scope === 'owned' ? 'ALLOW_OWNED' : 'ALLOW_WITH_WARNING' });
  if (denied) throw new Error(`CROSS_AGENT_WRITE_ACK_REQUIRED: ${display} belongs to ${owner!.AgentId}. Supply workspace_policy.acknowledge_cross_workspace=true and a nonempty reason.`);
  if (scope !== 'owned') {
    const warning = `OUTSIDE_OWN_WORKSPACE: ${access} ${display}; owner=${owner?.AgentId ?? 'unregistered'}.`;
    operations.getStore()?.warnings.add(warning);
    logWarn(warning);
  }
}

export async function checkCoordinatorCommand(cwd: string | undefined, displayCwd = 'the command workspace'): Promise<void> {
  if (!coordinatorRoot()) return;
  const grant = operations.getStore()?.grant;
  if (cwd) await checkCoordinatorPath(cwd, 'write', undefined, displayCwd);
  for (const [access, targets] of [['read', grant?.read_paths], ['write', grant?.write_paths]] as const) {
    for (const value of targets ?? []) {
      if (!cwd && !path.isAbsolute(value)) throw new Error('COORDINATOR_CWD_UNKNOWN: declare absolute stdin paths when the shell workspace is unknown.');
      await checkCoordinatorPath(value, access, cwd, value);
    }
  }
}

/** Called by the existing dispatcher, after its identity/permission gates, for direct and nested tools. */
export async function withCoordinatorOperation<T>(tool: string, args: unknown, run: () => Promise<T>): Promise<T> {
  if (!coordinatorRoot()) return run();
  const raw = args && typeof args === 'object' ? (args as Record<string, unknown>)['workspace_policy'] : undefined;
  const grant = workspacePolicySchema.parse(raw);
  const operation: Operation = { id: randomUUID(), tool, grant, warnings: new Set() };
  return operations.run(operation, async () => {
    await audit({ phase: 'started', argumentDigest: createHash('sha256').update(JSON.stringify(args) ?? '').digest('hex') });
    try {
      const result = await run();
      const completion = currentCall()?.evidence?.processCompletion;
      if (completion) void completion.then(value => audit({ phase: 'process-exited', exitCode: value.exitCode, durationMs: value.durationMs }))
        .catch(error => logWarn(`COORDINATOR_COMPLETION_AUDIT_FAILED: ${error instanceof Error ? error.message : String(error)}`));
      try { await audit({ phase: 'returned', isError: Boolean(result && typeof result === 'object' && 'isError' in result && result.isError) }); }
      catch (error) {
        logWarn(`COORDINATOR_RESULT_AUDIT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
        operation.warnings.add('COORDINATOR_RESULT_AUDIT_FAILED: the operation already returned. Inspect its result; do not repeat it merely to recreate the audit record.');
      }
      if (operation.warnings.size && result && typeof result === 'object' && 'content' in result && Array.isArray(result.content)) {
        result.content.push({ type: 'text', text: [...operation.warnings].join('\n') });
      }
      return result;
    } catch (error) {
      try { await audit({ phase: 'failed', error: error instanceof Error ? error.message : String(error) }); }
      catch (auditError) { logWarn(`COORDINATOR_FAILURE_AUDIT_FAILED: ${String(auditError)}`); }
      throw error;
    }
  });
}
