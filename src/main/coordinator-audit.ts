/** One owner for coordinator audit append and archival; no history is deleted. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function createCoordinatorAuditWriter(maxBytes = MAX_AUDIT_BYTES) {
  let tail: Promise<void> = Promise.resolve();
  let rotation = 0;
  return (root: string, record: Record<string, unknown>): Promise<void> => {
    // Caller-authored reasons and exception bodies can contain secrets. Keep
    // their identity for local correlation without copying their text to logs.
    const { error, reason, ...safe } = record;
    if (typeof error === 'string') {
      safe.errorCode = error.startsWith('CROSS_AGENT_WRITE_ACK_REQUIRED:') ? 'CROSS_AGENT_WRITE_ACK_REQUIRED' : 'OPERATION_FAILED';
      safe.errorDigest = digest(error);
    }
    if (typeof reason === 'string') safe.reasonDigest = digest(reason);
    const line = JSON.stringify(safe) + '\n';
    const bytes = Buffer.byteLength(line);
    const run = tail.then(async () => {
      if (bytes > 64 * 1024) throw new Error('COORDINATOR_AUDIT_RECORD_TOO_LARGE');
      const file = path.join(root, 'TOOL_POLICY_AUDIT.jsonl');
      let size = 0;
      try {
        const info = await fs.lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('COORDINATOR_AUDIT_INVALID_TARGET');
        size = info.size;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (size > 0 && size + bytes > maxBytes) {
        const directory = path.join(root, 'audit-archive');
        await fs.mkdir(directory, { recursive: true });
        if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('COORDINATOR_AUDIT_LINKED_ARCHIVE');
        const name = `TOOL_POLICY_AUDIT.${Date.now()}.${String(++rotation).padStart(8, '0')}.${randomUUID()}.jsonl`;
        await fs.rename(file, path.join(directory, name));
      }
      await fs.appendFile(file, line, 'utf8');
    });
    // A failed append stays a rejection for its caller, while the next
    // independent record can proceed after the underlying fault is repaired.
    tail = run.catch(() => undefined);
    return run;
  };
}

export const appendCoordinatorAudit = createCoordinatorAuditWriter();
