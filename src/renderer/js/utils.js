// ==================== UTILITY FUNCTIONS ====================

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Mischt eine Farbe mit Weiss und liefert wieder einen vollen Hex-Wert.
 * Sieht aus wie dieselbe Farbe mit wenig Deckkraft auf weissem Grund, ist
 * aber undurchsichtig - was darunter liegt, bleibt damit verdeckt.
 *
 * `ratio` ist der Farbanteil: 0.25 entspricht optisch alpha 0.25.
 */
export function hexTint(hex, ratio) {
  const mix = (v) => Math.round(255 + (v - 255) * ratio);
  const r = mix(parseInt(hex.slice(1, 3), 16));
  const g = mix(parseInt(hex.slice(3, 5), 16));
  const b = mix(parseInt(hex.slice(5, 7), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

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

export function sanitizeModuleDescriptionHtml(html) {
  const allowedTags = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'SPAN', 'FONT']);
  const template = document.createElement('template');
  template.innerHTML = html || '';

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tag = node.tagName.toUpperCase();
    const fragment = document.createDocumentFragment();

    if (!allowedTags.has(tag)) {
      Array.from(node.childNodes).forEach((child) => {
        fragment.appendChild(sanitizeNode(child));
      });
      return fragment;
    }

    const clean = document.createElement(tag.toLowerCase());

    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:|mailto:|#)/i.test(href)) {
        clean.setAttribute('href', href);
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (tag === 'TH' || tag === 'TD') {
      const colspan = node.getAttribute('colspan');
      const rowspan = node.getAttribute('rowspan');
      if (colspan && /^\d+$/.test(colspan)) clean.setAttribute('colspan', colspan);
      if (rowspan && /^\d+$/.test(rowspan)) clean.setAttribute('rowspan', rowspan);
    }

    if (tag === 'FONT') {
      const size = node.getAttribute('size');
      if (size && /^[1-7]$/.test(size)) clean.setAttribute('size', size);
    }

    const style = node.getAttribute('style') || '';
    const textAlignMatch = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
    if (textAlignMatch && ['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TH', 'TD', 'SPAN'].includes(tag)) {
      clean.style.textAlign = textAlignMatch[1].toLowerCase();
    }
    const marginBottomMatch = style.match(/margin-bottom\s*:\s*(\d+px)/i);
    if (marginBottomMatch && ['P', 'H1', 'H2', 'H3', 'DIV', 'LI', 'UL', 'OL'].includes(tag)) {
      clean.style.marginBottom = marginBottomMatch[1].toLowerCase();
    }

    Array.from(node.childNodes).forEach((child) => {
      clean.appendChild(sanitizeNode(child));
    });

    return clean;
  };

  const out = document.createElement('div');
  Array.from(template.content.childNodes).forEach((child) => {
    out.appendChild(sanitizeNode(child));
  });

  return out.innerHTML;
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
