// Production renderer interaction proof for inline Skills and local-project file references.
// Uses synthetic project data and the isolated IPC fixture; no account or user files.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}
const { createHarness } = require('./lib/ui-harness.cjs');
const { fixtureConfigSource, BENIGN_RENDERER_ERRORS } = require('./fixtures/app-defaults.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp', 'composer-invocation');
const harness = createHarness({ name: 'composer-invocation', width: 1440, height: 960, userData: path.join(output, 'profile'), output, ignoreErrors: BENIGN_RENDERER_ERRORS });
harness.app.disableHardwareAcceleration();

const injected = `(() => {
  const old = window.api;
  const ok = data => Promise.resolve({ ok: true, data: structuredClone(data) });
  const project = { id: 'sample-project', name: 'Sample project', path: '/home/you/project', createdAt: 1 };
  window.composerFixture.summary.projectId = project.id;
  window.api = new Proxy({
    listProjects: () => ok([project]),
    markWhatsNewSeen: () => ok(true),
    listProjectFiles: (projectId, directory) => ok({
      projectId, projectName: project.name, directory, truncated: false,
      entries: directory
        ? [{ name: 'main.ts', path: directory + '/main.ts', kind: 'file', bytes: 120 }]
        : [
          { name: 'src', path: 'src', kind: 'directory', bytes: null },
          { name: 'README.md', path: 'README.md', kind: 'file', bytes: 80 }
        ]
    })
  }, { get: (target, key) => key in target ? target[key] : old[key] });
})();`;

let server;
const typeAt = async (text, position) => harness.js(`(() => {
  const input = document.getElementById('chatInput');
  input.value = ${JSON.stringify(text)};
  input.focus();
  input.setSelectionRange(${position}, ${position});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

harness.ready().then(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: false, root: path.join(root, 'src', 'renderer'),
    cacheDir: path.join(output, 'vite'), logLevel: 'error',
    resolve: { alias: { '@phosphor-icons/web': path.join(root, 'node_modules', '@phosphor-icons/web', 'src') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [{ name: 'composer-invocation-fixture', transformIndexHtml(html) {
      return html.replace('</head>', '<script src="/composer-invocation-fixture.js"></script></head>');
    }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== '/composer-invocation-fixture.js') return next();
      res.setHeader('Content-Type', 'text/javascript');
      res.end(fixtureConfigSource() + fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'composer-ui.js'), 'utf8') + injected);
    }); } }]
  });
  await server.listen();
  await harness.window({ webPreferences: { sandbox: true, offscreen: true } });
  const win = harness.win;
  await harness.loadUrl(server.resolvedUrls.local[0]);
  win.webContents.setZoomFactor(1);
  const capture = async name => {
    win.webContents.invalidate();
    await harness.js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await harness.pause(700);
    await harness.shot(name);
  };
  await harness.until(`!!document.querySelector('#sessionList [data-id="composer-preview"]')`, 5000);
  await harness.js(`document.querySelector('#sessionList [data-id="composer-preview"]').click()`);
  await harness.until(`!document.getElementById('chatInput').disabled`, 5000);

  const slash = 'Please use /rev while checking this project.';
  await typeAt(slash, 'Please use /rev'.length);
  await harness.until(`!!document.querySelector('#skillPicker [data-skill-id="code-review"]')`, 5000);
  await harness.js(`document.getElementById('skillPicker').hidden = true`);
  assert.equal(await harness.js(`document.getElementById('chatInput').value`), slash);
  await capture('before.png');
  await typeAt(slash, 'Please use /rev'.length);
  await harness.until(`!!document.querySelector('#skillPicker [data-skill-id="code-review"]')`, 5000);
  assert.equal(await harness.js(`!document.getElementById('skillPicker').hidden`), true);
  assert.equal(await harness.js(`document.getElementById('chatInput').value`), slash);
  await capture('slash-picker.png');
  await harness.js(`document.querySelector('#skillPicker [data-skill-id="code-review"]').click()`);
  await harness.until(`document.getElementById('chatInput').value === 'Please use code-review while checking this project.'`, 5000);
  assert.equal(await harness.js(`document.querySelector('#composerSelectedSkills [data-skill-id="code-review"]') !== null`), true);
  await harness.js(`document.querySelector('#composerSelectedSkills .composer-selected-skill-remove').click()`);
  await harness.until(`!document.querySelector('#composerSelectedSkills [data-skill-id="code-review"]')`, 5000);

  const mention = 'Please inspect @src in this project.';
  await typeAt(mention, 'Please inspect @src'.length);
  await harness.until(`!!document.querySelector('#skillPicker [data-file-path="src"]')`, 5000);
  assert.equal(await harness.js(`!document.getElementById('skillPicker').hidden`), true);
  assert.equal(await harness.js(`document.getElementById('chatInput').value`), mention);
  await capture('file-picker.png');
  await harness.js(`document.querySelector('#skillPicker [data-file-path="src"]').click()`);
  await harness.until(`!!document.querySelector('#skillPicker [data-file-path="src/main.ts"]')`, 5000);
  await harness.js(`document.querySelector('#skillPicker [data-file-path="src/main.ts"]').click()`);
  await harness.until(`document.getElementById('chatInput').value === 'Please inspect @src/main.ts in this project.'`, 5000);
  assert.deepEqual(harness.pageErrors, []);
  console.log('PASS: inline Skill and local-project file pickers preserve surrounding composer text');
  await server.close();
  harness.finish();
}).catch(async error => {
  if (harness.win && !harness.win.isDestroyed()) {
    try {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'failure.png'), (await harness.win.webContents.capturePage()).toPNG());
    } catch {}
  }
  console.error(error);
  await server?.close();
  harness.onError(error);
});
