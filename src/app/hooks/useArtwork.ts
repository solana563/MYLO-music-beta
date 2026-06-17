import { useEffect, useState } from 'react';
import { getArtwork } from '../db/database';

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#1c1c1c"/>
    <path d="M200 120a60 60 0 100 120 60 60 0 000-120zm0 100a40 40 0 110-80 40 40 0 010 80z" fill="#3a3a3a"/>
  </svg>`
);

const cache = new Map<string, string>();

export function useArtwork(trackId: string | undefined): string {
  const [url, setUrl] = useState(trackId ? cache.get(trackId) ?? PLACEHOLDER : PLACEHOLDER);

  useEffect(() => {
    if (!trackId) { setUrl(PLACEHOLDER); return; }
    if (cache.has(trackId)) { setUrl(cache.get(trackId)!); return; }
    let cancelled = false;
    getArtwork(trackId).then(result => {
      if (cancelled) return;
      const resolved = result ?? PLACEHOLDER;
      cache.set(trackId, resolved);
      setUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [trackId]);

  return url;
}

export { PLACEHOLDER as PLACEHOLDER_ARTWORK };
