/** Stage one main-bundle change against the actual installed package; never install here. */
import asar from '@electron/asar';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [installed, target] = process.argv.slice(2);
if (!installed || !target || !path.isAbsolute(installed) || !path.isAbsolute(target)) throw new Error('Supply absolute installed archive and new staging directory');
// Refuse reuse before reading payloads. In particular, the installed resources
// directory cannot be used as staging and overwritten before the final hash check.
await mkdir(target);
const replacement = await readFile(new URL('../out/main/index.js', import.meta.url));
if (!replacement.includes(Buffer.from('COS_COORDINATOR_BUILD_20261027_R2'))) throw new Error('Build the safety integration first');
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packaged = JSON.parse(asar.extractFile(installed, 'package.json').toString());
if (source.version !== packaged.version) throw new Error('Source version differs from installed package');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const before = digest(await readFile(installed)), streams = [], entries = new Map();
function visit(node, prefix = '', inherited = false) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const file = prefix + name, unpacked = inherited || Boolean(entry.unpacked);
    if (entry.files) { streams.push({ path: file, type: 'directory', unpacked }); visit(entry, file + '/', unpacked); }
    else if (entry.link) throw new Error('A symlink needs the original packaging workflow');
    else {
      const bytes = file === 'out/main/index.js' ? replacement : asar.extractFile(installed, path.normalize(file));
      entries.set(file, digest(bytes));
      streams.push({ path: file, type: 'file', unpacked, stat: { size: bytes.length, mode: entry.executable ? 0o755 : 0o644 }, streamGenerator: () => Readable.from(bytes) });
    }
  }
}
visit(asar.getRawHeader(installed).header);
const destination = path.join(target, 'app.asar');
await finished(await asar.createPackageFromStreams(destination, streams)); asar.uncache(destination);
for (const [file, hash] of entries) {
  if (digest(asar.extractFile(destination, path.normalize(file))) !== hash) throw new Error(`Staged entry mismatch: ${file}`);
  if (file !== 'out/main/index.js' && digest(asar.extractFile(installed, path.normalize(file))) !== hash) throw new Error(`Unrelated payload changed: ${file}`);
  if (Boolean(asar.statFile(installed, path.normalize(file)).unpacked) !== Boolean(asar.statFile(destination, path.normalize(file)).unpacked)) throw new Error('Unpack mapping changed');
}
if (digest(await readFile(installed)) !== before) throw new Error('Installed archive changed during staging');
const evidence = { preparedUtc: new Date().toISOString(), version: packaged.version, installedArchive: installed, installedSha256: before,
  stagedArchive: destination, stagedSha256: digest(await readFile(destination)), replacementMainSha256: digest(replacement), verifiedEntries: entries.size, changedEntries: ['out/main/index.js'] };
await writeFile(path.join(target, 'archive-evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
