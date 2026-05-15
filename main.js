const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol } = require('electron');

protocol.registerSchemesAsPrivileged([{
  scheme: 'mrsynker',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
}]);

const IS_MAC = process.platform === 'darwin';

app.setName('MrSynker');

const config = require('./src/config');
const { checkDeps } = require('./src/deps-check');
const spotifyAuth = require('./src/spotify/auth');
const spotifyApi = require('./src/spotify/api');
const runner = require('./src/sync/runner');
const syncState = require('./src/sync/state');
const { inspectFile } = require('./src/inspect');

let mainWindow;

const LOGO_PATH = path.join(__dirname, 'logo', 'mainLogo.png');
const DOCK_ICON_PATH = path.join(__dirname, 'logo', 'mainLogo-padded.png');

function createWindow() {
  const winOpts = {
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: 'MrSynker',
    icon: DOCK_ICON_PATH,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (IS_MAC) {
    winOpts.titleBarStyle = 'hidden';
    winOpts.trafficLightPosition = { x: 14, y: 14 };
  } else {
    winOpts.frame = false;
  }
  mainWindow = new BrowserWindow(winOpts);
  mainWindow.loadFile('index.html');

  const sendMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);
}

function buildMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS forces an app menu — keep it minimal (just the app menu with Quit/About/Hide).
  const template = [{
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }, {
    label: 'Edit',
    submenu: [
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function emitSync(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:event', payload);
  }
}

const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return AUDIO_MIME[ext] || 'application/octet-stream';
}

function registerMediaProtocol() {
  protocol.handle('mrsynker', async (req) => {
    try {
      const url = new URL(req.url);
      const { outputDir } = config.readSettings();
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
      const filePath = path.resolve(outputDir, rel);
      const safeRoot = path.resolve(outputDir);
      if (!filePath.startsWith(safeRoot + path.sep) && filePath !== safeRoot) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });

      const stat = fs.statSync(filePath);
      const total = stat.size;
      const range = req.headers.get('range');
      const type = mimeFor(filePath);

      if (range) {
        const m = range.match(/bytes=(\d+)-(\d+)?/);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          const chunk = end - start + 1;
          const nodeStream = fs.createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(nodeStream), {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunk),
              'Content-Type': type,
            },
          });
        }
      }

      const nodeStream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(nodeStream), {
        headers: {
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Content-Type': type,
        },
      });
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('deps:check', () => checkDeps());

  ipcMain.handle('settings:get', () => config.readSettings());
  ipcMain.handle('settings:set', (_e, patch) => config.writeSettings(patch));
  ipcMain.handle('settings:getEnv', () => config.readEnv());
  ipcMain.handle('settings:setEnv', (_e, patch) => config.writeEnv(patch));

  ipcMain.handle('onboarding:status', () => ({
    needsOnboarding: config.needsOnboarding(),
    state: config.readOnboarding(),
  }));
  ipcMain.handle('onboarding:complete', (_e, payload) => {
    return config.writeOnboarding({
      completed: true,
      acceptedTerms: !!payload?.acceptedTerms,
      acceptedAt: new Date().toISOString(),
    });
  });
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
  ipcMain.handle('library:allTracks', () => {
    const { outputDir } = config.readSettings();
    const s = syncState.read(outputDir);
    const out = [];
    for (const [playlistId, entry] of Object.entries(s.playlists || {})) {
      for (const [trackId, t] of Object.entries(entry.tracks || {})) {
        out.push({
          trackId,
          playlistId,
          playlistName: entry.name || playlistId,
          file: t.file,
          ext: t.ext || (t.file?.split('.').pop() || '').toLowerCase(),
        });
      }
    }
    // de-dupe by file path (same track in multiple playlists)
    const seen = new Set();
    return out.filter((t) => (seen.has(t.file) ? false : (seen.add(t.file), true)));
  });

  ipcMain.handle('library:inspectOne', async (_e, fileRelOrAbs) => {
    const { outputDir } = config.readSettings();
    const full = path.isAbsolute(fileRelOrAbs) ? fileRelOrAbs : path.join(outputDir, fileRelOrAbs);
    return inspectFile(full);
  });
  ipcMain.handle('library:trackedTracks', async (_e, playlistId, { inspect = false } = {}) => {
    const { outputDir } = config.readSettings();
    const s = syncState.read(outputDir);
    const entry = s.playlists[playlistId];
    if (!entry) return { playlist: null, tracks: [] };
    const tracks = Object.entries(entry.tracks || {}).map(([id, t]) => ({
      id,
      file: t.file,
      fullPath: path.join(outputDir, t.file),
      ext: t.ext || (t.file?.split('.').pop() || '').toLowerCase(),
      isrc: t.isrc || null,
    }));
    if (!inspect) return { playlist: { id: playlistId, name: entry.name, lastSynced: entry.lastSynced }, tracks };
    const enriched = await Promise.all(tracks.map(async (t) => ({ ...t, info: await inspectFile(t.fullPath) })));
    return { playlist: { id: playlistId, name: entry.name, lastSynced: entry.lastSynced }, tracks: enriched };
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

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:state', () => ({
    isMac: IS_MAC,
    isMaximized: !!mainWindow?.isMaximized(),
  }));
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'MrSynker',
    applicationVersion: app.getVersion(),
    iconPath: DOCK_ICON_PATH,
  });
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(DOCK_ICON_PATH); } catch {}
  }
  registerMediaProtocol();
  buildMenu();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
