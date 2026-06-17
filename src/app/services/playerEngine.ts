// Real playback engine on top of HTMLAudioElement. Two <audio> elements are
// kept so the next track can be preloaded for gapless transitions; crossfade
// ramps gain between them when enabled.

import { Track } from '../db/database';
import { resolveFile } from '../db/fileResolver';

type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: Track[];
  queueIndex: number;
  buffering: boolean;
}

type Listener = (state: PlayerState) => void;

export class PlayerEngine {
  private audioA = new Audio();
  private audioB = new Audio();
  private active: HTMLAudioElement;
  private inactive: HTMLAudioElement;
  private objectUrl: string | null = null;
  private nextObjectUrl: string | null = null;
  private listeners = new Set<Listener>();
  private crossfadeSeconds = 0;
  private preloadedNextId: string | null = null;

  state: PlayerState = {
    current: null,
    isPlaying: false,
    position: 0,
    duration: 0,
    volume: 0.75,
    muted: false,
    shuffle: false,
    repeat: 'off',
    queue: [],
    queueIndex: -1,
    buffering: false,
  };

  constructor() {
    this.active = this.audioA;
    this.inactive = this.audioB;
    for (const a of [this.audioA, this.audioB]) {
      a.preload = 'auto';
    }
    this.bindActiveEvents();
    this.setupMediaSession();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }

  private bindActiveEvents() {
    const a = this.active;
    a.ontimeupdate = () => {
      this.state.position = a.currentTime;
      // start crossfade ahead of the natural end if configured
      if (this.crossfadeSeconds > 0 && a.duration - a.currentTime <= this.crossfadeSeconds && !this.fadingOut) {
        this.beginCrossfadeOut();
      }
      this.emit();
    };
    a.onloadedmetadata = () => {
      this.state.duration = a.duration;
      this.emit();
    };
    a.onwaiting = () => { this.state.buffering = true; this.emit(); };
    a.onplaying = () => { this.state.buffering = false; this.emit(); };
    a.onended = () => {
      if (this.crossfadeSeconds === 0) this.advance(1, true);
    };
    a.onerror = () => {
      // skip unplayable file rather than stalling the queue
      this.advance(1, true);
    };
  }

  private fadingOut = false;
  private async beginCrossfadeOut() {
    this.fadingOut = true;
    const nextTrack = this.peekNext();
    if (nextTrack && this.preloadedNextId !== nextTrack.id) {
      await this.preload(nextTrack);
    }
    if (!nextTrack) { this.fadingOut = false; return; }

    const duration = this.crossfadeSeconds * 1000;
    const steps = 30;
    const stepMs = duration / steps;
    this.inactive.volume = 0;
    this.inactive.currentTime = 0;
    this.inactive.play().catch(() => {});

    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, stepMs));
      const t = i / steps;
      this.active.volume = Math.max(0, (1 - t) * (this.state.muted ? 0 : this.state.volume));
      this.inactive.volume = Math.min(1, t * (this.state.muted ? 0 : this.state.volume));
    }

    this.active.pause();
    [this.active, this.inactive] = [this.inactive, this.active];
    this.bindActiveEvents();

    // The new active element is already mid-playback from the fade above, so
    // we only need to advance the queue index/state — never call loadCurrent()
    // here, since that would reassign .src and restart it from zero.
    let nextIndex = this.state.queueIndex + 1;
    if (nextIndex >= this.state.queue.length) nextIndex = 0; // only reachable when repeat === 'all', per peekNext
    this.state.queueIndex = nextIndex;
    this.state.current = this.state.queue[nextIndex] ?? null;
    this.state.position = this.active.currentTime;
    this.state.duration = this.active.duration || 0;
    this.state.isPlaying = true;
    this.preloadedNextId = null;
    if (this.state.current) this.updateMediaSessionMetadata(this.state.current);
    this.emit();
    this.fadingOut = false;
  }

  private peekNext(): Track | null {
    const { queue, queueIndex, repeat } = this.state;
    if (queue.length === 0) return null;
    const ni = queueIndex + 1;
    if (ni < queue.length) return queue[ni];
    if (repeat === 'all') return queue[0];
    return null;
  }

  private async preload(track: Track) {
    const file = await resolveFile(track.id);
    if (!file) return;
    if (this.nextObjectUrl) URL.revokeObjectURL(this.nextObjectUrl);
    this.nextObjectUrl = URL.createObjectURL(file);
    this.inactive.src = this.nextObjectUrl;
    this.preloadedNextId = track.id;
  }

  setCrossfade(seconds: number) {
    this.crossfadeSeconds = Math.max(0, Math.min(12, seconds));
  }

  async setQueue(tracks: Track[], startIndex: number, autoplay = true) {
    this.state.queue = tracks;
    this.state.queueIndex = startIndex;
    await this.loadCurrent(autoplay);
  }

  private async loadCurrent(autoplay: boolean) {
    const track = this.state.queue[this.state.queueIndex] ?? null;
    this.state.current = track;
    this.state.position = 0;
    this.emit();
    if (!track) return;

    const file = await resolveFile(track.id);
    if (!file) {
      // file moved/deleted since scan — skip forward rather than freeze
      this.advance(1, true);
      return;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.active.src = this.objectUrl;
    this.active.volume = this.state.muted ? 0 : this.state.volume;
    this.preloadedNextId = null;
    if (autoplay) {
      await this.active.play().catch(() => {});
      this.state.isPlaying = true;
    }
    this.updateMediaSessionMetadata(track);
    this.emit();
  }

  async play() {
    await this.active.play().catch(() => {});
    this.state.isPlaying = true;
    this.emit();
  }

  pause() {
    this.active.pause();
    this.state.isPlaying = false;
    this.emit();
  }

  toggle() {
    this.state.isPlaying ? this.pause() : this.play();
  }

  seek(seconds: number) {
    this.active.currentTime = Math.max(0, Math.min(this.active.duration || 0, seconds));
    this.state.position = this.active.currentTime;
    this.emit();
  }

  seekRelative(deltaSeconds: number) {
    this.seek(this.active.currentTime + deltaSeconds);
  }

  setVolume(v: number) {
    this.state.volume = Math.max(0, Math.min(1, v));
    if (!this.state.muted) this.active.volume = this.state.volume;
    this.emit();
  }

  setMuted(m: boolean) {
    this.state.muted = m;
    this.active.volume = m ? 0 : this.state.volume;
    this.emit();
  }

  setShuffle(on: boolean) {
    this.state.shuffle = on;
    if (on) {
      const current = this.state.queue[this.state.queueIndex];
      const rest = this.state.queue.filter((_, i) => i !== this.state.queueIndex);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      this.state.queue = current ? [current, ...rest] : rest;
      this.state.queueIndex = current ? 0 : 0;
    }
    this.emit();
  }

  setRepeat(mode: RepeatMode) {
    this.state.repeat = mode;
    this.emit();
  }

  async advance(direction: 1 | -1, autoplay: boolean) {
    const { queue, repeat } = this.state;
    if (queue.length === 0) return;

    if (repeat === 'one' && direction === 1) {
      this.seek(0);
      if (autoplay) this.play();
      return;
    }

    let nextIndex = this.state.queueIndex + direction;
    if (nextIndex >= queue.length) {
      if (repeat === 'all') nextIndex = 0;
      else { this.pause(); return; }
    } else if (nextIndex < 0) {
      nextIndex = repeat === 'all' ? queue.length - 1 : 0;
    }
    this.state.queueIndex = nextIndex;
    await this.loadCurrent(autoplay);
  }

  addToQueueNext(track: Track) {
    this.state.queue.splice(this.state.queueIndex + 1, 0, track);
    this.emit();
  }

  addToQueueEnd(track: Track) {
    this.state.queue.push(track);
    this.emit();
  }

  removeFromQueue(index: number) {
    if (index === this.state.queueIndex) return; // don't remove what's playing
    this.state.queue.splice(index, 1);
    if (index < this.state.queueIndex) this.state.queueIndex--;
    this.emit();
  }

  reorderQueue(fromIndex: number, toIndex: number) {
    const q = this.state.queue;
    const [item] = q.splice(fromIndex, 1);
    q.splice(toIndex, 0, item);
    if (fromIndex === this.state.queueIndex) this.state.queueIndex = toIndex;
    else if (fromIndex < this.state.queueIndex && toIndex >= this.state.queueIndex) this.state.queueIndex--;
    else if (fromIndex > this.state.queueIndex && toIndex <= this.state.queueIndex) this.state.queueIndex++;
    this.emit();
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.advance(-1, true));
    navigator.mediaSession.setActionHandler('nexttrack', () => this.advance(1, true));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) this.seek(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => this.seekRelative(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => this.seekRelative(10));
  }

  private updateMediaSessionMetadata(track: Track) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    navigator.mediaSession.playbackState = 'playing';
  }
}

export const playerEngine = new PlayerEngine();
