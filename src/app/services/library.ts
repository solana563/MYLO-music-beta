import { db, Track, Playlist, QueueState } from '../db/database';

export async function getAllTracks(): Promise<Track[]> {
  return db.tracks.orderBy('artist').toArray();
}

export async function searchTracks(query: string): Promise<Track[]> {
  if (!query.trim()) return getAllTracks();
  const q = query.toLowerCase();
  // Dexie has no full-text index; for 50k rows a single in-memory filter pass
  // is still sub-50ms, which is well within "feels instant".
  const all = await db.tracks.toArray();
  return all.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.album.toLowerCase().includes(q) ||
    t.genre.toLowerCase().includes(q)
  );
}

export async function toggleLike(id: string): Promise<boolean> {
  const track = await db.tracks.get(id);
  if (!track) return false;
  const liked: 0 | 1 = track.liked ? 0 : 1;
  await db.tracks.update(id, { liked });
  return liked === 1;
}

export async function recordPlay(id: string) {
  const track = await db.tracks.get(id);
  if (!track) return;
  await db.tracks.update(id, { playCount: track.playCount + 1, lastPlayed: Date.now() });
}

export async function getFavorites(): Promise<Track[]> {
  return db.tracks.where('liked').equals(1).toArray();
}

export async function getRecentlyPlayed(limit = 50): Promise<Track[]> {
  return db.tracks.where('lastPlayed').above(0).reverse().sortBy('lastPlayed').then(r => r.slice(0, limit));
}

export async function getMostPlayed(limit = 50): Promise<Track[]> {
  const all = await db.tracks.toArray();
  return all.filter(t => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, limit);
}

export interface AlbumGroup { album: string; albumArtist: string; tracks: Track[]; year: number; }
export async function getAlbums(): Promise<AlbumGroup[]> {
  const all = await db.tracks.toArray();
  const map = new Map<string, AlbumGroup>();
  for (const t of all) {
    const key = `${t.albumArtist}::${t.album}`;
    if (!map.has(key)) map.set(key, { album: t.album, albumArtist: t.albumArtist, tracks: [], year: t.year });
    map.get(key)!.tracks.push(t);
  }
  for (const g of map.values()) g.tracks.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
  return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
}

export interface ArtistGroup { artist: string; tracks: Track[]; }
export async function getArtists(): Promise<ArtistGroup[]> {
  const all = await db.tracks.toArray();
  const map = new Map<string, Track[]>();
  for (const t of all) {
    if (!map.has(t.artist)) map.set(t.artist, []);
    map.get(t.artist)!.push(t);
  }
  return [...map.entries()].map(([artist, tracks]) => ({ artist, tracks })).sort((a, b) => a.artist.localeCompare(b.artist));
}

export async function getGenres(): Promise<{ genre: string; tracks: Track[] }[]> {
  const all = await db.tracks.toArray();
  const map = new Map<string, Track[]>();
  for (const t of all) {
    if (!map.has(t.genre)) map.set(t.genre, []);
    map.get(t.genre)!.push(t);
  }
  return [...map.entries()].map(([genre, tracks]) => ({ genre, tracks })).sort((a, b) => a.genre.localeCompare(b.genre));
}

// ---- Playlists ----

export async function createPlaylist(name: string): Promise<number> {
  const now = Date.now();
  return db.playlists.add({ name, trackIds: [], createdAt: now, updatedAt: now }) as unknown as number;
}

export async function renamePlaylist(id: number, name: string) {
  await db.playlists.update(id, { name, updatedAt: Date.now() });
}

export async function deletePlaylist(id: number) {
  await db.playlists.delete(id);
}

export async function addToPlaylist(playlistId: number, trackId: string) {
  const pl = await db.playlists.get(playlistId);
  if (!pl || pl.trackIds.includes(trackId)) return;
  await db.playlists.update(playlistId, { trackIds: [...pl.trackIds, trackId], updatedAt: Date.now() });
}

export async function removeFromPlaylist(playlistId: number, trackId: string) {
  const pl = await db.playlists.get(playlistId);
  if (!pl) return;
  await db.playlists.update(playlistId, { trackIds: pl.trackIds.filter(id => id !== trackId), updatedAt: Date.now() });
}

export async function reorderPlaylist(playlistId: number, trackIds: string[]) {
  await db.playlists.update(playlistId, { trackIds, updatedAt: Date.now() });
}

export async function getPlaylists(): Promise<Playlist[]> {
  return db.playlists.orderBy('updatedAt').reverse().toArray();
}

export function exportM3U(name: string, tracks: Track[]): string {
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration)},${t.artist} - ${t.title}`);
    lines.push(t.fileName);
  }
  return lines.join('\n');
}

// Returns titles/artists parsed from M3U lines; caller matches against the
// library by title+artist since M3U paths rarely resolve across machines.
export function parseM3U(content: string): { title: string; artist: string }[] {
  const lines = content.split('\n').map(l => l.trim());
  const result: { title: string; artist: string }[] = [];
  for (const line of lines) {
    if (!line.startsWith('#EXTINF:')) continue;
    const meta = line.slice(line.indexOf(',') + 1);
    const [artist, ...rest] = meta.split(' - ');
    result.push({ artist: artist?.trim() || 'Unknown Artist', title: rest.join(' - ').trim() || meta.trim() });
  }
  return result;
}

// ---- Queue persistence ----

export async function saveQueueState(state: Omit<QueueState, 'id'>) {
  await db.queue.put({ id: 'queue', ...state });
}

export async function loadQueueState(): Promise<QueueState | null> {
  return (await db.queue.get('queue')) ?? null;
}
