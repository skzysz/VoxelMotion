/* Recent effects, persistent personal collections and disposable hover previews. */
(() => {
  'use strict';
  const {ui:UI, FX, P, store, u} = BFX, h=UI.h;
  const KEY='bfx.catalog.v1';
  let data;
  try{data=JSON.parse(localStorage.getItem(KEY));}catch{}
  if(!data||!Array.isArray(data.recent)||!Array.isArray(data.collections))data={recent:[],collections:[]};
  data.recent=data.recent.filter(id=>typeof id==='string').slice(0,24);
  data.collections=data.collections.filter(g=>g&&typeof g.id==='string'&&typeof g.name==='string'&&Array.isArray(g.ids)).slice(0,30);
  let refresh=()=>{}, live=null;
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(data));return true;}catch{UI.toast('Не удалось сохранить подборки: недостаточно места.',4000);return false;}};
  function stopPreview(){if(live){clearTimeout(live.timer);live.player?.destroy();live.canvas?.remove();live=null;}}
  const openFx=UI.openFx;
  UI.openFx=function(id,...args){stopPreview();data.recent=[id,...data.recent.filter(x=>x!==id)].slice(0,24);persist();return openFx.call(this,id,...args);};
  const go=UI.go;
  UI.go=function(...args){stopPreview();return go.apply(this,args);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPreview();});

  async function createCollection(effectId){
    if(data.collections.length>=30){UI.toast('Можно создать до 30 подборок');return;}
    const name=(await UI.prompt('Название подборки','','Например: Для роликов'))?.trim();
    if(!name)return;
    data.collections.push({id:u.uid(),name:name.slice(0,80),ids:effectId?[effectId]:[]});
    persist();refresh();
  }
  function collectionMenu(effect){
    UI.menu([
      ...data.collections.map(group=>({label:(group.ids.includes(effect.id)?'Убрать из «':'Добавить в «')+group.name+'»',icon:'folder',on:()=>{
        group.ids=group.ids.includes(effect.id)?group.ids.filter(id=>id!==effect.id):[...group.ids,effect.id];persist();refresh();
      }})),
      {label:'Новая подборка',icon:'plus',on:()=>createCollection(effect.id)}
    ],effect.name);
  }
  function card(effect){
    const tile=h('div',{class:'fx-library-tile','data-effect-id':effect.id},UI.fxCard(effect));
    tile.append(UI.ib('more',()=>collectionMenu(effect),'Добавить в подборку','fx-collection-more'));
    tile.addEventListener('contextmenu',e=>{e.preventDefault();collectionMenu(effect);});
    tile.addEventListener('pointerenter',e=>{
      if(e.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      stopPreview();const entry=live={};
      entry.timer=setTimeout(()=>{
        if(live!==entry||!tile.isConnected)return;
        const project=P.fromEffect(effect.id,undefined,false);
        entry.player=new UI.Player({project:()=>project,bg:()=>UI.POSTER_BG});
        entry.canvas=entry.player.cv;entry.canvas.classList.add('fx-hover-preview');
        tile.querySelector('.thumb').append(entry.canvas);entry.player.fit();entry.player.play();
      },450);
    });
    tile.addEventListener('pointerleave',()=>{if(live)stopPreview();});
    return tile;
  }
  UI.views.fx=function(view){
    let selected=store.get('fxLibraryTab','all'), query='';
    const search=h('input',{type:'search',class:'inp search',placeholder:'Название, тег или #категория…','aria-label':'Поиск эффектов и тегов'});
    const chips=h('div',{class:'chips scroll fx-library-tabs'}),list=h('div',{class:'fxlist'});
    const title=h('div',{class:'fx-library-heading'},h('div',null,h('span',{class:'fx-library-eyebrow'},'VOXELMOTION / БИБЛИОТЕКА'),h('b',null,'Эффекты Minecraft'),h('small',null,'Найдите эффект, настройте его и сохраните со звуком')),
      UI.btn('Новая подборка',()=>createCollection(),'ghost sm','plus'));
    const available=()=>FX.list.filter(f=>!f.catalogHidden&&f.cat!=='fox');
    const select=key=>{selected=key;store.set('fxLibraryTab',key);render();};
    function render(){
      stopPreview();
      const groups=[['recent','Недавние'],['fav','★ Избранное'],['all','Все'],
        ...FX.CATS.filter(c=>c[0]!=='fox').map(([id,name])=>[id,name]),...data.collections.map(g=>['collection:'+g.id,'▣ '+g.name])];
      if(!groups.some(([id])=>id===selected))selected='all';
      chips.replaceChildren(...groups.map(([id,name])=>h('button',{type:'button',class:'chip'+(id===selected?' on':''),'data-library-tab':id,'aria-pressed':String(id===selected),onclick:()=>select(id)},name)));
      const chosen=chips.querySelector('.on');
      if(chosen){const a=chosen.getBoundingClientRect(),b=chips.getBoundingClientRect();if(a.left<b.left)chips.scrollLeft+=a.left-b.left;else if(a.right>b.right)chips.scrollLeft+=a.right-b.right;}
      let effects=available(),heading='Все эффекты';
      if(selected==='recent'){effects=data.recent.map(id=>FX.map[id]).filter(f=>f&&!f.catalogHidden);heading='Недавно открытые';}
      else if(selected==='fav'){effects=BFX.FAV.list('fx').map(id=>FX.map[id]).filter(f=>f&&!f.catalogHidden);heading='Избранное';}
      else if(selected.startsWith('collection:')){const group=data.collections.find(g=>g.id===selected.slice(11));effects=(group?.ids||[]).map(id=>FX.map[id]).filter(Boolean);heading=group?.name||'Подборка';}
      else if(selected!=='all'){effects=effects.filter(f=>f.cat===selected||(selected==='new59'&&f.isNew61));heading=FX.CATS.find(c=>c[0]===selected)?.[1]||selected;}
      if(query.trim()){
        const norm=s=>String(s).toLowerCase().replace(/ё/g,'е');
        const tags=query.match(/#[^\s]+/g)||[];
        for(const token of tags){const tag=norm(token.slice(1));effects=effects.filter(f=>norm([f.cat,FX.CATS.find(c=>c[0]===f.cat)?.[1],...(f.tags||[])].join(' ')).includes(tag));}
        const text=query.replace(/#[^\s]+/g,'').trim();
        if(text)effects=BFX.SS.rank(effects,BFX.SS.query(text),BFX.SS.F.fx);
      }
      const row=h('div',{class:'grp-h'},h('span',null,heading),h('small',{'aria-label':'Количество эффектов'},effects.length));
      if(selected.startsWith('collection:')){
        const group=data.collections.find(g=>g.id===selected.slice(11));
        row.append(UI.ib('more',()=>UI.menu([
          {label:'Переименовать',icon:'edit',on:async()=>{const name=(await UI.prompt('Название подборки',group.name))?.trim();if(name){group.name=name.slice(0,80);persist();render();}}},
          {label:'Удалить подборку',icon:'trash',danger:true,on:async()=>{if(await UI.confirm('Удалить подборку «'+group.name+'»? Эффекты останутся.','Удалить',true)){data.collections=data.collections.filter(g=>g!==group);persist();select('all');}}}
        ],group.name),'Действия с подборкой'));
      }
      list.replaceChildren(row,effects.length?h('div',{class:'cards'},effects.map(card)):UI.empty('search','Пока пусто',query?'Измените запрос или выберите «Все».':selected==='recent'?'Откройте любой эффект — он появится здесь.':'Добавляйте эффекты через меню ⋯ на карточке.'));
    }
    search.addEventListener('input',u.debounce(()=>{query=search.value;render();},180));
    view.append(title,h('div',{class:'sticky-bar'},search,chips),list);
    refresh=()=>{if(view.isConnected)render();};
    view._show=render;view._hide=stopPreview;view._destroy=stopPreview;
    const favorite=()=>{if(!view.isConnected){BFX.events.off('fav',favorite);return;}if(selected==='fav')render();};
    BFX.events.on('fav',favorite);render();
  };
  BFX.catalog={get collections(){return structuredClone(data.collections);},get recent(){return data.recent.slice();},stopPreview};
})();
