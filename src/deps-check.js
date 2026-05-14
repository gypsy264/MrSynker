const { spawn } = require('child_process');

function checkBinary(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('error', () => resolve({ found: false, version: null }));
    proc.on('close', (code) => {
      if (code === 0) resolve({ found: true, version: out.trim().split('\n')[0] });
      else resolve({ found: false, version: null });
    });
  });
}

async function checkDeps() {
  const [ytdlp, ffmpeg] = await Promise.all([
    checkBinary('yt-dlp'),
    checkBinary('ffmpeg', ['-version']),
  ]);
  return {
    ytdlp,
    ffmpeg,
    ok: ytdlp.found && ffmpeg.found,
  };
}

module.exports = { checkDeps };
