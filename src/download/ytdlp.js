const { spawn } = require('child_process');
const path = require('path');

const SUPPORTED = new Set(['mp3', 'wav', 'flac']);

function downloadAudio({ url, outputDir, basename, format = 'mp3', onProgress, token }) {
  const fmt = SUPPORTED.has(format) ? format : 'mp3';
  return new Promise((resolve, reject) => {
    const outTemplate = path.join(outputDir, `${basename}.%(ext)s`);
    const args = [
      url,
      '-f', 'bestaudio/best',
      '-x',
      '--audio-format', fmt,
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-o', outTemplate,
    ];
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (token) token.register(proc);
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      const m = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (m && onProgress) onProgress(parseFloat(m[1]));
    });
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => {
      if (token) token.unregister(proc);
      reject(e);
    });
    proc.on('close', (code, signal) => {
      if (token) token.unregister(proc);
      if (token?.cancelled) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}${signal ? ` (${signal})` : ''}: ${stderr}`));
      resolve(path.join(outputDir, `${basename}.${fmt}`));
    });
  });
}

module.exports = { downloadAudio, SUPPORTED };
