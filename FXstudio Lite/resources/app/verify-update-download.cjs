'use strict';
// Runs under Electron. Serves only a local test installer and never installs it.
const {app}=require('electron');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NsisUpdater}=require('electron-updater');const {ElectronHttpExecutor}=require('electron-updater/out/electronHttpExecutor');
const {UpdateService,REPOSITORY}=require('./update-service.cjs');
const version=require('./package.json').version,base=path.resolve(__dirname,'../../../tmp/updater-verification'),output=path.resolve(__dirname,'../../docs/ru/screenshots/sound-updates');
fs.mkdirSync(base,{recursive:true});fs.mkdirSync(output,{recursive:true});
app.setName('VoxelMotion Update QA');app.setPath('userData',path.join(base,'electron-profile'));
app.whenReady().then(async()=>{
  const name=`VoxelMotion-${version}-Setup.exe`,file=path.join(__dirname,'dist',name),bytes=fs.readFileSync(file),sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  const manifest=JSON.stringify({version,files:[{url:name,sha512,size:bytes.length}],path:name,sha512,releaseDate:new Date().toISOString()});
  let corrupt=false;const server=http.createServer((req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;
    if(route==='/latest.yml'){res.writeHead(200,{'Content-Type':'application/yaml'});res.end(manifest);}
    else if(route==='/'+name){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length});if(corrupt){res.write(Buffer.from([bytes[0]^255]));fs.createReadStream(file,{start:1}).pipe(res);}else fs.createReadStream(file).pipe(res);}
    else{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  async function scenario(tamper){
    corrupt=tamper;const directory=fs.mkdtempSync(path.join(base,tamper?'corrupt-':'valid-'));
    const config=path.join(directory,'app-update.yml');fs.writeFileSync(config,JSON.stringify({provider:'generic',url,updaterCacheDirName:'test-cache'}));
    const adapter={version:'2.12.1',name:'VoxelMotion-Test',isPackaged:true,appUpdateConfigPath:config,userDataPath:directory,baseCachePath:directory,
      whenReady:()=>Promise.resolve(),quit:()=>{throw Error('Test must never quit for installation');},relaunch:()=>{},onQuit:()=>{}};
    const updater=new NsisUpdater(undefined,adapter);updater.httpExecutor=new ElectronHttpExecutor();updater.setFeedURL({provider:'generic',url});updater.disableDifferentialDownload=true;
    updater.logger={info:()=>{},warn:()=>{},error:()=>{},debug:()=>{}};
    const service=new UpdateService({version:'2.12.1',mode:'installed',updater,enabled:()=>true,
      fetchRelease:async()=>({tag_name:'v'+version,html_url:REPOSITORY+'/releases/tag/v'+version,assets:[{name,browser_download_url:REPOSITORY+'/releases/download/v'+version+'/'+name}]})});
    await service.check();
    if(tamper){assert.equal(service.state.status,'error');assert(/checksum|sha512|digest/i.test(service.state.message),service.state.message);}
    else{assert.equal(service.state.status,'downloaded',service.state.message);const result=updater.downloadedUpdateHelper.file;assert.equal(crypto.createHash('sha512').update(fs.readFileSync(result)).digest('base64'),sha512);}
    assert.equal(updater.autoInstallOnAppQuit,false);assert(!updater.quitAndInstallCalled);
    return {tampered:tamper,status:service.state.status,automaticInstall:false,message:tamper?service.state.message:undefined};
  }
  try{const result={version,bytes:bytes.length,checks:[await scenario(false),await scenario(true)]};fs.writeFileSync(path.join(output,'update-download-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
  finally{server.closeAllConnections();server.close();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
