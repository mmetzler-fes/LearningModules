// ==================== NEUE VERSION: AKTUALISIEREN ANBIETEN ====================
//
// Die App auf dem Home-Bildschirm (iPad) bleibt im Hintergrund im Speicher und lädt beim
// Antippen nicht neu – sie zeigte nach einem Update weiter die alte Oberfläche. Deshalb fragt
// sie die Version des Servers ab (/api/ui-version, ändert sich nur mit einer neuen Oberfläche):
// beim Zurückkommen in den Vordergrund und alle paar Minuten. Ist sie neu, aktualisiert sie sich
// ohne Rückfrage (es gibt keine Alternative): kurzes Popup „App wird aktualisiert“, offenes Blatt
// speichern, neu laden, Tab wieder öffnen. Wer gerade tippt, ein Quiz oder eine Klassenarbeit
// bearbeitet oder im Modul-Editor ist, wird nicht unterbrochen – dann erst danach.

const CHECK_MS = 5 * 60 * 1000;
const BUSY_RETRY_MS = 15 * 1000;
const SHOW_MS = 1500;
export const REOPEN_KEY = 'lm_ws_reopen';

let known = null;       // Version beim Laden der Seite
let pending = 0;        // Warten, bis niemand mehr arbeitet
let lastCheck = 0;

async function serverVersion() {
  try {
    const res = await fetch('/api/ui-version', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json())?.version || null;
  } catch (_) {
    return null; // offline – später noch einmal
  }
}

async function check() {
  if (document.visibilityState !== 'visible') return;
  lastCheck = Date.now();
  const v = await serverVersion();
  if (!v) return;
  if (!known) { known = v; return; }
  if (v === known) return;
  updateWhenFree();
}

/** Läuft gerade etwas, das ein Neuladen stören würde? (Das Blatt im Stift-Editor speichert updateNow selbst.) */
function busy() {
  const a = document.activeElement;
  if (a && !a.closest?.('.ink-overlay') && a.closest?.('input, textarea, select, [contenteditable="true"]')
    && !a.closest('input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"]')) return true;
  return !!document.querySelector('#view-student-quiz.active, #view-player.active, #view-create-module.active');
}

function updateWhenFree() {
  clearTimeout(pending);
  if (document.visibilityState !== 'visible' || busy()) { pending = setTimeout(updateWhenFree, BUSY_RETRY_MS); return; }
  showPopup();
  pending = setTimeout(() => { void updateNow(); }, SHOW_MS);
}

/** Offenes Blatt speichern, aktiven Tab merken, neu laden. */
export async function updateNow() {
  try {
    const { workspace } = await import('./workspace.js');
    if (workspace.on && workspace.active && workspace.active !== 'home') sessionStorage.setItem(REOPEN_KEY, workspace.active);
  } catch (_) { /* ohne Tabs */ }
  try {
    const { closeInkEditor } = await import('../lm-editor/src/ink/ink-editor.js');
    await closeInkEditor();
  } catch (_) { /* nichts offen */ }
  location.reload();
}

function showPopup() {
  if (document.getElementById('lmUpdatePopup')) return;
  const box = document.createElement('div');
  box.id = 'lmUpdatePopup';
  box.className = 'lm-update';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = `
    <div class="lm-update-text"><strong>🔄 App wird aktualisiert …</strong>
      <span>Es gibt eine neue Version von LearningModules. Dein Blatt wird vorher gespeichert.</span></div>`;
  document.body.appendChild(box);
}

/** Einmal beim Start der App aufrufen. */
export function startUpdateCheck() {
  void check();
  document.addEventListener('visibilitychange', () => {
    // Aus dem Hintergrund zurück (iPad: App wieder angetippt) – höchstens alle 20 s.
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 20_000) void check();
  });
  window.addEventListener('focus', () => { if (Date.now() - lastCheck > 20_000) void check(); });
  setInterval(() => { void check(); }, CHECK_MS);
}
