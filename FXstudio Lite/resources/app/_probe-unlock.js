const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const raw = await get('http://127.0.0.1:9333/json');
      const list = JSON.parse(raw);
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('no debug target');
}

async function main() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const call = (method, params) => new Promise(resolve => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await call('Runtime.enable', {});
  const expression = `(() => {
    if (!window.BFX || !BFX.ui || !BFX.FX || !BFX.LITE) return { ready: false };
    const pick = String(BFX.ui.pickImage);
    const open = String(BFX.ui.openFx);
    const save = String(BFX.ui.saveImage);
    const imp = String(BFX.ui.importFiles || '');
    const sample = ['rain','slice','furnace','mob_spawn','compass','subtitles','totem','new59_quill'];
    return {
      ready: true,
      hasAny: BFX.LITE.has('paid-example'),
      locked: BFX.LITE.locked.length,
      pickBlocked: /полной версии|notice\\(/.test(pick),
      openBlocked: /allow\\.has/.test(open),
      saveBlocked: /полной версии/.test(save),
      importBlocked: /полной версии/.test(imp),
      myAdd: BFX.MY && String(BFX.MY.add).includes('BFX.MY.orig'),
      sample: sample.map(id => ({ id, listed: BFX.FX.list.some(f => f.id === id), hidden: !!BFX.FX.map[id]?.catalogHidden, mapped: !!BFX.FX.map[id] })),
      proSection: document.querySelectorAll('.lite-pro-section').length,
      locks: document.querySelectorAll('.lite-lock-image,.lite-badge,.lite-locked-card').length,
      fxCount: BFX.FX.list.length,
      imageBtnBlocked: /полной версии|lite-locked/.test(String(BFX.ui.imageBtn)),
      exportBlocked: /lockedProject|allow\\.has/.test(String(BFX.EX && BFX.EX.run)),
      packsBlocked: /полной версии/.test(String(BFX.ui.packsImport || '')),
      rpBlocked: /полной версии/.test(String(BFX.RP && BFX.RP.importFile || ''))
    };
  })()`;
  let result;
  for (let i = 0; i < 30; i++) {
    const msg = await call('Runtime.evaluate', { expression, returnByValue: true });
    result = msg.result?.result?.value;
    if (result?.ready) break;
    await sleep(400);
  }
  console.log(JSON.stringify(result, null, 2));
  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
