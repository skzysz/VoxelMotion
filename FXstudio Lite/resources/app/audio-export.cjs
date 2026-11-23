'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

function validateAudioJob(job){
  if(!job||typeof job.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(job.id)||
    !['mp4','webm'].includes(job.format)||!(job.video instanceof Uint8Array)||!(job.audio instanceof Uint8Array)||
    job.video.byteLength<16||job.video.byteLength>512*1024*1024||job.audio.byteLength<16||job.audio.byteLength>50*1024*1024||
    !Number.isFinite(job.duration)||job.duration<.01||job.duration>3600||
    !Number.isFinite(job.volume)||job.volume<0||job.volume>1||
    !Number.isFinite(job.delay)||job.delay<0||job.delay>3600||typeof job.loop!=='boolean')throw Error('Неверные параметры звука');
  return job;
}
function audioArguments(job,folder){
  validateAudioJob(job);
  return ['-hide_banner','-loglevel','error','-nostdin','-y','-i',path.join(folder,'video.'+job.format),
    ...(job.loop?['-stream_loop','-1']:[]),'-i',path.join(folder,'sound'),
    '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a',job.format==='mp4'?'aac':'libopus',
    '-b:a','160k','-ar','48000','-ac','2','-af',`volume=${job.volume},adelay=${Math.round(job.delay*1000)}:all=1,apad`,
    '-t',String(job.duration),...(job.format==='mp4'?['-movflags','+faststart']:[]),
    '-progress','pipe:1',path.join(folder,'result.'+job.format)];
}
class AudioExporter{
  constructor({binary,folder,onProgress=()=>{}}){this.binary=binary;this.folder=path.resolve(folder);this.onProgress=onProgress;this.jobs=new Map();}
  cancel(id){const job=this.jobs.get(id);if(job){job.cancelled=true;job.process?.kill();}return !!job;}
  cancelAll(){for(const id of this.jobs.keys())this.cancel(id);}
  get busy(){return this.jobs.size>0;}
  async mix(input){
    const job=validateAudioJob(input);
    if(this.jobs.size)throw Error('Дождитесь завершения обработки звука');
    if(!fs.existsSync(this.binary))throw Error('Не найден модуль экспорта звука. Переустановите VoxelMotion.');
    fs.mkdirSync(this.folder,{recursive:true});
    const folder=fs.mkdtempSync(path.join(this.folder,'sound-'));
    const task={cancelled:false,process:null};this.jobs.set(job.id,task);
    try{
      fs.writeFileSync(path.join(folder,'video.'+job.format),job.video);
      fs.writeFileSync(path.join(folder,'sound'),job.audio);
      await new Promise((resolve,reject)=>{
        const child=task.process=spawn(this.binary,audioArguments(job,folder),{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
        let progress='',errors='';
        child.stdout.on('data',bytes=>{
          progress+=bytes.toString();let line;
          while((line=progress.indexOf('\n'))>=0){const text=progress.slice(0,line);progress=progress.slice(line+1);
            if(text.startsWith('out_time_us=')){const percent=Math.min(99,Math.max(0,Number(text.slice(12))/1e6/job.duration*100));if(Number.isFinite(percent))this.onProgress({id:job.id,percent});}}
        });
        child.stderr.on('data',bytes=>{errors=(errors+bytes.toString()).slice(-4000);});
        const timeout=setTimeout(()=>{task.cancelled=true;task.timedOut=true;child.kill();},Math.max(60000,job.duration*2000));
        child.once('error',error=>{clearTimeout(timeout);reject(error);});
        child.once('close',code=>{clearTimeout(timeout);if(task.timedOut)reject(Error('Обработка звука превысила допустимое время.'));else if(task.cancelled)resolve();else if(code===0)resolve();else{console.warn('Audio conversion:',errors);reject(Error('Не удалось обработать звук. Выберите другой OGG, WAV или MP3.'));}});
      });
      if(task.cancelled)return {cancelled:true};
      const file=path.join(folder,'result.'+job.format);
      const size=fs.statSync(file).size;if(size>600*1024*1024)throw Error('Результат слишком большой для экспорта со звуком.');
      this.onProgress({id:job.id,percent:100});
      return {bytes:new Uint8Array(fs.readFileSync(file)),mime:'video/'+job.format,codec:job.format==='mp4'?'AAC':'Opus'};
    }finally{
      this.jobs.delete(job.id);
      const target=path.resolve(folder);
      if(!target.startsWith(this.folder+path.sep))throw Error('Недопустимая временная папка');
      fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
  }
}
module.exports={AudioExporter,audioArguments,validateAudioJob};
