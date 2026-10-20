import { nextcloudState, uploadImageToNextcloud, openNextcloudDialog } from './nextcloud.js';

// ==================== BILDER SPEICHERN ====================
//
// Ein Weg für jedes Bild, das in ein Modul kommt (Bildfelder, Hotspots,
// Arbeitsblatt, Bildzusammenstellung): mit verbundener Nextcloud dorthin,
// sonst als data:-URL in die App – vorher verkleinert und gegen die Grenze
// geprüft, die der Admin einstellt (docs/nextcloud.md). Die klassischen
// Skripte erreichen das über window.appImages (app.js).

const MAX_EDGE = 1600;            // längste Kante nach dem Verkleinern
const KEEP_BYTES = 600 * 1024;    // kleinere Dateien bleiben unverändert
const HINT_EVERY_MS = 10 * 60 * 1000;

const mb = (bytes) => (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** Stand der Grenze; `pending`: in dieser Sitzung eingefügt, aber evtl. noch nicht gespeichert. */
const quotaState = { data: null, at: 0, pending: 0, hintAt: 0 };

export async function loadQuota(app, force = false) {
  if (!force && quotaState.data && Date.now() - quotaState.at < 60 * 1000) return quotaState.data;
  const res = await app.api.getImageQuota().catch(() => null);
  if (res && typeof res.usedBytes === 'number') {
    quotaState.data = res;
    quotaState.at = Date.now();
    quotaState.pending = 0;
  }
  return quotaState.data;
}

/** data:-URL oder Blob/File → Blob */
async function toBlob(input) {
  if (typeof input === 'string') return (await fetch(input)).blob();
  return input;
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Die Datei ließ sich nicht lesen.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Fotos über 1600 px oder 600 KB verkleinern: JPEG bleibt JPEG (Qualität
 * 0,85), alles andere wird PNG – so bleiben Transparenz und scharfe Kanten
 * (Schaltpläne, Screenshots). SVG und GIF (evtl. animiert) bleiben, wie sie sind.
 */
export async function shrinkImage(blob) {
  const original = await readAsDataUrl(blob);
  if (/svg|gif/.test(blob.type || '')) return original;
  const img = new Image();
  img.src = original;
  try { await img.decode(); } catch (_) { return original; }
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && blob.size <= KEEP_BYTES) return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = blob.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png');
  // Wird es (selten) größer, das Original nehmen.
  return out.length < original.length ? out : original;
}

const bytesOf = (dataUrl) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/** Grenze erreicht: erklären und zur Nextcloud führen. */
async function showLimitReached(app, q) {
  const go = await app.appConfirm(
    `Deine Bilder in der App haben die Grenze von ${mb(q.limitBytes)} MB erreicht – neue Bilder lassen sich hier nicht mehr speichern.\n\n`
    + 'Mit einer eigenen Nextcloud-Freigabe ist Platz für beliebig viele Bilder; die vorhandenen lassen sich dort mit einem Klick auslagern.\n\n'
    + 'Jetzt die Nextcloud einrichten?',
  );
  if (go) openNextcloudDialog(app);
}

/**
 * Bild speichern. `input`: File/Blob oder data:-URL, `name`: Dateiname für
 * die Nextcloud. Ergebnis: Link bzw. data:-URL – oder false (abgebrochen,
 * Grenze erreicht).
 */
export async function storeImage(app, input, name = 'bild.png') {
  if (nextcloudState.ready) {
    const blob = await toBlob(input);
    const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/png' });
    const url = await uploadImageToNextcloud(app, file);
    if (url) return url;
    if (url === false) return false;
    // null: Hochladen klappte nicht, die Lehrkraft will es in der App – weiter unten.
  }
  const q = await loadQuota(app);
  const limited = q && !q.nextcloud && q.limitBytes > 0;
  if (limited && q.usedBytes + quotaState.pending >= q.limitBytes) { await showLimitReached(app, q); return false; }

  const dataUrl = await shrinkImage(await toBlob(input));
  if (!q || q.nextcloud) return dataUrl;
  const size = bytesOf(dataUrl);
  const total = q.usedBytes + quotaState.pending + size;
  if (limited && total > q.limitBytes) { await showLimitReached(app, q); return false; }
  quotaState.pending += size;
  if (q.warnBytes > 0 && total >= q.warnBytes && Date.now() - quotaState.hintAt > HINT_EVERY_MS) {
    quotaState.hintAt = Date.now();
    app.showToast(`Deine Bilder in der App: ${mb(total)} MB${q.limitBytes ? ` von ${mb(q.limitBytes)} MB` : ''}. `
      + 'Mit einer Nextcloud-Freigabe ist Platz für beliebig viele – Home-Menü → ☁️ Nextcloud.', 'info');
  }
  return dataUrl;
}

/** Kurzer Stand für den Nextcloud-Dialog (HTML) – leer, wenn die Nextcloud verbunden ist. */
export function quotaHtml(q) {
  if (!q || q.nextcloud || (!q.usedBytes && q.state === 'ok')) return '';
  const of = q.limitBytes ? ` von ${mb(q.limitBytes)} MB` : '';
  const text = q.state === 'full'
    ? `⛔ Deine Bilder in der App: <strong>${mb(q.usedBytes)} MB${of}</strong> – die Grenze ist erreicht. Neue Bilder brauchen jetzt eine Nextcloud-Freigabe.`
    : q.state === 'warn'
      ? `⚠️ Deine Bilder in der App: <strong>${mb(q.usedBytes)} MB${of}</strong>. Bald geht nichts mehr hinein – am besten jetzt eine Freigabe verbinden.`
      : `Deine Bilder in der App: ${mb(q.usedBytes)} MB${of}.`;
  return `<p class="hint nc-status">${text}</p>`;
}

/** Punkt am Knopf ☁️ Nextcloud, wenn der Hinweis oder die Grenze erreicht ist. */
export async function refreshQuotaBadge(app) {
  const btn = document.getElementById('btnNextcloud');
  if (!btn) return;
  const q = await loadQuota(app, true);
  const need = q && !q.nextcloud && (q.state === 'warn' || q.state === 'full');
  btn.classList.toggle('nc-attention', !!need);
  btn.title = need
    ? `Deine Bilder in der App: ${mb(q.usedBytes)} MB – bitte eine Nextcloud-Freigabe verbinden`
    : 'Bilder der Module in der eigenen Nextcloud speichern statt auf dem Server – je Lernthema ein Ordner';
}

