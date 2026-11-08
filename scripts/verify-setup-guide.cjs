// Real Chromium layout for the setup guide, using the production modules and styles.
// Serves a UI-only fixture; no app backend, credentials, browser pairing or tunnel is started.
const { withoutScripts } = require('./ui-check-page.cjs');
const fs = require('node:fs');
const path = require('node:path');
const LANGUAGES = 1 + require('node:fs').readdirSync(path.join(__dirname, '../src/renderer/locales')).filter(name => name.endsWith('.json')).length;
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}
const { createHarness } = require('./lib/ui-harness.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'outputs/setup-guide');
const harness = createHarness({ name: 'setup-guide', width: 1100, height: 900, userData: path.resolve(__dirname, '../outputs/setup-guide-runtime'), output });

harness.ready().then(async () => {
  const { createServer } = await import('vite');
  fs.mkdirSync(output, { recursive: true });
  // Pixel data and transparency are sufficient for these PNGs; reject embedded metadata.
  for (const name of fs.readdirSync(path.join(root, 'src/renderer/setup-images'))) {
    if (!name.endsWith('.png')) continue;
    const bytes = fs.readFileSync(path.join(root, 'src/renderer/setup-images', name));
    let offset = 8;
    while (offset < bytes.length) {
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      assert.ok(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'].includes(type), `${name}: unexpected metadata ${type}`);
      offset += bytes.readUInt32BE(offset) + 12;
      if (type === 'IEND') break;
    }
    assert.equal(offset, bytes.length, `${name}: trailing data`);
  }
  const server = await createServer({ configFile: false, root: path.join(root, 'src/renderer'),
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'setup-fixture', configureServer(vite) {
      vite.middlewares.use('/setup-preview.html', async (_request, response) => {
        const source = withoutScripts(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'))
          .replace('</body>', `<script type="module">
            import { initSetupGuide } from '/setup-guide.ts';
            import { initLanguage, setLanguage, t } from '/i18n.ts';
            initLanguage(); initSetupGuide(); window.setLanguage = setLanguage; window.t = t;
            document.querySelector('.app').dataset.screen = 'settings';
            for (const p of document.querySelectorAll('.panel')) p.classList.toggle('is-active', p.dataset.panel === 'setup');
            document.getElementById('tabs').hidden = false;
            document.getElementById('desktopTunnelField').hidden = false;
            window.fixtureReady = true;
          </script></body>`);
        response.setHeader('Content-Type', 'text/html');
        response.end(await vite.transformIndexHtml('/setup-preview.html', source));
      });
    } }] });
  try {
    await server.listen();
    await harness.window({ webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: false } });
    const win = harness.win;
    await harness.loadUrl(server.resolvedUrls.local[0] + 'setup-preview.html');
    const ready = await harness.js('window.fixtureReady');
    assert.equal(ready, true);
    const results = [];
    for (const [width, height, zoom, language, theme] of [
      [1100, 900, 1, 'en', 'dark'], [800, 650, 1, 'en', 'dark'], [1100, 900, 1, 'de', 'dark'],
      [1100, 900, 1.5, 'zh-CN', 'light'], [640, 720, 1, 'zh-CN', 'dark'],
      [800, 650, 1, 'es', 'dark'], [800, 650, 1, 'zh-TW', 'light'],
      [1100, 900, 1, 'ja', 'dark'], [1100, 900, 1.5, 'ja', 'light'], [640, 720, 1, 'ja', 'dark'],
      [1100, 900, 1, 'tr', 'dark'], [1100, 900, 1.5, 'tr', 'light'], [640, 720, 1, 'tr', 'dark'],
      [1100, 900, 1, 'fr', 'dark'], [1100, 900, 1.5, 'fr', 'light'], [640, 720, 1, 'fr', 'dark'],
      [1100, 900, 1, 'pt-PT', 'dark'], [1100, 900, 1.5, 'pt-PT', 'light'], [640, 720, 1, 'pt-PT', 'dark'],
      [1100, 900, 1, 'ru', 'dark'], [1100, 900, 1.5, 'ru', 'light'], [640, 720, 1, 'ru', 'dark'],
      [1100, 900, 1, 'vi', 'dark'], [1100, 900, 1.5, 'vi', 'light'], [640, 720, 1, 'vi', 'dark']
    ]) {
      win.setSize(width, height);
      win.webContents.setZoomFactor(zoom);
      await harness.js(`window.setLanguage('${language}')`);
      await harness.js(`document.documentElement.dataset.theme = '${theme}'`);
      const header = await harness.js(`(async () => {
        const panel = document.querySelector('[data-panel="setup"]'); panel.scrollTop = 0;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const tabs = panel.querySelector('.language-tabs'), title = panel.querySelector('.setup-heading h1');
        const bounds = tabs.getBoundingClientRect(), heading = title.getBoundingClientRect();
        const buttons = [...tabs.querySelectorAll('button')];
        return {
          overflow: panel.scrollWidth > panel.clientWidth,
          separated: heading.right <= bounds.left || heading.bottom <= bounds.top,
          // One flag per shipped language (English plus each locale catalog), about 46px each.
          compact: bounds.width <= buttons.length * 46,
          flagsOnly: buttons.length === ${LANGUAGES} && buttons.every(button => !button.textContent.trim() && button.querySelector('svg')),
          labeled: buttons.every(button => button.title && button.title === button.getAttribute('aria-label')),
          selected: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.language),
          reachable: buttons.every(button => {
            const r = button.getBoundingClientRect();
            return r.width >= 36 && r.height >= 32 && r.left >= 0 && r.right <= innerWidth
              && r.top >= 0 && r.bottom <= innerHeight && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          })
        };
      })()`);
      assert.deepEqual(header, { overflow:false, separated:true, compact:true, flagsOnly:true, labeled:true, selected:[language], reachable:true }, JSON.stringify({width, zoom, language, header}));
      results.push({ kind:'header', width, zoom, language, theme, ...header });
      // Let the offscreen compositor publish the scrolled header before capturing it.
      await harness.pause(100);
      fs.writeFileSync(path.join(output, `${language}-${width}-${zoom}-header.png`), (await win.webContents.capturePage()).toPNG());
      const emptyFields = await harness.js(`(() => {
        return [...document.querySelectorAll('.setup-required')].every(input => {
          const empty = getComputedStyle(input).backgroundColor;
          input.classList.remove('is-empty');
          const filled = getComputedStyle(input).backgroundColor;
          input.classList.add('is-empty');
          return empty !== filled;
        });
      })()`);
      assert.equal(emptyFields, true, 'Empty required fields must have a distinct tint');
      // Each step's pictures sit in a carousel inside that step; only the open step is on screen.
      const groups = await harness.js(`[...document.querySelectorAll('[data-setup-guide]')]
        .map(host => [host.dataset.setupGuide, host.querySelectorAll('.guide-frame').length]).filter(([, count]) => count > 0)`);
      // Sign-in (two browsers), tunnel, API key and plugin; ChatGPT's Developer mode switch is gone.
      assert.ok(groups.length >= 5, 'Setup has its picture guides: ' + JSON.stringify(groups));
      for (const [group, count] of groups) {
        for (let index = 0; index < count; index++) {
          const selector = `[data-setup-guide="${group}"]`;
          const measured = await harness.js(`(async () => {
            const host = document.querySelector('${selector}');
            const step = host.closest('.step');
            for (const other of document.querySelectorAll('.wizard > .step')) other.classList.toggle('is-open', other === step);
            for (let node = host; node && node !== step; node = node.parentElement) node.hidden = false;
            const frames = [...host.querySelectorAll('.guide-frame')];
            host.querySelectorAll('.guide-dot')[${index}]?.click();
            await Promise.all([...host.querySelectorAll('img')].map(img => img.decode()));
            const frame = frames[${index}];
            frame.scrollIntoView({block:'center'});
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const panel = host.closest('.panel');
            const picture = frame.querySelector('.guide-picture').getBoundingClientRect();
            return { imageLoaded: frame.querySelector('img').naturalWidth > 0, overflow: panel.scrollWidth > panel.clientWidth,
              shown: !frame.hidden && picture.height > 0 && frames.filter(other => !other.hidden).length === 1,
              labelled: frame.getAttribute('aria-label') === window.t('Enlarge image'),
              spotsFit: [...frame.querySelectorAll('.guide-spot')].every(n => {
                const r = n.getBoundingClientRect();
                return r.left >= picture.left - 1 && r.right <= picture.right + 1 && r.top >= picture.top - 1 && r.bottom <= picture.bottom + 1;
              })
            };
          })()`);
          assert.deepEqual(measured, { imageLoaded: true, overflow: false, shown: true, labelled: true, spotsFit: true }, JSON.stringify({ group, index, width, zoom, measured }));
          results.push({ group, index, width, zoom, language, theme, ...measured });
          // Image decoding/layout can finish before the offscreen compositor publishes its tile.
          await harness.pause(100);
          fs.writeFileSync(path.join(output, `${language}-${width}-${zoom}-${group}-${index}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
    // Use Chromium's native button activation, then reload to check the new locale.
    await harness.js(`document.querySelector('[data-language="en"]').focus()`);
    const key = async keyCode => {
      win.webContents.sendInputEvent({type:'keyDown', keyCode});
      if (keyCode === 'Enter') win.webContents.sendInputEvent({type:'char', keyCode:'\r'});
      win.webContents.sendInputEvent({type:'keyUp', keyCode});
      await harness.js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    // Each step moves focus to another flag and activates it natively (Enter or Space); the page must
    // switch to exactly the focused language. Derived from the live focus, not a fixed flag order.
    const focused = () => harness.js('document.activeElement.dataset.language');
    const lang = () => harness.js('document.documentElement.lang');
    const visited = new Set(['en']);
    let last = 'en';
    for (const [tabs, activation] of [[1, 'Enter'], [2, 'Space'], [1, 'Space'], [1, 'Space']]) {
      for (let i = 0; i < tabs; i++) await key('Tab');
      const target = await focused();
      assert.ok(target && target !== last, 'Tab reaches another language flag: ' + target);
      await key(activation);
      assert.equal(await lang(), target, activation + ' activates the focused language');
      visited.add(target); last = target;
    }
    assert.ok(visited.size >= 4, 'Keyboard reached several languages: ' + [...visited].join(','));
    await harness.loadUrl(server.resolvedUrls.local[0] + 'setup-preview.html');
    assert.deepEqual(await harness.js(`({language:document.documentElement.lang,
      selected:document.querySelector('[data-language="${last}"]').getAttribute('aria-pressed'),
      preference:document.getElementById('uiLanguage').value})`), {language:last, selected:'true', preference:last});
    // Native modal, Escape dismissal and focus restoration must work without opening a browser.
    await harness.js(`(() => {
      const host=document.querySelector('[data-setup-guide="plugin"]');
      for (const step of document.querySelectorAll('.wizard > .step')) step.classList.toggle('is-open', step === host.closest('.step'));
      host.querySelectorAll('.guide-dot')[1].click();
      const button=host.querySelectorAll('.guide-frame')[1];
      button.focus(); button.click();
    })()`);
    assert.equal(await harness.js('document.querySelector(".setup-image-dialog").open'), true);
    fs.writeFileSync(path.join(output, 'enlarged.png'), (await win.webContents.capturePage()).toPNG());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESCAPE' });
    await harness.js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await harness.js('document.querySelector(".setup-image-dialog").open'), false);
    assert.equal(await harness.js('document.activeElement.getAttribute("aria-label")'), await harness.js('window.t("Enlarge image")'));
    const details = await harness.js(`(() => {
      const d=document.getElementById('desktopTunnelField'); const initial=d.open;
      d.querySelector('summary').click(); return { initial, opened:d.open };
    })()`);
    assert.deepEqual(details, { initial: false, opened: true });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`PASS: ${results.length} setup/header layouts; native language keyboard controls and persistence; modal/Escape/focus and optional disclosure.`);
  } finally {
    await server.close();
  }
  harness.finish();
}).catch(error => { console.error(error); harness.onError(error); });
