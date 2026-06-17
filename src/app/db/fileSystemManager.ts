// Persists FileSystemDirectoryHandles in IndexedDB (handles are structured-clonable)
// so the user only picks a folder once, and we can re-verify permission on relaunch.

import Dexie, { Table } from 'dexie';

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus'];

interface StoredHandle {
  id?: number;
  handle: FileSystemDirectoryHandle;
  name: string;
}

class HandleDB extends Dexie {
  handles!: Table<StoredHandle>;
  constructor() {
    super('MYLOHandles');
    this.version(1).stores({ handles: '++id, name' });
  }
}
const handleDb = new HandleDB();

export function isFileSystemAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
    await handleDb.handles.put({ handle, name: handle.name });
    return handle;
  } catch (err) {
    // user cancelled the picker
    return null;
  }
}

export async function getStoredFolders(): Promise<{ id: number; handle: FileSystemDirectoryHandle; name: string }[]> {
  const rows = await handleDb.handles.toArray();
  const verified: { id: number; handle: FileSystemDirectoryHandle; name: string }[] = [];
  for (const row of rows) {
    if (row.id === undefined) continue;
    try {
      // touching queryPermission confirms the handle is still valid; actual
      // permission re-prompting happens lazily via requestPermission() at use time
      await (row.handle as any).queryPermission({ mode: 'read' });
      verified.push({ id: row.id, handle: row.handle, name: row.name });
    } catch {
      // handle no longer valid (folder moved/deleted) — drop it
      await handleDb.handles.delete(row.id);
    }
  }
  return verified;
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const perm = await (handle as any).queryPermission({ mode: 'read' });
    if (perm === 'granted') return true;
    const req = await (handle as any).requestPermission({ mode: 'read' });
    return req === 'granted';
  } catch {
    return false;
  }
}

export async function removeFolder(id: number) {
  await handleDb.handles.delete(id);
}

export interface ScannedFile {
  file: File;
  handle: FileSystemFileHandle;
  path: string; // relative path within the watched folder, for folder-view grouping
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Recursively walks a directory handle, yielding every audio file found.
export async function* walkDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath = ''
): AsyncGenerator<ScannedFile> {
  for await (const [name, entry] of (dirHandle as any).entries()) {
    const path = basePath ? `${basePath}/${name}` : name;
    if (entry.kind === 'directory') {
      yield* walkDirectory(entry as FileSystemDirectoryHandle, path);
    } else if (entry.kind === 'file' && isAudioFile(name)) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      yield { file, handle: fileHandle, path };
    }
  }
}

// Cheap content fingerprint: size + first/last bytes, fast enough for 50k+ files
// and avoids reading whole files just to detect changes.
export async function fingerprint(file: File): Promise<string> {
  const head = await file.slice(0, 4096).arrayBuffer();
  const tail = file.size > 4096 ? await file.slice(-4096).arrayBuffer() : new ArrayBuffer(0);
  const bytes = new Uint8Array(head.byteLength + tail.byteLength + 8);
  bytes.set(new Uint8Array(head), 0);
  bytes.set(new Uint8Array(tail), head.byteLength);
  const sizeView = new DataView(bytes.buffer, bytes.length - 8, 8);
  sizeView.setBigUint64(0, BigInt(file.size));
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
