'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const qa = require('./verify-recovery.cjs');
const output = path.resolve(__dirname, '../../docs/ru/screenshots/export');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  try {
    await qa.launch();
    const c = qa.connection();
    const cases = [
      { format:'png', bg:'none', res:540, fps:24, wide:false },
      { format:'mp4', bg:'chroma', res:540, fps:24, wide:false },
      { format:'mp4', bg:'black', res:720, fps:30, wide:true },
      { format:'mp4', bg:'black', res:540, fps:24, wide:false, forceFallback:true },
      { format:'webm', bg:'none', res:540, fps:24, wide:false },
      { format:'gif', bg:'none', gifW:360, fps:10, crop:false, wide:false },
      { format:'zip', bg:'none', res:540, fps:10, wide:false }
    ];
    for (const options of cases) {
      const result = await c.evaluate(`(async()=>{
        const options=${JSON.stringify(options)};
        const pr=BFX.P.fromEffect('new59_quill');BFX.P.setAspect(pr,options.wide);
        pr.layers[0].dur=pr.dur=.5;
        const caps=BFX.EX.caps;let result;
        try{if(options.forceFallback)BFX.EX.caps=async()=>({webcodecs:false});result=await BFX.EX.run(pr,{...options,t:.25,quality:'std',name:'qa-'+options.format},()=>{});}
        finally{BFX.EX.caps=caps;}
        const bytes=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(result.blob);});
        let media=null;
        if(result.kind==='video'){
          const video=document.createElement('video');video.muted=true;video.src=result.url;
          await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Video metadata timeout')),12000);video.onloadedmetadata=()=>{clearTimeout(timeout);resolve();};video.onerror=()=>{clearTimeout(timeout);reject(Error('Video decoder rejected export'));};});
          const duration=video.duration;
          await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Seek timeout')),12000);video.onseeked=()=>{clearTimeout(timeout);resolve();};video.currentTime=.2;});
          const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0);
          const pixel=ctx.getImageData(0,0,1,1).data;
          media={duration:Number.isFinite(duration)?duration:null,width:video.videoWidth,height:video.videoHeight,cornerAlpha:pixel[3]};
          video.removeAttribute('src');video.load();
        }
        let imageAlpha=null;
        if(options.format==='png'){const img=await createImageBitmap(result.blob);const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;cv.getContext('2d').drawImage(img,0,0);imageAlpha=cv.getContext('2d').getImageData(0,0,1,1).data[3];img.close();}
        return {mime:result.mime,name:result.name,size:result.size,width:result.W,height:result.H,codec:result.codec||null,frames:result.frames||null,imageAlpha,media,bytes};
      })()`);
      const bytes = Buffer.from(result.bytes, 'base64');
      delete result.bytes;
      assert(bytes.length > 200, options.format + ' not empty');
      if (result.mime === 'video/mp4') assert.equal(bytes.subarray(4,8).toString(), 'ftyp');
      if (options.format === 'webm') assert.equal(bytes.subarray(0,4).toString('hex'), '1a45dfa3');
      if (options.format === 'png') {assert.equal(bytes.subarray(1,4).toString(), 'PNG');assert.equal(result.imageAlpha,0);}
      if (options.format === 'gif') assert.equal(bytes.subarray(0,3).toString(), 'GIF');
      if (options.format === 'zip') {assert.equal(bytes.readUInt32LE(0), 0x04034b50);assert.equal(bytes.readUInt16LE(bytes.length-12),5);assert.equal(result.frames,5);}
      if (result.media) {
        assert.equal(result.media.width, result.width);
        assert.equal(result.media.height, result.height);
        if(!options.forceFallback)assert(result.media.duration && Math.abs(result.media.duration-.5)<.15);
        if (options.format==='webm' && options.bg==='none') assert.equal(result.media.cornerAlpha,0,'WebM preserves alpha');
      }
      const file = `${options.format}-${options.wide?'wide':'tall'}${options.forceFallback?'-fallback':''}.${result.mime==='video/webm'?'webm':options.format}`;
      fs.writeFileSync(path.join(output,file),bytes);
      results.push({ options, ...result, file });
      console.log('Verified',file,result.size,result.codec||'');
    }
    const cancelled = await c.evaluate(`(async()=>{
      const pr=BFX.P.fromEffect('new59_quill'),abort={aborted:false};pr.dur=pr.layers[0].dur=2;
      try{await BFX.EX.run(pr,{format:'mp4',res:540,fps:24,bg:'black'},p=>{if(p.phase==='render')abort.aborted=true;},abort);return false;}
      catch(e){return !!e.abort;}
    })()`);
    assert(cancelled,'Cancellation stops video export');
    assert.deepEqual(qa.rendererErrors,[]);
    fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({results,cancelled,rendererErrors:qa.rendererErrors},null,2));
  } finally { await qa.stop(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
