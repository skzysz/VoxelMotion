'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const qa=require('./verify-recovery.cjs');
const output=path.resolve(__dirname,'../../docs/ru/screenshots/workspace');
const profile=path.resolve(__dirname,'../../../.qa-recovery-profile');
let c;const checks=[];
const run=expression=>c.evaluate(expression.startsWith('const ')?`{${expression}}`:expression);
async function click(text){
  await run(`(()=>{const root=BFX.ui.stack.at(-1)?.body||document;const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button: '+${JSON.stringify(text)});button.click();})()`);
  await qa.wait(100);
}
async function prompt(text){
  await qa.until(`!!BFX.ui.stack.at(-1)?.body.querySelector('input.inp')`,'Prompt');
  await run(`(()=>{const s=BFX.ui.stack.at(-1),input=s.body.querySelector('input.inp');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));s.body.querySelector('.btn.primary').click();})()`);
  await qa.wait(250);
}
async function shot(name){await qa.wait(1100);const image=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));}
async function key(code,key,modifiers){await c.call('Input.dispatchKeyEvent',{type:'keyDown',code,key,modifiers});await c.call('Input.dispatchKeyEvent',{type:'keyUp',code,key,modifiers});await qa.wait(100);}
async function main(){
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(output,'exports'),{recursive:true});fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'desktop-preferences.json'),JSON.stringify({exportFolder:path.join(output,'exports')}));
  try{
    await qa.launch();c=qa.connection();
    await run(`localStorage.removeItem('bfx.catalog.v1');localStorage.removeItem('bfx.presets.v1');BFX.store.set('fxLibraryTab','all');`);
    await c.call('Page.reload',{ignoreCache:true});await qa.wait(1500);
    await qa.until(`!!window.BFX?.catalog&&!!BFX.presets&&!!document.querySelector('#views')&&!document.querySelector('.splash')`,'Updated app');
    await qa.wait(1500);await run(`while(BFX.ui.stack.length)BFX.ui.stack.at(-1).close();BFX.ui.go('fx');`);
    await click('Новая подборка');await prompt('Для моих роликов');
    assert.equal(await run(`BFX.catalog.collections.length`),1);
    await run(`document.querySelector('.fx-library-tile[data-effect-id="new59_quill"] .fx-collection-more').click()`);
    await click('Добавить в «Для моих роликов»');
    const groupId=await run(`BFX.catalog.collections[0].id`);
    await run(`document.querySelector('[data-library-tab="collection:${groupId}"]').click()`);
    assert.equal(await run(`document.querySelectorAll('.fx-library-tile').length`),1);
    await shot('01-personal-collection');
    checks.push('Create personal collection and add an effect through its card menu');
    await run(`document.querySelector('[data-library-tab="all"]').click();const search=document.querySelector('[data-v="fx"] input[type=search]');search.value='#trans';search.dispatchEvent(new Event('input',{bubbles:true}));`);
    await qa.wait(350);
    assert(await run(`(()=>{const tiles=[...document.querySelectorAll('.fx-library-tile')];return tiles.length>0&&tiles.every(t=>BFX.FX.map[t.dataset.effectId].cat==='trans');})()`));
    checks.push('Hashtag category search filters transition effects');
    await run(`const search=document.querySelector('[data-v="fx"] input[type=search]');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));`);await qa.wait(300);
    await run(`document.querySelector('.fx-library-tile').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
    await qa.until(`!!document.querySelector('.fx-hover-preview')`,'Hover preview');
    await run(`BFX.ui.go('projects')`);assert(await run(`!document.querySelector('.fx-hover-preview')`));
    checks.push('Hover preview starts and is removed when leaving the catalog');
    await run(`BFX.ui.go('fx');BFX.ui.openFx('new59_quill');`);await qa.wait(650);
    await run(`BFX.ui.stack.at(-1)._historyPreview.pl.pause();BFX.ui.stack.at(-1).panel.focus();`);
    await key('KeyD','d',2);
    assert.equal(await run(`BFX.autosave.current.layers.length`),2);
    await run(`BFX.ui.stack.at(-1).head.querySelector('.fx-history-button').click()`);
    await click('Отменить');assert.equal(await run(`BFX.autosave.current.layers.length`),1);
    await click('Повторить');assert.equal(await run(`BFX.autosave.current.layers.length`),2);
    await run(`BFX.ui.stack.at(-1).close();BFX.ui.stack.at(-1).head.querySelector('.fx-layer-tools').click();`);
    await run(`const input=BFX.ui.stack.at(-1).body.querySelector('[data-layer-value="x"]');input.value=250;input.dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(await run(`BFX.autosave.current.layers[1].x`),250);
    await click('По центру X');assert.equal(await run(`BFX.autosave.current.layers[1].x`),0);
    await run(`const input=BFX.ui.stack.at(-1).body.querySelector('[data-layer-value="x"]');input.value=250;input.dispatchEvent(new Event('change',{bubbles:true}));const check=BFX.ui.stack.at(-1).body.querySelector('input[type=checkbox]');check.checked=true;check.dispatchEvent(new Event('change'));`);
    await shot('02-layer-tools');
    await click('Готово');
    checks.push('Ctrl+D duplicates a layer, history undo/redo works, precise X and alignment update preview');
    await run(`BFX.ui.stack.at(-1).head.querySelector('.fx-effect-presets').click()`);
    await click('Сохранить текущий вариант');await prompt('Мой вариант записи');
    assert.equal(await run(`BFX.presets.effects.length`),1);
    await run(`BFX.autosave.current.layers[1].x=999`);
    await click('Применить');await qa.wait(650);
    assert.equal(await run(`BFX.autosave.current.layers[1].x`),250);
    checks.push('Saved effect variant restores its layers and parameters');
    await run(`BFX.ui.stack.at(-1).head.querySelector('.btn.primary').click()`);
    await run(`const s=BFX.ui.stack.at(-1),select=s.body.querySelector('select[aria-label="Пресет экспорта"]');select.value='youtube';select.dispatchEvent(new Event('change'));`);await qa.wait(200);
    assert(await run(`BFX.P.isWide(BFX.autosave.current)&&BFX.ui.stack.at(-1).exportSettings.res===1080`));
    await click('Сохранить настройки');await prompt('Мой YouTube');
    assert.equal(await run(`BFX.presets.exports.length`),1);
    await shot('03-export-presets');
    checks.push('YouTube preset sets 16:9/1080p and custom export settings are saved');
    await run(`const s=BFX.ui.stack.at(-1);Object.assign(s.exportSettings,{format:'png',bg:'none',res:540});s.refreshExport();`);await qa.wait(100);
    await click('Экспортировать');
    await qa.until(`document.querySelector('.fx-export-location')?.dataset.state==='completed'`,'Native file download');
    await shot('04-file-saved');
    const files=fs.readdirSync(path.join(output,'exports')).filter(name=>name.endsWith('.png'));
    assert(files.length>0);assert.equal(fs.readFileSync(path.join(output,'exports',files.at(-1))).subarray(1,4).toString(),'PNG');
    checks.push('Real export UI saves PNG to the chosen folder and confirms native completion');
    await qa.stop();await qa.launch();c=qa.connection();
    assert.equal(await run(`BFX.catalog.collections[0].name`),'Для моих роликов');
    assert.equal(await run(`BFX.presets.effects[0].name`),'Мой вариант записи');
    assert.equal(await run(`BFX.presets.exports[0].name`),'Мой YouTube');
    assert(await run(`BFX.catalog.recent.includes('new59_quill')`));
    await run(`BFX.ui.go('fx');document.querySelector('[data-library-tab="recent"]').click()`);
    await shot('05-recent-effects');
    checks.push('Collections, effect variants, export presets and recent effects survive app restart');
    assert.deepEqual(qa.rendererErrors,[]);
    const report={checks,rendererErrors:qa.rendererErrors,output};fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await qa.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
