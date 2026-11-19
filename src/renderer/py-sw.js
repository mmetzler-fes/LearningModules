/* Service Worker nur für input() im Python-Block (js/python/py-worker.js).
 *
 * Python läuft in einem eigenen Thread und muss bei input() anhalten, bis die Antwort da ist. Dafür
 * fragt er synchron …/__py-input__?key=… an; diese Anfrage beantwortet dieser Service Worker erst, wenn
 * die Seite die Eingabe schickt. Alle anderen Anfragen gehen unverändert ans Netz.
 */
const waiting = new Map();
const answers = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'py-input-answer' || typeof d.key !== 'string') return;
  const done = waiting.get(d.key);
  if (done) {
    waiting.delete(d.key);
    done(String(d.value ?? ''));
  } else {
    answers.set(d.key, String(d.value ?? ''));
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.endsWith('/__py-input__')) return;
  const key = url.searchParams.get('key') || '';
  e.respondWith(new Promise((resolve) => {
    const done = (value) => resolve(new Response(value, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }));
    if (answers.has(key)) {
      const value = answers.get(key);
      answers.delete(key);
      done(value);
    } else {
      waiting.set(key, done);
    }
  }));
});
