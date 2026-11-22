// Run against a dedicated Electron QA profile with --remote-debugging-port=9444.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const html = fs.readFileSync(path.join(__dirname, 'www/index.html'), 'utf8');
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=['"]application\/(?:ld\+)?json/i.test(match[1])) continue;
    new vm.Script(match[2], { filename: `inline-${++scripts}` });
  }
  assert.equal((html.match(/src="lite\/lite-gate.js"/g) || []).length, 1);
  assert.equal((html.match(/href="lite\/lite.css"/g) || []).length, 1);
  assert(!html.includes('id="fxstudio-lite-gate-21122"'));
  const targets = await (await fetch('http://127.0.0.1:9444/json')).json();
  const page = targets.find(t => t.url === 'fxstudio://studio/');
  assert(page, 'FXstudio page is running');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  const errors = [];
  let id = 0;
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
    pending.get(msg.id)?.(msg);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timeout = setTimeout(() => { pending.delete(n); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(n, msg => { clearTimeout(timeout); pending.delete(n); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const output = path.resolve(__dirname, '../../docs/ru/screenshots');
  fs.mkdirSync(output, { recursive: true });
  const screenshot = async name => {
    await wait(1200);
    const result = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  try {
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled',{enabled:true});
    await call('Page.reload', { ignoreCache: true });
    await wait(4000);
    let ready=false;
    for(let i=0;i<120;i++) {
      ready=await evaluate(`!!document.querySelector('#views')&&!document.querySelector('.splash')`);
      if(ready)break;
      await wait(500);
    }
    assert(ready,'Application finished loading assets');
    const state = await evaluate(`(async()=>{
      const U=BFX.ui,F=BFX.FX,L=BFX.LITE;
      while(U.stack.length)U.stack.at(-1).close();
      BFX.store.set('fxcat','all'); U.go('fx');
      const prefs=await window.FXDesktopAPI.preferences();
      await window.FXDesktopAPI.exportActive(true);
      await window.FXDesktopAPI.exportActive(false);
      return {count:F.list.length,allowed:L.allowed.length,locked:L.locked.length,
        allAllowed:F.list.every(f=>L.has(f.id)),
        cardLocks:F.list.filter(f=>L.card(f).matches('.lite-locked-card')||L.card(f).querySelector('.lite-lock-image,.lite-badge')).map(f=>f.id),
        exportFolder:prefs.exportFolder,cssLoaded:[...document.styleSheets].some(s=>s.href?.endsWith('/lite/lite.css')),
        candidates:F.list.filter(f=>!f.catalogHidden).map(f=>({id:f.id,name:f.name}))};
    })()`);
    assert(state.count > 150);
    assert.equal(state.allowed, state.count);
    assert.equal(state.locked, 0);
    assert(state.allAllowed && state.cssLoaded && state.exportFolder);
    assert.deepEqual(state.cardLocks, []);
    let postersReady=false;
    for (let i=0;i<60;i++) {
      postersReady=await evaluate(`(()=>{const imgs=[...document.querySelectorAll('#views img.poster')].slice(0,14);return imgs.length>0&&imgs.every(img=>img.complete&&img.naturalWidth>0);})()`);
      if(postersReady)break;
      await wait(500);
    }
    assert(postersReady,'Catalog posters loaded');
    await screenshot('catalog');
    const opened = [];
    for (const effectId of ['rain', 'furnace', 'new59_quill', 'build3d']) {
      const effect = state.candidates.find(f => f.id === effectId);
      assert(effect, `Catalog contains ${effectId}`);
      const result = await evaluate(`(()=>{const U=BFX.ui;while(U.stack.length)U.stack.at(-1).close();U.openFx(${JSON.stringify(effectId)});return {dialogs:U.stack.length,editor:!!document.querySelector('.pc-editor'),locks:document.querySelectorAll('.lite-locked-card,.lite-lock-image,.lite-badge').length};})()`);
      assert(result.dialogs > 0 && result.editor, `Editor opened: ${effectId}`);
      assert.equal(result.locks, 0);
      opened.push(effect);
      if (effectId === 'new59_quill') await screenshot('editor-quill');
      if (effectId === 'build3d') await screenshot('editor-build');
      await wait(300);
    }
    const png = await evaluate(`(async()=>{
      const c=document.createElement('canvas');c.width=16;c.height=16;
      c.getContext('2d').fillRect(0,0,16,16);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      const key=await BFX.ui.saveImage(new File([blob],'qa-import.png',{type:'image/png'}));
      const saved=await BFX.db.get('images',key.slice(2));
      const result=await BFX.EX.run(BFX.P.fromEffect('new59_quill'),{format:'png',res:360,t:3,bg:'none',name:'qa-quill'});
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(result.blob);});
      return {imported:!!saved?.blob,key,width:result.W,height:result.H,size:result.size,data};
    })()`);
    assert(png.imported && png.size > 1000 && png.width > 0 && png.height > 0);
    fs.writeFileSync(path.join(output,'export-quill.png'),Buffer.from(png.data,'base64'));
    delete png.data;
    await evaluate(`(()=>{const U=BFX.ui;while(U.stack.length)U.stack.at(-1).close();U.go('fx');})()`);
    assert.deepEqual(errors, [], 'No uncaught renderer errors');
    const report = { inlineScriptsParsed:scripts, ...state, candidates:undefined, opened, png, rendererErrors:errors, screenshots:output };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { ws.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
