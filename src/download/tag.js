const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const NodeID3 = require('node-id3');

async function fetchCoverBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return { buf, mime };
  } catch {
    return null;
  }
}

async function writeMp3Tags(filePath, track) {
  const cover = await fetchCoverBuffer(track.coverUrl);
  const tags = {
    title: track.name,
    artist: (track.artists || []).join(', '),
    album: track.album,
    year: track.year || '',
    ...(cover ? { image: { mime: cover.mime, type: { id: 3, name: 'front cover' }, description: 'cover', imageBuffer: cover.buf } } : {}),
  };
  const ok = NodeID3.write(tags, filePath);
  if (ok !== true) throw new Error('Failed to write ID3 tags');
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.split('\n').slice(-6).join('\n')}`));
    });
  });
}

function atomicReplace(tmp, target) {
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(tmp, target);
    } else {
      throw e;
    }
  }
}

function buildTagArgs({ filePath, coverPath, tmp, track, container }) {
  const args = ['-y', '-i', filePath];

  if (coverPath) {
    args.push(
      '-i', coverPath,
      '-map', '0:a:0',
      '-map', '1:v:0',
      '-c:a', 'copy',
      '-c:v', 'copy',
      '-metadata:s:v:0', 'title=Album cover',
      '-metadata:s:v:0', 'comment=Cover (front)',
      '-disposition:v:0', 'attached_pic',
    );
  } else {
    args.push('-map', '0:a:0', '-c:a', 'copy');
  }

  if (container === 'wav') {
    args.push('-id3v2_version', '3', '-write_id3v2', '1');
  }

  args.push(
    '-metadata', `title=${track.name || ''}`,
    '-metadata', `artist=${(track.artists || []).join(', ')}`,
    '-metadata', `album_artist=${(track.artists || []).join(', ')}`,
    '-metadata', `album=${track.album || ''}`,
    '-metadata', `date=${track.year || ''}`,
    tmp,
  );

  return args;
}

async function writeFfmpegTags(filePath, track, { container }) {
  const cover = await fetchCoverBuffer(track.coverUrl);
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const tmp = path.join(dir, `.mrsynker-tmp-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  let coverPath = null;

  if (cover) {
    const isPng = cover.mime.includes('png');
    coverPath = path.join(dir, `.mrsynker-cover-${crypto.randomBytes(6).toString('hex')}.${isPng ? 'png' : 'jpg'}`);
    fs.writeFileSync(coverPath, cover.buf);
  }

  const runWith = (withCover) => runFfmpeg(buildTagArgs({
    filePath,
    coverPath: withCover ? coverPath : null,
    tmp,
    track,
    container,
  }));

  try {
    try {
      await runWith(!!coverPath);
    } catch (e) {
      // Cover embed failed (common on WAV with old ffmpeg). Retry without it
      // so we at least get text metadata written.
      if (coverPath) {
        if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
        await runWith(false);
      } else {
        throw e;
      }
    }
    atomicReplace(tmp, filePath);
  } finally {
    if (coverPath) { try { fs.unlinkSync(coverPath); } catch {} }
    if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
  }
}

async function writeTags(filePath, track) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext === 'mp3') return writeMp3Tags(filePath, track);
  if (ext === 'flac') return writeFfmpegTags(filePath, track, { container: 'flac' });
  if (ext === 'wav') return writeFfmpegTags(filePath, track, { container: 'wav' });
}

module.exports = { writeTags };
