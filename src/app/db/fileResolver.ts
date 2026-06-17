// Maps a track's fingerprint id back to a live File for playback.
// Folder-based tracks are re-resolved by walking stored directory handles
// (cheap: walks are lazy generators, we stop at the first match).
// Files added via raw <input type=file> are kept in this session-only map.

import { walkDirectory, getStoredFolders, requestPermission, fingerprint } from './fileSystemManager';

const sessionFiles = new Map<string, File>();
const resolvedCache = new Map<string, File>();

export function registerSessionFile(id: string, file: File) {
  sessionFiles.set(id, file);
}

export async function resolveFile(id: string): Promise<File | null> {
  if (sessionFiles.has(id)) return sessionFiles.get(id)!;
  if (resolvedCache.has(id)) return resolvedCache.get(id)!;

  const folders = await getStoredFolders();
  for (const { handle } of folders) {
    const ok = await requestPermission(handle);
    if (!ok) continue;
    for await (const scanned of walkDirectory(handle)) {
      // recompute the same fingerprint used during scanning to find a match
      const candidateId = await fingerprint(scanned.file);
      if (candidateId === id) {
        resolvedCache.set(id, scanned.file);
        return scanned.file;
      }
    }
  }
  return null;
}
