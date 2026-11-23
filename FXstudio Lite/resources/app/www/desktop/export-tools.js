/* Export presets and explicit file-save feedback. */
(() => {
  'use strict';
  const {ui:UI,EX,P,u}=BFX,h=UI.h;
  const KEY='bfx.presets.v1';
  let presets;
  try{presets=JSON.parse(localStorage.getItem(KEY));}catch{}
  if(!presets||!Array.isArray(presets.exports)||!Array.isArray(presets.effects))presets={exports:[],effects:[]};
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(presets));return true;}catch{UI.toast('Пресет не сохранён: недостаточно места.',4000);return false;}};
  const builtins=[
    {id:'shorts',name:'YouTube Shorts',wide:false,format:'mp4',res:1080,fps:30,bg:'chroma',quality:'high'},
    {id:'tiktok',name:'TikTok / Reels',wide:false,format:'mp4',res:1080,fps:30,bg:'chroma',quality:'high'},
    {id:'youtube',name:'YouTube · 16:9',wide:true,format:'mp4',res:1080,fps:30,bg:'black',quality:'high'},
    {id:'alpha',name:'Прозрачное видео',wide:false,format:'webm',res:1080,fps:30,bg:'none',quality:'high'},
    {id:'sticker',name:'GIF-стикер',wide:false,format:'gif',gifW:480,gfps:20,bg:'none',crop:true}
  ];
  function exportPresetUI(sheet){
    const st=sheet.exportSettings,project=sheet.exportProject;
    if(!st||!sheet.refreshExport)return;
    const refresh=()=>{
      const media=sheet.body.querySelector('.exp-done .media');
      if(media&&!media.dataset.sizing){
        media.dataset.sizing='true';const image=media.querySelector('img,video');
        const size=()=>{const w=image?.naturalWidth||image?.videoWidth,hh=image?.naturalHeight||image?.videoHeight;if(w&&hh){media.style.aspectRatio=w+'/'+hh;media.classList.toggle('fx-wide-result',w>hh);}};
        image?.addEventListener('load',size,{once:true});image?.addEventListener('loadedmetadata',size,{once:true});size();
      }
      if(sheet.closed||sheet.body.querySelector('.fx-export-presets')||!sheet.body.querySelector('.fmts'))return;
      const select=h('select',{class:'inp','aria-label':'Пресет экспорта'},h('option',{value:''},'Выбрать готовые настройки…'));
      for(const preset of [...builtins,...presets.exports])select.append(h('option',{value:preset.id},preset.name));
      select.onchange=()=>{
        const preset=[...builtins,...presets.exports].find(p=>p.id===select.value);if(!preset)return;
        UI.setFrame(project,!!preset.wide);
        for(const key of ['format','res','fps','bg','quality','gfps','gifW','crop','color','clean'])if(preset[key]!==undefined)st[key]=preset[key];
        if(preset.bg==='project'&&project.bg?.type==='none')st.bg='black';
        sheet.refreshExport();
      };
      const row=h('div',{class:'fx-export-presets'},UI.field('Пресеты экспорта',select),h('div',{class:'row gap wrap'},
        UI.btn('Сохранить настройки',async()=>{
          if(presets.exports.length>=30){UI.toast('Можно сохранить до 30 пресетов экспорта');return;}
          const name=(await UI.prompt('Название пресета','','Например: Мой YouTube'))?.trim();if(!name)return;
          presets.exports.push({...structuredClone(st),id:u.uid(),name:name.slice(0,80),wide:P.isWide(project)});
          if(persist()){row.remove();refresh();UI.toast('Пресет экспорта сохранён');}
        },'ghost sm','plus'),UI.btn('Мои пресеты',()=>manageExports(),'ghost sm','gear')),
        h('p',{class:'f-hint'},project._effectSound?.enabled?
          (['mp4','webm'].includes(st.format)?'Со звуком: '+project._effectSound.name:'Этот формат сохраняется без звука. Для звука выберите MP4 или WebM.'):
          'Звук можно выбрать в редакторе эффекта. MP4 и WebM поддерживают экспорт со звуком.'));
      sheet.body.prepend(row);
    };
    const observer=new MutationObserver(refresh);observer.observe(sheet.body,{childList:true});
    const close=sheet.close;sheet.close=function(...args){observer.disconnect();return close.apply(this,args);};refresh();
    function manageExports(){
      const modal=UI.sheet({title:'Мои пресеты экспорта'});
      const fill=()=>{modal.body.replaceChildren(...(presets.exports.length?presets.exports.map(p=>h('div',{class:'fx-preset-row'},h('span',null,p.name),UI.btn('Удалить',async()=>{
        if(!await UI.confirm('Удалить пресет «'+p.name+'»?','Удалить',true))return;
        presets.exports=presets.exports.filter(x=>x!==p);persist();fill();rowRefresh();
      },'ghost sm'))):[h('p',{class:'f-hint'},'Сохраните текущие настройки экспорта, чтобы создать свой пресет.')]));};
      const rowRefresh=()=>{sheet.body.querySelector('.fx-export-presets')?.remove();refresh();};fill();
    }
  }
  const exportSheet=UI.exportSheet;
  UI.exportSheet=function(...args){const sheet=exportSheet.apply(this,args);if(sheet)exportPresetUI(sheet);return sheet;};

  let running=false;
  const run=EX.run;
  EX.run=async function(project,options,onProgress,signal={aborted:false}){
    if(running)throw Error('Дождитесь завершения текущего экспорта.');
    if(signal.aborted){const error=Error('Отменено');error.abort=true;throw error;}
    const fps=options?.fps??30;
    if(!Number.isFinite(fps)||fps<1||fps>60)throw Error('Выберите частоту от 1 до 60 кадров в секунду.');
    running=true;
    try{
      // Editing a live project cannot change frames halfway through an export.
      const snapshot=u.deep(project);
      return await run.call(this,snapshot,options,p=>{
        onProgress?.(p);
        for(const bar of document.querySelectorAll('.exp-run .bar')){
          bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','Экспорт');
          bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
          bar.setAttribute('aria-valuenow',String(Math.round((p.k||0)*100)));
        }
      },signal);
    } finally {running=false;}
  };
  window.FXDesktopAPI?.onDownload(result=>{
    for(const node of document.querySelectorAll('.fx-export-location')){
      node.textContent=result.state==='completed'?'Файл сохранён: '+result.name+' · '+(BFX.desktop?.exportFolder||'папка экспорта'):
        'Не удалось сохранить файл. Проверьте папку экспорта и повторите скачивание.';
      node.dataset.state=result.state;
    }
  });

  function effectPresetUI(sheet,id){
    const project=sheet._historyProject;if(!project)return;
    function open(){
      const modal=UI.sheet({title:'Варианты эффекта'});
      const fill=()=>{
        modal.body.replaceChildren(UI.btn('Сохранить текущий вариант',async()=>{
          if(presets.effects.length>=60){UI.toast('Можно сохранить до 60 вариантов');return;}
          const name=(await UI.prompt('Название варианта',project.name||BFX.FX.map[id]?.name||''))?.trim();if(!name)return;
          const snapshot=structuredClone(project);delete snapshot.thumb;
          presets.effects.push({id:u.uid(),name:name.slice(0,80),effectId:id,project:snapshot});
          if(persist()){fill();UI.toast('Вариант сохранён');}
        },'primary wide','plus'),h('p',{class:'f-hint'},'Сохраняются параметры, слои и сцена. Исходные изображения остаются в библиотеке этого приложения.'));
        const own=presets.effects.filter(p=>p.effectId===id);
        for(const preset of own)modal.body.append(h('div',{class:'fx-preset-row'},h('strong',null,preset.name),h('div',{class:'row gap'},
          UI.btn('Применить',()=>{
            const pr=structuredClone(preset.project);pr.id=u.uid();pr.created=pr.updated=Date.now();
            while(UI.stack.length)UI.stack.at(-1).close();UI.openFx(id,null,{historyProject:pr});
          },'ghost sm'),UI.ib('trash',async()=>{if(await UI.confirm('Удалить вариант «'+preset.name+'»?','Удалить',true)){presets.effects=presets.effects.filter(p=>p!==preset);persist();fill();}},'Удалить вариант'))));
        if(!own.length)modal.body.append(h('p',{class:'f-hint'},'Сохранённых вариантов этого эффекта пока нет.'));
      };fill();return modal;
    }
    const button=UI.ib('magic',open,'Варианты эффекта','fx-effect-presets');
    sheet.head.insertBefore(button,sheet.head.querySelector('.fx-autosave-status')||sheet.head.querySelector('.btn.primary'));
    sheet.openEffectPresets=open;
  }
  const openFx=UI.openFx;
  UI.openFx=function(id,...args){const sheet=openFx.call(this,id,...args);if(sheet)effectPresetUI(sheet,id);return sheet;};
  BFX.presets={get exports(){return structuredClone(presets.exports);},get effects(){return structuredClone(presets.effects);},builtins};
})();
