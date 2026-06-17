# MYLO Music — Offline Local Music Player

<div align="center">

![MYLO Music Player](./src/imports/102856936.jpg)

A production, offline-first music player for the browser. No streaming, no cloud, no
mock data — every feature in this repo is backed by real playback, real file scanning,
and a real persistent database.

## What's real here

- **Playback** via native `HTMLAudioElement` (two elements internally, for gapless
  transitions and crossfade) — play/pause/seek/shuffle/repeat-one/repeat-all/queue.
- **Library scanning** via the File System Access API (`showDirectoryPicker`),
  recursively walking folders for `.mp3 .flac .m4a .aac .wav .ogg .opus`, with a
  `<input type="file" webkitdirectory>` fallback for browsers without that API.
- **Metadata extraction** via `music-metadata-browser` (title/artist/album/album
  artist/genre/year/track/disc/duration/embedded artwork), falling back to filename
  parsing (`Artist - Title.mp3`) when tags are missing or unreadable.
- **Persistence** via Dexie (IndexedDB): tracks, playlists, queue state, artwork blobs,
  and preferences all survive a refresh or relaunch. Directory handles are also
  persisted so you don't have to re-pick your music folder every time.
- **Incremental rescanning**: each file gets a content fingerprint (SHA-256 of size +
  head/tail bytes); rescanning a folder only touches new or removed files.
- **Search** is an in-memory filter across title/artist/album/genre — sub-50ms even at
  tens of thousands of tracks.
- **MediaSession API** wiring for lock-screen and OS notification controls
  (play/pause/next/previous/seek).
- **Playlists**: create/rename/delete/reorder, M3U export, and M3U import (matched
  against your library by title+artist, since M3U paths rarely resolve cross-machine).
- **Favorites, recently played, most played, queue persistence** — all backed by the
  same database, no separate mock state.

## Project structure

```
src/app/
├── components/
│   └── MusicPlayer.tsx       # the entire UI: nav, views, transport bar, queue panel
├── db/
│   ├── database.ts           # Dexie schema: tracks, playlists, queue, artwork, prefs
│   ├── fileSystemManager.ts  # folder picking, persisted directory handles, recursive walk, fingerprinting
│   └── fileResolver.ts       # maps a track id back to a live File for playback
├── services/
│   ├── libraryScanner.ts     # real metadata extraction + incremental scan/diff
│   ├── library.ts            # search, favorites, albums/artists/genres grouping, playlist CRUD, M3U
│   └── playerEngine.ts       # the playback engine itself (queue, shuffle, repeat, crossfade, MediaSession)
└── hooks/
    ├── usePlayer.ts          # React bridge to playerEngine + auto-persist + play-count recording
    └── useArtwork.ts         # cached artwork loading with placeholder fallback
```

Everything else under `src/app/components/ui/` is the existing shadcn/ui component
library, unchanged from the original scaffold.

## What was removed

The original repo had a UI-only prototype layered over several stub/demo subsystems:
a fake `audioEngine.ts` that imported a Node-only npm package (broken in a browser), a
`libraryScanner.ts` full of `console.log` placeholders, and an entire unused
device-detection/offline-sync cluster that nothing in the app actually imported. All
of that has been deleted rather than left to bit-rot — see git history for specifics.

## Getting started

```bash
npm install
npm run dev
```

Open the app, click **Add Music Folder**, and pick a directory of audio files. On
first run your browser will prompt for folder access; that permission is remembered
across reloads (re-granted automatically where the browser allows, or re-prompted
once per session otherwise).

### Browser support

The File System Access API (used for folder scanning and persisted folder handles) is
supported in Chromium-based browsers (Chrome, Edge, Opera, Arc). Firefox and Safari
fall back automatically to a standard file/folder input — scanning still works, but
the browser won't remember the folder handle between sessions, so you'll re-select
files after a refresh.

## Known gaps

This is a real, working player, not a finished product. Not yet implemented: a
Settings panel (theme/accent color/cache management — the data layer for prefs already
exists in `database.ts`, just no UI yet), equalizer, ReplayGain, sleep timer, `.lrc`
lyrics sync, smart playlists, and automated tests. See the project's open issues /
your own notes for the current priority order.

## License

MIT — see [LICENSE](./LICENSE).
