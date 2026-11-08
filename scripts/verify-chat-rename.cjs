// Production renderer and real Chromium layout/input; synthetic conversations only (#1107).
// Naming a chat in the sidebar: the field takes the row (the hover actions step aside), survives the
// sidebar's activity repaints as the same node, and Enter, Escape and an empty name do what they say.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exit(result.status ?? 1);
}
const { createHarness } = require('./lib/ui-harness.cjs');
const root = process.env.COS_UI_ROOT || path.resolve(__dirname, '..');
const output = path.resolve(process.env.COS_UI_OUTPUT || path.join(root, '.tmp', 'chat-rename'));
const { fixtureConfigSource, BENIGN_RENDERER_ERRORS } = require(path.join(root, 'scripts/fixtures/app-defaults.cjs'));
const harness = createHarness({ name: 'chat-rename', width: 1280, height: 800, userData: path.join(output, 'profile'), output, ignoreErrors: BENIGN_RENDERER_ERRORS });
harness.app.disableHardwareAcceleration();
let server;
const fixture = `(() => {
 const old=window.api,f=composerFixture,ok=data=>Promise.resolve({ok:true,data:structuredClone(data)});
 f.summary.title='Write a haiku about snow. Do not use any tools.';
 f.summary.updatedAt=Date.now()-3*3600000; f.summary.lastToolCallAt=null; f.summary.activityExpiresAt=null;
 const others=[1,2,3].map(n=>({...f.summary,id:'other-chat-'+n,title:['Fix the flaky bridge test','Plan the release notes','Review the dashboard layout'][n-1],
  conversationId:'other-conversation-'+n,chatIds:['other-conversation-'+n],updatedAt:f.summary.updatedAt-n*60000}));
 window.renames=[];
 window.fixtureTheme='dark';
 window.setTheme=async theme=>{window.fixtureTheme=theme;const r=await methods.getState();f.emit('onStateChanged',r.data);};
 window.repaint=()=>{f.summary.updatedAt++;f.emit('onSessionChanged',{allTranscripts:true});};
 const methods={
  getState:async()=>{const r=await old.getState();r.data.config=fixtureMerge(fixtureDefaults,r.data.config);r.data.config.ui={...r.data.config.ui,language:'en',theme:window.fixtureTheme};return r;},
  listSessions:()=>ok({sessions:[{...f.summary,events:f.events.length},...others],activeId:null,pressure:[],blocked:[],trusted:[]}),
  renameSession:(id,title)=>{window.renames.push([id,title]);const row=id===f.summary.id?f.summary:others.find(o=>o.id===id);
   if(row){if(title){row.autoTitle=row.autoTitle||{title:row.title,source:'fallback'};row.title=title;row.titleSource='manual';}
   else if(row.autoTitle){row.title=row.autoTitle.title;delete row.autoTitle;row.titleSource='fallback';}}
   return ok(true);}
 };
 window.api=new Proxy(methods,{get:(target,key)=>key in target?target[key]:old[key]});
})();`;
harness.ready().then(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ configFile:false, root:path.join(root,'src/renderer'), cacheDir:path.join(output,'vite'), logLevel:'error',
    resolve:{alias:{'@phosphor-icons/web':path.join(root,'node_modules/@phosphor-icons/web/src')}},
    server:{host:'127.0.0.1',port:0,fs:{allow:[root,fs.realpathSync(path.join(root,'node_modules/@phosphor-icons/web/src'))]}},
    plugins:[{name:'chat-rename-fixture',transformIndexHtml:html=>html.replace('</head>','<script src="/timeline-fixture.js"></script></head>'),
      configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/timeline-fixture.js')return next();res.setHeader('Content-Type','text/javascript');res.end(fixtureConfigSource()+fs.readFileSync(path.join(root,'scripts/fixtures/composer-ui.js'),'utf8')+fixture);});}}] });
  await server.listen();
  await harness.window({ webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } });
  const win = harness.win;
  const js=code=>harness.js(code);
  const until=async expression=>{await harness.until(expression, 15000);};
  const settle=async()=>{await js(`document.getAnimations().forEach(a=>{if(a.effect.getTiming().iterations!==Infinity)a.finish()})`);await harness.pause(180);};
  const capture=async name=>{await settle();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());};
  const row=`document.querySelector('#sessionList [data-id="other-chat-1"]')`;
  const field=`document.querySelector('.sess-rename')`;
  const key=async name=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:name});win.webContents.sendInputEvent({type:'keyUp',keyCode:name});await harness.pause(120);};
  await harness.loadUrl(server.resolvedUrls.local[0]);
  await until(`!!${row}?.querySelector('.row-menu-button')`);
  // Rename is an item of the row's menu (the "⋯" button, or a right click on the row).
  const rename=async()=>{await js(`${row}.querySelector('.row-menu-button').click()`);await until(`!!document.querySelector('.row-menu [data-row-action="rename"]')`);await js(`document.querySelector('.row-menu [data-row-action="rename"]').click()`);};
  win.show(); win.focus(); win.webContents.focus(); await harness.pause(100);

  for (const theme of ['dark','light']) {
    await js(`setTheme(${JSON.stringify(theme)})`);
    await until(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
    // One "⋯" sits on the hovered or focused row; its menu holds Rename and the other actions.
    await js(`${row}.querySelector('.sess-top').focus()`);
    await settle();
    assert.equal(await js(`getComputedStyle(${row}.querySelector('.sess-actions')).display`),'flex');
    assert.equal(await js(`${row}.querySelectorAll('.sess-actions button').length`),1);
    await js(`${row}.querySelector('.row-menu-button').click()`);
    await until(`!!document.querySelector('.row-menu')`);
    await capture(`${theme}-actions.png`);
    await js(`document.querySelector('.row-menu [data-row-action="rename"]').click()`);
    await until(`!!${field}`);
    await settle();
    // The field takes the row: the actions step aside instead of squeezing it.
    assert.equal(await js(`getComputedStyle(${row}.querySelector('.sess-actions')).display`),'none','Actions hide while naming');
    const widths=await js(`({field:${field}.getBoundingClientRect().width,row:${row}.getBoundingClientRect().width})`);
    assert.ok(widths.field>=widths.row*0.8,'The field spans the row: '+JSON.stringify(widths));
    assert.equal(await js(`document.activeElement===${field}`),true,'The field has focus');
    assert.equal(await js(`${field}.value`),'Fix the flaky bridge test');
    assert.deepEqual(await js(`[${field}.selectionStart,${field}.selectionEnd]`),[0,25],'The whole old name is selected');
    await capture(`${theme}-editing.png`);
    await key('Escape');
    await until(`!${field}`);
    assert.equal(await js(`${row}.querySelector('.sess-top b').textContent`),'Fix the flaky bridge test');
  }
  assert.deepEqual(await js('renames'),[],'Escape saves nothing');

  // Real typing while the sidebar repaints: the same node, its text and its caret survive.
  await js(`${row}.querySelector('.sess-top b').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await until(`!!${field}`);
  const editing=await js(`(window.editingField=${field}, true)`);
  assert.equal(editing,true);
  await js(`${field}.select()`);
  win.webContents.insertText('Bridge');
  await js('repaint()'); await harness.pause(150);
  win.webContents.insertText(' work');
  await js('repaint()'); await harness.pause(150);
  assert.equal(await js(`${field}===window.editingField`),true,'Repaints keep the same field');
  assert.equal(await js(`${field}.value`),'Bridge work');
  await key('Enter');
  await until(`renames.length===1`);
  assert.deepEqual(await js('renames[0]'),['other-chat-1','Bridge work']);
  await until(`${row}.querySelector('.sess-top b')?.textContent==='Bridge work'`);
  await capture('renamed.png');

  // An empty name hands the title back to ChatGPT's.
  await rename();
  await until(`!!${field}`);
  await js(`${field}.select()`);
  await key('Backspace');
  await key('Enter');
  await until(`renames.length===2`);
  assert.deepEqual(await js('renames[1]'),['other-chat-1',null]);
  await until(`${row}.querySelector('.sess-top b')?.textContent==='Fix the flaky bridge test'`);
  assert.deepEqual(harness.pageErrors,[]);
  console.log('PASS: chat naming field layout in both themes, Escape, repaints during typing, Enter and clearing');
  await server.close();
  harness.finish();
}).catch(async error=>{
  fs.mkdirSync(output,{recursive:true});
  if(harness.win&&!harness.win.isDestroyed()){try{fs.writeFileSync(path.join(output,'failure.png'),(await harness.win.webContents.capturePage()).toPNG());}catch{}}
  console.error(error);
  await server?.close();
  harness.onError(error);
});
