// Real renderer with synthetic controls only. Never connects to the installed app or ChatGPT.
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

const root = path.join(__dirname, '..');
const harness = createHarness({ name: 'goal-progress', width: 1100, height: 760 });

harness.ready().then(async () => {
  fs.mkdirSync(harness.outputDir, { recursive: true });
  const code = (await require('esbuild').build({ entryPoints: [path.join(root, 'src/renderer/chat.ts')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'chat', logLevel: 'error',
    // Module CSS (xterm) is not needed: the page inlines the production stylesheet below.
    loader: { '.css': 'empty' },
    // Vite's `?url` asset imports (the PDF worker) have no meaning here; the checks never render a PDF.
    plugins: [{ name: 'vite-url-stub', setup(build) {
      build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'vite-url-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'vite-url-stub' }, () => ({ contents: 'export default ""', loader: 'js' }));
    } }] })).outputFiles[0].text;
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const html = withoutScripts(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')).replace(/<link\b[^>]*>/g, '')
    .replace('</head>', `<style>${css}</style></head>`);
  await harness.window();
  await harness.loadHtml(html);
  await harness.js(`(() => {
    const ok = data => Promise.resolve({ok:true,data});
    const session = {id:'goal-fixture',title:'Loop progress',conversationId:'fixture',chatIds:['fixture'],
      startedAt:1,updatedAt:1,endedAt:null,events:0,userMessages:0,toolCalls:0,errors:0,estimatedTokens:0,contextTokens:0,agents:[],origin:null};
    window.controls = {sessionId:session.id,conversationId:'fixture',automation:'loop',objective:'Continue the requested work',blocked:'',job:null,
      goalWait:{reason:'quiet',until:Date.now()+125000},goalDraft:null};
    window.api = new Proxy({listSessions:()=>ok({sessions:[session],activeId:null,blocked:[],pressure:[]}),
      listProjects:()=>ok([]),listInputs:()=>ok([]),runningTools:()=>ok([]),listPausedHelpers:()=>ok([]),
      getSession:()=>ok({summary:session,total:0,events:[],nextFrom:0}),getSessionControls:()=>ok(controls)
    }, {get:(target,key)=>target[key]??(()=>ok(null))});
    window.frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  })()`);
  await harness.js(code);
  await harness.js(`(async()=>{
    chat.initChat({state:()=>null,save:async()=>{}});chat.chatVisible(true);await frame();
    document.querySelector('#sessionList [data-id="goal-fixture"]').click();
    for(let i=0;i<120&&!document.getElementById('goalLifecycle')?.textContent.includes('Waiting for tool inactivity');i++) await frame();
  })()`);
  const results = [];
  for (const width of [1100, 720]) for (const zoom of [1, 1.5]) {
    harness.win.setContentSize(width, 760); harness.win.webContents.setZoomFactor(zoom);
    const result = await harness.js(`(async()=>{
      await frame();const row=document.getElementById('goalLifecycle'),timer=row.querySelector('[role="timer"]');
      const r=row.getBoundingClientRect(),t=timer.getBoundingClientRect();
      return {text:row.textContent,visible:!row.hidden&&r.height>0,fits:row.scrollWidth<=row.clientWidth&&t.right<=r.right};
    })()`);
    assert.ok(result.visible && result.fits, JSON.stringify({ width, zoom, ...result }));
    results.push({ width, zoom, ...result });
    if (width === 1100 && zoom === 1) await harness.shot('waiting.png');
  }
  harness.win.setContentSize(1100, 760); harness.win.webContents.setZoomFactor(1);
  const generated = await harness.js(`(async()=>{
    controls.goalWait=null;controls.goalDraft={stage:'answering',model:'fixture',text:'Continue with the remaining verification and report the result.',error:null};
    chat.chatVisible(false);chat.chatVisible(true);await frame();await frame();await frame();return document.getElementById('goalLifecycle').textContent;
  })()`);
  assert.ok(generated.includes('Generating a continuation') && generated.includes('remaining verification'), generated);
  await harness.shot('generating.png');
  fs.writeFileSync(path.join(harness.outputDir, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log('Passed real Loop progress rendering, countdown fit at four size/zoom combinations, and generated text.');
  harness.finish();
}).catch(error => harness.onError(error));
