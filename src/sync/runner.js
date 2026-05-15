const fs = require('fs');
const path = require('path');
const { getPlaylistMeta, getPlaylistTracks } = require('../spotify/api');
const { diff, filenameFor } = require('./diff');
const state = require('./state');
const { findBestMatch } = require('../download/match');
const { downloadAudio } = require('../download/ytdlp');
const { writeTags } = require('../download/tag');
const { readSettings } = require('../config');

function makeToken() {
  const children = new Set();
  return {
    cancelled: false,
    register(proc) { children.add(proc); },
    unregister(proc) { children.delete(proc); },
    cancel() {
      this.cancelled = true;
      for (const p of children) {
        try { p.kill('SIGTERM'); } catch {}
      }
    },
  };
}

let current = null;

function stop() {
  if (current) {
    current.cancel();
    return true;
  }
  return false;
}

async function previewSync(playlistId) {
  const { outputDir } = readSettings();
  fs.mkdirSync(outputDir, { recursive: true });
  const meta = await getPlaylistMeta(playlistId);
  const tracks = await getPlaylistTracks(playlistId);
  const stateEntry = state.getPlaylist(playlistId, outputDir);
  const d = diff(tracks, stateEntry, outputDir);
  return { meta, tracks, diff: d, outputDir };
}

async function processTrack(playlistId, t, outputDir, format, token, emit) {
  const targetName = filenameFor(t, format);
  const basename = targetName.replace(new RegExp(`\\.${format}$`, 'i'), '');
  emit({ kind: 'track:start', playlistId, trackId: t.id, name: t.name, artist: t.artists?.[0] || '' });
  try {
    if (token.cancelled) throw new Error('cancelled');
    const match = await findBestMatch(t, token);
    if (!match) throw new Error('No suitable YouTube match found');
    emit({ kind: 'track:match', playlistId, trackId: t.id, title: match.title });
    const filePath = await downloadAudio({
      url: match.url,
      outputDir,
      basename,
      format,
      onProgress: (pct) => emit({ kind: 'track:progress', playlistId, trackId: t.id, pct }),
      token,
    });
    if (token.cancelled) throw new Error('cancelled');
    await writeTags(filePath, t);
    state.upsertTrack(playlistId, t.id, { file: path.basename(filePath), ext: format, isrc: t.isrc || null }, outputDir);
    emit({ kind: 'track:done', playlistId, trackId: t.id, file: path.basename(filePath) });
    return { ok: true };
  } catch (e) {
    const cancelled = token.cancelled || e.message === 'cancelled';
    emit({
      kind: cancelled ? 'track:cancelled' : 'track:error',
      playlistId,
      trackId: t.id,
      error: cancelled ? null : e.message,
    });
    return { ok: false, cancelled };
  }
}

async function runPool(items, concurrency, worker) {
  let i = 0;
  let downloaded = 0;
  let failed = 0;
  let cancelled = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      const res = await worker(items[idx]);
      if (res.cancelled) cancelled++;
      else if (res.ok) downloaded++;
      else failed++;
    }
  });
  await Promise.all(runners);
  return { downloaded, failed, cancelled };
}

async function syncPlaylist(playlistId, opts = {}, emit = () => {}) {
  if (current) throw new Error('A sync is already running');
  const settings = readSettings();
  const removeOrphans = opts.removeOrphans ?? !!settings.removeOrphans;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? settings.concurrency ?? 4));
  const format = ['mp3', 'wav', 'flac'].includes(opts.format) ? opts.format : (settings.audioFormat || 'mp3');
  const { outputDir } = settings;
  fs.mkdirSync(outputDir, { recursive: true });

  const token = makeToken();
  current = token;
  try {
    const meta = await getPlaylistMeta(playlistId);
    emit({ kind: 'playlist:start', playlistId, name: meta.name, concurrency });

    const tracks = await getPlaylistTracks(playlistId);
    const stateEntry = state.getPlaylist(playlistId, outputDir);
    const d = diff(tracks, stateEntry, outputDir);
    emit({ kind: 'diff', playlistId, added: d.added.length, removed: d.removed.length, existing: d.existing.length });

    const queue = d.added.map((a) => a.track);
    const result = await runPool(queue, concurrency, (t) => processTrack(playlistId, t, outputDir, format, token, emit));

    if (removeOrphans && !token.cancelled) {
      for (const r of d.removed) {
        const full = path.join(outputDir, r.file);
        try { fs.unlinkSync(full); } catch {}
        state.removeTrack(playlistId, r.trackId, outputDir);
        emit({ kind: 'track:removed', playlistId, trackId: r.trackId, file: r.file });
      }
    }

    state.touch(playlistId, meta.name, outputDir);
    emit({
      kind: 'playlist:done',
      playlistId,
      downloaded: result.downloaded,
      failed: result.failed,
      cancelled: result.cancelled,
      skipped: d.existing.length,
      stopped: token.cancelled,
    });
    return { ...result, skipped: d.existing.length, stopped: token.cancelled };
  } finally {
    current = null;
  }
}

async function syncAllTracked(opts = {}, emit = () => {}) {
  const { outputDir } = readSettings();
  const tracked = state.listTrackedPlaylists(outputDir);
  if (!tracked.length) {
    emit({ kind: 'library:empty' });
    return { playlists: 0, downloaded: 0, failed: 0 };
  }
  emit({ kind: 'library:start', total: tracked.length });
  let totalDownloaded = 0;
  let totalFailed = 0;
  let stopped = false;
  for (const p of tracked) {
    if (stopped) break;
    try {
      const res = await syncPlaylist(p.id, opts, emit);
      totalDownloaded += res.downloaded;
      totalFailed += res.failed;
      if (res.stopped) { stopped = true; break; }
    } catch (e) {
      emit({ kind: 'library:playlist-error', playlistId: p.id, error: e.message });
    }
  }
  emit({ kind: 'library:done', playlists: tracked.length, downloaded: totalDownloaded, failed: totalFailed, stopped });
  return { playlists: tracked.length, downloaded: totalDownloaded, failed: totalFailed, stopped };
}

module.exports = { previewSync, syncPlaylist, syncAllTracked, stop };
