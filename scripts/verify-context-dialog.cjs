// Real Electron check of the context dialog: one fact per row, and every row fits the 310px
// dialog in all interface languages. Synthetic IPC only; no account, provider or installed app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/context-dialog');
const { createHarness } = require('./lib/ui-harness.cjs');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}

const harness = createHarness({ name: 'context-dialog', width: 1440, height: 960, userData: path.join(output, 'profile'), output });
harness.app.disableHardwareAcceleration();
const pause = harness.pause;
const MODELS = `[
  {id:'gpt-5-6',label:'5.6 Instant',efforts:['none']},
  {id:'gpt-5-6-thinking',label:'5.6 Thinking',efforts:['medium','high','xhigh']},
  {id:'gpt-6-sol',label:'GPT-6 Sol',efforts:['low','medium','high','xhigh','max','ultra']}]`;
let server;

harness.ready().then(async () => {
  const { createServer } = await import('vite');
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/composer-ui.js'), 'utf8')
    .replace(/models:\[\s*\{id:'gpt-6-sol'[\s\S]*?\n \]\};/, `models:${MODELS}};`);
  assert.ok(fixture.includes("'5.6 Instant'"), 'fixture model list replaced');
  server = await createServer({ configFile: false, root: path.join(root, 'src/renderer'),
    cacheDir: path.join(output, 'vite'), logLevel: 'error',
    resolve: { alias: { '@phosphor-icons/web': path.join(root, 'node_modules/@phosphor-icons/web/src') } },
    server: { host: '127.0.0.1', port: 4422, strictPort: true, fs: { allow: [root] } },
    plugins: [{ name: 'ipc-fixture', transformIndexHtml(html) {
      return html.replace('</head>', '<script src="/composer-fixture.js"></script></head>');
    }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== '/composer-fixture.js') return next();
      res.setHeader('Content-Type', 'text/javascript'); res.end(fixture);
    }); } }]
  });
  await server.listen();
  await harness.window();
  const win = harness.win;
  const js = source => harness.js(source);
  const capture = async name => harness.shot(name + '.png');
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(250); };
  const mouse = (type, x, y, held = false) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(held ? { modifiers: ['leftButtonDown'] } : {}) });
  const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(260); };
  const state = () => js(`(() => { const s = document.querySelector('#composerPowerChoices input'), t = document.querySelector('.power-track');
    return { slider: !!s, value: s ? Number(s.value) : null, fraction: t ? Number(t.style.getPropertyValue('--power-fraction')) : null,
      stops: document.querySelectorAll('.power-track .power-stop').length, endpoints: !!document.querySelector('#composerPowerChoices .effort-endpoints'),
      effort: document.getElementById('composerReasoning').value, subtitle: document.getElementById('composerPowerModel').textContent,
      label: document.getElementById('composerModelLabel').textContent,
      rect: s ? s.getBoundingClientRect().toJSON() : null }; })()`);
  try {
    await harness.loadUrl('http://127.0.0.1:4422'); await pause(2200);
    await js(`document.querySelector('#sessionList [data-id="composer-preview"]').click()`); await pause(500);
    const languages = [...new Set(await js(`[...document.querySelectorAll('#uiLanguage option')].map(o=>o.value)`))];
    assert.ok(languages.length >= 11, 'all interface languages: ' + languages.join(','));
    const results = [];
    for (const auto of [true, false]) {
      await js(`window.api.saveSettings({compaction:{auto:${auto},autoTokens:300000}})`); await pause(300);
      for (const language of languages) {
        await js(`(()=>{const s=document.getElementById('uiLanguage');s.value=${JSON.stringify('LANG')};s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`.replace('LANG', language));
        await pause(500);
        await js(`(()=>{const m=document.getElementById('contextMeter');if(!m.classList.contains('pinned'))document.getElementById('contextMeterButton').click();return 1})()`);
        await pause(300);
        const r = await js(`(()=>{const d=document.getElementById('contextMeterInfo'),box=d.getBoundingClientRect();
          const rows=[...d.querySelectorAll('.context-data dt')].filter(dt=>!dt.hidden).map(dt=>{const dd=dt.nextElementSibling,a=dt.getBoundingClientRect(),b=dd.getBoundingClientRect();
            return {label:dt.textContent,value:dd.textContent,inside:a.left>=box.left-1&&b.right<=box.right+1,overlap:a.right>b.left+1&&Math.abs(a.top-b.top)<4,clipped:dt.scrollWidth>dt.clientWidth+1||dd.scrollWidth>dd.clientWidth+1}});
          return {lang:document.documentElement.lang,rows,inViewport:box.left>=0&&box.right<=innerWidth&&box.top>=0}})()`);
        results.push(r);
        assert.equal(r.rows.length, auto ? 3 : 4, language + ': ' + (auto ? 'three' : 'four') + ' rows');
        assert.equal(r.rows.some(row => /4\d\d/.test(row.value) && auto), false, language + ': no derived limit shown while compaction is on');
        assert.ok(r.inViewport, language + ': dialog visible');
        for (const row of r.rows) {
          assert.ok(row.inside && !row.overlap && !row.clipped, language + ': row fits: ' + JSON.stringify(row));
          assert.ok(row.value.trim().length > 0 && !/undefined|NaN|\{\d\}/.test(row.value + row.label), language + ': row has a value: ' + JSON.stringify(row));
        }
        if (['en', 'de', 'pt-BR'].includes(language)) await capture('context-' + language + (auto ? '' : '-auto-off'));
      }
    }
    await js(`(()=>{const s=document.getElementById('uiLanguage');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    assert.deepEqual(harness.pageErrors, [], 'no renderer errors');
    console.log('PASS: context dialog rows fit in ' + languages.length + ' languages, with automatic compaction on and off. ' + output);
    await server.close();
    harness.finish();
  } catch (error) {
    console.error(error);
    await server?.close();
    harness.onError(error);
  }
}).catch(async error => {
  console.error(error);
  await server?.close();
  harness.onError(error);
});
