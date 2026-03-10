/**
 * Asset URL helpers.
 *
 * In local dev (VITE_STATIC_BASE unset): returns relative paths like
 *   /audio/sunriser.mp3  →  fetched from Express (auth-protected)
 *
 * In production (VITE_STATIC_BASE=https://static.recordcrash.com/motifle):
 *   /audio/sunriser.mp3  →  https://static.recordcrash.com/motifle/audio/sunriser.mp3
 */

const BASE = (import.meta.env.VITE_STATIC_BASE || '').replace(/\/$/, '');

export function audioUrl(slug) {
  return `${BASE}/audio/${slug}.mp3`;
}

export function imageUrl(slug) {
  return `${BASE}/images/${slug}.jpg`;
}
