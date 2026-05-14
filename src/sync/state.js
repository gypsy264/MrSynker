const fs = require('fs');
const path = require('path');
const { readSettings } = require('../config');

const STATE_FILENAME = 'synk.data';

function statePath(outputDir) {
  const dir = outputDir || readSettings().outputDir;
  return path.join(dir, STATE_FILENAME);
}

function defaultState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    lastSynced: null,
    playlists: {},
  };
}

function read(outputDir) {
  try {
    const raw = fs.readFileSync(statePath(outputDir), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, playlists: parsed.playlists || {} };
  } catch {
    return defaultState();
  }
}

function write(state, outputDir) {
  const dir = outputDir || readSettings().outputDir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2));
}

function getPlaylist(playlistId, outputDir) {
  const s = read(outputDir);
  return s.playlists[playlistId] || { name: '', lastSynced: null, tracks: {} };
}

function setPlaylist(playlistId, data, outputDir) {
  const s = read(outputDir);
  s.playlists[playlistId] = data;
  write(s, outputDir);
}

function upsertTrack(playlistId, trackId, entry, outputDir) {
  const s = read(outputDir);
  if (!s.playlists[playlistId]) s.playlists[playlistId] = { name: '', lastSynced: null, tracks: {} };
  s.playlists[playlistId].tracks[trackId] = entry;
  write(s, outputDir);
}

function removeTrack(playlistId, trackId, outputDir) {
  const s = read(outputDir);
  if (s.playlists[playlistId]?.tracks?.[trackId]) {
    delete s.playlists[playlistId].tracks[trackId];
    write(s, outputDir);
  }
}

function touch(playlistId, name, outputDir) {
  const s = read(outputDir);
  if (!s.playlists[playlistId]) s.playlists[playlistId] = { name, lastSynced: null, tracks: {} };
  s.playlists[playlistId].name = name;
  s.playlists[playlistId].lastSynced = new Date().toISOString();
  s.lastSynced = s.playlists[playlistId].lastSynced;
  write(s, outputDir);
}

function listTrackedPlaylists(outputDir) {
  const s = read(outputDir);
  return Object.entries(s.playlists).map(([id, p]) => ({
    id,
    name: p.name,
    trackCount: Object.keys(p.tracks || {}).length,
    lastSynced: p.lastSynced,
  }));
}

function removePlaylist(playlistId, outputDir) {
  const s = read(outputDir);
  if (s.playlists[playlistId]) {
    delete s.playlists[playlistId];
    write(s, outputDir);
  }
}

module.exports = {
  read, write, getPlaylist, setPlaylist, upsertTrack, removeTrack,
  touch, listTrackedPlaylists, removePlaylist, statePath,
};
