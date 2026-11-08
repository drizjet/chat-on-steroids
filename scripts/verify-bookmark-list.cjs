// Production renderer and real Chromium layout/input; synthetic conversations only (#1133).
// A chat with many bookmarks (#1719, up to 200): the header's list stays inside the window and
// scrolls, scrolling it keeps it open, and keyboard focus brings the item it moves to into view.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.env.COS_UI_ROOT || path.resolve(__dirname, '..');
const output = path.resolve(process.env.COS_UI_OUTPUT || path.join(root, '.tmp', 'bookmark-list'));
const { fixtureConfigSource, BENIGN_RENDERER_ERRORS } = require(path.join(root, 'scripts/fixtures/app-defaults.cjs'));
const { createHarness } = require('./lib/ui-harness.cjs');
fs.rmSync(path.join(output, 'profile'), { recursive: true, force: true });
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}

const harness = createHarness({ name: 'bookmark-list', width: 1280, height: 800, userData: path.join(output, 'profile'), output, ignoreErrors: BENIGN_RENDERER_ERRORS });
harness.app.disableHardwareAcceleration();
let server;
const fixture = `(() => {
 const old=window.api,f=composerFixture,ok=data=>Promise.resolve({ok:true,data:structuredClone(data)});
 f.summary.title='Plan the release';
 const marks=Array.from({length:200},(_,n)=>({messageId:'answer-'+n,excerpt:'Saved answer number '+(n+1)+': the plan, the decision and what came out of it.',messageTime:Date.now()-n*60000,at:Date.now()-n*1000}));
 const methods={
  getState:async()=>{const r=await old.getState();r.data.config=fixtureMerge(fixtureDefaults,r.data.config);r.data.config.ui={...r.data.config.ui,language:'en',theme:'dark'};return r;},
  listSessions:()=>ok({sessions:[{...f.summary,events:f.events.length}],activeId:null,pressure:[],blocked:[],trusted:[]}),
  listBookmarks:()=>ok(marks),
  locateMessage:()=>ok(null)
 };
 window.api=new Proxy(methods,{get:(target,key)=>key in target?target[key]:old[key]});
})();`;

harness.ready().then(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: false, root: path.join(root, 'src/renderer'), cacheDir: path.join(output, 'vite'), logLevel: 'error',
    resolve: { alias: { '@phosphor-icons/web': path.join(root, 'node_modules/@phosphor-icons/web/src') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, 'node_modules/@phosphor-icons/web/src'))] } },
    plugins: [{ name: 'bookmark-list-fixture', transformIndexHtml: html => html.replace('</head>', '<script src="/timeline-fixture.js"></script></head>'),
      configureServer(vite) { vite.middlewares.use((req, res, next) => { if (req.url !== '/timeline-fixture.js') return next(); res.setHeader('Content-Type', 'text/javascript'); res.end(fixtureConfigSource() + fs.readFileSync(path.join(root, 'scripts/fixtures/composer-ui.js'), 'utf8') + fixture); }); } }] });
  await server.listen();
  await harness.window();
  const win = harness.win;
  const js = code => harness.js(code);
  const pause = harness.pause;
  const until = expression => harness.until(expression, 15000);
  const settle = async () => { await js(`document.getAnimations().forEach(a=>{if(a.effect.getTiming().iterations!==Infinity)a.finish()})`); await pause(180); };
  const capture = async name => { await settle(); await harness.shot(name); };
  await harness.loadUrl(server.resolvedUrls.local[0]);
  const chatRow = `document.querySelector('#sessionList .sess[data-id]')`;
  await until(`!!${chatRow}`);
  win.show(); win.focus(); win.webContents.focus(); await pause(100);
  await js(`${chatRow}.click()`);
  await until(`!document.getElementById('chatBookmarks').hidden`); await settle();
  const menuBox = `(()=>{const m=document.querySelector('.row-menu');if(!m)return null;const r=m.getBoundingClientRect();return {top:r.top,bottom:r.bottom,innerHeight,scrollHeight:m.scrollHeight,clientHeight:m.clientHeight,items:m.querySelectorAll('[data-row-action="bookmark"]').length}})()`;
  const focusedVisible = `(()=>{const m=document.querySelector('.row-menu'),f=document.activeElement;if(!m||!m.contains(f))return 'focus not in menu';const a=m.getBoundingClientRect(),b=f.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1?true:'item '+Math.round(b.top)+'..'+Math.round(b.bottom)+' outside menu '+Math.round(a.top)+'..'+Math.round(a.bottom)})()`;
  for (const height of [800, 520]) {
    win.setContentSize(1280, height); await pause(300);
    await js(`document.getElementById('chatBookmarks').click()`); await settle();
    const box = await js(menuBox);
    assert.ok(box, 'The bookmark list opens');
    assert.equal(box.items, 200, 'Every bookmark is listed');
    assert.ok(box.top >= 7.5 && box.bottom <= box.innerHeight - 7.5, `The list stays inside the window at ${height}px: ` + JSON.stringify(box));
    assert.ok(box.scrollHeight > box.clientHeight + 50, 'The list scrolls: ' + JSON.stringify(box));
    await capture(`bookmarks-${height}.png`);
    await js(`(()=>{const m=document.querySelector('.row-menu');m.scrollTop=600;m.dispatchEvent(new Event('scroll'));})()`); await pause(150);
    assert.ok(await js(`!!document.querySelector('.row-menu')`), 'Scrolling the list keeps it open');
    for (const key of ['End', 'Home', 'ArrowUp', 'ArrowDown']) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key }); await pause(120);
      assert.equal(await js(focusedVisible), true, `After ${key} the focused bookmark is in view`);
    }
    await js(`document.querySelector('.row-menu')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await settle();
  }
  assert.deepEqual(harness.pageErrors, []);
  console.log('PASS: a long bookmark list stays inside the window, scrolls, stays open while scrolled, and keeps the focused bookmark in view');
  await server.close();
  harness.finish();
}).catch(async error => {
  fs.mkdirSync(output, { recursive: true });
  if (harness.win && !harness.win.isDestroyed()) await harness.shot('failure.png');
  console.error(error);
  await server?.close();
  harness.onError(error);
});
