/**
 * Web-App-Manifest für Schüler: Die installierte App (iPad: Teilen → Zum
 * Home-Bildschirm) startet am Schüler-Link statt an der Anmeldung der
 * Lehrkraft. Klassenbuch-Links ergeben alle dieselbe App
 * „LearningModules_Schüler“ mit der Liste der eigenen Klassennotizbücher
 * (`?app=classbook`) – ebenso die Schüler-Startseite (`/schueler/`, ohne
 * Link: zum Installieren am PC). Ein Themen- oder Quick-Link ergibt seine
 * eigene. Alle liegen unter /schueler/ – ein eigener Bereich, damit Chrome
 * und Edge sie neben der Lehrer-App installieren.
 */

/** Pfad der Schüler-Apps (der Server liefert dort dieselbe Oberfläche aus). */
export const STUDENT_BASE = '/schueler/';

/** Name der Schüler-App – anders als die Lehrer-App („LernModule“), damit beide nebeneinander erkennbar sind. */
export const STUDENT_APP_NAME = 'LearningModules_Schüler';

/** Erlaubte Startadressen: `/?k=…`, `/?l=…`, `/?q=…` mit einem Token, `/` (Schüler-Startseite) – sonst null. */
export function studentStartUrl(start: unknown): string | null {
  if (start === undefined || start === '' || start === '/') return '/';
  const m = /^\/\?(k|l|q)=([A-Za-z0-9._~-]{1,200})$/.exec(String(start ?? ''));
  return m ? `/?${m[1]}=${m[2]}` : null;
}

export function studentManifest(start: string) {
  const classbook = start === '/' || start.startsWith('/?k=');
  const query = start.slice(1); // „?k=…“
  return {
    id: classbook ? `${STUDENT_BASE}?app=classbook` : STUDENT_BASE + query,
    name: STUDENT_APP_NAME,
    short_name: classbook ? 'LM Schüler' : 'LernModule',
    description: 'Aufgaben, Blätter und Ergebnisse',
    lang: 'de',
    // Das Klassennotizbuch des Links kommt beim ersten Start in die Liste.
    start_url: classbook ? `${STUDENT_BASE}?app=classbook${start === '/' ? '' : `&k=${start.slice(4)}`}` : STUDENT_BASE + query,
    scope: STUDENT_BASE,
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
