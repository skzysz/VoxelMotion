/* Layer operations share the existing undo history, preview and autosave. */
(() => {
  'use strict';
  const {ui:UI,P,u,EditHistory}=BFX,h=UI.h;
  const histories=new WeakMap();
  function tools(sheet){
    const project=sheet._historyProject,pv=sheet._historyPreview;
    if(!project||!pv||sheet.head.querySelector('.fx-layer-tools'))return;
    const history=EditHistory.attach(project);
    let log=histories.get(history);
    if(!log){
      log=[];histories.set(history,log);
      const record=history.record;
      let label='Изменение параметров';
      history.record=function(key){label=key?.startsWith('tool:')?key.slice(5):'Изменение параметров';return record.apply(this,arguments);};
      history.listen(restored=>{log.unshift({label:restored?'Отмена / повтор':label,time:Date.now()});log.splice(30);});
    }
    const layer=()=>project.layers.find(l=>l.id===pv.activeLayer)||project.layers[0];
    function change(label,fn){fn();history.record('tool:'+label);pv.syncProject?.();pv.pl.invalidate();}
    function duplicate(){
      const source=layer();if(!source)return;
      change('Копия слоя',()=>{
        const clone=u.deep(source);clone.id=u.uid();clone.name=(source.name||BFX.FX.map[source.fx]?.name||'Слой')+' · копия';
        clone.x=(clone.x||0)+24;clone.y=(clone.y||0)+24;
        project.layers.splice(project.layers.indexOf(source)+1,0,clone);pv.activeLayer=clone.id;
        project.dur=Math.max(project.dur||0,(clone.start||0)+clone.dur);
      });UI.toast('Создана копия слоя');
    }
    function layersSheet(){
      pv.pl.pause();
      const modal=UI.sheet({title:'Слои и точное положение',cls:'fx-layer-tool-sheet'}),body=modal.body;
      const build=()=>{
        const target=layer(),select=h('select',{class:'inp','aria-label':'Слой для редактирования'});
        for(const item of project.layers)select.append(h('option',{value:item.id,selected:item===target},item.name||BFX.FX.map[item.fx]?.name||'Слой'));
        select.onchange=()=>{pv.activeLayer=select.value;build();};
        body.replaceChildren(UI.field('Слой',select));
        if(!target)return;
        const fields=h('div',{class:'fx-precise-grid'});
        for(const [key,label,step,min,max,initial]of [['x','X, пиксели',1,-10000,10000,0],['y','Y, пиксели',1,-10000,10000,0],['scale','Масштаб',.01,.01,20,1],['rot','Поворот, °',.1,-3600,3600,0]]){
          const input=h('input',{class:'inp',type:'number',step,min,max,value:target[key]??initial,'aria-label':label,'data-layer-value':key});
          input.addEventListener('change',()=>{const value=Number(input.value);if(!Number.isFinite(value)){input.value=target[key]??initial;return;}change(label,()=>target[key]=Math.max(min,Math.min(max,value)));input.value=target[key];});
          fields.append(UI.field(label,input));
        }
        const centerX=()=>{const frame=P.frame(project);target.x=frame.x+frame.w/2-540;};
        const centerY=()=>{const frame=P.frame(project);target.y=frame.h/2-960;};
        body.append(fields,h('div',{class:'row gap wrap'},
          UI.btn('По центру X',()=>{change('Выравнивание X',centerX);build();},'ghost sm'),
          UI.btn('По центру Y',()=>{change('Выравнивание Y',centerY);build();},'ghost sm'),
          UI.btn('Копия слоя',()=>{duplicate();build();},'ghost sm','copy')));
        body.append(h('p',{class:'f-hint'},'Ctrl+D — копия активного слоя. Alt+стрелки — сдвиг на 1 пиксель, Alt+Shift+стрелки — на 10. Магнит в предпросмотре привязывает объекты к направляющим.'));
        const check=h('input',{type:'checkbox',checked:!!BFX.store.get('compositionGuides',false)});
        check.onchange=()=>{BFX.store.set('compositionGuides',check.checked);showGuides();};
        body.append(h('label',{class:'fx-guides-label'},check,' Показывать сетку третей и центр кадра'),UI.btn('Готово',()=>modal.close(),'primary wide mt'));
      };build();return modal;
    }
    const grid=h('div',{class:'fx-composition-guides','aria-hidden':'true'});pv.stage.append(grid);
    function showGuides(){grid.hidden=!BFX.store.get('compositionGuides',false);}showGuides();
    function historySheet(){
      const modal=UI.sheet({title:'История действий',cls:'fx-history-tools'});
      const render=()=>{
        if(modal.closed)return;
        const undo=UI.btn('Отменить',()=>history.undo(),'ghost sm','undo');undo.disabled=!history.canUndo;
        const redo=UI.btn('Повторить',()=>history.redo(),'ghost sm','reset');redo.disabled=!history.canRedo;
        modal.body.replaceChildren(h('div',{class:'row gap'},undo,redo),h('p',{class:'f-hint'},'До 60 состояний в текущем редакторе. Ctrl+Z — отмена, Ctrl+Shift+Z — повтор.'),
          h('ol',{class:'fx-action-history'},...(log.length?log.map(item=>h('li',null,item.label,h('small',null,new Date(item.time).toLocaleTimeString('ru-RU')))):[h('li',null,'Пока нет изменений')])));
      };
      const unsubscribe=history.listen(render),close=modal.close;
      modal.close=function(...args){unsubscribe();return close.apply(this,args);};render();return modal;
    }
    const button=UI.ib('layers',layersSheet,'Слои и точное положение','fx-layer-tools');
    const historyButton=UI.ib('undo',historySheet,'История действий','fx-history-button');
    sheet.head.insertBefore(button,sheet.head.querySelector('.fx-autosave-status')||sheet.head.querySelector('.btn.primary'));sheet.head.insertBefore(historyButton,button.nextSibling);
    sheet.editorTools={duplicate,layersSheet,historySheet,move(dx,dy){const target=layer();if(target)change('Сдвиг слоя',()=>{target.x=(target.x||0)+dx;target.y=(target.y||0)+dy;});}};
  }
  const open=UI.openFx;
  UI.openFx=function(...args){const sheet=open.apply(this,args);if(sheet)tools(sheet);return sheet;};
  const editable=node=>node?.closest?.('input,textarea,select,[contenteditable=true]');
  document.addEventListener('keydown',e=>{
    if(editable(e.target)||e.repeat)return;
    const sheet=[...UI.stack].reverse().find(s=>s.editorTools);
    if(!sheet||UI.stack.at(-1)!==sheet)return;
    if(e.ctrlKey&&!e.altKey&&!e.metaKey&&e.code==='KeyD'){e.preventDefault();e.stopImmediatePropagation();sheet.editorTools.duplicate();}
    else if(e.altKey&&!e.ctrlKey&&!e.metaKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){
      e.preventDefault();e.stopImmediatePropagation();const d=e.shiftKey?10:1;
      sheet.editorTools.move(e.code==='ArrowLeft'?-d:e.code==='ArrowRight'?d:0,e.code==='ArrowUp'?-d:e.code==='ArrowDown'?d:0);
    }
  },true);
})();
