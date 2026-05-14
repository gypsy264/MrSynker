# MrSynker

<p align="center">
  <img src="logo/mainLogo.png" alt="MrSynker logo" width="160" />
</p>

Desktop app that syncs your Spotify playlists to local MP3 files — built for
loading up a Sony Walkman (or any MP3 player) without all the dragging,
renaming, and re-tagging.

Pick a playlist, hit sync, and MrSynker matches each track on YouTube via
yt-dlp, converts to MP3, writes ID3 tags (title / artist / album / year /
cover art), and keeps a `synk.data` file inside the output folder so it can
incrementally update later.

---

## Disclaimer (the honest one)

**This app is half vibe-coded and half made by me, just for fun and
entertainment purposes.** It is not a polished, production-grade product.
There are rough edges. Things will break. PRs welcome, but don't expect
enterprise SLAs from someone shipping this at 2am.

## Disclaimer (the legal one)

MrSynker is a tool. It does **not** host, distribute, or own any music.

- All music, cover art, metadata, and other content sourced through this app
  belongs to its respective rights holders (artists, labels, publishers, etc.).
- Audio is downloaded via [yt-dlp](https://github.com/yt-dlp/yt-dlp) from
  publicly accessible YouTube/YouTube Music URLs. The legality of doing so
  depends on your country, the specific content, and your intended use.
- Spotify metadata is read via Spotify's official Web API using your own
  developer credentials — MrSynker never sees or stores Spotify content
  itself, only track metadata (title, artist, ISRC, etc.).
- **You are solely responsible for how you use this software.** Use it only
  with content you have the right to download in your jurisdiction (e.g.
  music you already own, public-domain works, content under permissive
  licenses, or where personal-use copies are legally permitted).
- The authors and contributors of MrSynker accept **no liability** for any
  misuse, copyright infringement, terms-of-service violations, broken
  speakers, lost Walkmans, or hurt feelings. Please don't sue us.

If you are a rights holder and have a concern about how this software could
be misused, open an issue and we'll talk.

---

## Features

- **ISRC-based matching** — when Spotify provides an ISRC, MrSynker searches
  YouTube by ISRC first for high-accuracy matches, then falls back to
  artist + title with a scoring heuristic that favors `- Topic` channels and
  near-matching durations, and penalizes covers / remixes / live versions.
- **Incremental sync** — re-running a sync only downloads what's new. Already
  synced tracks are skipped instantly via the per-folder `synk.data` state file.
- **Multiple libraries** — each output folder is its own self-contained library.
  Have one for the Walkman, one for the car, one for a USB stick — switch
  between them from the topbar and hit "Update all" to refresh everything.
- **Orphan removal (optional)** — when a song is removed from a playlist on
  Spotify, MrSynker can delete the local file too.
- **Parallel downloads** — 1–8 configurable concurrent workers, with proper
  cancellation that kills in-flight yt-dlp processes.
- **Liked Songs as a playlist** — your Spotify library appears as a virtual
  playlist at the top of the list.
- **Full ID3 tagging** — title, artist, album, year, and cover art (fetched
  from Spotify, not scraped from YouTube thumbnails).

---

## Requirements

- **Node.js** 18+
- **Electron** (installed automatically via `npm install`)
- **yt-dlp** — must be on your `PATH`
- **ffmpeg** — must be on your `PATH`
- A **Spotify Developer** app (free) — see setup below

### Install yt-dlp + ffmpeg

**macOS (Homebrew):**
```bash
brew install yt-dlp ffmpeg
```

**Linux (apt):**
```bash
sudo apt install ffmpeg
pip install yt-dlp
```

**Windows:**
Download yt-dlp from https://github.com/yt-dlp/yt-dlp/releases and ffmpeg from
https://ffmpeg.org/download.html, and add both to your `PATH`.

The app checks for these at startup and shows the status in the top bar.

---

## Setup

### 1. Clone and install

```bash
git clone <this repo>
cd MrSynker
npm install
```

### 2. Create a Spotify Developer app

1. Go to https://developer.spotify.com/dashboard
2. Click **Create app**
3. Name and description: whatever you like
4. **Redirect URI:** add `http://127.0.0.1:8888/callback`
5. Save and copy the **Client ID** from the app page

### 3. Configure MrSynker

Either:

- Run `npm start`, click the **⚙ Settings** button, paste your Client ID and
  save — this writes a `.env` file in the project root for you.

Or manually:

```bash
cp .env.example .env
# then edit .env
```

```env
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

> The Client Secret is **optional** because MrSynker uses PKCE.

### 4. Run it

```bash
npm start
```

Click **Log in to Spotify**, pick a library folder (or use the default
`~/Music/MrSynker`), select a playlist, and hit **Start sync**.

---

## How libraries work

Each library is a folder on disk. Inside it, MrSynker writes:

```
<library-folder>/
├── Artist - Track.mp3
├── Artist - Track.mp3
├── ...
└── synk.data           # JSON sync state
```

`synk.data` records every playlist you've synced into this folder, plus
which Spotify track IDs are mapped to which files. Move the folder to
another machine and the state moves with it.

Use **Update all** to re-sync every tracked playlist in the current library —
ideal for "plug in the Walkman, click one button, walk away."

---

## Project structure

```
MrSynker/
├── main.js              # Electron main process + IPC handlers
├── preload.js           # contextBridge → window.api
├── index.html           # Single-page UI
├── renderer/
│   ├── app.js
│   └── styles.css
├── src/
│   ├── config.js        # .env + user settings + library list
│   ├── deps-check.js    # Verifies yt-dlp + ffmpeg
│   ├── spotify/
│   │   ├── auth.js      # PKCE OAuth in a BrowserWindow
│   │   └── api.js       # Playlists, tracks, Liked Songs
│   ├── sync/
│   │   ├── state.js     # Reads/writes <library>/synk.data
│   │   ├── diff.js      # Computes added/existing/removed
│   │   └── runner.js    # Worker pool, cancellation, orchestration
│   └── download/
│       ├── match.js     # ISRC-first YouTube search + scoring
│       ├── ytdlp.js     # yt-dlp subprocess wrapper
│       └── tag.js       # node-id3 + cover art
├── logo/
└── package.json
```

---

## Known limitations

- Match quality depends entirely on what's on YouTube. Obscure tracks may
  not match well; very common songs sometimes pick a remix or cover —
  inspect with the **Preview** button first if it matters.
- No `.opus` / `.flac` / `.aac` output — MP3 only (Walkman-friendly).
- No app packaging yet (`electron-builder` / `electron-forge`). Runs via
  `npm start` from source.
- macOS-tested. Should work on Linux and Windows but icons/dock behavior
  may need tweaks.

---

## License

ISC. See `package.json`.

Built with caffeine and the assumption that nobody important will read it.
