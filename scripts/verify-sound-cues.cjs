// #1802: the three sounds, rendered by Chromium's own Web Audio (OfflineAudioContext) in real
// Electron, then measured: audible but well below full scale, short, and with no click where a
// note starts or ends. No sound device is needed and nothing is played aloud.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status ?? 1);
}
const { createHarness } = require('./lib/ui-harness.cjs');

const root = path.join(__dirname, '..');
const harness = createHarness({ name: 'sound-cues', height: 600 });

harness.ready().then(async () => {
  await harness.window({ webPreferences: { sandbox: true } });
  fs.mkdirSync(harness.outputDir, { recursive: true });
  const code = (await require('esbuild').build({ stdin: { contents: `export { scheduleSoundCue } from './src/renderer/sound-cues.ts';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'cues', logLevel: 'error' })).outputFiles[0].text;
  await harness.loadHtml('<!doctype html><title>sounds</title>');
  await harness.js(code);
  const results = {};
  for (const kind of ['finished', 'needs-you', 'failed']) {
    const measured = await harness.js(`(async () => {
      const rate = 48000, audio = new OfflineAudioContext(1, rate, rate);
      cues.scheduleSoundCue(audio, ${JSON.stringify(kind)}, 0);
      const data = (await audio.startRendering()).getChannelData(0);
      let peak = 0, sum = 0, jump = 0, first = -1, last = -1;
      for (let i = 0; i < data.length; i++) {
        const value = Math.abs(data[i]);
        peak = Math.max(peak, value); sum += data[i] * data[i];
        if (value > 0.001) { if (first < 0) first = i; last = i; }
        if (i) jump = Math.max(jump, Math.abs(data[i] - data[i - 1]));
      }
      const heard = data.slice(first, last + 1);
      const rms = Math.sqrt(heard.reduce((total, value) => total + value * value, 0) / heard.length);
      return { peak, rms, seconds: (last - first) / rate, start: Math.abs(data[Math.max(0, first)]), end: Math.abs(data[last]), jump,
        tail: Math.max(...data.slice(last + 1).map(Math.abs), 0) };
    })()`);
    results[kind] = measured;
    assert.ok(measured.rms > 0.02, `${kind} is audible: ${JSON.stringify(measured)}`);
    assert.ok(measured.peak <= 0.13, `${kind} stays quiet: ${JSON.stringify(measured)}`);
    assert.ok(measured.seconds > 0.15 && measured.seconds < 0.6, `${kind} is short: ${JSON.stringify(measured)}`);
    assert.ok(measured.start < 0.01 && measured.end < 0.01 && measured.tail < 0.001, `${kind} fades in and out: ${JSON.stringify(measured)}`);
    assert.ok(measured.jump < 0.03, `${kind} has no click: ${JSON.stringify(measured)}`);
  }
  fs.writeFileSync(path.join(harness.outputDir, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log('Passed: the three sounds render audible, at most 0.13 of full scale, under 0.6 s, fading in and out with no click.');
  harness.finish();
}).catch(error => harness.onError(error));
