'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const qa=require('./verify-recovery.cjs');
const output=path.resolve(__dirname,'../../docs/ru/screenshots/sound-updates');
const binary=require('ffmpeg-static');let c;
const check=[];
const evaluate=code=>c.evaluate(code);
async function shot(name){await qa.wait(700);const img=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(img.data,'base64'));}
function wave(){const rate=48000,n=rate*.3,bytes=Buffer.alloc(44+n*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)bytes.writeInt16LE(Math.round(Math.sin(i/rate*440*Math.PI*2)*20000),44+i*2);return bytes;}
function pcm(file){return execFileSync(binary,['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:10*1024*1024});}
function rms(bytes,start,end){let sum=0,n=0;for(let i=Math.round(start*48000)*4;i<Math.min(bytes.length,Math.round(end*48000)*4);i+=4){sum+=bytes.readFloatLE(i)**2;n++;}return Math.sqrt(sum/Math.max(1,n));}
async function main(){
  fs.mkdirSync(output,{recursive:true});const input=path.join(output,'sound-test.wav');fs.writeFileSync(input,wave());
  try{
    await qa.launch();c=qa.connection();
    await evaluate(`BFX.ui.openFx('new59_quill');`);await qa.wait(500);
    await evaluate(`(()=>{const s=BFX.ui.stack.at(-1);s._historyPreview.pl.pause();s._historyProject.dur=s._historyProject.layers[0].dur=1.2;s.head.querySelector('.fx-effect-sound').click();})()`);
    await qa.until(`!!document.querySelector('[data-effect-sound="extra-short_whoosh"]')`,'Offline sound catalog');
    await evaluate(`document.querySelector('[data-effect-sound="extra-short_whoosh"] .btn').click()`);
    await qa.until(`BFX.autosave.current?._effectSound?.id==='extra-short_whoosh'`,'Built-in sound selection');
    check.push('An offline catalog sound can be attached to an effect');
    await c.call('Page.setInterceptFileChooserDialog',{enabled:true});
    await evaluate(`(()=>{const s=BFX.ui.stack.at(-1);[...s.body.querySelectorAll('button')].find(b=>b.textContent.trim()==='Загрузить свой звук').click();})()`);
    const fileInput=await c.call('Runtime.evaluate',{expression:`document.querySelector('input[type=file]')`});
    assert(fileInput.result.objectId);
    await c.call('DOM.setFileInputFiles',{files:[input],objectId:fileInput.result.objectId});
    await qa.until(`BFX.autosave.current?._effectSound?.id.startsWith('user-')`,'Own WAV import');
    await evaluate(`(()=>{const root=BFX.ui.stack.at(-1).body,v=root.querySelector('[aria-label="Громкость звука"]'),d=root.querySelector('[aria-label="Задержка звука, секунды"]'),l=root.querySelector('[aria-label="Повторять звук"]');v.value=35;v.dispatchEvent(new Event('input'));d.value=.25;d.dispatchEvent(new Event('change'));l.checked=true;l.dispatchEvent(new Event('change'));})()`);
    await shot('01-effect-sound');
    await evaluate(`(()=>{const s=BFX.ui.stack.at(-1);[...s.body.querySelectorAll('button')].find(b=>b.textContent.trim()==='Прослушать с эффектом').click();})()`);
    await qa.wait(700);
    const playback=await evaluate(`(()=>{const s=BFX.ui.stack.at(-1),a=s._historyPreview.pl._effectSoundState.audio;return {playing:!!a&&!a.paused,volume:a?.volume,loop:a?.loop};})()`);
    assert(playback.playing);assert.equal(playback.volume,.35);assert(playback.loop);
    await evaluate(`BFX.ui.stack.at(-1)._historyPreview.pl.pause()`);
    check.push('Imported WAV plays with the effect using its volume and loop settings');
    const settings=await evaluate(`JSON.parse(JSON.stringify(BFX.autosave.current._effectSound))`);
    await evaluate(`BFX.autosave.save()`);
    await qa.stop();await qa.launch();c=qa.connection();
    await evaluate(`BFX.autosave.restore()`);await qa.wait(600);
    assert.deepEqual(await evaluate(`JSON.parse(JSON.stringify(BFX.autosave.current._effectSound))`),settings);
    assert(await evaluate(`(async()=>!!(await BFX.EffectSound.read(BFX.autosave.current._effectSound.id)).blob)()`));
    check.push('Sound and settings survive restart and draft recovery');
    const exports=[];
    for(const format of ['mp4','webm']){
      const result=await evaluate(`(async()=>{
        const pr=BFX.autosave.current;const result=await BFX.EX.run(pr,{format:'${format}',bg:'none',res:540,fps:24,quality:'std'},()=>{});
        const video=document.createElement('video');video.muted=true;video.src=result.url;
        await new Promise((r,j)=>{video.onloadedmetadata=r;video.onerror=()=>j(Error('Decode failed'));});
        await new Promise(r=>{video.onseeked=r;video.currentTime=.5;});
        const cv=document.createElement('canvas');cv.width=video.videoWidth;cv.height=video.videoHeight;cv.getContext('2d').drawImage(video,0,0);
        const alpha=cv.getContext('2d').getImageData(0,0,1,1).data[3];
        const bytes=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(result.blob);});
        window.__qaAudioVideo=result.blob;const out={size:result.size,codec:result.codec,hasAudio:result.hasAudio,duration:video.duration,alpha,bytes};video.removeAttribute('src');video.load();return out;
      })()`);
      assert(result.hasAudio);assert(Math.abs(result.duration-1.2)<.15);
      if(format==='webm')assert.equal(result.alpha,0,'WebM alpha retained after sound mux');
      const file=path.join(output,'with-sound.'+format);fs.writeFileSync(file,Buffer.from(result.bytes,'base64'));delete result.bytes;
      const samples=pcm(file);const silence=rms(samples,.03,.17),sound=rms(samples,.3,.48),tail=rms(samples,.95,1.1);
      assert(silence<.001);assert(sound>.03&&sound<.22);assert(tail>.03,'Loop reaches the end of the effect');
      exports.push({format,...result,silenceRms:silence,audioRms:sound,tailRms:tail});
    }
    check.push('MP4/AAC and WebM/Opus contain audible delayed and looped sound at the selected volume; WebM retains alpha');
    const cancelled=await evaluate(`(async()=>{const signal={aborted:false};try{await BFX.EX.run(BFX.autosave.current,{format:'mp4',res:540,fps:24,bg:'black'},p=>{if(p.phase==='audio')signal.aborted=true;},signal);return false;}catch(e){return !!e.abort;}})()`);
    assert(cancelled);check.push('Export cancellation also cancels the sound stage');
    await evaluate(`(()=>{window.__qaJobId=crypto.randomUUID();window.__qaJob=(async()=>{const sound=await BFX.EffectSound.read(BFX.autosave.current._effectSound.id);return window.FXDesktopAPI.mixEffectAudio({id:window.__qaJobId,video:new Uint8Array(await window.__qaAudioVideo.arrayBuffer()),audio:new Uint8Array(await sound.blob.arrayBuffer()),format:'webm',duration:300,volume:.5,delay:0,loop:true});})();return true;})()`);
    await qa.wait(50);
    assert.equal(await evaluate(`window.FXDesktopAPI.cancelEffectAudio(window.__qaJobId)`),true);
    assert.equal(await evaluate(`(async()=>!!(await window.__qaJob).cancelled)()`),true);
    assert.equal(fs.readdirSync(path.resolve(__dirname,'../../../.qa-recovery-profile/temp/effect-audio')).length,0);
    check.push('Cancelling a running native audio job terminates FFmpeg and cleans temporary files');
    await evaluate(`(()=>{while(BFX.ui.stack.length)BFX.ui.stack.at(-1).close();BFX.ui.go('fx');BFX.updates.open();})()`);
    const state=await evaluate(`window.FXDesktopAPI.checkUpdates()`);
    assert(['current','available'].includes(state.status),state.message);
    await evaluate(`window.FXDesktopAPI.setAutoUpdates(false)`);
    assert.equal(await evaluate(`BFX.updates.state.auto`),false);
    await evaluate(`window.FXDesktopAPI.setAutoUpdates(true)`);
    await shot('02-updates');check.push('Update panel checks real GitHub Releases and persists automatic-check preferences');
    assert.deepEqual(qa.rendererErrors,[]);
    const report={checks:check,exports,updateState:state,rendererErrors:qa.rendererErrors};fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await qa.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
