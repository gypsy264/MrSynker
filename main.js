const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const config = require('./src/config');
const { checkDeps } = require('./src/deps-check');
const spotifyAuth = require('./src/spotify/auth');
const spotifyApi = require('./src/spotify/api');
const runner = require('./src/sync/runner');
const syncState = require('./src/sync/state');

let mainWindow;

const LOGO_PATH = path.join(__dirname, 'logo', 'mainLogo.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    icon: LOGO_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

function emitSync(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:event', payload);
  }
}

function registerIpc() {
  ipcMain.handle('deps:check', () => checkDeps());

  ipcMain.handle('settings:get', () => config.readSettings());
  ipcMain.handle('settings:set', (_e, patch) => config.writeSettings(patch));
  ipcMain.handle('settings:getEnv', () => config.readEnv());
  ipcMain.handle('settings:setEnv', (_e, patch) => config.writeEnv(patch));
  ipcMain.handle('library:addFromPicker', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a library folder',
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return config.addLibrary(res.filePaths[0]);
  });
  ipcMain.handle('library:setActive', (_e, libPath) => config.setActiveLibrary(libPath));
  ipcMain.handle('library:remove', (_e, libPath) => config.removeLibrary(libPath));
  ipcMain.handle('library:rename', (_e, libPath, name) => config.renameLibrary(libPath, name));
  ipcMain.handle('library:tracked', () => syncState.listTrackedPlaylists());
  ipcMain.handle('library:removeTrackedPlaylist', (_e, playlistId) => {
    syncState.removePlaylist(playlistId);
    return syncState.listTrackedPlaylists();
  });

  ipcMain.handle('spotify:status', () => spotifyAuth.status());
  ipcMain.handle('spotify:login', async () => {
    await spotifyAuth.login();
    return spotifyAuth.status();
  });
  ipcMain.handle('spotify:logout', () => { spotifyAuth.clearToken(); return spotifyAuth.status(); });
  ipcMain.handle('spotify:me', () => spotifyApi.getMe());
  ipcMain.handle('spotify:playlists', () => spotifyApi.getUserPlaylists());
  ipcMain.handle('spotify:resolvePlaylist', async (_e, input) => {
    const id = spotifyApi.playlistIdFromUrl(input);
    if (!id) throw new Error('Could not parse a playlist ID from that input');
    return spotifyApi.getPlaylistMeta(id);
  });

  ipcMain.handle('sync:preview', (_e, playlistId) => runner.previewSync(playlistId));
  ipcMain.handle('sync:start', (_e, playlistId, opts) => runner.syncPlaylist(playlistId, opts || {}, emitSync));
  ipcMain.handle('sync:startAll', (_e, opts) => runner.syncAllTracked(opts || {}, emitSync));
  ipcMain.handle('sync:stop', () => runner.stop());
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(LOGO_PATH); } catch {}
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
