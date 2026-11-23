'use strict';

const {
  app, BrowserWindow, protocol, net, session, shell, Menu, ipcMain, dialog,
  powerSaveBlocker, screen
} = require('electron');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const { RecoveryStore } = require('./recovery-store.cjs');
const { AudioExporter } = require('./audio-export.cjs');
const { UpdateService } = require('./update-service.cjs');

app.setName('VoxelMotion');
// Keep the existing profile across the rename; respect explicit QA/portable profiles.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'FXstudio Lite'));
}
app.setAppUserModelId('app.blockfx.lite.desktop');
protocol.registerSchemesAsPrivileged([{
  scheme: 'fxstudio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const appUrl = 'fxstudio://studio/';
const root = path.join(__dirname, 'www');
const pendingDownloads = new Set();
let win;
let prefs = {};
let prefsPath;
let blocker;
let recovery;
let audioExporter;
let updates;

function notify(channel,value) {
  if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,value);
}

function configureUpdates() {
  const installed=app.isPackaged&&!process.env.PORTABLE_EXECUTABLE_FILE&&
    fs.existsSync(path.join(path.dirname(app.getPath('exe')),'Uninstall VoxelMotion.exe'));
  const updater=installed?new (require('electron-updater').NsisUpdater)({provider:'github',owner:'skzysz',repo:'VoxelMotion'}):null;
  updates=new UpdateService({version:app.getVersion(),mode:installed?'installed':app.isPackaged?'portable':'development',updater,
    enabled:()=>prefs.autoUpdates!==false,onState:state=>notify('desktop:update-state',state),
    fetchRelease:async()=>{
      const response=await net.fetch('https://api.github.com/repos/skzysz/VoxelMotion/releases/latest',{
        headers:{'User-Agent':'VoxelMotion/'+app.getVersion(),'Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(response.status===403?'GitHub временно ограничил запросы. Повторите позже.':'GitHub: '+response.status);
      return response.json();
    }});
  handle('desktop:update-state',()=>updates.state);
  handle('desktop:update-check',()=>updates.check());
  handle('desktop:update-download',()=>updates.download());
  handle('desktop:update-auto',enabled=>{
    if(typeof enabled!=='boolean')throw Error('Неверная настройка');
    const previous=prefs.autoUpdates;prefs.autoUpdates=enabled;
    try{savePrefs();}catch(error){prefs.autoUpdates=previous;throw error;}
    return updates.set({});
  });
  handle('desktop:update-release',()=>shell.openExternal(updates.state.releaseUrl));
  handle('desktop:update-install',()=>{
    if(blocker!==undefined||audioExporter.busy)throw Error('Сначала дождитесь завершения экспорта.');
    updates.install();
  });
  const initial=setTimeout(()=>{if(prefs.autoUpdates!==false)updates.check();},10000);initial.unref();
  const periodic=setInterval(()=>{if(prefs.autoUpdates!==false)updates.check();},6*60*60*1000);periodic.unref();
}

function trustedSender(event) {
  return win && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame && isAppUrl(event.senderFrame?.url);
}

function isAppUrl(url) {
  return typeof url === 'string' && url.startsWith(appUrl);
}

function allowedRemote(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (
      ['raw.githubusercontent.com', 'minotar.net', 'mc-heads.net'].includes(url.hostname) ||
      /(^|\.)(mojang\.com|minecraft\.net)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function directoryExists(folder) {
  try {
    return typeof folder === 'string' && path.isAbsolute(folder) && fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function exportFolder() {
  return directoryExists(prefs.exportFolder) ? prefs.exportFolder : app.getPath('downloads');
}

function savePrefs() {
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  const temporary = prefsPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(prefs, null, 2));
  fs.renameSync(temporary, prefsPath);
}

function keepAwake(enabled) {
  if (enabled && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!enabled && blocker !== undefined) {
    powerSaveBlocker.stop(blocker);
    blocker = undefined;
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) {
      throw new Error('Недоступная команда');
    }
    return handler(...args);
  });
}

function configureDesktopCommands() {
  const binary=app.isPackaged?path.join(process.resourcesPath,'ffmpeg','ffmpeg.exe'):require('ffmpeg-static');
  audioExporter=new AudioExporter({binary,folder:path.join(app.getPath('userData'),'temp','effect-audio'),onProgress:progress=>notify('desktop:audio-progress',progress)});
  handle('desktop:audio-mix',job=>audioExporter.mix(job));
  handle('desktop:audio-cancel',id=>typeof id==='string'&&audioExporter.cancel(id));
  recovery = new RecoveryStore(path.join(app.getPath('userData'), 'recovery'));
  handle('desktop:recovery-load', () => recovery.load());
  handle('desktop:recovery-save', record => recovery.save(record));
  handle('desktop:recovery-clear', () => recovery.clear());
  // beforeunload cannot await invoke(). Keep a bounded, local final write available.
  ipcMain.on('desktop:recovery-save-sync', (event, record) => {
    try {
      if (!trustedSender(event)) throw new Error('Недоступная команда');
      event.returnValue = { ok: true, draft: recovery.save(record) };
    } catch (error) { event.returnValue = { ok: false, error: error.message }; }
  });
  handle('desktop:preferences', () => ({ exportFolder: exportFolder() }));
  handle('desktop:choose-export-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Папка для экспорта VoxelMotion', defaultPath: exportFolder(), properties: ['openDirectory']
    });
    const folder = result.filePaths[0];
    if (result.canceled || !directoryExists(folder)) return null;
    const previous = prefs.exportFolder;
    prefs.exportFolder = folder;
    try { savePrefs(); } catch (error) { prefs.exportFolder = previous; throw error; }
    return { exportFolder: folder };
  });
  handle('desktop:open-export-folder', async () => {
    const folder = exportFolder();
    fs.mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  handle('desktop:export-active', enabled => keepAwake(enabled === true));
}

function configureDownloads() {
  session.defaultSession.on('will-download', (_event, item, contents) => {
    const notify = data => {
      if (contents && !contents.isDestroyed() && isAppUrl(contents.getURL())) contents.send('desktop:download', data);
    };
    const folder = exportFolder();
    const name = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'VoxelMotion';
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let target = path.join(folder, name);
    let suffix = 1;
    try {
      fs.mkdirSync(folder, { recursive: true });
      while (fs.existsSync(target) || pendingDownloads.has(target)) target = path.join(folder, `${base} (${suffix++})${ext}`);
      item.setSavePath(target);
      pendingDownloads.add(target);
      item.once('done', (_doneEvent, state) => {
        pendingDownloads.delete(target);
        notify({ state, name: path.basename(target) });
      });
    } catch {
      item.cancel();
      notify({ state: 'interrupted', name });
    }
  });
}

async function start() {
  prefsPath = path.join(app.getPath('userData'), 'desktop-preferences.json');
  try {
    const saved = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) prefs = saved;
  } catch { prefs = {}; }
  Menu.setApplicationMenu(null);
  protocol.handle('fxstudio', request => {
    let url;
    let relative;
    try {
      url = new URL(request.url);
      relative = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.hostname !== 'studio') return new Response('Not found', { status: 404 });
    if (relative === '/' || !relative) relative = '/index.html';
    const target = path.resolve(root, '.' + relative);
    if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!allowedRemote(details.url)) return callback({});
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'access-control-allow-origin') delete headers[key];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range'];
    callback({ responseHeaders: headers });
  });
  configureDesktopCommands();
  configureUpdates();
  configureDownloads();
  const area = screen.getPrimaryDisplay().workAreaSize;
  const size = prefs.window || {};
  const width = Math.min(area.width, Math.max(960, Number(size.width) || 1440));
  const height = Math.min(area.height, Math.max(620, Number(size.height) || 900));
  win = new BrowserWindow({
    title: 'VoxelMotion', width, height, minWidth: Math.min(960, area.width), minHeight: Math.min(620, area.height),
    backgroundColor: '#0c0e12', icon: path.join(__dirname, 'voxelmotion-icon.png'), show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false, preload: path.join(__dirname, 'preload.js')
    }
  });
  win.once('ready-to-show', () => {
    if (size.maximized) win.maximize();
    win.show();
  });
  win.on('close', () => {
    const bounds = win.getNormalBounds();
    prefs.window = { width: bounds.width, height: bounds.height, maximized: win.isMaximized() };
    try { savePrefs(); } catch (error) { console.error('Window preferences', error.message); }
    keepAwake(false);
  });
  win.on('closed', () => { win = undefined; });
  win.webContents.on('render-process-gone', () => {keepAwake(false);audioExporter.cancelAll();});
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  await win.loadURL(appUrl);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('VoxelMotion', 'Не удалось запустить приложение.\n' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit',()=>audioExporter?.cancelAll());
}
