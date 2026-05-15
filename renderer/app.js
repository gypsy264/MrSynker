const $ = (id) => document.getElementById(id);

function animatedClose(el, ms = 180) {
  if (!el || el.hidden) return;
  el.classList.add('is-closing');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('is-closing');
  }, ms);
}

const state = {
  settings: null,
  authed: false,
  playlists: [],
  trackedPlaylists: [],
  selectedPlaylistId: null,
  selectedPlaylistName: '',
  preview: null,
  rows: new Map(),
  syncing: false,
};

function setPill(el, text, cls) {
  el.textContent = text;
  el.classList.remove('ok', 'bad');
  if (cls) el.classList.add(cls);
}

async function refreshStatus() {
  const deps = await window.api.checkDeps();
  setPill($('depsStatus'), deps.ok ? 'deps: yt-dlp + ffmpeg' : 'deps: missing', deps.ok ? 'ok' : 'bad');

  const auth = await window.api.spotifyStatus();
  state.authed = auth.loggedIn && !auth.expired;
  setPill($('authStatus'), state.authed ? 'spotify: connected' : 'spotify: signed out', state.authed ? 'ok' : null);
  $('loginBtn').hidden = state.authed;
  $('logoutBtn').hidden = !state.authed;

  state.settings = await window.api.getSettings();
  renderLibraryPicker();
  await refreshTrackedPlaylists();
}

function renderLibraryPicker() {
  const sel = $('librarySelect');
  sel.innerHTML = '';
  for (const lib of state.settings.libraries) {
    const opt = document.createElement('option');
    opt.value = lib.path;
    opt.textContent = lib.name;
    opt.title = lib.path;
    if (lib.path === state.settings.outputDir) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function refreshTrackedPlaylists() {
  try {
    state.trackedPlaylists = await window.api.getTrackedPlaylists();
  } catch {
    state.trackedPlaylists = [];
  }
  renderTracked();
  renderPlaylists(state.playlists);
}

function fmtDate(iso) {
  if (!iso) return 'never';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function renderTracked() {
  const ul = $('trackedList');
  ul.innerHTML = '';
  const empty = $('libraryEmpty');
  empty.hidden = state.trackedPlaylists.length > 0;
  $('updateAllBtn').disabled = state.trackedPlaylists.length === 0;
  const trackedIds = new Set(state.trackedPlaylists.map((p) => p.id));
  for (const p of state.trackedPlaylists) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === state.selectedPlaylistId) li.classList.add('selected');
    li.innerHTML = `
      <div class="liked-art" style="background:linear-gradient(135deg,#1e3a8a,#1db954)">♪</div>
      <div class="meta">
        <div class="name"></div>
        <div class="sub tracked-meta"></div>
      </div>
    `;
    li.querySelector('.name').textContent = p.name || p.id;
    li.querySelector('.sub').textContent = `${p.trackCount} synced · last ${fmtDate(p.lastSynced)}`;
    li.addEventListener('click', () => openTracksModal(p));
    ul.appendChild(li);
  }
  return trackedIds;
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtKhz(hz) {
  if (!hz) return '—';
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

function fmtBitrate(bps) {
  if (!bps) return '—';
  return `${Math.round(bps / 1000)} kbps`;
}

async function openTracksModal(p) {
  const modal = $('tracksModal');
  $('tracksModalTitle').textContent = p.name || p.id;
  $('tracksMeta').textContent = 'Loading…';
  $('tracksGrid').innerHTML = '';
  modal.hidden = false;
  await renderTracksModal(p.id, false);
  await renderTracksModal(p.id, true);
}

async function renderTracksModal(playlistId, inspect) {
  try {
    const res = await window.api.getTrackedTracks(playlistId, { inspect });
    const grid = $('tracksGrid');
    grid.innerHTML = '';
    $('tracksMeta').textContent = `${res.tracks.length} synced · last ${fmtDate(res.playlist?.lastSynced)}${inspect ? '' : ' · inspecting files…'}`;
    for (const t of res.tracks) {
      const card = document.createElement('div');
      card.className = 'track-card';
      const info = t.info || {};
      const cover = info.cover;
      card.innerHTML = `
        <div class="art">
          ${cover ? `<img src="${cover}" />` : '♪'}
          <span class="ext-pill">${(t.ext || 'mp3').toUpperCase()}</span>
        </div>
        <div class="title"></div>
        <div class="meta"></div>
      `;
      card.querySelector('.title').textContent = t.file;
      const meta = card.querySelector('.meta');
      meta.innerHTML = `
        <span>${fmtBytes(info.sizeBytes)}</span>
        <span>${fmtKhz(info.sampleRate)}</span>
        <span>${fmtBitrate(info.bitrate)}</span>
      `;
      grid.appendChild(card);
    }
  } catch (e) {
    $('tracksMeta').textContent = `Failed: ${e.message}`;
  }
}

async function loadPlaylists() {
  if (!state.authed) { renderPlaylists([]); return; }
  try {
    state.playlists = await window.api.spotifyPlaylists();
    renderPlaylists(state.playlists);
  } catch (e) {
    console.error(e);
  }
}

function renderPlaylists(items) {
  const ul = $('playlistList');
  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li style="color:var(--muted);cursor:default">No playlists yet — log in or paste a URL above.</li>';
    return;
  }
  for (const p of items) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === state.selectedPlaylistId) li.classList.add('selected');
    if (p.liked) li.classList.add('liked');
    const art = p.liked
      ? `<div class="liked-art">♥</div>`
      : `<img src="${p.image || ''}" onerror="this.style.visibility='hidden'" />`;
    li.innerHTML = `
      ${art}
      <div class="meta">
        <div class="name"></div>
        <div class="sub"></div>
      </div>
    `;
    const nameEl = li.querySelector('.name');
    nameEl.textContent = p.name;
    if (p.liked) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'LIKED';
      nameEl.appendChild(badge);
    }
    if (state.trackedPlaylists.some((tp) => tp.id === p.id)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'TRACKED';
      nameEl.appendChild(badge);
    }
    li.querySelector('.sub').textContent = `${p.trackCount} tracks · ${p.owner || ''}`;
    li.addEventListener('click', () => selectPlaylist(p));
    ul.appendChild(li);
  }
}

function selectPlaylist(p) {
  state.selectedPlaylistId = p.id;
  state.selectedPlaylistName = p.name;
  state.preview = null;
  state.previewTrackIndex = new Map();
  $('syncTitle').textContent = `Sync — ${p.name}`;
  $('syncControls').hidden = false;
  $('previewSummary').hidden = true;
  $('previewLists').hidden = true;
  $('completedStrip').hidden = true;
  $('completedStripRow').innerHTML = '';
  $('progressList').innerHTML = '';
  state.rows.clear();
  document.querySelectorAll('.playlist-list li').forEach((li) => {
    li.classList.toggle('selected', li.dataset.id === p.id);
  });
}

function fmtDuration(ms) {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderPreviewList(ulId, items, kind) {
  const ul = $(ulId);
  ul.innerHTML = '';
  for (const item of items) {
    const t = item.track || item;
    const li = document.createElement('li');
    const art = t.coverUrl
      ? `<img src="${t.coverUrl}" />`
      : `<div class="placeholder">♪</div>`;
    li.innerHTML = `
      ${art}
      <div>
        <div class="pl-title"></div>
        <div class="pl-artist"></div>
      </div>
      <div class="pl-dur"></div>
    `;
    const title = t.name || item.file || item.trackId || '';
    const artist = (t.artists || []).join(', ');
    li.querySelector('.pl-title').textContent = title;
    li.querySelector('.pl-artist').textContent = kind === 'removed' ? (item.file || '') : artist;
    li.querySelector('.pl-dur').textContent = fmtDuration(t.durationMs);
    ul.appendChild(li);
  }
}

async function doPreview() {
  if (!state.selectedPlaylistId) return;
  $('previewBtn').disabled = true;
  try {
    const res = await window.api.previewSync(state.selectedPlaylistId);
    state.preview = res;
    state.previewTrackIndex = new Map();
    for (const t of res.tracks || []) state.previewTrackIndex.set(t.id, t);
    const { added, removed, existing } = res.diff;
    const el = $('previewSummary');
    el.hidden = false;
    el.innerHTML = `
      <span><span class="num added">${added.length}</span> to download</span>
      <span><span class="num existing">${existing.length}</span> already synced</span>
      <span><span class="num removed">${removed.length}</span> to remove</span>
    `;
    $('previewLists').hidden = false;
    $('previewAddedCount').textContent = `(${added.length})`;
    $('previewExistingCount').textContent = `(${existing.length})`;
    $('previewRemovedCount').textContent = `(${removed.length})`;
    renderPreviewList('previewAdded', added, 'added');
    renderPreviewList('previewExisting', existing, 'existing');
    renderPreviewList('previewRemoved', removed, 'removed');
    $('previewAddedDetails').open = added.length > 0;
    $('previewExistingDetails').open = false;
    $('previewRemovedDetails').open = removed.length > 0;
  } catch (e) {
    alert(`Preview failed: ${e.message}`);
  } finally {
    $('previewBtn').disabled = false;
  }
}

async function doSync() {
  if (!state.selectedPlaylistId) return;
  $('syncBtn').hidden = true;
  $('stopBtn').hidden = false;
  $('previewBtn').disabled = true;
  $('progressList').innerHTML = '';
  $('completedStripRow').innerHTML = '';
  $('completedStrip').hidden = false;
  state.rows.clear();
  try {
    await window.api.startSync(state.selectedPlaylistId, {
      removeOrphans: $('removeOrphans').checked,
      concurrency: state.settings?.concurrency ?? 4,
    });
  } catch (e) {
    alert(`Sync failed: ${e.message}`);
  } finally {
    $('syncBtn').hidden = false;
    $('stopBtn').hidden = true;
    $('stopBtn').disabled = false;
    $('stopBtn').textContent = 'Stop';
    $('previewBtn').disabled = false;
    await refreshTrackedPlaylists();
  }
}

async function doStop() {
  $('stopBtn').disabled = true;
  $('stopBtn').textContent = 'Stopping…';
  try { await window.api.stopSync(); } catch {}
}

async function addCompletedCard(trackId, file) {
  $('completedStrip').hidden = false;
  const track = state.previewTrackIndex?.get(trackId) || {};
  const card = document.createElement('div');
  card.className = 'completed-card';
  const ext = (file?.split('.').pop() || '').toLowerCase();
  card.innerHTML = `
    <div class="ca-art">
      ${track.coverUrl ? `<img src="${track.coverUrl}" />` : ''}
      <span class="ca-ext">${ext.toUpperCase()}</span>
    </div>
    <div class="ca-title"></div>
    <div class="ca-meta"><span>—</span></div>
  `;
  card.querySelector('.ca-title').textContent = track.name || file;
  card.title = `${(track.artists || []).join(', ')} — ${track.name || ''}`;
  const row = $('completedStripRow');
  row.prepend(card);
  try {
    const info = await window.api.inspectOne(file);
    const meta = card.querySelector('.ca-meta');
    meta.innerHTML = `
      <span>${fmtBytes(info.sizeBytes)}</span>
      <span>${fmtKhz(info.sampleRate)}</span>
      <span>${fmtBitrate(info.bitrate)}</span>
    `;
    if (!track.coverUrl && info.cover) {
      const art = card.querySelector('.ca-art');
      const img = document.createElement('img');
      img.src = info.cover;
      art.insertBefore(img, art.firstChild);
    }
  } catch {}
}

function ensureRow(trackId, label) {
  if (state.rows.has(trackId)) return state.rows.get(trackId);
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="title"></span>
    <span class="state">queued</span>
    <div class="bar"><div></div></div>
  `;
  li.querySelector('.title').textContent = label;
  $('progressList').appendChild(li);
  const obj = {
    li,
    title: li.querySelector('.title'),
    stateEl: li.querySelector('.state'),
    barInner: li.querySelector('.bar > div'),
  };
  state.rows.set(trackId, obj);
  return obj;
}

function handleSyncEvent(ev) {
  switch (ev.kind) {
    case 'track:start': {
      const row = ensureRow(ev.trackId, `${ev.artist} — ${ev.name}`);
      row.stateEl.textContent = 'matching';
      break;
    }
    case 'track:match': {
      const row = ensureRow(ev.trackId, ev.title);
      row.stateEl.textContent = 'downloading';
      break;
    }
    case 'track:progress': {
      const row = state.rows.get(ev.trackId);
      if (row) row.barInner.style.width = `${ev.pct}%`;
      break;
    }
    case 'track:done': {
      const row = state.rows.get(ev.trackId);
      if (row) {
        row.stateEl.textContent = 'done';
        row.stateEl.classList.add('done');
        row.barInner.style.width = '100%';
      }
      addCompletedCard(ev.trackId, ev.file);
      break;
    }
    case 'track:error': {
      const row = state.rows.get(ev.trackId);
      if (row) {
        row.stateEl.textContent = 'error';
        row.stateEl.classList.add('error');
        row.li.title = ev.error;
        if (!row.errorEl) {
          const errEl = document.createElement('span');
          errEl.className = 'error-detail';
          row.li.appendChild(errEl);
          row.errorEl = errEl;
        }
        row.errorEl.textContent = ev.error || 'unknown error';
      }
      console.error(`[sync] ${ev.trackId}: ${ev.error}`);
      break;
    }
    case 'track:cancelled': {
      const row = state.rows.get(ev.trackId);
      if (row) {
        row.stateEl.textContent = 'stopped';
        row.stateEl.classList.add('error');
      }
      break;
    }
    case 'track:removed': {
      const li = document.createElement('li');
      li.innerHTML = `<span class="title"></span><span class="state error">removed</span>`;
      li.querySelector('.title').textContent = ev.file;
      $('progressList').appendChild(li);
      break;
    }
    case 'playlist:done': {
      const li = document.createElement('li');
      const cancelled = ev.cancelled || 0;
      const label = ev.stopped
        ? `Stopped — ${ev.downloaded} new, ${cancelled} cancelled, ${ev.failed} failed, ${ev.skipped} already synced`
        : `Finished — ${ev.downloaded} new, ${ev.failed} failed, ${ev.skipped} already synced`;
      li.innerHTML = `<span class="title"></span><span class="state ${ev.stopped ? 'error' : 'done'}">${ev.stopped ? 'stopped' : 'complete'}</span>`;
      li.querySelector('.title').textContent = label;
      $('progressList').appendChild(li);
      break;
    }
  }
}

async function resolvePastedUrl() {
  const v = $('playlistUrl').value;
  if (!v.trim()) return;
  try {
    const meta = await window.api.spotifyResolvePlaylist(v);
    const existing = state.playlists.find((p) => p.id === meta.id);
    if (!existing) state.playlists.unshift(meta);
    renderPlaylists(state.playlists);
    selectPlaylist(meta);
    $('playlistUrl').value = '';
  } catch (e) {
    alert(e.message);
  }
}

$('loginBtn').addEventListener('click', async () => {
  $('loginBtn').disabled = true;
  try {
    await window.api.spotifyLogin();
    await refreshStatus();
    await loadPlaylists();
  } catch (e) {
    alert(`Login failed: ${e.message}`);
  } finally {
    $('loginBtn').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await window.api.spotifyLogout();
  state.playlists = [];
  state.selectedPlaylistId = null;
  renderPlaylists([]);
  await refreshStatus();
});

$('librarySelect').addEventListener('change', async (e) => {
  const next = await window.api.setActiveLibrary(e.target.value);
  state.settings = next;
  state.selectedPlaylistId = null;
  $('syncControls').hidden = true;
  $('previewSummary').hidden = true;
  $('progressList').innerHTML = '';
  state.rows.clear();
  $('syncTitle').textContent = 'Sync';
  await refreshTrackedPlaylists();
});

$('addLibraryBtn').addEventListener('click', async () => {
  const next = await window.api.addLibraryFromPicker();
  if (next) {
    state.settings = next;
    renderLibraryPicker();
    await refreshTrackedPlaylists();
  }
});

$('removeLibraryBtn').addEventListener('click', async () => {
  if (!confirm('Remove this library from the list? Files on disk are NOT deleted.')) return;
  const next = await window.api.removeLibrary(state.settings.outputDir);
  state.settings = next;
  renderLibraryPicker();
  await refreshTrackedPlaylists();
});

$('updateAllBtn').addEventListener('click', async () => {
  if (!state.trackedPlaylists.length || state.syncing) return;
  if (!state.authed) { alert('Log in to Spotify first.'); return; }
  state.syncing = true;
  $('updateAllBtn').hidden = true;
  $('stopAllBtn').hidden = false;
  $('progressList').innerHTML = '';
  state.rows.clear();
  try {
    await window.api.startSyncAll({
      removeOrphans: $('removeOrphans').checked,
      concurrency: state.settings?.concurrency ?? 4,
    });
  } catch (e) {
    alert(`Update failed: ${e.message}`);
  } finally {
    state.syncing = false;
    $('updateAllBtn').hidden = false;
    $('stopAllBtn').hidden = true;
    $('stopAllBtn').disabled = false;
    $('stopAllBtn').textContent = 'Stop';
    await refreshTrackedPlaylists();
  }
});

$('stopAllBtn').addEventListener('click', async () => {
  $('stopAllBtn').disabled = true;
  $('stopAllBtn').textContent = 'Stopping…';
  try { await window.api.stopSync(); } catch {}
});

$('resolveBtn').addEventListener('click', resolvePastedUrl);
$('playlistUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') resolvePastedUrl(); });
$('previewBtn').addEventListener('click', doPreview);
$('syncBtn').addEventListener('click', doSync);
$('stopBtn').addEventListener('click', doStop);

window.api.onSyncEvent(handleSyncEvent);

const settingsModal = $('settingsModal');

async function openSettings() {
  const [settings, env] = await Promise.all([window.api.getSettings(), window.api.getEnv()]);
  $('settingsOutputDir').value = settings.outputDir;
  $('settingsRemoveOrphans').checked = !!settings.removeOrphans;
  const concurrency = Math.max(1, Math.min(8, settings.concurrency ?? 4));
  $('settingsConcurrency').value = concurrency;
  $('settingsConcurrencyVal').textContent = concurrency;
  $('settingsAudioFormat').value = ['mp3', 'wav', 'flac'].includes(settings.audioFormat) ? settings.audioFormat : 'mp3';
  $('envClientId').value = env.SPOTIFY_CLIENT_ID || '';
  $('envClientSecret').value = env.SPOTIFY_CLIENT_SECRET || '';
  $('envRedirectUri').value = env.SPOTIFY_REDIRECT_URI || '';
  $('settingsSavedNote').textContent = '';
  settingsModal.hidden = false;
}

function closeSettings() { animatedClose(settingsModal); }

settingsModal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSettings));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsModal.hidden) closeSettings(); });

const tracksModal = $('tracksModal');
tracksModal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => animatedClose(tracksModal)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tracksModal.hidden) animatedClose(tracksModal); });
$('tracksRefreshBtn').addEventListener('click', () => {
  const title = $('tracksModalTitle').textContent;
  const tracked = state.trackedPlaylists.find((p) => (p.name || p.id) === title);
  if (tracked) openTracksModal(tracked);
});

$('settingsBtn').addEventListener('click', openSettings);
$('settingsConcurrency').addEventListener('input', (e) => {
  $('settingsConcurrencyVal').textContent = e.target.value;
});

$('settingsChooseDir').addEventListener('click', async () => {
  const next = await window.api.addLibraryFromPicker();
  if (next) {
    state.settings = next;
    $('settingsOutputDir').value = next.outputDir;
    renderLibraryPicker();
    await refreshTrackedPlaylists();
  }
});

$('settingsSave').addEventListener('click', async () => {
  const btn = $('settingsSave');
  btn.disabled = true;
  try {
    const updatedSettings = await window.api.setSettings({
      removeOrphans: $('settingsRemoveOrphans').checked,
      concurrency: parseInt($('settingsConcurrency').value, 10) || 4,
      audioFormat: $('settingsAudioFormat').value || 'mp3',
    });
    await window.api.setEnv({
      SPOTIFY_CLIENT_ID: $('envClientId').value.trim(),
      SPOTIFY_CLIENT_SECRET: $('envClientSecret').value.trim(),
      SPOTIFY_REDIRECT_URI: $('envRedirectUri').value.trim(),
    });
    state.settings = updatedSettings;
    $('removeOrphans').checked = !!updatedSettings.removeOrphans;
    $('settingsSavedNote').textContent = 'Saved';
    setTimeout(() => { $('settingsSavedNote').textContent = ''; }, 1500);
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
});

const onboard = {
  step: 1,
  totalSteps: 3,
  el: $('onboarding'),
};

function showOnboarding() { onboard.el.hidden = false; setOnboardStep(1); }
function hideOnboarding() { animatedClose(onboard.el, 200); }

function setOnboardStep(n) {
  onboard.step = n;
  document.querySelectorAll('.onboarding-step').forEach((s) => {
    s.hidden = parseInt(s.dataset.step, 10) !== n;
  });
  document.querySelectorAll('.onboarding-steps .step').forEach((s) => {
    const stepNum = parseInt(s.dataset.step, 10);
    s.classList.toggle('active', stepNum === n);
    s.classList.toggle('done', stepNum < n);
  });
  $('onboardBack').hidden = n === 1;
  $('onboardNext').textContent = n === onboard.totalSteps ? 'Finish' : 'Continue';
  $('onboardError').hidden = true;
}

async function advanceOnboarding() {
  $('onboardError').hidden = true;
  if (onboard.step === 2) {
    if (!$('onboardAccept').checked) {
      $('onboardError').textContent = 'You need to accept the terms to continue.';
      $('onboardError').hidden = false;
      return;
    }
  }
  if (onboard.step === 3) {
    const clientId = $('onboardClientId').value.trim();
    const clientSecret = $('onboardClientSecret').value.trim();
    const redirectUri = $('onboardRedirectUri').value.trim() || 'http://127.0.0.1:8888/callback';
    if (!clientId) {
      $('onboardError').textContent = 'Client ID is required.';
      $('onboardError').hidden = false;
      return;
    }
    try {
      await window.api.setEnv({
        SPOTIFY_CLIENT_ID: clientId,
        SPOTIFY_CLIENT_SECRET: clientSecret,
        SPOTIFY_REDIRECT_URI: redirectUri,
      });
      await window.api.completeOnboarding({ acceptedTerms: true });
    } catch (e) {
      $('onboardError').textContent = `Failed to save: ${e.message}`;
      $('onboardError').hidden = false;
      return;
    }
    hideOnboarding();
    await refreshStatus();
    await loadPlaylists();
    return;
  }
  setOnboardStep(onboard.step + 1);
}

$('onboardNext').addEventListener('click', advanceOnboarding);
$('onboardBack').addEventListener('click', () => setOnboardStep(Math.max(1, onboard.step - 1)));

// ============================================================
// PLAYER
// ============================================================
const player = {
  view: $('playerView'),
  audio: $('audioEl'),
  tracks: [],
  filtered: [],
  index: -1,
  coverCache: new Map(),
  shuffle: false,
  repeat: 'off', // off | all | one
};

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

async function openPlayer() {
  try {
    player.tracks = await window.api.getAllLibraryTracks();
  } catch (e) {
    alert(`Could not load tracks: ${e.message}`);
    return;
  }
  $('playerLibName').textContent = state.settings?.libraries?.find((l) => l.path === state.settings.outputDir)?.name || '';
  $('playerSearch').value = '';
  applyPlayerFilter('');
  player.view.hidden = false;
}

function closePlayer() { animatedClose(player.view, 180); }

function applyPlayerFilter(q) {
  const needle = q.trim().toLowerCase();
  player.filtered = needle
    ? player.tracks.filter((t) => t.file.toLowerCase().includes(needle))
    : player.tracks.slice();
  renderPlayerList();
}

function renderPlayerList() {
  const ul = $('playerTracks');
  ul.innerHTML = '';
  $('playerCount').textContent = `${player.filtered.length} of ${player.tracks.length}`;
  player.filtered.forEach((t, i) => {
    const li = document.createElement('li');
    if (player.index >= 0 && player.tracks[player.index]?.file === t.file) li.classList.add('playing');
    li.innerHTML = `
      <span class="pt-idx">${(i + 1).toString().padStart(2, '0')}</span>
      <span class="pt-title"></span>
      <span class="pt-ext">${(t.ext || '').toUpperCase()}</span>
    `;
    li.querySelector('.pt-title').textContent = t.file.replace(/\.(mp3|wav|flac|m4a|ogg)$/i, '');
    li.title = `${t.playlistName} — ${t.file}`;
    li.addEventListener('click', () => {
      const realIdx = player.tracks.findIndex((x) => x.file === t.file);
      if (realIdx >= 0) playIndex(realIdx);
    });
    ul.appendChild(li);
  });
}

function splitFilename(file) {
  const base = file.replace(/\.(mp3|wav|flac|m4a|ogg)$/i, '');
  const idx = base.indexOf(' - ');
  if (idx > 0) return { artist: base.slice(0, idx), title: base.slice(idx + 3) };
  return { artist: '', title: base };
}

async function loadNowPlaying(track) {
  const { artist, title } = splitFilename(track.file);
  $('nowTitle').textContent = title;
  $('nowArtist').textContent = artist;
  $('nowAlbum').textContent = track.playlistName || '';
  $('nowQuality').textContent = `${(track.ext || '').toUpperCase()} · loading…`;
  const art = $('nowArt');
  art.innerHTML = '<span class="hero-art-fallback">♪</span>';
  $('playerBg').style.backgroundImage = '';

  try {
    const info = player.coverCache.get(track.file) || await window.api.inspectOne(track.file);
    player.coverCache.set(track.file, info);
    if (info.cover) {
      art.innerHTML = `<img src="${info.cover}" alt="" />`;
      $('playerBg').style.backgroundImage = `url("${info.cover}")`;
    }
    const parts = [];
    parts.push((track.ext || info.ext || '').toUpperCase());
    if (info.sampleRate) parts.push(`${(info.sampleRate / 1000).toFixed(info.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
    if (info.bitrate) parts.push(`${Math.round(info.bitrate / 1000)} kbps`);
    if (info.sizeBytes) parts.push(`${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
    $('nowQuality').textContent = parts.join(' · ');
  } catch {}
}

function playIndex(idx) {
  if (idx < 0 || idx >= player.tracks.length) return;
  player.index = idx;
  const track = player.tracks[idx];
  player.audio.src = window.api.mediaUrlFor(track.file);
  loadNowPlaying(track);
  player.audio.play().catch((e) => console.error('play failed', e));
  renderPlayerList();
}

function playPause() {
  if (player.index < 0) {
    if (player.tracks.length) playIndex(0);
    return;
  }
  if (player.audio.paused) player.audio.play(); else player.audio.pause();
}

function pickNextIndex() {
  if (player.shuffle && player.tracks.length > 1) {
    let r;
    do { r = Math.floor(Math.random() * player.tracks.length); } while (r === player.index);
    return r;
  }
  if (player.index + 1 < player.tracks.length) return player.index + 1;
  if (player.repeat === 'all') return 0;
  return -1;
}

function next() {
  const i = pickNextIndex();
  if (i >= 0) playIndex(i);
}
function prev() {
  if (player.audio.currentTime > 3) { player.audio.currentTime = 0; return; }
  if (player.index > 0) playIndex(player.index - 1);
  else if (player.repeat === 'all') playIndex(player.tracks.length - 1);
}

const PLAY_SVG = '<svg id="playIcon" width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
const PAUSE_SVG = '<svg id="playIcon" width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';

$('playerBtn').addEventListener('click', openPlayer);
$('playerCloseBtn').addEventListener('click', closePlayer);
$('queueToggleBtn').addEventListener('click', () => {
  const q = $('playerQueue');
  q.hidden = !q.hidden;
});
$('playerSearch').addEventListener('input', (e) => applyPlayerFilter(e.target.value));
$('playBtn').addEventListener('click', playPause);
$('nextBtn').addEventListener('click', next);
$('prevBtn').addEventListener('click', prev);
$('shuffleBtn').addEventListener('click', () => {
  player.shuffle = !player.shuffle;
  $('shuffleBtn').classList.toggle('active', player.shuffle);
});
$('repeatBtn').addEventListener('click', () => {
  player.repeat = player.repeat === 'off' ? 'all' : (player.repeat === 'all' ? 'one' : 'off');
  $('repeatBtn').classList.toggle('active', player.repeat !== 'off');
  $('repeatBtn').title = `Repeat: ${player.repeat}`;
});
$('seekBar').addEventListener('input', (e) => {
  if (Number.isFinite(player.audio.duration)) {
    player.audio.currentTime = parseFloat(e.target.value);
  }
});
$('volBar').addEventListener('input', (e) => { player.audio.volume = parseFloat(e.target.value); });

player.audio.addEventListener('loadedmetadata', () => {
  $('seekBar').max = String(player.audio.duration || 0);
  $('durTime').textContent = fmtTime(player.audio.duration);
});
player.audio.addEventListener('timeupdate', () => {
  $('seekBar').value = String(player.audio.currentTime || 0);
  $('curTime').textContent = fmtTime(player.audio.currentTime);
});
player.audio.addEventListener('play', () => { $('playBtn').innerHTML = PAUSE_SVG; });
player.audio.addEventListener('pause', () => { $('playBtn').innerHTML = PLAY_SVG; });
player.audio.addEventListener('ended', () => {
  if (player.repeat === 'one') { player.audio.currentTime = 0; player.audio.play(); return; }
  next();
});
player.audio.addEventListener('error', () => {
  $('nowQuality').textContent = 'playback error — file may be missing or unsupported';
});

document.addEventListener('keydown', (e) => {
  if (player.view.hidden) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); playPause(); }
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'Escape') closePlayer();
});

(async () => {
  try {
    const winState = await window.api.windowState();
    if (winState.isMac) {
      document.getElementById('topbar').classList.add('is-mac');
      document.querySelector('.player-topbar').classList.add('is-mac');
    } else {
      document.getElementById('windowControls').hidden = false;
      document.getElementById('winMinimize').addEventListener('click', () => window.api.windowMinimize());
      document.getElementById('winMaximize').addEventListener('click', () => window.api.windowToggleMaximize());
      document.getElementById('winClose').addEventListener('click', () => window.api.windowClose());
    }
  } catch {}

  try {
    const ob = await window.api.onboardingStatus();
    if (ob.needsOnboarding) {
      const env = await window.api.getEnv();
      $('onboardRedirectUri').value = env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
      $('onboardClientId').value = env.SPOTIFY_CLIENT_ID || '';
      $('onboardClientSecret').value = env.SPOTIFY_CLIENT_SECRET || '';
      $('onboardAccept').checked = !!ob.state?.acceptedTerms;
      showOnboarding();
      return;
    }
  } catch (e) {
    console.error('onboarding check failed', e);
  }
  await refreshStatus();
  await loadPlaylists();
})();
