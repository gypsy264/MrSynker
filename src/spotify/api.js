const SpotifyWebApi = require('spotify-web-api-node');
const { getValidAccessToken } = require('./auth');

const LIKED_ID = '__liked__';

async function client() {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Not authenticated with Spotify');
  const api = new SpotifyWebApi();
  api.setAccessToken(token);
  return api;
}

function mapTrack(t) {
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name),
    album: t.album?.name || '',
    year: (t.album?.release_date || '').slice(0, 4),
    durationMs: t.duration_ms,
    isrc: t.external_ids?.isrc || null,
    coverUrl: t.album?.images?.[0]?.url || null,
  };
}

async function getMe() {
  const api = await client();
  return (await api.getMe()).body;
}

async function getLikedMeta() {
  const api = await client();
  const { body } = await api.getMySavedTracks({ limit: 1 });
  return {
    id: LIKED_ID,
    name: 'Liked Songs',
    owner: 'You',
    image: null,
    trackCount: body.total ?? 0,
    liked: true,
  };
}

async function getLikedTracks() {
  const api = await client();
  const out = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const { body } = await api.getMySavedTracks({ limit, offset });
    for (const item of body.items) {
      if (!item.track || !item.track.id) continue;
      out.push(mapTrack(item.track));
    }
    if (body.items.length < limit) break;
    offset += limit;
  }
  return out;
}

async function getUserPlaylists() {
  const api = await client();
  const out = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const { body } = await api.getUserPlaylists({ limit, offset });
    out.push(...body.items);
    if (body.items.length < limit) break;
    offset += limit;
  }
  const mapped = out.map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner?.display_name || p.owner?.id,
    image: p.images?.[0]?.url || null,
    trackCount: p.tracks?.total ?? 0,
  }));
  try {
    const liked = await getLikedMeta();
    mapped.unshift(liked);
  } catch {}
  return mapped;
}

function playlistIdFromUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === LIKED_ID) return LIKED_ID;
  const m = trimmed.match(/playlist[\/:]([a-zA-Z0-9]+)/);
  return m ? m[1] : (/^[a-zA-Z0-9]{22}$/.test(trimmed) ? trimmed : null);
}

async function getPlaylistMeta(playlistId) {
  if (playlistId === LIKED_ID) return getLikedMeta();
  const api = await client();
  const { body } = await api.getPlaylist(playlistId, { fields: 'id,name,owner(display_name,id),images,tracks(total)' });
  return {
    id: body.id,
    name: body.name,
    owner: body.owner?.display_name || body.owner?.id,
    image: body.images?.[0]?.url || null,
    trackCount: body.tracks?.total ?? 0,
  };
}

async function getPlaylistTracks(playlistId) {
  if (playlistId === LIKED_ID) return getLikedTracks();
  const api = await client();
  const out = [];
  let offset = 0;
  const limit = 100;
  const fields = 'items(track(id,name,duration_ms,external_ids,artists(name),album(name,release_date,images))),next';
  while (true) {
    const { body } = await api.getPlaylistTracks(playlistId, { limit, offset, fields });
    for (const item of body.items) {
      if (!item.track || !item.track.id) continue;
      out.push(mapTrack(item.track));
    }
    if (body.items.length < limit) break;
    offset += limit;
  }
  return out;
}

module.exports = { getMe, getUserPlaylists, getPlaylistMeta, getPlaylistTracks, playlistIdFromUrl, LIKED_ID };
