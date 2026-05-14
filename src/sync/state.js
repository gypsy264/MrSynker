const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STATE_FILE = path.join(app.getPath('userData'), 'sync-state.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { playlists: {} };
  }
}

function write(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getPlaylist(playlistId) {
  const s = read();
  return s.playlists[playlistId] || { name: '', lastSynced: null, tracks: {} };
}

function setPlaylist(playlistId, data) {
  const s = read();
  s.playlists[playlistId] = data;
  write(s);
}

function upsertTrack(playlistId, trackId, entry) {
  const s = read();
  if (!s.playlists[playlistId]) s.playlists[playlistId] = { name: '', lastSynced: null, tracks: {} };
  s.playlists[playlistId].tracks[trackId] = entry;
  write(s);
}

function removeTrack(playlistId, trackId) {
  const s = read();
  if (s.playlists[playlistId]?.tracks?.[trackId]) {
    delete s.playlists[playlistId].tracks[trackId];
    write(s);
  }
}

function touch(playlistId, name) {
  const s = read();
  if (!s.playlists[playlistId]) s.playlists[playlistId] = { name, lastSynced: null, tracks: {} };
  s.playlists[playlistId].name = name;
  s.playlists[playlistId].lastSynced = new Date().toISOString();
  write(s);
}

module.exports = { read, write, getPlaylist, setPlaylist, upsertTrack, removeTrack, touch };
