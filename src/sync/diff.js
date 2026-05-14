const fs = require('fs');
const path = require('path');

function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function filenameFor(track) {
  const artist = sanitize(track.artists?.[0] || 'Unknown Artist');
  const title = sanitize(track.name || 'Unknown Title');
  return `${artist} - ${title}.mp3`;
}

function diff(playlistTracks, stateEntry, outputDir) {
  const known = stateEntry?.tracks || {};
  const playlistIds = new Set(playlistTracks.map((t) => t.id));

  const added = [];
  const existing = [];
  for (const t of playlistTracks) {
    const k = known[t.id];
    const expectedPath = path.join(outputDir, filenameFor(t));
    const fileExists = k?.file && fs.existsSync(path.join(outputDir, k.file));
    if (k && fileExists) {
      existing.push({ track: t, file: k.file });
    } else {
      added.push({ track: t, targetFile: path.basename(expectedPath) });
    }
  }

  const removed = [];
  for (const [id, entry] of Object.entries(known)) {
    if (!playlistIds.has(id)) removed.push({ trackId: id, file: entry.file });
  }

  return { added, existing, removed };
}

module.exports = { diff, filenameFor, sanitize };
