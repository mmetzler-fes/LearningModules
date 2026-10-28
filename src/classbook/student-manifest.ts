/**
 * Web-App-Manifest für Schüler: Die installierte App (iPad: Teilen → Zum
 * Home-Bildschirm) startet am Klassenbuch- bzw. Themen-Link statt an der
 * Anmeldung der Lehrkraft. Je Link eine eigene App (`id`).
 */

/** Erlaubte Startadressen: `/?k=…`, `/?l=…`, `/?q=…` mit einem Token – sonst null. */
export function studentStartUrl(start: unknown): string | null {
  const m = /^\/\?(k|l|q)=([A-Za-z0-9._~-]{1,200})$/.exec(String(start ?? ''));
  return m ? `/?${m[1]}=${m[2]}` : null;
}

export function studentManifest(start: string, title = '') {
  const name = title ? `LernModule – ${title}` : 'LernModule';
  return {
    id: start,
    name,
    short_name: title || 'LernModule',
    description: 'Aufgaben, Blätter und Ergebnisse',
    lang: 'de',
    start_url: start,
    scope: '/',
    display: 'standalone',
    background_color: '#f5f7fb',
    theme_color: '#3b82f6',
    // Absolut: Das Manifest liegt unter /api/…, nicht neben den Symbolen.
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
