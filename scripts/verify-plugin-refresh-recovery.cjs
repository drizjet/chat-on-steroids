// Built production renderer in isolated Electron; placeholder state, no provider or installed app.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { fixtureConfigSource } = require('./fixtures/app-defaults.cjs');
const root = path.resolve(__dirname, '..'), built = path.join(root, 'out/renderer');
const output = path.join(root, 'outputs/plugin-refresh-recovery');
const before = process.argv.includes('--before');
const { createHarness } = require('./lib/ui-harness.cjs');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}

const harness = createHarness({ name: 'plugin-refresh-recovery', width: 1100, height: 850, userData: path.join(output, 'runtime'), output });
let server;
const fixture = `${fixtureConfigSource()}
  localStorage.setItem('cos.ui.language', new URLSearchParams(location.search).get('lang') || 'en');
  const state = {config:fixtureConfig({ui:{theme:'dark',autoRefreshPlugins:true,lastSeenVersion:'${require('../package.json').version}'}}),
    pluginRefreshUnreadable:true,connectorSchemas:{},hasApiKey:false,hasGoalKey:false,
    status:{state:'disconnected',detail:'',publicUrl:null,localUrl:null,health:null,surfaces:[]},
    bridge:{running:false,paired:false,present:false},update:{current:'${require('../package.json').version}',latest:null,stage:'idle',error:null}};
  const ok=data=>Promise.resolve({ok:true,data}); let listener=()=>{};
  window.fixtureState=state; window.resetCalls=0;
  window.api=new Proxy({getState:()=>ok(state),getLog:()=>ok([]),listProjects:()=>ok([]),
    listSessions:()=>ok({sessions:[],activeId:null,pressure:[]}),listInputs:()=>ok([]),runningTools:()=>ok([]),
    getSwarm:()=>ok({running:false,agents:[],pendingReports:0}),getChatModels:()=>ok({state:'unknown',models:[]}),
    onStateChanged:fn=>{listener=fn;return()=>{}},
    resetPluginRefresh:()=>{window.resetCalls++;return new Promise(resolve=>window.finishReset=resolve)}
  },{get:(target,key)=>key in target?target[key]:String(key).startsWith('on')?()=>()=>{}:()=>ok(null)});
  window.fixturePush=()=>listener(structuredClone(state));`;

harness.ready().then(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixture); return; }
    const file = path.resolve(built, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(built + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp' }[path.extname(file)];
    if (type) res.setHeader('Content-Type', type);
    const data = fs.readFileSync(file);
    res.end(path.extname(file) === '.html' ? data.toString().replace('<head>', '<head><script src="/fixture.js"></script>') : data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.mkdirSync(output, { recursive: true });
  await harness.window();
  const js = code => harness.js(code);
  const pause = harness.pause;
  const open = async lang => {
    await harness.loadUrl('http://127.0.0.1:' + server.address().port + '/?lang=' + lang);
    await harness.until(`document.getElementById('versionLine').textContent.length>0`, 8000);
    await js(`document.querySelector('#tabs [data-tab="settings"]').click();document.getElementById('autoRefreshPlugins').closest('.setting').scrollIntoView({block:'center'})`);
    await pause(250);
  };
  await open('en');
  if (before) {
    assert.equal(await js(`!!document.getElementById('pluginRefreshRecovery')`), false);
    await harness.shot('before.png');
    await server.close();
    harness.finish();
    return;
  }
  assert.equal(await js('window.resetCalls'), 0);
  assert.equal(await js(`document.getElementById('pluginRefreshRecovery').hidden`), false);
  await harness.shot('after.png');
  await js(`document.getElementById('pluginRefreshReset').click();document.getElementById('pluginRefreshReset').click();window.fixturePush()`);
  assert.equal(await js('window.resetCalls'), 1);
  assert.equal(await js(`document.getElementById('pluginRefreshReset').disabled`), true);
  await js(`window.finishReset({ok:false,error:'Fixture write failed'})`);
  await harness.until(`!document.getElementById('pluginRefreshReset').disabled`, 8000);
  assert.match(await js(`document.getElementById('pluginRefreshRecoveryError').textContent`), /Could not reset/);
  await harness.shot('failed.png');
  await js(`document.getElementById('pluginRefreshReset').click();window.fixtureState.pluginRefreshUnreadable=false;window.finishReset({ok:true,data:structuredClone(window.fixtureState)})`);
  await harness.until(`document.getElementById('pluginRefreshRecovery').hidden`, 8000);
  assert.equal(await js('window.resetCalls'), 2);
  await harness.shot('recovered.png');
  for (const lang of ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'pt-PT', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW']) {
    harness.win.setSize(700, 600);
    await open(lang);
    await js(`document.getElementById('appearanceSize').value='18';document.getElementById('appearanceSize').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('pluginRefreshRecovery').scrollIntoView({block:'center'})`);
    const bounds = await js(`(()=>{const row=document.getElementById('pluginRefreshRecovery'),b=row.querySelector('button').getBoundingClientRect();return {overflow:row.scrollWidth>row.clientWidth+1,width:b.width,left:b.left,right:b.right,viewport:innerWidth,text:row.querySelector('b').textContent}})()`);
    assert.equal(bounds.overflow, false, lang);
    assert.ok(bounds.width > 0 && bounds.left >= 0 && bounds.right <= bounds.viewport, lang);
    if (lang !== 'en') assert.notEqual(bounds.text, 'Could not read plugin-refresh state', lang);
    if (lang === 'ja') await harness.shot('after-ja-narrow.png');
  }
  assert.deepEqual(harness.pageErrors, []);
  console.log('PASS: plugin refresh recovery, failure/retry, single click and 13 languages at 700x600 / 18px');
  await server.close();
  harness.finish();
}).catch(async error => {
  fs.mkdirSync(output, { recursive: true });
  if (harness.win && !harness.win.isDestroyed()) await harness.shot('failure.png');
  console.error(error);
  await server?.close();
  harness.onError(error);
});
