'use strict';
// Starts and closes only its own isolated Electron profile. Never touches the user's open app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { RecoveryStore } = require('./recovery-store.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.resolve(__dirname, '../../../.qa-recovery-profile');
const output = path.resolve(__dirname, '../../docs/ru/screenshots/recovery');
const port = 9555;
let child, connection;
const checks = [];
const rendererErrors = [];

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') rendererErrors.push(message.params.exceptionDetails);
    pending.get(message.id)?.(message);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(Error('Timeout: ' + method)); }, method==='Runtime.evaluate'?90000:25000);
    pending.set(n, message => { clearTimeout(timer); pending.delete(n); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.addEventListener('close',()=>{for(const resolve of pending.values())resolve({error:{message:'QA debug connection closed'}});pending.clear();});
  return { ws, call, async evaluate(expression) {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  } };
}

async function launch(options = {}) {
  const log = fs.openSync(path.join(output, 'electron.log'), 'a');
  child = spawn(options.executable || require('electron'), [...(options.packaged ? [] : [__dirname]), '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port, '--enable-logging=stderr'], { windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let page;
  for (let i = 0; i < 80; i++) {
    assert(child.exitCode === null, 'QA instance stayed alive');
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find(target => target.url === 'fxstudio://studio/');
      if (page) break;
    } catch {}
    await wait(250);
  }
  assert(page, 'QA page available');
  connection = await connect(page.webSocketDebuggerUrl);
  await connection.call('Runtime.enable');
  await connection.call('Page.enable');
  await connection.call('Page.bringToFront');
  await connection.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until(`!!window.BFX?.autosave&&!!document.querySelector('#views')&&!document.querySelector('.splash')`, 'App mounted');
  await wait(1700);
  await connection.evaluate(`(()=>{while(BFX.ui.stack.length)BFX.ui.stack.at(-1).close();})()`);
}

async function until(expression, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (await connection.evaluate(expression)) return;
    await wait(200);
  }
  throw Error(label + ' timed out');
}

async function stop(crash = false) {
  if (!child || child.exitCode !== null) return;
  if (crash) child.kill('SIGKILL');
  else {
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browser = await connect(info.webSocketDebuggerUrl);
    browser.ws.send(JSON.stringify({ id: 999, method: 'Browser.close' }));
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(6000)]);
    browser.ws.close();
  }
  await Promise.race([child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)), wait(5000)]);
  assert(child.exitCode !== null || child.signalCode, 'QA instance exited');
  connection?.ws.close();
  connection = null;
  await wait(600);
}

async function screenshot(name) {
  await wait(900);
  const result = await connection.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
}

async function openEffect() {
  await connection.evaluate(`BFX.ui.openFx('new59_quill')`);
  await wait(650);
  await connection.evaluate(`BFX.ui.stack.at(-1)._historyPreview.pl.pause()`);
}

async function editDuration(value) {
  // Exercise the real duration control and its existing callbacks.
  await connection.evaluate(`(()=>{
    const s=BFX.ui.stack.find(s=>s._historyProject);
    s.body.querySelector('.ed-time-button').click();
    const input=BFX.ui.stack.at(-1).body.querySelector('input[type=range]');
    if(!input)throw Error('Duration input missing');
    input.value=${value};input.dispatchEvent(new Event('input',{bubbles:true}));
    BFX.ui.stack.at(-1).close();
  })()`);
}

async function restoreFromBanner() {
  await until(`!!document.querySelector('.fx-recovery-banner .btn.primary')`, 'Recovery banner');
  await connection.evaluate(`document.querySelector('.fx-recovery-banner .btn.primary').click()`);
  await until(`!!BFX.autosave.current`, 'Restored editor');
  await wait(700);
  return connection.evaluate(`JSON.parse(JSON.stringify(BFX.autosave.current))`);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const store = new RecoveryStore(path.join(profile, 'recovery'));
  // This dedicated QA profile contains only generated test data.
  store.clear();
  try {
    await launch();
    await openEffect();
    await editDuration(7.25);
    await until(`document.querySelector('.fx-autosave-status')?.textContent.includes('Сохранено в')`, 'Automatic save');
    let record = store.load().draft;
    assert.equal(record.project.layers[0].dur, 7.25);
    const originalId = record.project.id;
    checks.push('Actual duration control autosaves without Ctrl+S');
    // Include multiple layers, a scene and a real imported resource in the recovery snapshot.
    await connection.evaluate(`(async()=>{
      const pr=BFX.autosave.current;
      const c=document.createElement('canvas');c.width=32;c.height=32;
      c.getContext('2d').fillStyle='#ffb320';c.getContext('2d').fillRect(0,0,32,32);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      const key=await BFX.ui.saveImage(new File([blob],'recovery-test.png',{type:'image/png'}));
      const layer=BFX.P.newLayer('l_image');layer.p.img=key;layer.p.size=130;layer.x=300;layer.y=400;layer.rot=17.5;pr.layers.push(layer);
      pr.scene={...pr.scene,qaMarker:'scene-survives'};
      const s=BFX.ui.stack.find(s=>s._historyProject);s._historyPreview.pl.seek(2.5);
      s._historyPreview.history.record('qa:resource');
    })()`);
    await until(`document.querySelector('.fx-autosave-status')?.textContent.includes('Сохранено в')`, 'Resource autosave');
    const beforeCrash = store.load().draft;
    assert.equal(beforeCrash.project.layers.length, 2);
    await screenshot('01-autosaved-editor');
    await stop(true);
    await launch();
    await screenshot('02-recovery-offer');
    const afterCrash = await restoreFromBanner();
    assert.deepEqual(afterCrash, beforeCrash.project);
    assert.equal(afterCrash.id, originalId);
    const imageRestored = await connection.evaluate(`(async()=>{
      const pr=BFX.autosave.current;
      const img=await BFX.db.get('images',pr.layers[1].p.img.slice(2));
      return !!img?.blob;
    })()`);
    assert(imageRestored);
    const playhead = await connection.evaluate(`BFX.ui.stack.find(s=>s._historyProject)._historyPreview.pl.t`);
    assert(Math.abs(playhead - 2.5) < .1);
    checks.push('Abrupt main-process termination restores exact scene, two layers, resource and playhead');
    await screenshot('03-restored-editor');
    await editDuration(8.5);
    // Close before the 650 ms debounce; the synchronous final write must capture this edit.
    await stop();
    assert.equal(store.load().draft.project.layers[0].dur, 8.5);
    await launch();
    const afterClose = await restoreFromBanner();
    assert.equal(afterClose.layers[0].dur, 8.5);
    checks.push('Normal close flushes an edit before the autosave debounce');
    // Real keyboard shortcut, including the ordinary effect editor.
    await connection.evaluate(`BFX.autosave.current.name='Проверка Ctrl+S'`);
    await connection.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', modifiers: 2, windowsVirtualKeyCode: 83 });
    await connection.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', modifiers: 2, windowsVirtualKeyCode: 83 });
    try{await until(`document.querySelector('.fx-autosave-status')?.textContent.includes('Сохранено в')`, 'Ctrl+S');}
    catch(error){console.log('Save diagnostic',await connection.evaluate(`({status:[...document.querySelectorAll('.fx-autosave-status')].map(n=>n.textContent),active:!!BFX.autosave.current,name:BFX.autosave.current?.name,stack:BFX.ui.stack.map(s=>s.panel.getAttribute('aria-label'))})`),store.load().draft?.project?.name);throw error;}
    assert.equal(store.load().draft.project.name, 'Проверка Ctrl+S');
    checks.push('Ctrl+S saves the active effect draft');
    // A real filesystem write failure must be visible and retryable.
    const blocked=store.latest+'.tmp';fs.mkdirSync(blocked);
    await editDuration(9.5);
    await until(`document.querySelector('.fx-autosave-status')?.dataset.state==='error'`, 'Visible write failure');
    assert.notEqual(store.load().draft.project.layers[0].dur,9.5);
    await connection.evaluate(`window.close()`);
    await wait(500);
    assert.equal(await connection.evaluate(`!!BFX.autosave.current`),true,'Failed close-time save keeps the window open');
    fs.rmdirSync(blocked);
    await connection.evaluate(`document.querySelector('.fx-autosave-status button').click()`);
    await until(`document.querySelector('.fx-autosave-status')?.textContent.includes('Сохранено в')`, 'Retry after write failure');
    assert.equal(store.load().draft.project.layers[0].dur,9.5);
    checks.push('Filesystem write failure is visible, prevents silent close and can be retried');
    await stop();
    const backup = store.read(store.backup);
    fs.writeFileSync(store.latest, '{broken');
    await launch();
    await until(`document.querySelector('.fx-recovery-banner')?.textContent.includes('резервная копия')`, 'Backup warning');
    await screenshot('04-backup-recovery');
    const afterCorruption = await restoreFromBanner();
    assert.deepEqual(afterCorruption, backup.project);
    checks.push('Truncated latest file offers and restores the previous backup');
    assert.deepEqual(rendererErrors, []);
    await stop();
    const report = { date: new Date().toISOString(), checks, rendererErrors, profile, output };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (child?.exitCode === null && !child.signalCode) await stop().catch(() => child.kill());
    connection?.ws.close();
  }
}
module.exports = { launch, stop, until, wait, connection: () => connection, rendererErrors };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
