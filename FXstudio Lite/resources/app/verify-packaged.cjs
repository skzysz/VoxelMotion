'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const qa=require('./verify-recovery.cjs');
const output=path.resolve(__dirname,'../../docs/ru/screenshots/packaged');
async function main(){
  fs.mkdirSync(output,{recursive:true});
  const executable=path.resolve(process.argv[2]||path.join(__dirname,'dist/win-unpacked/VoxelMotion.exe'));
  assert(fs.existsSync(executable),'Packaged executable exists');
  try{
    await qa.launch({executable,packaged:true});const c=qa.connection();
    const state=await c.evaluate(`(async()=>{
      BFX.ui.go('fx');
      const count=BFX.FX.list.length;
      BFX.ui.openFx('new59_quill');
      const s=BFX.ui.stack.at(-1);s._historyPreview.pl.pause();s._historyProject.layers[0].dur=s._historyProject.dur=1.25;
      const saved=await BFX.autosave.save();
      const result=await BFX.EX.run(s._historyProject,{format:'png',res:540,bg:'none',t:.5});
      return {version:BFX.APPVER,count,hasCatalog:!!BFX.catalog,hasPresets:!!BFX.presets,saved,pngBytes:result.size};
    })()`);
    assert(state.count>=188&&state.hasCatalog&&state.hasPresets&&state.saved&&state.pngBytes>1000);
    assert.equal(state.version,'2.12.1');
    await qa.wait(700);const image=await c.call('Page.captureScreenshot',{format:'png'});
    const label=path.basename(executable).includes('Portable')?'portable':'standalone';
    fs.writeFileSync(path.join(output,label+'.png'),Buffer.from(image.data,'base64'));
    assert.deepEqual(qa.rendererErrors,[]);
    fs.writeFileSync(path.join(output,label+'-verification.json'),JSON.stringify({executable,...state,rendererErrors:qa.rendererErrors},null,2));
    console.log(JSON.stringify({executable,...state},null,2));
  }finally{await qa.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
