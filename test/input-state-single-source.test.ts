import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The outbox state vocabularies belong to shared/input.ts. This scans the source tree so a new
// literal list cannot quietly reintroduce the drift these predicates were extracted to remove.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
const allowed = path.join('shared', 'input.ts');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN: RegExp[] = [
  /\[\s*'sent'\s*,\s*'cancelled'\s*\]/,
  /\[\s*'sent'\s*,\s*'cancelled'\s*,\s*'failed'\s*\]/,
  /\[\s*'sent'\s*,\s*'failed'\s*,\s*'cancelled'\s*\]/,
  /\[\s*'cancelled'\s*,\s*'failed'\s*\]/,
  /\[\s*'queued'\s*,\s*'browser'\s*,\s*'tool'\s*\]/,
  /\[\s*'queued'\s*,\s*'tool'\s*,\s*'browser'\s*\]/,
  /'off'\s*\|\s*'goal'\s*\|\s*'loop'/
];

describe('input state vocabulary', () => {
  it('is defined once, in shared/input.ts', () => {
    const offenders: string[] = [];
    for (const file of walk(src)) {
      if (file.endsWith(allowed)) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        const match = pattern.exec(text);
        if (match) offenders.push(`${path.relative(src, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
