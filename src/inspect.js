const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const NodeID3 = require('node-id3');

function ffprobe(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe ${code}: ${err}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

function coverFromId3(filePath) {
  try {
    const tags = NodeID3.read(filePath);
    if (tags?.image?.imageBuffer) {
      const mime = tags.image.mime || 'image/jpeg';
      return `data:${mime};base64,${tags.image.imageBuffer.toString('base64')}`;
    }
  } catch {}
  return null;
}

function coverViaFfmpeg(filePath) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `mrsynker-extract-${crypto.randomBytes(6).toString('hex')}.jpg`);
    const proc = spawn('ffmpeg', [
      '-y',
      '-v', 'error',
      '-i', filePath,
      '-an',
      '-vcodec', 'copy',
      '-frames:v', '1',
      tmp,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(tmp); } catch {}
        return resolve(null);
      }
      try {
        const buf = fs.readFileSync(tmp);
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
        const mime = isPng ? 'image/png' : 'image/jpeg';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      } catch {
        resolve(null);
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
    });
  });
}

async function inspectFile(filePath) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat) return { exists: false, file: path.basename(filePath) };
  const ext = path.extname(filePath).toLowerCase().slice(1);
  let sampleRate = null;
  let bitrate = null;
  let channels = null;
  let codec = null;
  try {
    const probe = await ffprobe(filePath);
    const audio = (probe.streams || []).find((s) => s.codec_type === 'audio');
    if (audio) {
      sampleRate = audio.sample_rate ? parseInt(audio.sample_rate, 10) : null;
      channels = audio.channels || null;
      codec = audio.codec_name || null;
    }
    if (probe.format?.bit_rate) bitrate = parseInt(probe.format.bit_rate, 10);
  } catch {}
  let cover = null;
  if (ext === 'mp3') {
    cover = coverFromId3(filePath);
  } else if (ext === 'flac' || ext === 'wav') {
    cover = await coverViaFfmpeg(filePath);
  }

  return {
    exists: true,
    file: path.basename(filePath),
    fullPath: filePath,
    ext,
    sizeBytes: stat.size,
    sampleRate,
    bitrate,
    channels,
    codec,
    cover,
  };
}

module.exports = { inspectFile };
