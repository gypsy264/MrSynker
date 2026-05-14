const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  authed: false,
  playlists: [],
  selectedPlaylistId: null,
  selectedPlaylistName: '',
  preview: null,
  rows: new Map(),
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
  setPill($('outputStatus'), `output: ${state.settings.outputDir}`);
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
  $('syncBtn').disabled = true;
  $('previewBtn').disabled = true;
  $('progressList').innerHTML = '';
  state.rows.clear();
  try {
    await window.api.startSync(state.selectedPlaylistId, { removeOrphans: $('removeOrphans').checked });
  } catch (e) {
    alert(`Sync failed: ${e.message}`);
  } finally {
    $('syncBtn').disabled = false;
    $('previewBtn').disabled = false;
  }
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
    case 'track:removed': {
      const li = document.createElement('li');
      li.innerHTML = `<span class="title"></span><span class="state error">removed</span>`;
      li.querySelector('.title').textContent = ev.file;
      $('progressList').appendChild(li);
      break;
    }
    case 'playlist:done': {
      const li = document.createElement('li');
      li.innerHTML = `<span class="title">Finished — ${ev.downloaded} new, ${ev.failed} failed, ${ev.skipped} already synced</span><span class="state done">complete</span>`;
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

$('outputStatus').addEventListener('click', async () => {
  const next = await window.api.chooseOutputDir();
  if (next) {
    state.settings = next;
    setPill($('outputStatus'), `output: ${next.outputDir}`);
  }
});

$('resolveBtn').addEventListener('click', resolvePastedUrl);
$('playlistUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') resolvePastedUrl(); });
$('previewBtn').addEventListener('click', doPreview);
$('syncBtn').addEventListener('click', doSync);

window.api.onSyncEvent(handleSyncEvent);

const settingsModal = $('settingsModal');

async function openSettings() {
  const [settings, env] = await Promise.all([window.api.getSettings(), window.api.getEnv()]);
  $('settingsOutputDir').value = settings.outputDir;
  $('settingsRemoveOrphans').checked = !!settings.removeOrphans;
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

$('settingsChooseDir').addEventListener('click', async () => {
  const next = await window.api.chooseOutputDir();
  if (next) {
    state.settings = next;
    $('settingsOutputDir').value = next.outputDir;
    setPill($('outputStatus'), `output: ${next.outputDir}`);
  }
});

$('settingsSave').addEventListener('click', async () => {
  const btn = $('settingsSave');
  btn.disabled = true;
  try {
    const updatedSettings = await window.api.setSettings({
      removeOrphans: $('settingsRemoveOrphans').checked,
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
