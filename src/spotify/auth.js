const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { BrowserWindow, app, shell } = require('electron');
const { getSpotifyEnv } = require('../config');

const TOKEN_FILE = path.join(app.getPath('userData'), 'spotify-token.json');
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function genPkce() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeToken(tok) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  const enriched = { ...tok, obtainedAt: Date.now() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(enriched, null, 2));
  return enriched;
}

function clearToken() {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
}

function isExpired(tok) {
  if (!tok || !tok.obtainedAt || !tok.expires_in) return true;
  return Date.now() > tok.obtainedAt + (tok.expires_in - 60) * 1000;
}

async function exchangeCode({ code, verifier, clientId, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.refresh_token) json.refresh_token = refreshToken;
  return json;
}

function login() {
  const { clientId, redirectUri } = getSpotifyEnv();
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID is missing in .env');

  const { verifier, challenge } = genPkce();
  const state = base64url(crypto.randomBytes(16));
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES);

  const redirectParsed = new URL(redirectUri);
  const port = Number(redirectParsed.port) || 8888;

  return new Promise((resolve, reject) => {
    let win;
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, redirectUri);
      if (reqUrl.pathname !== redirectParsed.pathname) {
        res.writeHead(404); res.end(); return;
      }
      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>You can close this window.</h2></body></html>');
      server.close();
      if (win && !win.isDestroyed()) win.close();
      if (error) return reject(new Error(`Spotify auth error: ${error}`));
      if (returnedState !== state) return reject(new Error('State mismatch'));
      if (!code) return reject(new Error('No code returned'));
      try {
        const tok = await exchangeCode({ code, verifier, clientId, redirectUri });
        resolve(writeToken(tok));
      } catch (e) { reject(e); }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      win = new BrowserWindow({
        width: 500,
        height: 700,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      win.on('closed', () => {
        try { server.close(); } catch {}
      });
      win.loadURL(url.toString());
    });
  });
}

async function getValidAccessToken() {
  const { clientId } = getSpotifyEnv();
  let tok = readToken();
  if (!tok) return null;
  if (isExpired(tok)) {
    if (!tok.refresh_token) return null;
    tok = writeToken(await refreshAccessToken(tok.refresh_token, clientId));
  }
  return tok.access_token;
}

function status() {
  const tok = readToken();
  return { loggedIn: !!tok, expired: isExpired(tok) };
}

module.exports = { login, getValidAccessToken, status, clearToken };
