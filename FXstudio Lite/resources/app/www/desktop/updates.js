(() => {
  'use strict';
  const UI=BFX.ui,h=UI.h,native=window.FXDesktopAPI;if(!native?.updateState)return;
  let state=null;const panels=new Set();
  const descriptions={idle:'Проверка при запуске и каждые 6 часов.',checking:'Проверяем GitHub Releases…',current:'Установлена актуальная версия.',
    available:'Доступна новая версия.',downloading:'Скачиваем обновление…',downloaded:'Обновление скачано и готово к установке.',error:'Не удалось проверить обновление.'};
  async function action(fn){try{await fn();}catch(error){UI.toast(error.message||'Действие не удалось.',4500);}}
  function header(){
    const top=document.querySelector('#app.ready > .top');if(!top)return;
    let button=top.querySelector('.fx-update-button');
    if(!button){button=UI.btn('Обновления',open,'ghost sm fx-update-button','reset');top.insertBefore(button,top.lastElementChild);}
    const available=state&&['available','downloading','downloaded'].includes(state.status);
    button.classList.toggle('has-update',!!available);button.title=available?'Доступна версия '+state.version:'Обновления VoxelMotion';
    button.querySelector('span').textContent=state?.status==='downloaded'?'Установить обновление':state?.status==='downloading'?'Скачивание '+(state.percent||0)+'%':'Обновления';
  }
  function render(panel){
    if(panel.closed){panels.delete(panel);return;}
    const current=state;if(!current){panel.body.textContent='Загрузка…';return;}
    const automatic=h('input',{type:'checkbox',checked:current.auto,'aria-label':'Автоматические обновления'});
    automatic.onchange=()=>action(async()=>{state=await native.setAutoUpdates(automatic.checked);update(state);});
    const installed=current.mode==='installed';
    const copy=h('div',{class:'fx-update-summary',role:'status'},h('b',null,'VoxelMotion '+current.currentVersion),
      h('p',null,current.status==='error'?current.message:descriptions[current.status]||''),
      ['available','downloading','downloaded'].includes(current.status)?h('small',null,'Новая версия: '+current.version):null);
    const controls=h('div',{class:'col gap'});
    const check=UI.btn('Проверить сейчас',()=>action(()=>native.checkUpdates()),'ghost wide','reset');
    check.disabled=['checking','downloading'].includes(current.status);controls.append(check);
    if(current.status==='available'&&installed)controls.append(UI.btn('Скачать обновление',()=>action(()=>native.downloadUpdate()),'primary wide','export'));
    if(current.status==='downloaded')controls.append(UI.btn('Установить и перезапустить',()=>action(async()=>{
      if(document.body.classList.contains('busy'))throw Error('Дождитесь завершения экспорта.');
      if(BFX.autosave?.flush&&!BFX.autosave.flush())throw Error('Не удалось сохранить черновик. Повторите сохранение перед обновлением.');
      await native.installUpdate();
    }),'primary wide','check'));
    if(current.status==='downloading')controls.append(h('progress',{value:current.percent||0,max:100,'aria-label':'Скачивание обновления'}));
    controls.append(UI.btn('Открыть страницу релиза',()=>action(()=>native.openUpdateRelease()),'ghost wide','info'));
    panel.body.replaceChildren(copy,h('label',{class:'fx-update-toggle'},automatic,' Проверять обновления автоматически'),
      h('p',{class:'f-hint'},installed?'Новая версия скачивается в фоне. Перезапуск выполняется только по кнопке, после сохранения черновика.':
        'Для Portable и запуска исходников доступна проверка версии. Новую версию скачайте со страницы релиза; установка из Setup поддерживает обновление внутри приложения.'),controls);
  }
  function update(next){state=next;header();for(const panel of panels)render(panel);}
  function open(){const panel=UI.sheet({title:'Обновления VoxelMotion',cls:'fx-updates-sheet'});panels.add(panel);render(panel);return panel;}
  const mount=UI.mount;UI.mount=function(...args){const result=mount.apply(this,args);header();return result;};
  const settings=UI.settings;UI.settings=function(...args){const result=settings.apply(this,args),panel=result?.body?result:UI.stack.at(-1);if(panel?.body&&!panel.body.querySelector('.fx-update-settings')){
    const button=UI.btn('Обновления VoxelMotion',open,'ghost wide fx-update-settings','reset');panel.body.prepend(button);
  }return result;};
  native.onUpdateState(update);native.updateState().then(update).catch(()=>{});
  BFX.updates={open,get state(){return state;}};
})();
