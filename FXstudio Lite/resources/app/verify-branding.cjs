'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const qa=require('./verify-recovery.cjs');
const output=path.resolve(__dirname,'../../docs/ru/screenshots/branding');
async function main(){
  fs.mkdirSync(output,{recursive:true});
  try{
    await qa.launch();const c=qa.connection();
    const png=await c.evaluate(`(async()=>{
      const svg=await(await fetch('desktop/voxelmotion.svg')).text();
      const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').drawImage(img,0,0);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    fs.writeFileSync(path.join(__dirname,'voxelmotion-icon.png'),Buffer.from(png,'base64'));
    const state=await c.evaluate(`(()=>{
      BFX.store.set('fxLibraryTab','all');BFX.ui.go('fx');
      return {title:document.title,brand:document.querySelector('.pc-logo')?.textContent||'',version:BFX.APPVER,apiName:window.fxstudio.getAppName(),exportName:BFX.EX.fname('Example','png'),effects:BFX.FX.list.length};
    })()`);
    assert.equal(state.title,'VoxelMotion');assert.equal(state.apiName,'VoxelMotion');assert.equal(state.version,require('./package.json').version);
    assert(state.brand.includes('VoxelMotion'));assert(state.exportName.startsWith('VoxelMotion_'));assert.equal(state.effects,188);
    await qa.wait(1500);const image=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'catalog.png'),Buffer.from(image.data,'base64'));
    assert.deepEqual(qa.rendererErrors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
  }finally{await qa.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
