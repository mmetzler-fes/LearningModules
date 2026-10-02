import { normalizeShareUrl } from './utils.js';

/**
 * Was hinter einem Video-Link steckt und wie er abgespielt wird.
 *   { kind: 'youtube', id }      – eingebetteter Player (youtube-nocookie)
 *   { kind: 'vimeo', id }        – eingebetteter Vimeo-Player
 *   { kind: 'file', src }        – <video> (Nextcloud-Freigabe, .mp4 …)
 *   { kind: 'link', src }        – unbekannt: nur als Link anbieten
 *   null                         – kein Link
 */
export function videoSourceOf(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  let m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(u);
  if (m) return { kind: 'youtube', id: m[1] };
  m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u);
  if (m) return { kind: 'vimeo', id: m[1] };
  const shared = normalizeShareUrl(u);
  if (shared !== u) return { kind: 'file', src: shared };
  if (/\.(mp4|m4v|webm|ogv|ogg|mov)(?:[?#].*)?$/i.test(u) || /\/download(?:[?#].*)?$/.test(u)) return { kind: 'file', src: u };
  return { kind: 'link', src: u };
}
