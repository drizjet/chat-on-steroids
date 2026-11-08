// Isolated Chromium hit testing of the production connection overlay and CSS.
const { withoutScripts } = require('./ui-check-page.cjs');
const { createHarness } = require('./lib/ui-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}

const harness = createHarness({ name: 'connection-layer', height: 800 });

harness.ready().then(async () => {
  await harness.window({ webPreferences: { sandbox: true } });
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const html = withoutScripts(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')).replace(/<link\b[^>]*>/gi, '');
  const main = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
  const relocation = main.match(/document\.body\.append\(\$\('connectionPopover'\)\);/)?.[0];
  assert.ok(relocation, 'Production initialization must escape the sidebar containing block');
  await harness.loadHtml(html.replace('</head>', `<style>${css}</style></head>`));
  const results = [];
  for (const translucent of [false, true]) for (const files of [false, true]) {
    const result = await harness.js(`(() => {
      const $ = id => document.getElementById(id);
      document.documentElement.dataset.translucentSidebar = '${translucent}';
      document.documentElement.style.setProperty('--sidebar-color', '#1a2129');
      document.querySelector('[data-panel="chat"]').classList.toggle('has-file-panel', ${files});
      const popup = $('connectionPopover');
      popup.hidden = false;
      // Fixed overlap reproduces the reported paint boundary independently of window size.
      const composer = document.querySelector('.composer');
      composer.style.cssText = 'position:fixed;left:250px;bottom:24px;width:400px;height:130px;display:block';
      popup.style.cssText = 'left:100px;bottom:56px;width:300px';
      document.querySelector('.connection-anchor').append(popup);
      const hit = () => popup.contains(document.elementFromPoint(275, innerHeight - 100));
      const before = hit();
      ${relocation}
      return { before, after: hit(), outsideSidebar: popup.parentElement === document.body };
    })()`);
    assert.equal(result.after, true, JSON.stringify({ translucent, files, result }));
    assert.equal(result.outsideSidebar, true);
    if (translucent) assert.equal(result.before, false, 'Must reproduce the original occlusion');
    results.push({ translucent, files, ...result });
  }
  fs.mkdirSync(harness.outputDir, { recursive: true });
  fs.writeFileSync(path.join(harness.outputDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Connection overlay hit tests passed: ' + JSON.stringify(results));
  harness.finish();
}).catch(error => harness.onError(error));
