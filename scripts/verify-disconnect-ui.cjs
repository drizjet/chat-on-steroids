// Production renderer in isolated Electron; no tunnel, credentials or user data.
const { withoutScripts } = require('./ui-check-page.cjs');
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
const { fixtureConfigSource } = require('./fixtures/app-defaults.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'outputs/disconnect-ui');
const harness = createHarness({ name: 'disconnect-ui', width: 1100, height: 800, userData: path.join(output, 'runtime'), output });
harness.ready().then(async () => {
  const { createServer } = await import('vite');
  const fixture = `
    localStorage.removeItem('cos.ui.language');
    ${fixtureConfigSource()}
    const config = fixtureConfig({
      roots:[{name:'fixture',path:'C:/fixture'}],readOnly:true,
      capabilities:{browse:true,search:true,read:true,metadata:true},
      tunnel:{kind:'manual',tunnelId:'',desktopTunnelId:'',binaryPath:''},
      ui:{theme:'dark',autoConnect:false},sessions:{record:true,retainDays:30,advisoryTokens:300000,limitTokens:400000},
      compaction:{auto:false,autoTokens:300000},multiAgent:{enabled:false,maxWorkers:2},
      goal:{enabled:false,model:'fixture',reasoning:'default',prompt:'Fixture'}
    });
    const state = {config,hasApiKey:false,hasGoalKey:false,resolvedBinary:null,bundledTunnelVersion:null,
      status:{state:'connected',detail:'',publicUrl:null,localUrl:null,handshakeAt:null,lastRequestAt:null,lastToolCallAt:null,health:null,surfaces:[]},
      bridge:{running:false,port:0,paired:false,present:false,lastSeenAt:null,extensionVersion:null},
      update:{current:'2.1.13',latest:null,stage:'idle',error:null,checkedAt:null}};
    const ok=data=>Promise.resolve({ok:true,data:structuredClone(data)});
    let push = () => {};
    window.disconnectCalls=0;
    window.api = new Proxy({
      getState:()=>ok(state),getLog:()=>ok([]),listProjects:()=>ok([]),
      listSessions:()=>ok({sessions:[],total:0,nextCursor:null,activeId:null,pressure:[],blocked:[]}),
      getSwarm:()=>ok({running:false,runId:null,agents:[],maxWorkers:2,pendingReports:0}),
      getChatModels:()=>ok({state:'unknown',models:[]}),
      onStateChanged:callback=>{push=()=>callback(structuredClone(state));},
      disconnect:async()=>{
        window.disconnectCalls++;
        state.status.state='disconnecting';window.disconnectingAt=Date.now();push();
        await new Promise(resolve=>window.releaseDisconnect=resolve);
        state.status.state='disconnected';push();return ok(state);
      },
      connect:()=>{state.status.state='connected';push();return ok(state);}
    },{get:(target,key)=>key in target?target[key]:()=>ok(null)});
    await import('/main.ts');
    window.fixtureReady=true;
  `;
  const server = await createServer({configFile:false,root:path.join(root,'src/renderer'),
    server:{host:'127.0.0.1',port:0},plugins:[{name:'disconnect-fixture',configureServer(vite) {
      vite.middlewares.use('/fixture.html',async (_req,res)=>{
        const html=withoutScripts(fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8'))
          .replace('</body>','<script type="module">'+fixture+'</script></body>');
        res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/fixture.html',html));
      });
    }}]});
  try {
    await server.listen();
    await harness.window({ webPreferences: { sandbox: true, backgroundThrottling: false } });
    const win = harness.win;
    await harness.loadUrl(server.resolvedUrls.local[0]+'fixture.html');
    const js = code => harness.js(code);
    await harness.until('!!window.fixtureReady', 2500);
    assert.equal(await js('!!window.fixtureReady'),true);
    await js(`document.getElementById('sidebarConnection').click()`);
    const point=await js(`(() => {const r=document.getElementById('connectionPopoverToggle').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await harness.until('!!window.releaseDisconnect', 2500);
    assert.deepEqual(await js(`(() => {const b=document.getElementById('connectionPopoverToggle');for(let i=0;i<100;i++) b.click();return {text:b.textContent,disabled:b.disabled,calls:window.disconnectCalls,title:document.getElementById('connectionPopoverTitle').textContent};})()`),
      {text:'Disconnecting…',disabled:true,calls:1,title:'Disconnecting'});
    assert.equal(await js(`document.getElementById('connectionPopoverTitle').title`),'Closing connection…');
    assert.equal(await js(`document.getElementById('connectionPopoverVerified')`),null);
    assert.equal(await js(`document.getElementById('wizConnectLabel').textContent`),'Disconnecting…');
    assert.equal(await js(`document.getElementById('wizConnect').disabled`),true);
    fs.mkdirSync(output,{recursive:true});
    assert.equal(await js(`document.getElementById('connectionPopover').checkVisibility()`),true);
    await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output,'disconnecting.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    await js('window.releaseDisconnect()');
    // A quick Disconnecting stays on screen a moment (about a second) before the real state shows.
    await js('new Promise(resolve=>setTimeout(resolve,0))');
    // Only while the hold can still be running: the screenshots above may take longer than it under load.
    assert.ok(await js(`Date.now()-window.disconnectingAt>1000 || document.getElementById('connectionPopoverTitle').textContent==='Disconnecting'`));
    await harness.until(`document.getElementById('connectionPopoverTitle').textContent==='Not connected'`, 3000);
    // Disconnected: the capsule is the one Connect; the details only describe.
    assert.deepEqual(await js(`(() => ({title:document.getElementById('connectionPopoverTitle').textContent,actionHidden:document.getElementById('connectionPopoverToggle').closest('.connection-popover-actions').hidden,capsule:document.getElementById('sidebarConnectionLabel').textContent}))()`),{title:'Not connected',actionHidden:true,capsule:'Connect'});
    await js(`document.getElementById('sidebarConnection').click()`);
    await harness.until(`document.getElementById('connectionPopoverTitle').textContent==='Connected'`, 3000);
    assert.equal(await js(`document.getElementById('connectionPopoverTitle').textContent`),'Connected');
    console.log('Disconnect renderer passed: native click, visible pending state, 100 ignored duplicate clicks, completion and reconnect.');
  } finally {
    await server.close();
  }
  harness.finish();
}).catch(error=>{console.error(error);harness.onError(error);});
