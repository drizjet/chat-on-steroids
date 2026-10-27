import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';

it('refuses an existing staging directory before reading or replacing archive payloads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-stage-refusal-'));
  try {
    const installed = path.join(root, 'app.asar'), existing = path.join(root, 'existing');
    await fs.writeFile(installed, 'synthetic installed archive'); await fs.mkdir(existing);
    await fs.writeFile(path.join(existing, 'app.asar'), 'existing artifact');
    const execute = promisify(execFile);
    await expect(execute(process.execPath, [path.resolve('scripts/stage-coordinator-archive.mjs'), installed, existing], { windowsHide: true }))
      .rejects.toThrow(/EEXIST/);
    expect(await fs.readFile(installed, 'utf8')).toBe('synthetic installed archive');
    expect(await fs.readFile(path.join(existing, 'app.asar'), 'utf8')).toBe('existing artifact');
    // The source directory itself is also an existing destination; it must be refused.
    await expect(execute(process.execPath, [path.resolve('scripts/stage-coordinator-archive.mjs'), installed, root], { windowsHide: true }))
      .rejects.toThrow(/EEXIST/);
    expect(await fs.readFile(installed, 'utf8')).toBe('synthetic installed archive');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
