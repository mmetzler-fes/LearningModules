// ==================== PDF TEILEN (iPad: direkt an GoodNotes) ====================
//
// „Teilen“ in Safari gibt nur die Adresse weiter – GoodNotes lädt sie ohne die
// Anmeldung und bekommt den Anmeldebildschirm. Hier geht die fertige Datei
// über das Teilen-Menü des Geräts (Web Share API mit Dateien). Das Menü darf
// nur direkt nach einem Tippen öffnen; nach dem Erzeugen (einige Sekunden)
// fragt deshalb ein kleiner Dialog noch einmal.

import { escapeHtml } from './utils.js';

/** Kann das Gerät Dateien teilen (iPad/iPhone, Android, manche Desktop-Browser)? */
export function canShareFiles() {
  try {
    if (!navigator.canShare || !navigator.share) return false;
    return navigator.canShare({ files: [new File([new Blob(['%PDF'])], 'x.pdf', { type: 'application/pdf' })] });
  } catch (_) {
    return false;
  }
}

/** Dateiname aus Content-Disposition (filename*=UTF-8''…), sonst `fallback`. */
export function fileNameOf(res, fallback) {
  const cd = res?.headers?.get?.('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  let name = fallback;
  if (m) { try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; } }
  name = String(name || 'Dokument').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Dokument';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/**
 * Fertiges PDF ausliefern: teilen können → Dialog „📤 Teilen“ (GoodNotes, Dateien, AirDrop …)
 * und „Öffnen“; sonst im vorher geöffneten Fenster `win` bzw. einem neuen anzeigen.
 */
export function deliverPdf(blob, name, win = null) {
  const url = URL.createObjectURL(blob);
  if (!canShareFiles()) {
    if (win) win.location.href = url; else window.open(url, '_blank');
    return;
  }
  win?.close();
  const file = new File([blob], name, { type: 'application/pdf' });
  document.getElementById('lmShareOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'lmShareOverlay';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card" style="max-width:420px; text-align:center">
    <h3>📄 PDF ist fertig</h3>
    <p class="hint">${escapeHtml(name)}</p>
    <p class="login-error hidden" id="lmShareErr"></p>
    <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px">
      <button type="button" class="btn btn-primary btn-full" id="lmShareGo">📤 Teilen – z. B. an GoodNotes</button>
      <button type="button" class="btn btn-secondary btn-full" id="lmShareOpen">Öffnen</button>
      <button type="button" class="btn btn-secondary btn-full" id="lmShareClose">Schließen</button>
    </div></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#lmShareGo').addEventListener('click', async () => {
    try {
      await navigator.share({ files: [file], title: name.replace(/\.pdf$/i, '') });
      close();
    } catch (err) {
      if (err?.name === 'AbortError') return; // Menü geschlossen – Dialog bleibt
      const e = overlay.querySelector('#lmShareErr');
      e.textContent = `Teilen ging nicht (${err?.message || err}). „Öffnen“ zeigt das PDF – dort über ⬆ teilen.`;
      e.classList.remove('hidden');
    }
  });
  overlay.querySelector('#lmShareOpen').addEventListener('click', () => { window.open(url, '_blank'); close(); });
  overlay.querySelector('#lmShareClose').addEventListener('click', close);
}
