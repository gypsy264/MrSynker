const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const dotenv = require('dotenv');

const USER_DATA = app.getPath('userData');
const APP_PATH = app.getAppPath();

const DEV_ENV_FILE = path.join(APP_PATH, '.env');
const USER_ENV_FILE = path.join(USER_DATA, '.env');

function resolveEnvFile() {
  if (app.isPackaged) return USER_ENV_FILE;
  if (fs.existsSync(DEV_ENV_FILE)) return DEV_ENV_FILE;
  if (fs.existsSync(USER_ENV_FILE)) return USER_ENV_FILE;
  return DEV_ENV_FILE;
}

const ENV_FILE = resolveEnvFile();

function loadEnv() {
  const result = dotenv.config({ path: ENV_FILE, override: true });
  return result.parsed || {};
}

loadEnv();

const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const ONBOARD_FILE = path.join(USER_DATA, 'onboarded.json');

const DEFAULT_LIBRARY_PATH = path.join(app.getPath('music'), 'MrSynker');

const DEFAULTS = {
  outputDir: DEFAULT_LIBRARY_PATH,
  removeOrphans: false,
  concurrency: 4,
  audioFormat: 'mp3',
  libraries: [{ path: DEFAULT_LIBRARY_PATH, name: 'Default', addedAt: new Date().toISOString() }],
  selectedPlaylistIds: [],
};

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    if (!Array.isArray(merged.libraries) || merged.libraries.length === 0) {
      merged.libraries = [{ path: merged.outputDir, name: path.basename(merged.outputDir) || 'Default', addedAt: new Date().toISOString() }];
    }
    if (!merged.libraries.find((l) => l.path === merged.outputDir)) {
      merged.libraries.push({ path: merged.outputDir, name: path.basename(merged.outputDir) || 'Library', addedAt: new Date().toISOString() });
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(patch) {
  const current = readSettings();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

const ENV_KEYS = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'];

function readEnv() {
  const out = {};
  let parsed = {};
  try {
    parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
  } catch {}
  for (const k of ENV_KEYS) out[k] = parsed[k] ?? process.env[k] ?? '';
  if (!out.SPOTIFY_REDIRECT_URI) out.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
  return out;
}

function writeEnv(patch) {
  let existing = {};
  try { existing = dotenv.parse(fs.readFileSync(ENV_FILE)); } catch {}
  const next = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (!ENV_KEYS.includes(k)) continue;
    next[k] = v == null ? '' : String(v);
  }
  const body = ENV_KEYS
    .map((k) => `${k}=${next[k] ?? ''}`)
    .join('\n') + '\n';
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, body);
  for (const k of ENV_KEYS) process.env[k] = next[k] ?? '';
  return readEnv();
}

function readOnboarding() {
  try {
    return JSON.parse(fs.readFileSync(ONBOARD_FILE, 'utf8'));
  } catch {
    return { completed: false, acceptedTerms: false, acceptedAt: null, version: 1 };
  }
}

function writeOnboarding(patch) {
  const current = readOnboarding();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(ONBOARD_FILE), { recursive: true });
  fs.writeFileSync(ONBOARD_FILE, JSON.stringify(next, null, 2));
  return next;
}

function needsOnboarding() {
  const ob = readOnboarding();
  if (!ob.completed || !ob.acceptedTerms) return true;
  const env = readEnv();
  if (!env.SPOTIFY_CLIENT_ID) return true;
  return false;
}

function getSpotifyEnv() {
  return {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback',
  };
}

function addLibrary(libPath, name) {
  if (!libPath) throw new Error('Path required');
  const s = readSettings();
  const exists = s.libraries.find((l) => l.path === libPath);
  if (!exists) {
    s.libraries.push({ path: libPath, name: name || path.basename(libPath) || 'Library', addedAt: new Date().toISOString() });
  } else if (name && exists.name !== name) {
    exists.name = name;
  }
  s.outputDir = libPath;
  return writeSettings({ libraries: s.libraries, outputDir: s.outputDir });
}

function removeLibrary(libPath) {
  const s = readSettings();
  const filtered = s.libraries.filter((l) => l.path !== libPath);
  let outputDir = s.outputDir;
  if (outputDir === libPath) {
    outputDir = filtered[0]?.path || DEFAULT_LIBRARY_PATH;
  }
  if (filtered.length === 0) {
    filtered.push({ path: DEFAULT_LIBRARY_PATH, name: 'Default', addedAt: new Date().toISOString() });
    outputDir = DEFAULT_LIBRARY_PATH;
  }
  return writeSettings({ libraries: filtered, outputDir });
}

function setActiveLibrary(libPath) {
  const s = readSettings();
  if (!s.libraries.find((l) => l.path === libPath)) throw new Error('Library not found');
  return writeSettings({ outputDir: libPath });
}

function renameLibrary(libPath, name) {
  const s = readSettings();
  const lib = s.libraries.find((l) => l.path === libPath);
  if (!lib) throw new Error('Library not found');
  lib.name = name;
  return writeSettings({ libraries: s.libraries });
}

module.exports = {
  readSettings, writeSettings, getSpotifyEnv, readEnv, writeEnv,
  addLibrary, removeLibrary, setActiveLibrary, renameLibrary,
  readOnboarding, writeOnboarding, needsOnboarding,
  SETTINGS_FILE, ENV_FILE, ONBOARD_FILE,
};
