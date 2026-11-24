// ==================== 💬 FEEDBACK ====================
//
// Fehler oder Wunsch melden – für alle (Lehrkräfte, Schüler, Gäste): Beschreibung plus Bild
// (📷 Bildschirmfoto aus dem Stift-Editor, Zwischenablage, Datei). Der Admin sieht die Meldungen
// unter „💬 Feedback“, ordnet sie nach Wichtigkeit und löscht sie (views/admin-feedback.js).

import { escapeHtml } from './utils.js';

// Gezeichnete Symbole statt Emojis (Feedback: auf dem iPad ruhiger, gleich groß).
const svg = (d) => `<svg class="lm-fb-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
export const FEEDBACK_ICON = svg('M4 5h16v11H10l-5 4v-4H4zM8 9.5h8M8 12.5h5');
const PASTE_ICON = svg('M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M9 12h6M9 16h4');
const PICTURE_ICON = svg('M4 5h16v14H4zM4 16l5-5 4 4 2.5-2.5L20 17M15.5 7.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z');

let lastShot = null;   // { blob, at } – das letzte 📷 Bildschirmfoto
let appRef = null;

window.addEventListener('lm-screenshot', (e) => { if (e.detail?.blob) lastShot = { blob: e.detail.blob, at: Date.now() }; });

const toDataUrl = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

/** Bild verkleinern (lange Seite höchstens 2000 px) – damit die Meldung nicht zu groß wird. */
async function shrink(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 3e6) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)) || blob;
  } catch (_) {
    return blob;
  }
}

/** Wo der Fehler passiert ist – ohne Zugangsschlüssel aus der Adresse. */
function context() {
  const view = document.querySelector('.view.active')?.id?.replace(/^view-/, '') || (document.getElementById('loginScreen')?.classList.contains('hidden') ? '' : 'anmeldung');
  return {
    page: location.pathname,
    view,
    tab: document.querySelector('.ws-tab.active .ws-tab-title')?.textContent || null,
    ink: document.querySelector('.ink-overlay')?.getAttribute('aria-label') || null,
    role: appRef?.state?.currentUser?.role || null,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}`,
    touch: window.matchMedia('(pointer: coarse)').matches,
    standalone: !!(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches),
    agent: navigator.userAgent,
    at: new Date().toISOString(),
  };
}

/** Klasse der Schülerin/des Schülers – aus dem Klassenlink oder dem Klassennotizbuch. */
function reporterClass() {
  const fromLink = appRef?.state?.linkSession?.className;
  if (fromLink) return fromLink;
  try {
    const cb = JSON.parse(sessionStorage.getItem('lm_classbook') || 'null');
    const books = JSON.parse(localStorage.getItem('lm_classbooks') || 'null')?.books || [];
    const token = cb?.token || JSON.parse(localStorage.getItem('lm_classbooks') || 'null')?.current;
    const name = books.find((b) => b.token === token)?.className || '';
    return name.split(' · ')[0];
  } catch (_) {
    return '';
  }
}

/** Name fürs Feedback – der Server speichert davon nur Vorname und ersten Buchstaben des Nachnamens. */
function reporterName() {
  try {
    const cb = JSON.parse(sessionStorage.getItem('lm_classbook') || 'null');
    if (cb?.name) return cb.name;
  } catch (_) { /* ohne */ }
  return appRef?.state?.currentUser?.role === 'student' ? appRef.state.currentUser.name || '' : '';
}

// ---- Entwurf: Was getippt ist, geht beim Schließen (Klick daneben, anderes Fenster, 📷) nicht verloren ----
const DRAFT_KEY = 'lm_feedback_draft';
const DRAFT_IMAGE_MAX = 1_500_000; // größere Bilder nur bis zum Neuladen (im Speicher der Seite)
let draftImage = null; // Blob – überlebt das Schließen des Dialogs

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && (d.text || d.image) ? d : null;
  } catch (_) {
    return null;
  }
}

async function writeDraft(text, image) {
  draftImage = image || null;
  try {
    if (!text && !image) { localStorage.removeItem(DRAFT_KEY); return; }
    let dataUrl = null;
    if (image && image.size <= DRAFT_IMAGE_MAX) dataUrl = await toDataUrl(image);
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, image: dataUrl, at: Date.now() }));
  } catch (_) {
    // Speicher voll oder gesperrt: wenigstens den Text
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, image: null, at: Date.now() })); } catch (__) { /* egal */ }
  }
}

function clearDraft() {
  draftImage = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* egal */ }
}

async function dataUrlToBlob(url) {
  try { return await (await fetch(url)).blob(); } catch (_) { return null; }
}

/** Feedback-Fenster öffnen; `blob`: gleich angehängtes Bild (z. B. aus 📷). */
export async function openFeedback(blob = null) {
  const open = document.getElementById('lmFeedback');
  if (open) { await open.lmSaveDraft?.(); open.remove(); } // offener Dialog: erst sichern
  const draft = readDraft();
  const draftImg = draftImage || (draft?.image ? await dataUrlToBlob(draft.image) : null);
  let image = blob || draftImg || (lastShot && Date.now() - lastShot.at < 10 * 60_000 ? lastShot.blob : null);
  const box = document.createElement('div');
  box.id = 'lmFeedback';
  box.className = 'lm-feedback';
  box.innerHTML = `<form class="lm-feedback-card">
      <h3>${FEEDBACK_ICON} Feedback</h3>
      <p class="hint">Was ist passiert, oder was wünschst du dir? Ein Bild hilft beim Finden des Fehlers.</p>
      <textarea name="text" rows="5" placeholder="z. B. Beim Wischen springt das Blatt nach oben …" required></textarea>
      <div class="lm-feedback-image"></div>
      <div class="lm-feedback-tools">
        <button type="button" class="btn btn-secondary lm-fb-btn" data-fb="paste">${PASTE_ICON} Bild aus Zwischenablage</button>
        <label class="btn btn-secondary lm-fb-btn">${PICTURE_ICON} Bild wählen<input type="file" accept="image/*" hidden></label>
      </div>
      <p class="login-error hidden" data-fb="err"></p>
      <div class="lm-feedback-actions">
        <button type="button" class="btn btn-secondary lm-fb-btn" data-fb="discard" title="Text und Bild löschen"${draft || draftImg ? '' : ' hidden'}>Entwurf verwerfen</button>
        <button type="button" class="btn btn-secondary lm-fb-btn" data-fb="cancel" title="Schließen – das Eingegebene bleibt als Entwurf">Abbrechen</button>
        <button type="submit" class="btn btn-primary lm-fb-btn">Senden</button>
      </div>
    </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const err = box.querySelector('[data-fb="err"]');
  const showErr = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); };
  const discardBtn = box.querySelector('[data-fb="discard"]');
  if (draft?.text) {
    form.text.value = draft.text;
    const when = draft.at ? new Date(draft.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    box.querySelector('.hint').insertAdjacentHTML('afterend', `<p class="hint" data-fb="restored">Entwurf${when ? ` von ${escapeHtml(when)}` : ''} wiederhergestellt – weiterschreiben oder „Entwurf verwerfen“.</p>`);
  }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void writeDraft(form.text.value, image);
      discardBtn.hidden = !form.text.value && !image;
    }, 300);
  };
  form.text.addEventListener('input', save);
  discardBtn.addEventListener('click', () => {
    clearDraft();
    form.text.value = '';
    image = null;
    paint();
    discardBtn.hidden = true;
    box.querySelector('[data-fb="restored"]')?.remove();
    form.text.focus();
  });
  const paint = () => {
    const slot = box.querySelector('.lm-feedback-image');
    if (!image) { slot.innerHTML = ''; return; }
    const url = URL.createObjectURL(image);
    slot.innerHTML = `<img src="${url}" alt="Angehängtes Bild"><button type="button" class="btn btn-secondary btn-sm" data-fb="drop">✕ Bild entfernen</button>`;
    slot.querySelector('[data-fb="drop"]').addEventListener('click', () => { image = null; paint(); save(); });
  };
  paint();
  // Neues Bild (📷) zu einem Entwurf: gleich mit sichern.
  if (blob) save();
  const take = async (b) => { if (b) { image = await shrink(b); showErr(''); paint(); save(); } };
  box.querySelector('[data-fb="paste"]').addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { await take(await it.getType(type)); return; }
      }
      showErr('In der Zwischenablage ist kein Bild.');
    } catch (e) {
      showErr('Die Zwischenablage lässt sich hier nicht lesen – Bild mit ⌘V/Strg+V einfügen oder „Bild wählen“.');
    }
  });
  box.querySelector('input[type=file]').addEventListener('change', (e) => take(e.target.files?.[0] || null));
  box.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (file) { e.preventDefault(); void take(file); }
  });
  // Schließen behält das Eingegebene als Entwurf.
  let sent = false;
  const close = () => {
    clearTimeout(saveTimer);
    if (!sent) void writeDraft(form.text.value, image);
    box.remove();
  };
  box.lmSaveDraft = () => { clearTimeout(saveTimer); return sent ? Promise.resolve() : writeDraft(form.text.value, image); };
  box.querySelector('[data-fb="cancel"]').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Wird gesendet …';
    try {
      const body = { text: form.text.value, context: context(), reporter: reporterName(), className: reporterName() ? reporterClass() : '', image: image ? await toDataUrl(await shrink(image)) : null };
      const headers = { 'Content-Type': 'application/json', ...(appRef?.authStore?.getHeaders?.() || {}) };
      const res = await fetch('/api/feedback', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      lastShot = null;
      clearTimeout(saveTimer);
      sent = true;
      clearDraft();
      box.querySelector('.lm-feedback-card').innerHTML = `<h3>${FEEDBACK_ICON} Danke!</h3><p>Deine Meldung ist angekommen.</p><div class="lm-feedback-actions"><button type="button" class="btn btn-primary" data-fb="cancel">Schließen</button></div>`;
      box.querySelector('[data-fb="cancel"]').addEventListener('click', () => box.remove());
      setTimeout(() => box.remove(), 2500);
    } catch (e2) {
      showErr(e2.message || 'Senden ging nicht.');
      btn.disabled = false;
      btn.textContent = 'Senden';
    }
  });
  setTimeout(() => form.text.focus(), 50);
}

/** Einmal beim Start: Stift-Editor und Tab-Leiste bieten 💬 an. */
export function initFeedback(app) {
  appRef = app;
  window.lmOpenFeedback = (blob) => { void openFeedback(blob || null); };
}
