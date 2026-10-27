import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { createCoordinatorAuditWriter } from '../src/main/coordinator-audit.js';

const directories: string[] = [];
async function directory() { const root = await makeTempDir('coordinator-audit-'); directories.push(root); return root; }
afterEach(async () => { for (const root of directories.splice(0)) await removeTempDir(root); });

describe('coordinator-owned audit rotation', () => {
  it('serializes concurrent append/rotation without dropping or duplicating records', async () => {
    const root = await directory(), write = createCoordinatorAuditWriter(150);
    await Promise.all(Array.from({ length: 15 }, (_, seq) => write(root, { phase: 'fixture', seq })));
    const archives = (await fs.readdir(path.join(root, 'audit-archive'))).sort();
    expect(archives.length).toBeGreaterThan(0);
    const records: { seq: number }[] = [];
    for (const file of archives) records.push(...(await fs.readFile(path.join(root, 'audit-archive', file), 'utf8')).trim().split('\n').map(s => JSON.parse(s)));
    records.push(...(await fs.readFile(path.join(root, 'TOOL_POLICY_AUDIT.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s)));
    expect(records.map(r => r.seq).sort((a, b) => a-b)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('retains the exact old bytes and excludes raw failure/reason strings from new records', async () => {
    const root = await directory(), write = createCoordinatorAuditWriter(80);
    const original = Buffer.from('{"historical":"retained"}\n'.repeat(5));
    await fs.writeFile(path.join(root, 'TOOL_POLICY_AUDIT.jsonl'), original);
    await write(root, { phase: 'failed', error: 'SECRET provider body', reason: 'SECRET task reason' });
    const files = await fs.readdir(path.join(root, 'audit-archive'));
    expect(await fs.readFile(path.join(root, 'audit-archive', files[0]!))).toEqual(original);
    const text = await fs.readFile(path.join(root, 'TOOL_POLICY_AUDIT.jsonl'), 'utf8');
    expect(text).not.toContain('SECRET');
    const record = JSON.parse(text);
    expect(record.errorCode).toBe('OPERATION_FAILED');
    expect(record.errorDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.reasonDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps an append error visible and allows the next independent record after repair', async () => {
    const root = await directory(), write = createCoordinatorAuditWriter();
    const target = path.join(root, 'TOOL_POLICY_AUDIT.jsonl');
    await fs.mkdir(target);
    await expect(write(root, { seq: 1 })).rejects.toThrow();
    await fs.rmdir(target);
    await write(root, { seq: 2 });
    expect(JSON.parse(await fs.readFile(target, 'utf8')).seq).toBe(2);
  });

  it('refuses a linked archive directory before moving the active history', async () => {
    const root = await directory(), write = createCoordinatorAuditWriter(10);
    const target = path.join(root, 'TOOL_POLICY_AUDIT.jsonl');
    await fs.writeFile(target, '{"old":true}\n');
    await fs.mkdir(path.join(root, 'other'));
    await fs.symlink(path.join(root, 'other'), path.join(root, 'audit-archive'), 'junction');
    await expect(write(root, { next: true })).rejects.toThrow('COORDINATOR_AUDIT_LINKED_ARCHIVE');
    expect(await fs.readFile(target, 'utf8')).toBe('{"old":true}\n');
  });
});
