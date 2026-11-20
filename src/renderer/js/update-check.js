// ==================== NEUE VERSION: AKTUALISIEREN ANBIETEN ====================
//
// Die App auf dem Home-Bildschirm (iPad) bleibt im Hintergrund im Speicher und lädt beim
// Antippen nicht neu – sie zeigte nach einem Update weiter die alte Oberfläche. Deshalb fragt
// sie die Version des Servers ab (/api/ui-version, ändert sich nur mit einer neuen Oberfläche):
// beim Zurückkommen in den Vordergrund und alle paar Minuten. Ist sie neu, erscheint ein Popup;
// „Aktualisieren“ speichert das offene Blatt, lädt neu und öffnet den Tab wieder.

const CHECK_MS = 5 * 60 * 1000;
const LATER_MS = 60 * 60 * 1000;
export const REOPEN_KEY = 'lm_ws_reopen';

let known = null;       // Version beim Laden der Seite
let declined = null;    // { version, until } – „Später“
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
  if (declined?.version === v && Date.now() < declined.until) return;
  showPopup(v);
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

function showPopup(version) {
  if (document.getElementById('lmUpdatePopup')) return;
  const box = document.createElement('div');
  box.id = 'lmUpdatePopup';
  box.className = 'lm-update';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'Neue Version verfügbar');
  box.innerHTML = `
    <div class="lm-update-text"><strong>🔄 Neue Version verfügbar</strong>
      <span>LearningModules wurde aktualisiert. Dein Blatt wird vorher gespeichert.</span></div>
    <div class="lm-update-actions">
      <button type="button" class="btn btn-secondary" data-later>Später</button>
      <button type="button" class="btn btn-primary" data-now>Aktualisieren</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelector('[data-now]').addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Wird aktualisiert …';
    void updateNow();
  });
  box.querySelector('[data-later]').addEventListener('click', () => {
    declined = { version, until: Date.now() + LATER_MS };
    box.remove();
  });
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
