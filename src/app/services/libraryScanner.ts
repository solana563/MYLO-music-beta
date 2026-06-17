import { parseBlob } from 'music-metadata-browser';
import { db, Track, saveArtwork } from '../db/database';
import { walkDirectory, ScannedFile, fingerprint } from '../db/fileSystemManager';
import { registerSessionFile } from '../db/fileResolver';

export interface ScanProgress {
  scanned: number;
  total: number;
  currentFile: string;
}

export interface ScanResult {
  added: number;
  removed: number;
  unchanged: number;
}

function parseFilenameFallback(fileName: string): { title: string; artist: string } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Unknown Artist', title: base.trim() };
}

async function extractTrack(scanned: ScannedFile): Promise<{ track: Track; artwork: Blob | null }> {
  const { file } = scanned;
  const id = await fingerprint(file);
  const fallback = parseFilenameFallback(file.name);

  let common: any = {};
  let format: any = {};
  let artwork: Blob | null = null;

  try {
    const meta = await parseBlob(file, { duration: true });
    common = meta.common || {};
    format = meta.format || {};
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      artwork = new Blob([pic.data], { type: pic.format });
    }
  } catch {
    // unreadable tags — fall back to filename parsing below
  }

  const track: Track = {
    id,
    fileKey: id,
    title: common.title || fallback.title,
    artist: common.artist || fallback.artist,
    album: common.album || 'Unknown Album',
    albumArtist: common.albumartist || common.artist || fallback.artist,
    genre: (common.genre && common.genre[0]) || 'Unknown',
    year: common.year || 0,
    trackNumber: common.track?.no || 0,
    discNumber: common.disk?.no || 1,
    duration: format.duration || 0,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'audio/mpeg',
    dateAdded: Date.now(),
    lastPlayed: 0,
    playCount: 0,
    liked: 0,
  };

  return { track, artwork };
}

export async function scanFolder(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  const existingIds = new Set(await db.tracks.toArray().then(ts => ts.map(t => t.id)));
  const seenIds = new Set<string>();
  let added = 0;
  let unchanged = 0;
  let scanned = 0;

  for await (const scannedFile of walkDirectory(dirHandle)) {
    scanned++;
    onProgress?.({ scanned, total: 0, currentFile: scannedFile.file.name });

    const { track, artwork } = await extractTrack(scannedFile);
    seenIds.add(track.id);

    if (existingIds.has(track.id)) {
      unchanged++;
      continue;
    }

    await db.tracks.put(track);
    if (artwork) await saveArtwork(track.id, artwork);
    added++;
  }

  // anything previously known but not seen in this walk was deleted/moved
  const toRemove = [...existingIds].filter(id => !seenIds.has(id));
  if (toRemove.length > 0) {
    await db.tracks.bulkDelete(toRemove);
    await db.artwork.where('trackId').anyOf(toRemove).delete();
  }

  return { added, removed: toRemove.length, unchanged };
}

export async function scanFiles(
  files: File[],
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  let added = 0;
  let unchanged = 0;
  let scanned = 0;
  const existingIds = new Set(await db.tracks.toArray().then(ts => ts.map(t => t.id)));

  for (const file of files) {
    scanned++;
    onProgress?.({ scanned, total: files.length, currentFile: file.name });

    const { track, artwork } = await extractTrack({ file, handle: null as any, path: file.name });
    registerSessionFile(track.id, file);
    if (existingIds.has(track.id)) {
      unchanged++;
      continue;
    }
    await db.tracks.put(track);
    if (artwork) await saveArtwork(track.id, artwork);
    added++;
  }

  return { added, removed: 0, unchanged };
}
