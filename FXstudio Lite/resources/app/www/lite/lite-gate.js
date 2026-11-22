/* FXstudio Lite: subscription gates removed.
   Loaded once by index.html after the editor scripts.
   Keep the original UI, project, model, import, and export APIs intact. */
(()=>{
'use strict';
if(typeof BFX==='undefined'||!BFX.FX||!BFX.ui) return;
const UI=BFX.ui, FX=BFX.FX;
const ids=FX.list.map(fx=>fx.id);
const L=BFX.LITE={
  allowed:ids,
  promoted:[],
  locked:[],
  previewDepth:0
};
L.has=()=>true;
L.find=()=>[];
L.notice=()=>{};
L.card=fx=>UI.fxCard(fx);
})();
