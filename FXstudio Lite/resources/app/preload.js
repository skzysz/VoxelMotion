// Preload script for secure IPC communication between renderer and main process
const { contextBridge, ipcRenderer } = require('electron');

// Names consumed by the desktop workspace in index.html.
contextBridge.exposeInMainWorld('FXDesktopAPI', {
  recoveryLoad: () => ipcRenderer.invoke('desktop:recovery-load'),
  recoverySave: record => ipcRenderer.invoke('desktop:recovery-save', record),
  recoveryClear: () => ipcRenderer.invoke('desktop:recovery-clear'),
  recoverySaveSync: record => ipcRenderer.sendSync('desktop:recovery-save-sync', record),
  preferences: () => ipcRenderer.invoke('desktop:preferences'),
  chooseExportFolder: () => ipcRenderer.invoke('desktop:choose-export-folder'),
  openExportFolder: () => ipcRenderer.invoke('desktop:open-export-folder'),
  exportActive: enabled => ipcRenderer.invoke('desktop:export-active', enabled),
  onDownload: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('desktop:download', listener);
    return () => ipcRenderer.removeListener('desktop:download', listener);
  }
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('fxstudio', {
  // Desktop commands
  getPreferences: () => ipcRenderer.invoke('desktop:preferences'),
  chooseExportFolder: () => ipcRenderer.invoke('desktop:choose-export-folder'),
  openExportFolder: () => ipcRenderer.invoke('desktop:open-export-folder'),
  
  // Download notifications
  onDownload: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('desktop:download', subscription);
    return () => {
      ipcRenderer.removeListener('desktop:download', subscription);
    };
  },

  // Power save control
  keepAwake: (enabled) => ipcRenderer.invoke('desktop:export-active', enabled),
  
  // App info
  getAppName: () => 'VoxelMotion'
});

// Prevent the window from being closed by clicking outside of content
contextBridge.exposeInMainWorld('fxstudioSafe', {
  preventClose: true
});
