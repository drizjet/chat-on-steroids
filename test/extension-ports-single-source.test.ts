import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BROWSER_BRIDGE_AUTO_PORTS, WAKE_MESSAGES } from '../src/shared/browser-bridge.js';
import { BRIDGE_PROTOCOL } from '../src/main/version.js';

// Auto discovers the bridge by scanning a fixed port list. The list lives in the shared module;
// the extension carries its own copy as `PORTS`. This test keeps the two from drifting apart.

const here = path.dirname(fileURLToPath(import.meta.url));

describe('extension port list', () => {
  it('matches BROWSER_BRIDGE_AUTO_PORTS exactly', () => {
    const text = readFileSync(path.resolve(here, '../extension/protocol.js'), 'utf8');
    const list = /export const PORTS = \[([^\]]+)\];/.exec(text)?.[1];
    expect(list, 'extension/protocol.js PORTS').toBeTruthy();
    const ports = (list ?? '').split(',').map(part => Number(part.trim()));
    expect(ports).toEqual([...BROWSER_BRIDGE_AUTO_PORTS]);
  });

  it('keeps background.js on the generated file instead of local literals', () => {
    const text = readFileSync(path.resolve(here, '../extension/background.js'), 'utf8');
    expect(text).toContain(`import { BRIDGE_PROTOCOL, PORTS } from './protocol.js';`);
    expect(text).not.toMatch(/^const PORTS =/m);
    expect(text).not.toMatch(/^const BRIDGE_PROTOCOL =/m);
  });

  it('regenerates to exactly the committed protocol.js', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-extension-protocol.mjs', '--check'], { cwd: path.resolve(here, '..'), encoding: 'utf8' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('keeps the bridge protocol number in step with the extension', () => {
    const text = readFileSync(path.resolve(here, '../extension/protocol.js'), 'utf8');
    const match = /export const BRIDGE_PROTOCOL = (\d+);/.exec(text);
    expect(match?.[1], 'extension/protocol.js BRIDGE_PROTOCOL').toBe(String(BRIDGE_PROTOCOL));
  });

  it('declares every x-extension header the browser sends', () => {
    const extensionText = readdirSync(path.resolve(here, '../extension'))
      .filter(name => name.endsWith('.js'))
      .map(name => readFileSync(path.resolve(here, '../extension', name), 'utf8'))
      .join('\n');
    const sent = new Set<string>();
    for (const match of extensionText.matchAll(/['"`](x-extension-[a-z-]+)['"`]/g)) sent.add(match[1] as string);
    expect(sent.size).toBeGreaterThan(0);
    const bridgeText = readFileSync(path.resolve(here, '../src/main/bridge.ts'), 'utf8');
    const allow = /access-control-allow-headers'\]\s*=\s*'([^']+)'/.exec(bridgeText)?.[1] ?? '';
    const allowed = new Set(allow.split(',').map(part => part.trim()));
    for (const header of sent) expect(allowed.has(header), header).toBe(true);
  });

  // The wake channel is the whole WebSocket conversation between the extension and the app.
  // Its vocabulary lives in WAKE_MESSAGES; the extension carries the same strings as literals,
  // and browser-wake.ts must consume the shared names instead of its own copies.
  it('enumerates the wake vocabulary on both sides of the channel', () => {
    expect(WAKE_MESSAGES).toEqual({
      route: '/wake', ping: 'ping', pong: 'pong', wake: 'wake', browserControl: 'browser-control'
    });
    const extension = readFileSync(path.resolve(here, '../extension/background.js'), 'utf8');
    expect(extension).toContain('/wake?host=');
    for (const message of ['ping', 'pong', 'wake', 'browser-control']) {
      expect(extension, `background.js must carry the ${message} literal`).toContain(`'${message}'`);
    }
    const wake = readFileSync(path.resolve(here, '../src/main/browser-wake.ts'), 'utf8');
    expect(wake).toContain(`from '../shared/browser-bridge.js'`);
    expect(wake).toContain('WAKE_MESSAGES.');
    expect(wake).not.toMatch(/send\('(?:ping|wake|browser-control)'\)/);
    expect(wake).not.toMatch(/message === 'pong'/);
    expect(wake).not.toMatch(/pathname !== '\/wake'/);
  });
});
