const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const config = require('./src/config');
const { checkDeps } = require('./src/deps-check');
const spotifyAuth = require('./src/spotify/auth');
const spotifyApi = require('./src/spotify/api');
const runner = require('./src/sync/runner');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
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
  ipcMain.handle('settings:chooseOutputDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose output folder',
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return config.writeSettings({ outputDir: res.filePaths[0] });
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
  ipcMain.handle('sync:stop', () => runner.stop());
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
