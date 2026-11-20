// ==================== 💬 FEEDBACK ====================
//
// Fehler oder Wunsch melden – für alle (Lehrkräfte, Schüler, Gäste): Beschreibung plus Bild
// (📷 Bildschirmfoto aus dem Stift-Editor, Zwischenablage, Datei). Der Admin sieht die Meldungen
// unter „💬 Feedback“, ordnet sie nach Wichtigkeit und löscht sie (views/admin-feedback.js).

import { escapeHtml } from './utils.js';

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

function reporterName() {
  try {
    const cb = JSON.parse(sessionStorage.getItem('lm_classbook') || 'null');
    if (cb?.name) return cb.name;
  } catch (_) { /* ohne */ }
  return appRef?.state?.currentUser?.role === 'student' ? appRef.state.currentUser.name || '' : '';
}

/** Feedback-Fenster öffnen; `blob`: gleich angehängtes Bild (z. B. aus 📷). */
export function openFeedback(blob = null) {
  document.getElementById('lmFeedback')?.remove();
  let image = blob || (lastShot && Date.now() - lastShot.at < 10 * 60_000 ? lastShot.blob : null);
  const box = document.createElement('div');
  box.id = 'lmFeedback';
  box.className = 'lm-feedback';
  box.innerHTML = `<form class="lm-feedback-card">
      <h3>💬 Feedback</h3>
      <p class="hint">Was ist passiert, oder was wünschst du dir? Ein Bild hilft beim Finden des Fehlers.</p>
      <textarea name="text" rows="5" placeholder="z. B. Beim Wischen springt das Blatt nach oben …" required></textarea>
      <div class="lm-feedback-image"></div>
      <div class="lm-feedback-tools">
        <button type="button" class="btn btn-secondary btn-sm" data-fb="paste">📋 Bild aus Zwischenablage</button>
        <label class="btn btn-secondary btn-sm">🖼 Bild wählen<input type="file" accept="image/*" hidden></label>
      </div>
      <p class="login-error hidden" data-fb="err"></p>
      <div class="lm-feedback-actions">
        <button type="button" class="btn btn-secondary" data-fb="cancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary">Senden</button>
      </div>
    </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const err = box.querySelector('[data-fb="err"]');
  const showErr = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); };
  const paint = () => {
    const slot = box.querySelector('.lm-feedback-image');
    if (!image) { slot.innerHTML = ''; return; }
    const url = URL.createObjectURL(image);
    slot.innerHTML = `<img src="${url}" alt="Angehängtes Bild"><button type="button" class="btn btn-secondary btn-sm" data-fb="drop">✕ Bild entfernen</button>`;
    slot.querySelector('[data-fb="drop"]').addEventListener('click', () => { image = null; paint(); });
  };
  paint();
  const take = async (b) => { if (b) { image = await shrink(b); showErr(''); paint(); } };
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
  box.querySelector('[data-fb="cancel"]').addEventListener('click', () => box.remove());
  box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Wird gesendet …';
    try {
      const body = { text: form.text.value, context: context(), reporter: reporterName(), image: image ? await toDataUrl(await shrink(image)) : null };
      const headers = { 'Content-Type': 'application/json', ...(appRef?.authStore?.getHeaders?.() || {}) };
      const res = await fetch('/api/feedback', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      lastShot = null;
      box.querySelector('.lm-feedback-card').innerHTML = '<h3>💬 Danke!</h3><p>Deine Meldung ist angekommen.</p><div class="lm-feedback-actions"><button type="button" class="btn btn-primary" data-fb="cancel">Schließen</button></div>';
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
  window.lmOpenFeedback = (blob) => openFeedback(blob || null);
}
