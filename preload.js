const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkDeps: () => ipcRenderer.invoke('deps:check'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getEnv: () => ipcRenderer.invoke('settings:getEnv'),
  setEnv: (patch) => ipcRenderer.invoke('settings:setEnv', patch),

  onboardingStatus: () => ipcRenderer.invoke('onboarding:status'),
  completeOnboarding: (payload) => ipcRenderer.invoke('onboarding:complete', payload),

  addLibraryFromPicker: () => ipcRenderer.invoke('library:addFromPicker'),
  setActiveLibrary: (path) => ipcRenderer.invoke('library:setActive', path),
  removeLibrary: (path) => ipcRenderer.invoke('library:remove', path),
  renameLibrary: (path, name) => ipcRenderer.invoke('library:rename', path, name),
  getTrackedPlaylists: () => ipcRenderer.invoke('library:tracked'),
  getTrackedTracks: (playlistId, opts) => ipcRenderer.invoke('library:trackedTracks', playlistId, opts || {}),
  inspectOne: (file) => ipcRenderer.invoke('library:inspectOne', file),
  removeTrackedPlaylist: (playlistId) => ipcRenderer.invoke('library:removeTrackedPlaylist', playlistId),

  spotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  spotifyLogin: () => ipcRenderer.invoke('spotify:login'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  spotifyMe: () => ipcRenderer.invoke('spotify:me'),
  spotifyPlaylists: () => ipcRenderer.invoke('spotify:playlists'),
  spotifyResolvePlaylist: (input) => ipcRenderer.invoke('spotify:resolvePlaylist', input),

  previewSync: (playlistId) => ipcRenderer.invoke('sync:preview', playlistId),
  startSync: (playlistId, opts) => ipcRenderer.invoke('sync:start', playlistId, opts),
  startSyncAll: (opts) => ipcRenderer.invoke('sync:startAll', opts),
  stopSync: () => ipcRenderer.invoke('sync:stop'),

  windowState: () => ipcRenderer.invoke('window:state'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onWindowMaximized: (cb) => {
    const listener = (_e, isMaximized) => cb(isMaximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },

  onSyncEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('sync:event', listener);
    return () => ipcRenderer.removeListener('sync:event', listener);
  },
});
