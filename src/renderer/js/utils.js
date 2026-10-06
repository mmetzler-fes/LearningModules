// ==================== UTILITY FUNCTIONS ====================

/**
 * Freigabelinks auf die Datei selbst umbiegen. Ein Nextcloud-Link
 * ".../s/<Kürzel>" öffnet eine Webseite; erst ".../s/<Kürzel>/download"
 * liefert die Datei – ein <img> oder <audio> mit der Webseite bleibt leer.
 * (Kopie in hotspot-editor.js, das als klassisches Skript nicht importiert.)
 */
export function normalizeShareUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = /^(https?:\/\/[^?#]+?\/(?:index\.php\/)?s\/[A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(u);
  return m ? `${m[1]}/download` : u;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

export function sanitizeModuleDescriptionHtml(html) {
  return sanitizeRichHtml(html, false);
}

/**
 * Inhalt eines Arbeitsblatts. Wie die Modulbeschreibung, zusätzlich Bilder
 * (nur als data:-Bild oder https), H4, Unter-/Hochstellung, Trennlinien und
 * Textrahmen (div.ws-box) – das, was der .odt-Import erzeugt.
 */
/** Erlaubte Klassen an Bildern im Arbeitsblatt (siehe .worksheet-content in styles.css). */
export const WORKSHEET_IMAGE_CLASSES = new Set(['ws-float-left', 'ws-float-right', 'ws-img-center', 'ws-img-border']);

export function sanitizeWorksheetHtml(html) {
  return sanitizeRichHtml(html, true);
}

function sanitizeRichHtml(html, worksheet) {
  const allowedTags = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'SPAN', 'FONT']);
  if (worksheet) ['IMG', 'H4', 'SUB', 'SUP', 'HR', 'DIV'].forEach((t) => allowedTags.add(t));
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

    if (tag === 'IMG') {
      // Kein SVG als Adresse von außen und nichts außer Bildern: Ein
      // data:-Bild bzw. https-Bild führt im <img> kein Skript aus.
      const src = node.getAttribute('src') || '';
      if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src) && !/^https:\/\//i.test(src)) {
        return document.createDocumentFragment();
      }
      clean.setAttribute('src', src);
      const alt = node.getAttribute('alt');
      if (alt) clean.setAttribute('alt', alt);
      const width = node.getAttribute('width');
      if (width && /^\d{1,4}$/.test(width)) clean.setAttribute('width', width);
      // Lage und Rahmen eines Bildes – nur diese festen Klassen, kein freies CSS.
      const classes = (node.getAttribute('class') || '').split(/\s+/).filter((c) => WORKSHEET_IMAGE_CLASSES.has(c));
      if (worksheet && classes.length) clean.className = classes.join(' ');
    }

    if (tag === 'DIV' && node.classList.contains('ws-box')) clean.className = 'ws-box';

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

/**
 * Kleines Kontextmenue an der Zeigerposition. Schliesst bei Klick daneben,
 * Escape, Scrollen oder wenn ein Eintrag gewaehlt wurde.
 * items: [{ label, onClick, danger }]
 *
 * Gleiche Funktion wie in content-editors.js (klassisches Skript, kann nicht
 * importieren).
 */
export function showContextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m._close());
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('blur', close);
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  menu._close = close;
  items.forEach(({ label, onClick, danger }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-menu-item' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { close(); onClick(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('blur', close);
}

/**
 * Ziehen per Pointer-Events statt nativem HTML5-Drag&Drop, damit Finger und
 * Stift ein Element sofort bewegen. Natives Drag&Drop startet auf dem iPad
 * erst nach langem Druecken. Vorbild ist pointerDrag.ts in LibreSpice.
 *
 * Waehrend des Ziehens folgt eine Kopie (Geist) dem Zeiger; das Original
 * bekommt die Klasse `dragging`. Losgelassen wird per elementFromPoint
 * ermittelt, worueber das Element liegt.
 *
 * Optionen:
 *  - onHover(target, info)  bei jeder Bewegung, am Ende mit null
 *  - onDrop(target, info)   beim Loslassen nach einer echten Bewegung
 *                           info = { x, y, rect, pointerType }: Zeigerposition
 *                           und Rechteck der mitgezogenen Kopie, damit der
 *                           Aufrufer auch knapp daneben noch einrasten kann
 *  - onLongPress(x, y)      Finger/Stift ruht LONG_PRESS_MS lang (Ersatz fuer
 *                           Rechtsklick, iPadOS kennt kein contextmenu)
 *  - canLongPress()         ob der lange Druck gerade etwas ausloesen soll
 *  - canDrag()              ob das Element gerade ziehbar ist (z. B. nur eine
 *                           gefuellte Luecke)
 *  - scrollContainer        wird am oberen/unteren Rand mitgescrollt
 *
 * Ein Tippen ohne Bewegung bleibt ein normaler click.
 */
// Ab dieser Bewegung wird gezogen. Fuer Finger groesser: Ein ruhig
// gehaltener Finger zittert, das darf den langen Druck nicht abbrechen.
const DRAG_THRESHOLD = { mouse: 4, pen: 6, touch: 10 };
const LONG_PRESS_MS = 500;

// Der click, den der Browser nach Ziehen bzw. langem Druck noch nachschiebt,
// darf nichts ausloesen (sonst wanderte das Element per Klick weiter). Ein
// Klick ins gerade geoeffnete Kontextmenue bleibt erlaubt.
function swallowNextClick() {
  const stop = (e) => {
    if (e.target.closest && e.target.closest('.ctx-menu')) return;
    e.stopPropagation(); e.preventDefault();
    window.removeEventListener('click', stop, true);
  };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 400);
}

export function attachPointerDrag(el, { onHover, onDrop, onLongPress, canLongPress, canDrag, scrollContainer } = {}) {
  el.draggable = false;
  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (canDrag && !canDrag()) return;
    const id = e.pointerId;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, offX = 0, offY = 0;
    let scrollSpeed = 0, scrollTimer = null;
    let pressTimer = null;

    if (onLongPress && e.pointerType !== 'mouse' && (!canLongPress || canLongPress())) {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        cleanup();
        swallowNextClick();
        onLongPress(x0, y0);
      }, LONG_PRESS_MS);
    }

    const hit = (ev) => document.elementFromPoint(ev.clientX, ev.clientY);
    const info = (ev) => ({
      x: ev.clientX, y: ev.clientY, pointerType: e.pointerType,
      rect: ghost ? ghost.getBoundingClientRect() : null,
    });

    const autoScroll = (ev) => {
      if (!scrollContainer) return;
      const r = scrollContainer.getBoundingClientRect();
      scrollSpeed = ev.clientY - r.top < 60 ? -15 : r.bottom - ev.clientY < 60 ? 15 : 0;
      if (scrollSpeed && !scrollTimer) {
        scrollTimer = setInterval(() => { scrollContainer.scrollTop += scrollSpeed; }, 20);
      } else if (!scrollSpeed && scrollTimer) {
        clearInterval(scrollTimer); scrollTimer = null;
      }
    };

    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < (DRAG_THRESHOLD[e.pointerType] ?? 6)) return;
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        const r = el.getBoundingClientRect();
        offX = x0 - r.left; offY = y0 - r.top;
        ghost = el.cloneNode(true);
        // Ohne id und data-*: Die Kopie soll fuer keine Auswertung wie ein
        // echtes Element aussehen.
        ghost.removeAttribute('id');
        Object.keys(ghost.dataset).forEach((k) => delete ghost.dataset[k]);
        ghost.classList.add('drag-ghost');
        Object.assign(ghost.style, {
          position: 'fixed', margin: '0', width: r.width + 'px',
          pointerEvents: 'none', zIndex: '10000',
        });
        document.body.appendChild(ghost);
        el.classList.add('dragging');
      }
      ev.preventDefault();
      ghost.style.left = (ev.clientX - offX) + 'px';
      ghost.style.top = (ev.clientY - offY) + 'px';
      if (onHover) onHover(hit(ev), info(ev));
      autoScroll(ev);
    };

    const end = (ev) => {
      if (ev.pointerId !== id) return;
      const dragged = !!ghost;
      // Ziel noch im Ziehzustand bestimmen (Zoneninhalte sind dann per CSS
      // nicht treffbar, es zaehlt die Zone selbst).
      const drop = dragged && ev.type === 'pointerup' ? { target: hit(ev), info: info(ev) } : null;
      cleanup();
      if (dragged) {
        swallowNextClick();
        if (drop && drop.target && onDrop) onDrop(drop.target, drop.info);
      }
    };

    function cleanup() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('dragging');
      if (onHover) onHover(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    }

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
