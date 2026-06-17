import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Home, Search, ListMusic, Heart, Plus, Play, Pause,
  Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Volume2, VolumeX,
  MoreHorizontal, FolderOpen, Music, Disc3, Mic2, Clock, TrendingUp,
  X, FolderPlus, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "./ui/sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal,
} from "./ui/dropdown-menu";
import { getPrefs, savePrefs, Track } from "../db/database";
import {
  getAllTracks, searchTracks, toggleLike, getFavorites, getRecentlyPlayed,
  getMostPlayed, getAlbums, getArtists, getGenres, getPlaylists,
  createPlaylist, deletePlaylist, addToPlaylist, exportM3U, parseM3U, AlbumGroup, ArtistGroup,
} from "../services/library";
import { scanFolder, scanFiles, ScanProgress } from "../services/libraryScanner";
import {
  isFileSystemAccessSupported, pickFolder, getStoredFolders, requestPermission,
} from "../db/fileSystemManager";
import { usePlayer, restoreQueueFromLastSession } from "../hooks/usePlayer";
import { useArtwork } from "../hooks/useArtwork";

function formatTime(secs: number) {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type View = "home" | "songs" | "albums" | "artists" | "genres" | "folders" | "playlists" | "favorites" | "recent" | "most-played" | "search";

function TrackArtwork({ trackId, className, style }: { trackId?: string; className?: string; style?: React.CSSProperties }) {
  const url = useArtwork(trackId);
  return <img src={url} alt="" className={className} style={style} />;
}

export function MusicPlayer() {
  const player = usePlayer();
  const [view, setView] = useState<View>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);
  const [mostPlayed, setMostPlayed] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [artists, setArtists] = useState<ArtistGroup[]>([]);
  const [genres, setGenres] = useState<{ genre: string; tracks: Track[] }[]>([]);
  const [playlists, setPlaylists] = useState<Awaited<ReturnType<typeof getPlaylists>>>([]);
  const [folders, setFolders] = useState<{ id: number; handle: FileSystemDirectoryHandle; name: string }[]>([]);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [ready, setReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const m3uInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const tracks = await getAllTracks();
    setAllTracks(tracks);
    setLiked(new Set(tracks.filter(t => t.liked).map(t => t.id)));
    setFavorites(tracks.filter(t => t.liked));
    setRecent(await getRecentlyPlayed());
    setMostPlayed(await getMostPlayed());
    setAlbums(await getAlbums());
    setArtists(await getArtists());
    setGenres(await getGenres());
    setPlaylists(await getPlaylists());
    setFolders(await getStoredFolders());
  }, []);

  useEffect(() => {
    (async () => {
      const prefs = await getPrefs();
      player.setVolume(prefs.volume);
      player.setCrossfade(prefs.crossfade);
      await reload();
      const tracks = await getAllTracks();
      if (tracks.length > 0) await restoreQueueFromLastSession(tracks);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const id = setTimeout(async () => {
      setSearchResults(await searchTracks(searchQuery));
    }, 80); // small debounce so 50k-track libraries don't filter on every keystroke
    return () => clearTimeout(id);
  }, [searchQuery]);

  const playTrackInContext = useCallback((track: Track, context: Track[]) => {
    const idx = context.findIndex(t => t.id === track.id);
    player.setQueue(context, idx === -1 ? 0 : idx);
  }, [player]);

  const handleToggleLike = useCallback(async (id: string) => {
    const isLiked = await toggleLike(id);
    setLiked(prev => {
      const next = new Set(prev);
      isLiked ? next.add(id) : next.delete(id);
      return next;
    });
    setFavorites(await getFavorites());
  }, []);

  const runScan = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setScanning({ scanned: 0, total: 0, currentFile: "" });
    try {
      const result = await scanFolder(handle, (p) => setScanning(p));
      toast.success(`Scan complete: ${result.added} added, ${result.removed} removed, ${result.unchanged} unchanged`);
      await reload();
    } catch (err) {
      toast.error("Scan failed: " + (err as Error).message);
    } finally {
      setScanning(null);
    }
  }, [reload]);

  const handleAddFolder = useCallback(async () => {
    if (isFileSystemAccessSupported()) {
      const handle = await pickFolder();
      if (handle) await runScan(handle);
    } else {
      fileInputRef.current?.click();
    }
  }, [runScan]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setScanning({ scanned: 0, total: files.length, currentFile: "" });
    try {
      const result = await scanFiles(files, (p) => setScanning(p));
      toast.success(`Added ${result.added} tracks`);
      await reload();
    } finally {
      setScanning(null);
      e.target.value = "";
    }
  }, [reload]);

  const handleRescanFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const ok = await requestPermission(handle);
    if (!ok) { toast.error("Permission denied for this folder"); return; }
    await runScan(handle);
  }, [runScan]);

  const handleImportM3U = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await file.text();
    const entries = parseM3U(content);
    if (entries.length === 0) { toast.error("No tracks found in that M3U file"); return; }

    // M3U file paths rarely resolve across machines, so match by title+artist instead
    const lowerTracks = allTracks.map(t => ({ t, title: t.title.toLowerCase(), artist: t.artist.toLowerCase() }));
    const matched: typeof allTracks = [];
    for (const entry of entries) {
      const found = lowerTracks.find(lt => lt.title === entry.title.toLowerCase() && lt.artist === entry.artist.toLowerCase())
        ?? lowerTracks.find(lt => lt.title === entry.title.toLowerCase());
      if (found) matched.push(found.t);
    }

    const name = file.name.replace(/\.m3u8?$/i, "") || "Imported Playlist";
    const id = await createPlaylist(name);
    for (const t of matched) await addToPlaylist(id, t.id);
    setPlaylists(await getPlaylists());
    toast.success(`Imported "${name}": matched ${matched.length} of ${entries.length} tracks`);
  }, [allTracks]);

  const handleVolumeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.setVolume(ratio);
    player.setMuted(ratio === 0);
    savePrefs({ volume: ratio });
  }, [player]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!player.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    player.seek(ratio * player.duration);
  }, [player]);

  const progressPct = player.duration > 0 ? (player.position / player.duration) * 100 : 0;
  const volumePct = player.muted ? 0 : player.volume * 100;

  const currentList = useMemo(() => {
    if (view === "search") return searchResults;
    if (view === "favorites") return favorites;
    if (view === "recent") return recent;
    if (view === "most-played") return mostPlayed;
    return allTracks;
  }, [view, searchResults, favorites, recent, mostPlayed, allTracks]);

  const repeatIcon = player.repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />;

  return (
    <div className="flex flex-col h-screen" style={{ background: "#0d0d0d", color: "#fff", fontFamily: "Inter, system-ui, sans-serif" }}>
      <Toaster theme="dark" position="top-center" />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.m4a,.aac,.wav,.ogg,.opus"
        multiple
        // @ts-ignore - webkitdirectory enables folder selection where File System Access API is unavailable
        webkitdirectory=""
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <input
        ref={m3uInputRef}
        type="file"
        accept=".m3u,.m3u8,audio/x-mpegurl"
        style={{ display: "none" }}
        onChange={handleImportM3U}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="flex flex-col w-56 shrink-0 overflow-y-auto" style={{ background: "#111111" }}>
          <div className="flex items-center gap-2 px-5 py-5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#1db954" }}>
              <Disc3 size={14} color="#000" />
            </div>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>MYLO Music</span>
          </div>

          <nav className="px-3 space-y-0.5">
            {[
              { id: "home" as View, label: "Home", icon: Home },
              { id: "songs" as View, label: "Songs", icon: Music },
              { id: "albums" as View, label: "Albums", icon: Disc3 },
              { id: "artists" as View, label: "Artists", icon: Mic2 },
              { id: "genres" as View, label: "Genres", icon: ListMusic },
              { id: "folders" as View, label: "Folders", icon: FolderOpen },
              { id: "favorites" as View, label: "Favorites", icon: Heart },
              { id: "recent" as View, label: "Recently Played", icon: Clock },
              { id: "most-played" as View, label: "Most Played", icon: TrendingUp },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors"
                style={{
                  background: view === id ? "rgba(255,255,255,0.08)" : "transparent",
                  color: view === id ? "#fff" : "#a0a0a0",
                  fontSize: "13px",
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-5 px-3">
            <div className="flex items-center justify-between px-3 mb-2">
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#6b6b6b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Playlists
              </span>
            </div>
            <div className="space-y-0.5">
              {playlists.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => setView("playlists")}
                  className="flex items-center gap-2.5 w-full px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-md bg-violet-600 shrink-0 flex items-center justify-center">
                    <ListMusic size={14} color="#fff" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate" style={{ fontSize: "12px", color: "#ddd" }}>{pl.name}</div>
                    <div style={{ fontSize: "10px", color: "#666" }}>{pl.trackIds.length} songs</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto px-4 pb-4 space-y-2">
            <button
              onClick={async () => {
                const name = prompt("Playlist name");
                if (name) { await createPlaylist(name); setPlaylists(await getPlaylists()); }
              }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border transition-colors hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.12)", fontSize: "12px", color: "#aaa" }}
            >
              <Plus size={14} />
              New playlist
            </button>
            <button
              onClick={handleAddFolder}
              disabled={!!scanning}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ background: "#1db954", fontSize: "12px", color: "#000", fontWeight: 500 }}
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
              {scanning ? `Scanning… ${scanning.scanned}` : "Add Music Folder"}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto" style={{ background: "#111111" }}>
          <div className="sticky top-0 z-10 px-6 py-3 flex items-center gap-3" style={{ background: "rgba(17,17,17,0.9)", backdropFilter: "blur(8px)" }}>
            <div className="flex items-center gap-2 flex-1 rounded-full px-4 py-2" style={{ background: "#1e1e1e", maxWidth: 380 }}>
              <Search size={14} style={{ color: "#666" }} />
              <input
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setView("search"); }}
                placeholder="Search for artists, songs or albums"
                className="flex-1 bg-transparent outline-none"
                style={{ fontSize: "12px", color: "#ccc" }}
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setView("home"); }}>
                  <X size={13} style={{ color: "#666" }} />
                </button>
              )}
            </div>
          </div>

          <div className="px-6 pb-6">
            {!ready ? (
              <div className="flex items-center justify-center py-24" style={{ color: "#666" }}>
                <Loader2 size={20} className="animate-spin mr-2" /> Loading library…
              </div>
            ) : allTracks.length === 0 ? (
              <EmptyLibrary onAddFolder={handleAddFolder} scanning={!!scanning} />
            ) : view === "home" ? (
              <HomeView
                current={player.current}
                isPlaying={player.isPlaying}
                onTogglePlay={player.toggle}
                albums={albums}
                onPlayAlbum={(album) => playTrackInContext(album.tracks[0], album.tracks)}
              />
            ) : view === "albums" ? (
              <AlbumsView albums={albums} onPlayAlbum={(a) => playTrackInContext(a.tracks[0], a.tracks)} />
            ) : view === "artists" ? (
              <ArtistsView artists={artists} onPlayArtist={(a) => playTrackInContext(a.tracks[0], a.tracks)} />
            ) : view === "genres" ? (
              <GenresView genres={genres} onPlayGenre={(g) => playTrackInContext(g.tracks[0], g.tracks)} />
            ) : view === "folders" ? (
              <FoldersView folders={folders} onAddFolder={handleAddFolder} onRescan={handleRescanFolder} scanning={!!scanning} />
            ) : view === "playlists" ? (
              <PlaylistsView
                playlists={playlists}
                allTracks={allTracks}
                onPlayPlaylist={(tracks) => tracks.length > 0 && playTrackInContext(tracks[0], tracks)}
                onDelete={async (id) => { await deletePlaylist(id); setPlaylists(await getPlaylists()); }}
                onImport={() => m3uInputRef.current?.click()}
                onExport={(name, tracks) => {
                  const blob = new Blob([exportM3U(name, tracks)], { type: "audio/x-mpegurl" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${name}.m3u`;
                  a.click();
                }}
              />
            ) : (
              <TrackListView
                tracks={currentList}
                current={player.current}
                isPlaying={player.isPlaying}
                liked={liked}
                playlists={playlists}
                onPlay={(t) => playTrackInContext(t, currentList)}
                onToggleLike={handleToggleLike}
                onAddToQueueNext={(t) => player.addToQueueNext(t)}
                onAddToQueueEnd={(t) => { player.addToQueueEnd(t); toast.success(`Added "${t.title}" to queue`); }}
                onAddToPlaylist={async (trackId, playlistId) => {
                  await addToPlaylist(playlistId, trackId);
                  setPlaylists(await getPlaylists());
                  toast.success("Added to playlist");
                }}
                title={view === "songs" ? "All Songs" : view === "favorites" ? "Favorites" : view === "recent" ? "Recently Played" : view === "most-played" ? "Most Played" : "Search Results"}
              />
            )}
          </div>
        </main>

        {/* Right Panel: queue */}
        <aside className="flex flex-col w-64 shrink-0 overflow-y-auto" style={{ background: "#161616" }}>
          <div className="p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Liked Songs</h3>
              <MoreHorizontal size={14} style={{ color: "#666" }} />
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {favorites.slice(0, 4).map(song => (
                <TrackArtwork key={song.id} trackId={song.id} className="w-full aspect-square object-cover rounded-lg" />
              ))}
            </div>
            <div style={{ fontSize: "10px", color: "#666" }}>{favorites.length} liked songs</div>
          </div>

          <div className="flex-1 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Up Next</h3>
              <MoreHorizontal size={14} style={{ color: "#666" }} />
            </div>
            <div className="space-y-1">
              {player.queue.length === 0 ? (
                <div style={{ fontSize: "11px", color: "#555" }}>Queue is empty — play something to get started.</div>
              ) : (
                player.queue.map((song, i) => (
                  <button
                    key={`${song.id}-${i}`}
                    onClick={() => player.setQueue(player.queue, i)}
                    className="flex items-center gap-2.5 w-full px-2 py-2 rounded-lg transition-colors hover:bg-white/5 text-left"
                    style={{ background: i === player.queueIndex ? "rgba(255,255,255,0.08)" : "transparent" }}
                  >
                    <div className="relative shrink-0">
                      <TrackArtwork trackId={song.id} className="w-9 h-9 object-cover rounded-lg" />
                      {i === player.queueIndex && player.isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: "rgba(0,0,0,0.5)" }}>
                          <Pause size={10} color="#fff" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ fontSize: "11px", fontWeight: 500, color: i === player.queueIndex ? "#1db954" : "#ddd" }}>
                        {song.title}
                      </div>
                      <div className="truncate" style={{ fontSize: "10px", color: "#666" }}>{song.artist}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleToggleLike(song.id); }} className="shrink-0">
                      <Heart size={12} style={{ color: liked.has(song.id) ? "#1db954" : "#555" }} fill={liked.has(song.id) ? "#1db954" : "none"} />
                    </button>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Player Bar */}
      <div className="shrink-0 flex items-center gap-4 px-6 py-3 border-t" style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.06)", minHeight: 72 }}>
        <div className="flex items-center gap-3 w-48 shrink-0">
          {player.current ? (
            <>
              <TrackArtwork trackId={player.current.id} className="w-12 h-12 object-cover rounded-lg" />
              <div className="min-w-0">
                <div className="truncate" style={{ fontSize: "12px", fontWeight: 500, color: "#fff" }}>{player.current.title}</div>
                <div className="truncate" style={{ fontSize: "10px", color: "#888" }}>{player.current.artist}</div>
              </div>
              <button onClick={() => handleToggleLike(player.current!.id)} className="shrink-0">
                <Heart size={14} style={{ color: liked.has(player.current.id) ? "#1db954" : "#555" }} fill={liked.has(player.current.id) ? "#1db954" : "none"} />
              </button>
            </>
          ) : (
            <div style={{ fontSize: "11px", color: "#555" }}>Nothing playing</div>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-5">
            <button onClick={() => player.setShuffle(!player.shuffle)} className="transition-colors">
              <Shuffle size={15} style={{ color: player.shuffle ? "#1db954" : "#666" }} />
            </button>
            <button onClick={player.prev} className="transition-colors hover:text-white" style={{ color: "#aaa" }}>
              <SkipBack size={18} />
            </button>
            <button
              onClick={player.toggle}
              disabled={!player.current}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-40"
              style={{ background: "#fff" }}
            >
              {player.buffering ? <Loader2 size={16} color="#000" className="animate-spin" /> : player.isPlaying ? <Pause size={16} color="#000" /> : <Play size={16} color="#000" />}
            </button>
            <button onClick={player.next} className="transition-colors hover:text-white" style={{ color: "#aaa" }}>
              <SkipForward size={18} />
            </button>
            <button
              onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")}
              className="transition-colors"
            >
              <span style={{ color: player.repeat !== "off" ? "#1db954" : "#666" }}>{repeatIcon}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 w-full max-w-md">
            <span style={{ fontSize: "10px", color: "#666", minWidth: 32, textAlign: "right" }}>{formatTime(player.position)}</span>
            <div className="flex-1 h-1 rounded-full cursor-pointer relative group" style={{ background: "rgba(255,255,255,0.12)" }} onClick={handleProgressClick}>
              <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${progressPct}%`, background: "#fff" }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `${progressPct}%`, transform: "translateX(-50%) translateY(-50%)", background: "#fff" }} />
            </div>
            <span style={{ fontSize: "10px", color: "#666", minWidth: 32 }}>{formatTime(player.duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-36 shrink-0 justify-end">
          <button onClick={() => player.setMuted(!player.muted)} className="transition-colors" style={{ color: "#aaa" }}>
            {player.muted || player.volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <div className="flex-1 h-1 rounded-full cursor-pointer relative group" style={{ background: "rgba(255,255,255,0.12)" }} onClick={handleVolumeClick}>
            <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${volumePct}%`, background: "#fff" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-views ----

function EmptyLibrary({ onAddFolder, scanning }: { onAddFolder: () => void; scanning: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "#1c1c1c" }}>
        <Music size={28} style={{ color: "#444" }} />
      </div>
      <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: 8 }}>Your library is empty</h2>
      <p style={{ fontSize: "12px", color: "#777", marginBottom: 20, maxWidth: 320 }}>
        Add a folder of music files (MP3, FLAC, M4A, AAC, WAV, OGG, OPUS) to get started. Everything stays on this device.
      </p>
      <button
        onClick={onAddFolder}
        disabled={scanning}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all hover:scale-105"
        style={{ background: "#1db954", color: "#000", fontSize: "13px" }}
      >
        <FolderPlus size={14} /> Add Music Folder
      </button>
    </div>
  );
}

function HomeView({ current, isPlaying, onTogglePlay, albums, onPlayAlbum }: {
  current: Track | null; isPlaying: boolean; onTogglePlay: () => void;
  albums: AlbumGroup[]; onPlayAlbum: (a: AlbumGroup) => void;
}) {
  return (
    <>
      <div className="relative overflow-hidden rounded-2xl mb-6" style={{ height: 240, background: "linear-gradient(135deg, #1a0a2e 0%, #2d1255 40%, #0d0d0d 100%)" }}>
        {current && (
          <TrackArtwork trackId={current.id} className="absolute inset-0 w-full h-full object-cover opacity-40" style={{ filter: "blur(2px)" }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 flex items-end p-7">
          <div>
            <div style={{ fontSize: "10px", color: "#aaa", marginBottom: 4 }}>{current?.artist ?? "Welcome"}</div>
            <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#fff", lineHeight: 1.2, marginBottom: 16 }}>
              {current?.title ?? "Pick something to play"}
            </h1>
            {current && (
              <button onClick={onTogglePlay} className="flex items-center gap-2 px-5 py-2 rounded-full font-medium transition-all hover:scale-105" style={{ background: "#fff", color: "#000", fontSize: "13px" }}>
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                {isPlaying ? "Pause" : "Play"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: 16 }}>Albums</h2>
        <div className="grid grid-cols-4 gap-3">
          {albums.slice(0, 8).map(album => (
            <button key={`${album.albumArtist}-${album.album}`} onClick={() => onPlayAlbum(album)} className="group relative overflow-hidden rounded-xl transition-transform hover:scale-105" style={{ aspectRatio: "3/4", background: "#1c1c1c" }}>
              <TrackArtwork trackId={album.tracks[0]?.id} className="w-full h-full object-cover opacity-80 group-hover:opacity-90 transition-opacity" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
                <div className="truncate" style={{ fontSize: "12px", fontWeight: 600, color: "#fff" }}>{album.album}</div>
                <div className="truncate" style={{ fontSize: "10px", color: "#aaa" }}>{album.albumArtist}</div>
              </div>
              <div className="absolute top-2 right-2 w-8 h-8 rounded-full items-center justify-center hidden group-hover:flex transition-all" style={{ background: "#1db954" }}>
                <Play size={12} color="#000" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function TrackRow({ track, isActive, isPlaying, liked, playlists, onPlay, onToggleLike, onAddToQueueNext, onAddToQueueEnd, onAddToPlaylist }: {
  track: Track; isActive: boolean; isPlaying: boolean; liked: boolean;
  playlists: { id?: number; name: string }[];
  onPlay: () => void; onToggleLike: () => void;
  onAddToQueueNext: () => void; onAddToQueueEnd: () => void; onAddToPlaylist: (playlistId: number) => void;
}) {
  return (
    <button onClick={onPlay} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors hover:bg-white/5 text-left" style={{ background: isActive ? "rgba(255,255,255,0.06)" : "transparent" }}>
      <div className="relative shrink-0">
        <TrackArtwork trackId={track.id} className="w-10 h-10 object-cover rounded-md" />
        {isActive && isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md" style={{ background: "rgba(0,0,0,0.5)" }}>
            <Pause size={11} color="#fff" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: "12px", fontWeight: 500, color: isActive ? "#1db954" : "#ddd" }}>{track.title}</div>
        <div className="truncate" style={{ fontSize: "11px", color: "#777" }}>{track.artist} · {track.album}</div>
      </div>
      <span style={{ fontSize: "11px", color: "#666" }}>{formatTime(track.duration)}</span>
      <button onClick={e => { e.stopPropagation(); onToggleLike(); }} className="shrink-0">
        <Heart size={13} style={{ color: liked ? "#1db954" : "#555" }} fill={liked ? "#1db954" : "none"} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button onClick={e => e.stopPropagation()} className="shrink-0">
            <MoreHorizontal size={14} style={{ color: "#666" }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onAddToQueueNext}>Play next</DropdownMenuItem>
          <DropdownMenuItem onClick={onAddToQueueEnd}>Add to queue</DropdownMenuItem>
          {playlists.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Add to playlist</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {playlists.map(pl => (
                    <DropdownMenuItem key={pl.id} onClick={() => pl.id !== undefined && onAddToPlaylist(pl.id)}>{pl.name}</DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </button>
  );
}

function TrackListView({ tracks, current, isPlaying, liked, playlists, onPlay, onToggleLike, onAddToQueueNext, onAddToQueueEnd, onAddToPlaylist, title }: {
  tracks: Track[]; current: Track | null; isPlaying: boolean; liked: Set<string>;
  playlists: { id?: number; name: string }[];
  onPlay: (t: Track) => void; onToggleLike: (id: string) => void;
  onAddToQueueNext: (t: Track) => void; onAddToQueueEnd: (t: Track) => void; onAddToPlaylist: (trackId: string, playlistId: number) => void;
  title: string;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: 12 }}>{title} <span style={{ color: "#666", fontWeight: 400 }}>· {tracks.length}</span></h2>
      {tracks.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#666" }}>Nothing here yet.</div>
      ) : (
        <div className="space-y-0.5">
          {tracks.map(t => (
            <TrackRow
              key={t.id} track={t} isActive={current?.id === t.id} isPlaying={isPlaying} liked={liked.has(t.id)}
              playlists={playlists} onPlay={() => onPlay(t)} onToggleLike={() => onToggleLike(t.id)}
              onAddToQueueNext={() => onAddToQueueNext(t)} onAddToQueueEnd={() => onAddToQueueEnd(t)}
              onAddToPlaylist={(pid) => onAddToPlaylist(t.id, pid)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlbumsView({ albums, onPlayAlbum }: { albums: AlbumGroup[]; onPlayAlbum: (a: AlbumGroup) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: 16 }}>Albums <span style={{ color: "#666", fontWeight: 400 }}>· {albums.length}</span></h2>
      <div className="grid grid-cols-5 gap-4">
        {albums.map(album => (
          <button key={`${album.albumArtist}-${album.album}`} onClick={() => onPlayAlbum(album)} className="text-left group">
            <div className="relative overflow-hidden rounded-xl mb-2 transition-transform group-hover:scale-105" style={{ aspectRatio: "1/1", background: "#1c1c1c" }}>
              <TrackArtwork trackId={album.tracks[0]?.id} className="w-full h-full object-cover" />
            </div>
            <div className="truncate" style={{ fontSize: "12px", fontWeight: 500, color: "#fff" }}>{album.album}</div>
            <div className="truncate" style={{ fontSize: "11px", color: "#777" }}>{album.albumArtist} {album.year ? `· ${album.year}` : ""}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArtistsView({ artists, onPlayArtist }: { artists: ArtistGroup[]; onPlayArtist: (a: ArtistGroup) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: 16 }}>Artists <span style={{ color: "#666", fontWeight: 400 }}>· {artists.length}</span></h2>
      <div className="grid grid-cols-5 gap-4">
        {artists.map(artist => (
          <button key={artist.artist} onClick={() => onPlayArtist(artist)} className="text-left group">
            <div className="relative overflow-hidden rounded-full mb-2 transition-transform group-hover:scale-105" style={{ aspectRatio: "1/1", background: "#1c1c1c" }}>
              <TrackArtwork trackId={artist.tracks[0]?.id} className="w-full h-full object-cover" />
            </div>
            <div className="truncate text-center" style={{ fontSize: "12px", fontWeight: 500, color: "#fff" }}>{artist.artist}</div>
            <div className="truncate text-center" style={{ fontSize: "11px", color: "#777" }}>{artist.tracks.length} songs</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function GenresView({ genres, onPlayGenre }: { genres: { genre: string; tracks: Track[] }[]; onPlayGenre: (g: { genre: string; tracks: Track[] }) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: 16 }}>Genres <span style={{ color: "#666", fontWeight: 400 }}>· {genres.length}</span></h2>
      <div className="grid grid-cols-3 gap-3">
        {genres.map(g => (
          <button key={g.genre} onClick={() => onPlayGenre(g)} className="flex items-center justify-between px-5 py-6 rounded-xl transition-transform hover:scale-[1.02]" style={{ background: "linear-gradient(135deg, #2d1255, #1a0a2e)" }}>
            <div className="text-left">
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>{g.genre}</div>
              <div style={{ fontSize: "11px", color: "#aaa" }}>{g.tracks.length} songs</div>
            </div>
            <Play size={16} color="#fff" />
          </button>
        ))}
      </div>
    </div>
  );
}

function FoldersView({ folders, onAddFolder, onRescan, scanning }: {
  folders: { id: number; handle: FileSystemDirectoryHandle; name: string }[];
  onAddFolder: () => void; onRescan: (h: FileSystemDirectoryHandle) => void; scanning: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff" }}>Watched Folders</h2>
        <button onClick={onAddFolder} disabled={scanning} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ background: "#1db954", color: "#000" }}>
          <FolderPlus size={12} /> Add Folder
        </button>
      </div>
      {folders.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#666" }}>No folders added yet.</div>
      ) : (
        <div className="space-y-2">
          {folders.map(f => (
            <div key={f.id} className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: "#1a1a1a" }}>
              <div className="flex items-center gap-3">
                <FolderOpen size={16} style={{ color: "#1db954" }} />
                <span style={{ fontSize: "13px", color: "#ddd" }}>{f.name}</span>
              </div>
              <button onClick={() => onRescan(f.handle)} disabled={scanning} className="px-3 py-1 rounded-full text-xs" style={{ background: "rgba(255,255,255,0.1)", color: "#ccc" }}>
                Rescan
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistsView({ playlists, allTracks, onPlayPlaylist, onDelete, onImport, onExport }: {
  playlists: { id?: number; name: string; trackIds: string[] }[];
  allTracks: Track[];
  onPlayPlaylist: (tracks: Track[]) => void;
  onDelete: (id: number) => void;
  onImport: () => void;
  onExport: (name: string, tracks: Track[]) => void;
}) {
  const byId = useMemo(() => new Map(allTracks.map(t => [t.id, t])), [allTracks]);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#fff" }}>Playlists</h2>
        <button onClick={onImport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ background: "rgba(255,255,255,0.1)", color: "#ccc" }}>
          <Plus size={12} /> Import M3U
        </button>
      </div>
      {playlists.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#666" }}>No playlists yet. Create one from the sidebar.</div>
      ) : (
        <div className="space-y-3">
          {playlists.map(pl => {
            const tracks = pl.trackIds.map(id => byId.get(id)).filter(Boolean) as Track[];
            return (
              <div key={pl.id} className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: "#1a1a1a" }}>
                <div className="flex items-center gap-3">
                  <button onClick={() => onPlayPlaylist(tracks)} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#1db954" }}>
                    <Play size={13} color="#000" />
                  </button>
                  <div>
                    <div style={{ fontSize: "13px", color: "#fff" }}>{pl.name}</div>
                    <div style={{ fontSize: "11px", color: "#777" }}>{tracks.length} songs</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => onExport(pl.name, tracks)} className="px-3 py-1 rounded-full text-xs" style={{ background: "rgba(255,255,255,0.1)", color: "#ccc" }}>Export M3U</button>
                  <button onClick={() => pl.id && onDelete(pl.id)} className="px-3 py-1 rounded-full text-xs" style={{ background: "rgba(255,80,80,0.15)", color: "#ff7a7a" }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
