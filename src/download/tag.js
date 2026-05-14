const NodeID3 = require('node-id3');

async function fetchCover(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return { mime, type: { id: 3, name: 'front cover' }, description: 'cover', imageBuffer: buf };
  } catch {
    return null;
  }
}

async function writeTags(filePath, track) {
  const image = await fetchCover(track.coverUrl);
  const tags = {
    title: track.name,
    artist: (track.artists || []).join(', '),
    album: track.album,
    year: track.year || '',
    ...(image ? { image } : {}),
  };
  const ok = NodeID3.write(tags, filePath);
  if (ok !== true) throw new Error('Failed to write ID3 tags');
}

module.exports = { writeTags };
