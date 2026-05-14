const $ = (id) => document.getElementById(id);

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
    li.addEventListener('click', () => {
      const matched = state.playlists.find((x) => x.id === p.id);
      selectPlaylist(matched || { id: p.id, name: p.name || p.id, trackCount: p.trackCount });
    });
    ul.appendChild(li);
  }
  return trackedIds;
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
  $('syncTitle').textContent = `Sync — ${p.name}`;
  $('syncControls').hidden = false;
  $('previewSummary').hidden = true;
  $('progressList').innerHTML = '';
  state.rows.clear();
  document.querySelectorAll('.playlist-list li').forEach((li) => {
    li.classList.toggle('selected', li.dataset.id === p.id);
  });
}

async function doPreview() {
  if (!state.selectedPlaylistId) return;
  $('previewBtn').disabled = true;
  try {
    const res = await window.api.previewSync(state.selectedPlaylistId);
    state.preview = res;
    const { added, removed, existing } = res.diff;
    const el = $('previewSummary');
    el.hidden = false;
    el.innerHTML = `
      <span><span class="num added">${added.length}</span> to download</span>
      <span><span class="num existing">${existing.length}</span> already synced</span>
      <span><span class="num removed">${removed.length}</span> to remove</span>
    `;
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
      break;
    }
    case 'track:error': {
      const row = state.rows.get(ev.trackId);
      if (row) {
        row.stateEl.textContent = 'error';
        row.stateEl.classList.add('error');
        row.li.title = ev.error;
      }
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
  $('envClientId').value = env.SPOTIFY_CLIENT_ID || '';
  $('envClientSecret').value = env.SPOTIFY_CLIENT_SECRET || '';
  $('envRedirectUri').value = env.SPOTIFY_REDIRECT_URI || '';
  $('settingsSavedNote').textContent = '';
  settingsModal.hidden = false;
}

function closeSettings() { settingsModal.hidden = true; }

settingsModal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSettings));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsModal.hidden) closeSettings(); });

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

(async () => {
  await refreshStatus();
  await loadPlaylists();
})();
