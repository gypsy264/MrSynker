const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkDeps: () => ipcRenderer.invoke('deps:check'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseOutputDir: () => ipcRenderer.invoke('settings:chooseOutputDir'),
  getEnv: () => ipcRenderer.invoke('settings:getEnv'),
  setEnv: (patch) => ipcRenderer.invoke('settings:setEnv', patch),

  spotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  spotifyLogin: () => ipcRenderer.invoke('spotify:login'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  spotifyMe: () => ipcRenderer.invoke('spotify:me'),
  spotifyPlaylists: () => ipcRenderer.invoke('spotify:playlists'),
  spotifyResolvePlaylist: (input) => ipcRenderer.invoke('spotify:resolvePlaylist', input),

  previewSync: (playlistId) => ipcRenderer.invoke('sync:preview', playlistId),
  startSync: (playlistId, opts) => ipcRenderer.invoke('sync:start', playlistId, opts),

  onSyncEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('sync:event', listener);
    return () => ipcRenderer.removeListener('sync:event', listener);
  },
});
