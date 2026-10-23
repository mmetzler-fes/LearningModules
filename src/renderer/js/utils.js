// ==================== UTILITY FUNCTIONS ====================
//
// Was auch die Anzeige der Module braucht (Escapen, Bereinigen von HTML,
// Kontextmenü, Ziehen per Pointer), liegt in lm-editor und wird hier nur
// weitergereicht – so bleiben die Importe der App unverändert.

import { escapeHtml } from '../lm-editor/src/util/dom.js';

export * from '../lm-editor/src/util/dom.js';

export function generateId() {
  return 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

export function escapeHtmlPreservingText(text) {
  return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

export function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Bericht nach einem Import (z. B. Moodle-XML): was übersprungen und was nur
 * vereinfacht übernommen wurde. Ohne beides passiert nichts.
 */
export function showImportReport({ skipped = [], notes = [] } = {}, heading = '📋 Import-Bericht') {
  if (!skipped.length && !notes.length) return;
  const list = (items) => `<ul class="import-report-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card import-report">
      <h3>${escapeHtml(heading)}</h3>
      ${skipped.length ? `<p><strong>⏭ Nicht übernommen (${skipped.length})</strong></p>${list(skipped)}` : ''}
      ${notes.length ? `<p><strong>ℹ️ Vereinfacht übernommen (${notes.length})</strong></p>${list(notes)}` : ''}
      <p class="hint">${heading.includes('Export') ? 'Alles andere ist in der Datei.' : 'Alles andere ist im Thema – bitte die Aufgaben kurz im Editor durchsehen.'}</p>
      <div class="confirm-actions"><button type="button" class="btn btn-primary btn-ok">OK</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.btn-ok').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

export function appConfirm(message) {
  return new Promise((resolve) => {
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmBtnYes = document.getElementById('confirmBtnYes');
    const confirmBtnNo = document.getElementById('confirmBtnNo');

    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');
    confirmBtnYes.focus();

    function cleanup(result) {
      confirmBtnYes.removeEventListener('click', onYes);
      confirmBtnNo.removeEventListener('click', onNo);
      confirmOverlay.classList.add('hidden');
      resolve(result);
    }

    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    confirmBtnYes.addEventListener('click', onYes);
    confirmBtnNo.addEventListener('click', onNo);
  });
}

/**
 * Legt ein PNG in die Zwischenablage. Getrennt herausgezogen, weil beide
 * Kopier-Wege denselben letzten Schritt haben.
 */
async function putPngOnClipboard(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}

/** Bricht Text auf eine Breite um und liefert die einzelnen Zeilen. */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const probe = line ? line + ' ' + word : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Kopiert das komplette Aushang-Blatt - Überschrift, QR-Code und Link - als
 * ein Bild in die Zwischenablage, so wie es auch aufs Papier käme.
 *
 * Bewusst auf einem Canvas nachgebaut statt den Dialog abzufotografieren:
 * Ein Browser kann kein DOM rastern, und der Umweg über SVG-foreignObject
 * verliert regelmäßig Schriften und Farben. Hier ist das Ergebnis immer
 * gleich - was gebraucht wird, um es in OneNote einzufügen.
 *
 * Gibt zurück, ob es geklappt hat.
 */
export async function copyShareSheetAsPng({ title, subtitle, svg, url, qrSize = 380 }) {
  if (!svg) return false;
  try {
    const xml = new XMLSerializer().serializeToString(svg);
    const qrImg = new Image();
    qrImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await qrImg.decode();

    const scale = 2;                 // doppelte Auflösung, damit es beim Ausdrucken scharf bleibt
    const width = 760;
    const pad = 48;
    const inner = width - 2 * pad;
    const font = "'Segoe UI', system-ui, -apple-system, sans-serif";

    // Erst messen, dann zeichnen: Die Höhe haengt davon ab, wie oft der
    // Untertitel und der Link umbrechen.
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `500 20px ${font}`;
    const subLines = subtitle ? wrapText(probe, subtitle, inner) : [];
    probe.font = `600 22px ${font}`;
    const urlLines = wrapText(probe, url, inner);

    let height = pad + 38;                       // Überschrift
    if (subLines.length) height += subLines.length * 28 + 10;
    height += 24 + qrSize + 30;                  // QR-Code
    height += urlLines.length * 32;
    height += pad;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    let y = pad + 28;
    ctx.font = `700 28px ${font}`;
    ctx.fillText(title, width / 2, y);
    y += 10;

    if (subLines.length) {
      ctx.font = `500 20px ${font}`;
      ctx.fillStyle = '#444444';
      for (const line of subLines) { y += 28; ctx.fillText(line, width / 2, y); }
      y += 10;
    }

    y += 24;
    ctx.drawImage(qrImg, (width - qrSize) / 2, y, qrSize, qrSize);
    y += qrSize + 30;

    ctx.font = `600 22px ${font}`;
    ctx.fillStyle = '#000000';
    for (const line of urlLines) { y += 32; ctx.fillText(line, width / 2, y); }

    return await putPngOnClipboard(canvas);
  } catch (_) {
    return false;
  }
}

/**
 * Legt eine fertige OneNote-Seite in die Zwischenablage: Überschrift, Zeilen
 * mit Infos, QR-Code als Bild und den Link als anklickbaren Text (nicht im
 * Bild). Als HTML – das übernimmt OneNote samt Formatierung – und als
 * einfacher Text für Programme ohne HTML. Gibt zurück, ob es geklappt hat.
 */
export async function copyOneNotePage({ title, lines = [], svg, url, qrSize = 240 }) {
  if (!url) return false;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  try {
    let qr = '';
    if (svg) {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();
      const size = qrSize * 2;             // doppelte Auflösung, scannt auch ausgedruckt
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      qr = `<p><img src="${canvas.toDataURL('image/png')}" width="${qrSize}" height="${qrSize}" alt="QR-Code"></p>`;
    }
    const html = `<html><body>
<h1>${esc(title)}</h1>
${lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('\n')}
${qr}
<p><b>Link:</b> <a href="${esc(url)}">${esc(url)}</a></p>
</body></html>`;
    const text = [title, '', ...lines.filter(Boolean), '', `Link: ${url}`].join('\n');
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Kopiert einen QR-Code (SVG) als PNG in die Zwischenablage – zum Einfügen
 * in Arbeitsblätter, Präsentationen oder Moodle. Das SVG wird über ein
 * Canvas gerastert, bewusst großzügig, damit es beim Ausdrucken scharf bleibt.
 *
 * Gibt zurück, ob es geklappt hat; ältere Browser können keine Bilder in die
 * Zwischenablage legen.
 */
export async function copyQrSvgAsPng(svg, size = 600) {
  if (!svg) return false;
  try {
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';           // weißer Grund, sonst scannt es schlecht
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    return await putPngOnClipboard(canvas);
  } catch (_) {
    return false;
  }
}
