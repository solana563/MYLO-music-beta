import Dexie, { Table } from 'dexie';

export interface Track {
  id: string;           // hash of file content
  fileKey: string;      // opaque key to re-open via stored handle
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: number;
  trackNumber: number;
  discNumber: number;
  duration: number;     // seconds
  fileName: string;
  fileSize: number;
  mimeType: string;
  artworkKey?: string;  // IDB key for artwork blob
  dateAdded: number;    // epoch ms
  lastPlayed: number;
  playCount: number;
  liked: 0 | 1;          // IndexedDB key ranges don't support booleans, so this is indexed as a number
}

export interface Playlist {
  id?: number;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface QueueState {
  id: 'queue';
  trackIds: string[];
  currentIndex: number;
  position: number;     // seconds
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  shuffledOrder: string[];
}

export interface Artwork {
  id?: number;
  trackId: string;
  data: Blob;
}

export interface Prefs {
  id: 'prefs';
  volume: number;
  theme: 'dark' | 'light';
  accentColor: string;
  crossfade: number;    // 0 = off, 1-12s
}

class DB extends Dexie {
  tracks!: Table<Track>;
  playlists!: Table<Playlist>;
  queue!: Table<QueueState>;
  artwork!: Table<Artwork>;
  prefs!: Table<Prefs>;

  constructor() {
    super('MYLOv2');
    this.version(1).stores({
      tracks: 'id, artist, album, genre, liked, dateAdded, lastPlayed, playCount',
      playlists: '++id, name',
      queue: 'id',
      artwork: '++id, trackId',
      prefs: 'id',
    });
  }
}

export const db = new DB();

export async function getPrefs(): Promise<Prefs> {
  const p = await db.prefs.get('prefs');
  if (p) return p;
  const defaults: Prefs = { id: 'prefs', volume: 0.75, theme: 'dark', accentColor: '#1db954', crossfade: 0 };
  await db.prefs.put(defaults);
  return defaults;
}

export async function savePrefs(patch: Partial<Prefs>) {
  const p = await getPrefs();
  await db.prefs.put({ ...p, ...patch });
}

export async function getArtwork(trackId: string): Promise<string | null> {
  const row = await db.artwork.where('trackId').equals(trackId).first();
  if (!row) return null;
  return URL.createObjectURL(row.data);
}

export async function saveArtwork(trackId: string, blob: Blob) {
  await db.artwork.where('trackId').equals(trackId).delete();
  await db.artwork.add({ trackId, data: blob });
}
