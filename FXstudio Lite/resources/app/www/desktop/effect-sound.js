/* One short sound per effect/composition; no audio timeline. */
(() => {
  'use strict';
  const {ui:UI,db,P,u,EX}=BFX,h=UI.h,native=window.FXDesktopAPI;
  const PREFIX='effect-sound:',players=new Set();
  async function read(id){const record=await db.get('kv',PREFIX+id);if(!record?.blob)throw Error('Звуковой файл отсутствует. Выберите его ещё раз.');return record;}
  async function duration(blob){
    const url=URL.createObjectURL(blob),audio=new Audio();
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Не удалось прочитать звук. Выберите OGG, WAV или MP3.')),10000);
      audio.onloadedmetadata=()=>{clearTimeout(timer);Number.isFinite(audio.duration)&&audio.duration>0?resolve(audio.duration):reject(Error('Не удалось определить длительность звука.'));};
      audio.onerror=()=>{clearTimeout(timer);reject(Error('Не удалось открыть звук. Поддерживаются OGG, WAV, MP3 и другие форматы браузера.'));};audio.src=url;
    });}finally{audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);}
  }
  async function storeSound(blob,name,id=u.uid()){
    if(!blob.size||blob.size>50*1024*1024)throw Error('Выберите звуковой файл до 50 МБ.');
    const record={blob,name,duration:await duration(blob),date:Date.now()};
    if(await db.set('kv',PREFIX+id,record)!==true)throw Error('Не удалось сохранить звук в библиотеке.');
    return {id,name,duration:record.duration,volume:1,delay:0,loop:false,enabled:true};
  }
  function cleanup(state){state.token++;state.audio?.pause();if(state.audio){state.audio.removeAttribute('src');state.audio.load();}if(state.url)URL.revokeObjectURL(state.url);state.audio=null;state.url=null;state.id=null;state.loading=false;}
  async function sync(player){
    const state=player._effectSoundState;if(!state)return;
    const cfg=player.pr?._effectSound;
    if(!player.alive||!player.cv.isConnected){if(!player.alive){cleanup(state);players.delete(player);}return;}
    if(!cfg?.enabled||!player.playing){state.audio?.pause();return;}
    if(state.id!==cfg.id){
      if(state.loading)return;
      cleanup(state);state.loading=true;state.id=cfg.id;const token=state.token;
      try{const record=await read(cfg.id);if(token!==state.token)return;state.url=URL.createObjectURL(record.blob);state.audio=new Audio(state.url);state.audio.preload='auto';}
      catch(error){if(token===state.token){state.failed=true;UI.toast(error.message,4000);}return;}
      finally{if(token===state.token)state.loading=false;}
    }
    const audio=state.audio;if(!audio)return;
    const t=player.t-(cfg.delay||0),end=Number.isFinite(audio.duration)?audio.duration:cfg.duration;
    audio.volume=Math.max(0,Math.min(1,cfg.volume??1));audio.loop=!!cfg.loop;
    if(t<0||!cfg.loop&&t>=end){audio.pause();return;}
    const at=cfg.loop?t%end:t;
    if(Number.isFinite(at)&&Math.abs(audio.currentTime-at)>.15)try{audio.currentTime=at;}catch{}
    if(audio.paused&&!state.failed)try{await audio.play();}catch{state.failed=true;}
  }
  const play=UI.Player.prototype.play,pause=UI.Player.prototype.pause,seek=UI.Player.prototype.seek,destroy=UI.Player.prototype.destroy;
  UI.Player.prototype.play=function(...args){const result=play.apply(this,args);if(this._effectSoundState)this._effectSoundState.failed=false;sync(this);return result;};
  UI.Player.prototype.pause=function(...args){const result=pause.apply(this,args);this._effectSoundState?.audio?.pause();return result;};
  UI.Player.prototype.seek=function(...args){const result=seek.apply(this,args);sync(this);return result;};
  UI.Player.prototype.destroy=function(...args){if(this._effectSoundState){cleanup(this._effectSoundState);players.delete(this);}return destroy.apply(this,args);};
  setInterval(()=>{for(const player of players)sync(player);},100);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const player of players)player._effectSoundState?.audio?.pause();});

  function install(sheet){
    const project=sheet._historyProject,pv=sheet._historyPreview;if(!project||!pv)return;
    pv.pl._effectSoundState={token:0,audio:null,id:null,url:null,loading:false};players.add(pv.pl);
    const changed=key=>{pv.history?.record('sound:'+key);refreshEntry();sync(pv.pl);};
    function refreshEntry(){
      const host=sheet.body.querySelector('.fx-global-scene-controls');if(!host)return;
      let entry=host.querySelector('.fx-sound-entry');
      if(!entry){entry=UI.btn('',open,'ghost fx-sound-entry','music');host.append(entry);}
      let text=entry.querySelector('.fx-sound-caption');if(!text){text=h('span',{class:'fx-sound-caption'});entry.append(text);}
      const cfg=project._effectSound;text.textContent=cfg?.enabled?'Звук · '+cfg.name:'Звук эффекта · '+(cfg?'выключен':'не выбран');
    }
    const originalSync=pv.syncProject;
    pv.syncProject=function(...args){const result=originalSync?.apply(this,args);refreshEntry();return result;};
    const unsubscribe=pv.history?.listen(refreshEntry),close=sheet.close;
    sheet.close=function(...args){unsubscribe?.();return close.apply(this,args);};
    function open(){
      pv.pl.pause();BFX.SoundLibrary.stop();
      let tab='extra',query='',audition=null,auditionUrl=null,generation=0,rows=[];
      const stop=()=>{audition?.pause();audition=null;if(auditionUrl)URL.revokeObjectURL(auditionUrl);auditionUrl=null;};
      const modal=UI.sheet({title:'Звук эффекта',cls:'fx-effect-sound-sheet',onClose:stop});
      const selected=h('div',{class:'fx-sound-selected'}),list=h('div',{class:'fx-sound-choices'}),notice=h('p',{class:'f-hint',role:'status'});
      const search=h('input',{type:'search',class:'inp',placeholder:'Найти звук…','aria-label':'Поиск звука эффекта'});
      const tabs=UI.seg([['extra','Короткие звуки'],['minecraft','Minecraft'],['mine','Свои файлы']],tab,value=>{tab=value;load();},'wide');
      async function choose(blob,name,id){
        try{stop();notice.textContent='Сохраняю звук…';const cfg=await storeSound(blob,name,id);if(modal.closed||sheet.closed)return;project._effectSound=cfg;cleanup(pv.pl._effectSoundState);changed('select');settings();notice.textContent='Звук выбран. Он сохранится вместе с черновиком.';}
        catch(error){notice.textContent=error.message;}
      }
      async function preview(row){
        try{stop();const blob=await row.blob();if(modal.closed)return;auditionUrl=URL.createObjectURL(blob);audition=new Audio(auditionUrl);await audition.play();}
        catch(error){notice.textContent='Не удалось прослушать звук. '+error.message;}
      }
      function settings(){
        const cfg=project._effectSound;
        selected.replaceChildren(h('strong',null,cfg?cfg.name:'Звук пока не выбран'));
        if(!cfg){selected.append(h('p',{class:'f-hint'},'Выберите короткий звук или загрузите свой файл. Он будет воспроизводиться вместе с эффектом.'));return;}
        const enabled=h('input',{type:'checkbox',checked:cfg.enabled,'aria-label':'Звук включён'});
        enabled.onchange=()=>{cfg.enabled=enabled.checked;changed('enabled');};
        const volume=h('input',{type:'range',min:0,max:100,step:1,value:Math.round(cfg.volume*100),'aria-label':'Громкость звука'}),value=h('span',null,Math.round(cfg.volume*100)+'%');
        volume.oninput=()=>{cfg.volume=Number(volume.value)/100;value.textContent=volume.value+'%';changed('volume');};
        const delay=h('input',{type:'number',class:'inp',min:0,max:P.duration(project),step:.05,value:cfg.delay,'aria-label':'Задержка звука, секунды'});
        delay.onchange=()=>{cfg.delay=Math.max(0,Math.min(P.duration(project),Number(delay.value)||0));delay.value=cfg.delay;changed('delay');};
        const loop=h('input',{type:'checkbox',checked:cfg.loop,'aria-label':'Повторять звук'});
        loop.onchange=()=>{cfg.loop=loop.checked;changed('loop');};
        selected.append(h('div',{class:'fx-sound-controls'},h('label',null,enabled,' Включён'),h('label',null,loop,' Повторять до конца эффекта')),
          UI.field('Громкость',h('div',{class:'row gap'},volume,value)),UI.field('Задержка, с',delay),
          h('div',{class:'row gap wrap'},UI.btn('Прослушать с эффектом',()=>{stop();modal.close();pv.pl.seek(0);pv.pl.play();},'primary sm','play'),
            UI.btn('Скачать звук',async()=>{try{const record=await read(cfg.id);const result=await EX.sink(record.name,record.blob.type||'audio/ogg');await result.write(record.blob);EX.download(await result.close());}catch(error){UI.toast(error.message);}},'ghost sm','export'),
            UI.btn('Убрать звук',()=>{stop();delete project._effectSound;cleanup(pv.pl._effectSoundState);changed('remove');settings();},'ghost sm','trash')));
      }
      function draw(){
        const words=query.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
        const visible=rows.filter(row=>words.every(word=>(row.name+' '+(row.tags||'')).toLocaleLowerCase('ru').includes(word)));
        list.replaceChildren(...visible.slice(0,60).map(row=>h('div',{class:'fx-sound-choice','data-effect-sound':row.id},
          h('div',null,h('b',null,row.name),h('small',null,row.category||'')),h('div',{class:'row gap'},
            UI.ib('play',()=>preview(row),'Прослушать звук'),UI.btn('Выбрать',async()=>{try{await choose(await row.blob(),row.fileName||row.name+'.ogg',row.id);}catch(error){notice.textContent=error.message;}},'ghost sm')))));
        if(!visible.length)list.append(h('p',{class:'f-hint'},'Звуки не найдены.'));
        if(visible.length>60)list.append(h('p',{class:'f-hint'},'Показаны первые 60. Уточните поиск.'));
      }
      async function load(){
        stop();const request=++generation;list.textContent='Открываю звуки…';
        try{
          let next;
          if(tab==='extra'){
            const meta=await(await fetch('sounds/extra.json')).json();
            next=meta.records.map(([id,name,category,,tags])=>({id:'extra-'+id,name,category,tags,blob:async()=>{const response=await fetch('sounds/extra/'+id+'.ogg');if(!response.ok)throw Error('Звук не найден');return response.blob();}}));
          }else if(tab==='minecraft'){
            const catalog=await BFX.SoundLibrary.catalog();
            next=catalog.rows.map(row=>({id:'minecraft-'+row.event,name:row.label,category:row.category,tags:row.aliases+' '+row.event,blob:()=>BFX.SoundLibrary.load(row.variants[0])}));
          }else{
            const all=await db.all('kv');next=all.filter(([key,record])=>String(key).startsWith(PREFIX+'user-')&&record?.blob).map(([key,record])=>({id:key.slice(PREFIX.length),name:record.name,fileName:record.name,category:'Свой файл',blob:async()=>record.blob}));
          }
          if(request!==generation||modal.closed)return;rows=next;draw();
        }catch(error){if(!modal.closed)list.textContent='Не удалось открыть каталог. '+error.message;}
      }
      search.oninput=()=>{query=search.value;draw();};
      modal.body.append(selected,h('p',{class:'f-hint'},'Один звук на эффект: громкость, задержка и повтор. MP4/WebM сохраняются со звуком; GIF, PNG и PNG-кадры — без звука.'),
        UI.btn('Загрузить свой звук',async()=>{const file=await UI.pickFile('audio/*,.ogg,.wav,.mp3,.m4a,.flac');if(file&&!modal.closed)await choose(file,file.name,'user-'+u.uid());},'ghost wide','plus'),tabs,search,notice,list,UI.btn('Готово',()=>modal.close(),'primary wide mt'));
      settings();load();return modal;
    }
    sheet.openEffectSound=open;
    sheet.head.insertBefore(UI.ib('music',open,'Звук эффекта','fx-effect-sound'),sheet.head.querySelector('.fx-autosave-status')||sheet.head.querySelector('.btn.primary'));
    refreshEntry();
  }
  const openFx=UI.openFx;UI.openFx=function(...args){const sheet=openFx.apply(this,args);if(sheet)install(sheet);return sheet;};
  async function attach(result,project,options,onProgress,signal){
    const cfg=project._effectSound;if(!cfg?.enabled)return result;
    if(!native?.mixEffectAudio)throw Error('Экспорт со звуком доступен в настольной версии VoxelMotion.');
    const record=await read(cfg.id),id=crypto.randomUUID();
    if(signal.aborted){const error=Error('Отменено');error.abort=true;throw error;}
    onProgress({phase:'audio',k:.96,msg:'Добавление звука…'});
    const unsubscribe=native.onAudioProgress(progress=>{if(progress.id===id)onProgress({phase:'audio',k:.96+progress.percent/100*.04,msg:'Добавление звука… '+Math.round(progress.percent)+'%'});});
    let cancelSent=false;const poll=setInterval(()=>{if(signal.aborted&&!cancelSent){cancelSent=true;native.cancelEffectAudio(id).catch(()=>{});}},100);
    try{
      const mixed=await native.mixEffectAudio({id,video:new Uint8Array(await result.blob.arrayBuffer()),audio:new Uint8Array(await record.blob.arrayBuffer()),
        format:result.mime.includes('webm')?'webm':'mp4',volume:cfg.volume??1,delay:cfg.delay||0,loop:!!cfg.loop,duration:P.duration(project)});
      if(mixed.cancelled||signal.aborted){const error=Error('Отменено');error.abort=true;throw error;}
      const blob=new Blob([mixed.bytes],{type:mixed.mime});if(result.url)URL.revokeObjectURL(result.url);
      const url=URL.createObjectURL(blob);onProgress({phase:'finish',k:1,msg:'Готово'});
      return {...result,blob,url,preview:url,size:blob.size,mime:mixed.mime,codec:(result.codec||'')+' + '+mixed.codec,hasAudio:true};
    }catch(error){
      if(signal.aborted){const cancelled=Error('Отменено');cancelled.abort=true;throw cancelled;}
      throw Error((error.message||String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));
    }finally{clearInterval(poll);unsubscribe();}
  }
  BFX.EffectSound={attach,read,store:storeSound,refresh:()=>{for(const p of players)sync(p);}};
})();
