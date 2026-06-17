import { useEffect, useState } from 'react';
import { playerEngine, PlayerState } from '../services/playerEngine';
import { Track } from '../db/database';
import { recordPlay, saveQueueState, loadQueueState } from '../services/library';

export function usePlayer() {
  const [state, setState] = useState<PlayerState>(playerEngine.state);

  useEffect(() => playerEngine.subscribe(setState), []);

  // persist queue position every 5s so a refresh/relaunch resumes where left off
  useEffect(() => {
    const id = setInterval(() => {
      if (state.queue.length === 0) return;
      saveQueueState({
        trackIds: state.queue.map(t => t.id),
        currentIndex: state.queueIndex,
        position: state.position,
        shuffle: state.shuffle,
        repeat: state.repeat,
        shuffledOrder: [],
      });
    }, 5000);
    return () => clearInterval(id);
  }, [state.queue, state.queueIndex, state.position, state.shuffle, state.repeat]);

  // record a play once a track has been listened to past 50% or 30s, whichever is sooner —
  // avoids inflating play counts from accidental clicks
  useEffect(() => {
    if (!state.current || !state.isPlaying) return;
    const threshold = Math.min(30, state.duration * 0.5);
    if (state.position >= threshold && state.position < threshold + 1) {
      recordPlay(state.current.id);
    }
  }, [state.position, state.current, state.isPlaying, state.duration]);

  return {
    ...state,
    play: () => playerEngine.play(),
    pause: () => playerEngine.pause(),
    toggle: () => playerEngine.toggle(),
    next: () => playerEngine.advance(1, true),
    prev: () => playerEngine.advance(-1, true),
    seek: (s: number) => playerEngine.seek(s),
    seekRelative: (d: number) => playerEngine.seekRelative(d),
    setVolume: (v: number) => playerEngine.setVolume(v),
    setMuted: (m: boolean) => playerEngine.setMuted(m),
    setShuffle: (s: boolean) => playerEngine.setShuffle(s),
    setRepeat: (r: 'off' | 'one' | 'all') => playerEngine.setRepeat(r),
    setQueue: (tracks: Track[], startIndex: number) => playerEngine.setQueue(tracks, startIndex),
    addToQueueNext: (t: Track) => playerEngine.addToQueueNext(t),
    addToQueueEnd: (t: Track) => playerEngine.addToQueueEnd(t),
    removeFromQueue: (i: number) => playerEngine.removeFromQueue(i),
    reorderQueue: (from: number, to: number) => playerEngine.reorderQueue(from, to),
    setCrossfade: (s: number) => playerEngine.setCrossfade(s),
  };
}

export async function restoreQueueFromLastSession(allTracks: Track[]) {
  const saved = await loadQueueState();
  if (!saved || saved.trackIds.length === 0) return;
  const byId = new Map(allTracks.map(t => [t.id, t]));
  const queue = saved.trackIds.map(id => byId.get(id)).filter(Boolean) as Track[];
  if (queue.length === 0) return;
  await playerEngine.setQueue(queue, saved.currentIndex, false);
  playerEngine.setRepeat(saved.repeat);
  playerEngine.seek(saved.position);
}
