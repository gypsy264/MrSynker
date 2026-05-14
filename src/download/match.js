const { spawn } = require('child_process');

function ytdlpJsonSearch(query, limit = 5, token = null) {
  return new Promise((resolve, reject) => {
    const args = [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-warnings',
      '--default-search', 'ytsearch',
      '--no-playlist',
    ];
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (token) token.register(proc);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => { if (token) token.unregister(proc); reject(e); });
    proc.on('close', (code) => {
      if (token) token.unregister(proc);
      if (token?.cancelled) return reject(new Error('cancelled'));
      if (code !== 0 && !out) return reject(new Error(`yt-dlp search failed: ${err}`));
      const lines = out.split('\n').filter(Boolean);
      const items = [];
      for (const line of lines) {
        try { items.push(JSON.parse(line)); } catch {}
      }
      resolve(items);
    });
  });
}

function scoreCandidate(c, track) {
  const title = (c.title || '').toLowerCase();
  const channel = (c.uploader || c.channel || '').toLowerCase();
  const artist = (track.artists?.[0] || '').toLowerCase();
  const trackName = (track.name || '').toLowerCase();
  let score = 0;
  if (artist && title.includes(artist)) score += 3;
  if (artist && channel.includes(artist)) score += 3;
  if (trackName && title.includes(trackName)) score += 4;
  if (channel.includes(' - topic')) score += 5;
  if (/official|audio/.test(title)) score += 1;
  if (/cover|live|remix|karaoke|reaction|sped\s*up/.test(title)) score -= 4;
  if (track.durationMs && c.duration) {
    const diff = Math.abs(c.duration * 1000 - track.durationMs);
    if (diff < 3000) score += 4;
    else if (diff < 8000) score += 2;
    else if (diff > 20000) score -= 3;
  }
  return score;
}

async function findBestMatch(track, token = null) {
  const queries = [];
  if (track.isrc) queries.push(track.isrc);
  const artist = track.artists?.[0] || '';
  queries.push(`${artist} ${track.name} audio`);
  queries.push(`${artist} ${track.name}`);

  for (const q of queries) {
    if (token?.cancelled) throw new Error('cancelled');
    try {
      const results = await ytdlpJsonSearch(q, 5, token);
      if (!results.length) continue;
      const ranked = results
        .map((r) => ({ r, s: scoreCandidate(r, track) }))
        .sort((a, b) => b.s - a.s);
      const best = ranked[0];
      if (best && best.s >= 3) {
        return { url: best.r.webpage_url || best.r.original_url || `https://www.youtube.com/watch?v=${best.r.id}`, title: best.r.title, query: q, score: best.s };
      }
    } catch {
      // try next query
    }
  }
  return null;
}

module.exports = { findBestMatch };
