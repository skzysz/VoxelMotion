'use strict';
const REPOSITORY='https://github.com/skzysz/VoxelMotion';
function newer(version,current){
  const parse=value=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value||'')?.slice(1).map(Number);
  const a=parse(version),b=parse(current);if(!a||!b)return false;
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
function releaseInfo(release,current){
  if(!release||release.draft||release.prerelease||!newer(release.tag_name,current))return null;
  const version=release.tag_name.replace(/^v/,'');
  const asset=release.assets?.find(a=>a.name===`VoxelMotion-${version}-Setup.exe`);
  if(!asset||release.html_url!==`${REPOSITORY}/releases/tag/${release.tag_name}`)throw Error('В релизе нет установщика VoxelMotion.');
  if(asset.browser_download_url!==`${REPOSITORY}/releases/download/${release.tag_name}/${asset.name}`)throw Error('Неверный адрес обновления.');
  return {version,url:release.html_url};
}
class UpdateService{
  constructor({version,mode,updater,fetchRelease,enabled,onState=()=>{}}){
    this.version=version;this.updater=updater;this.fetchRelease=fetchRelease;this.enabled=enabled;this.onState=onState;this.inflight=null;
    this.state={status:'idle',version,currentVersion:version,mode,auto:enabled(),releaseUrl:REPOSITORY+'/releases/latest'};
    if(updater){
      updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;
      updater.on('download-progress',p=>this.set({status:'downloading',percent:Math.round(p.percent)}));
      updater.on('update-downloaded',()=>this.set({status:'downloaded',percent:100}));
      updater.on('error',error=>this.set({status:'error',message:error.message||'Не удалось обновить программу.'}));
    }
  }
  set(next){this.state={...this.state,...next,auto:this.enabled()};this.onState(this.state);return this.state;}
  check(){
    if(this.inflight)return this.inflight;
    if(['downloading','downloaded'].includes(this.state.status))return Promise.resolve(this.state);
    this.set({status:'checking',message:''});
    this.inflight=(async()=>{
      try{
        const info=releaseInfo(await this.fetchRelease(),this.version);
        if(!info)return this.set({status:'current',version:this.version});
        this.set({status:'available',version:info.version,releaseUrl:info.url});
        if(this.updater){await this.updater.checkForUpdates();if(this.enabled())await this.download();}
        return this.state;
      }catch(error){return this.set({status:'error',message:'Проверка обновлений не удалась. '+error.message});}
    })().finally(()=>{this.inflight=null;});
    return this.inflight;
  }
  async download(){
    if(!this.updater)throw Error('Для этой версии скачайте обновление со страницы релиза.');
    if(this.state.status!=='available')return this.state;
    this.set({status:'downloading',percent:0});
    try{await this.updater.downloadUpdate();}catch(error){this.set({status:'error',message:'Не удалось скачать обновление. '+error.message});}
    return this.state;
  }
  install(){
    if(!this.updater||this.state.status!=='downloaded')throw Error('Сначала скачайте обновление.');
    this.updater.quitAndInstall(true,true);
  }
}
module.exports={UpdateService,newer,releaseInfo,REPOSITORY};
