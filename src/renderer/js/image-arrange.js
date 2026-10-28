// ==================== ZEICHENRAHMEN ANORDNEN (DIALOG) ====================
//
// „✥ Anordnen“ an einem Zeichenrahmen (Baustein `group`): Bilder und
// Textfenster ziehen, an der Ecke größer und kleiner ziehen (Bilder behalten
// ihr Seitenverhältnis), mit den Pfeiltasten fein schieben. Textfenster
// bekommen Text, Schriftgröße, Ausrichtung, Rand und Hintergrund. Der Rahmen
// ist danach so groß wie seine Teile zusammen (image-group.js, fromCm);
// „Breite“ skaliert alles gemeinsam – auch die Schrift.

import { toCm, fromCm, groupRow, ungroup, GROUP_MAX_WIDTH_CM } from '../lm-editor/src/doc/image-group.js';
import { FRAME_FILLS, FRAME_TEXT_COLORS, isTextItem, richText } from '../lm-editor/src/doc/docspec.js';
import { escapeHtml } from './utils.js';

const STEP = 0.1; // cm – Raster beim Ziehen und für die Pfeiltasten
const snap = (v) => Math.round(v / STEP) * STEP;
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const PT_CM = 2.54 / 72;
const FILL_NAMES = { weiss: 'Weiß', grau: 'Grau', gelb: 'Gelb', gruen: 'Grün', blau: 'Blau', rosa: 'Rosa', orange: 'Orange', lila: 'Lila' };

/**
 * Dialog öffnen. Ergebnis: { block, extracted } (extracted: herausgelöste
 * Teile als Bild- bzw. Text-Bausteine, kommen hinter den Rahmen),
 * { ungroup: [Bausteine] } oder null (Abbrechen).
 */
export function arrangeGroup(block) {
  return new Promise((resolve) => {
    let { widthCm: stageCm, items } = toCm(block);
    items = items.map((it) => ({ ...it }));
    const extracted = [];
    let selected = null;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<form class="import-modules-card ds-widget-dialog ig-dialog" novalidate>
        <h3>✥ Zeichenrahmen anordnen</h3>
        <p class="hint">Bilder und Textfenster ziehen; an der Ecke ziehen ändert die Größe. Pfeiltasten schieben das gewählte Teil (mit Umschalt weiter). Doppelklick auf ein Textfenster: Text bearbeiten.</p>
        <div class="ds-field-form">
          <label>Breite <input type="number" class="ig-width" min="1" max="${GROUP_MAX_WIDTH_CM}" step="0.1"> cm</label>
          <span class="ig-size hint"></span>
          <label>Lage <select class="ig-align"><option value="">wie der Text der Vorlage</option><option value="left">links</option><option value="center">mittig</option><option value="right">rechts</option></select></label>
          <label><input type="checkbox" class="ig-border"> Rand</label>
        </div>
        <div class="ig-stage-wrap"><div class="ig-stage" tabindex="0"><div class="ig-bbox"></div></div></div>
        <div class="ig-tools">
          <button type="button" class="btn btn-secondary btn-sm" data-ig="text" title="Neues Textfenster unter den übrigen Teilen">T Textfenster</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="row" title="Alle Bilder gleich hoch nebeneinander">▭▭ Bilder als Reihe</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="front" title="Gewähltes Teil nach vorn">⬆ Nach vorn</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="back" title="Gewähltes Teil nach hinten">⬇ Nach hinten</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="out" title="Gewähltes Teil als eigenen Baustein hinter den Rahmen">⇲ Aus dem Rahmen lösen</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="del" title="Gewähltes Teil entfernen">✕ Entfernen</button>
        </div>
        <div class="ig-text-form" hidden>
          <textarea class="ig-text" rows="2" placeholder="Text – **fett**, *kursiv*, [farbig]{blau}"></textarea>
          <div class="ds-field-form">
            <label>Schrift <input type="number" class="ig-tsize" min="4" max="72" step="0.5"> pt</label>
            <label>Ausrichtung <select class="ig-talign"><option value="left">links</option><option value="center">mittig</option><option value="right">rechts</option></select></label>
            <label>Farbe <select class="ig-tcolor"><option value="">schwarz</option>${Object.keys(FRAME_TEXT_COLORS).map((k) => `<option value="${k}">${FILL_NAMES[k] || k}</option>`).join('')}</select></label>
            <label><input type="checkbox" class="ig-tborder"> Rand</label>
            <label>Hintergrund <select class="ig-tfill"><option value="">keiner</option>${Object.keys(FRAME_FILLS).map((k) => `<option value="${k}">${FILL_NAMES[k] || k}</option>`).join('')}</select></label>
          </div>
        </div>
        <div class="ds-field-form"><label class="ig-caption-label">Unterschrift <input type="text" class="ig-caption"></label></div>
        <p class="ds-error"></p>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Übernehmen</button>
          <button type="button" class="btn btn-secondary ig-ungroup" title="Jedes Bild wird wieder ein eigenes Bild, jedes Textfenster ein Absatz">⊟ Gruppierung lösen</button>
          <button type="button" class="btn btn-secondary ig-cancel">Abbrechen</button>
        </div></form>`;
    document.body.appendChild(overlay);
    const $ = (sel) => overlay.querySelector(sel);
    const stage = $('.ig-stage');
    const bbox = $('.ig-bbox');
    const widthInput = $('.ig-width');
    const sizeInfo = $('.ig-size');
    const caption = $('.ig-caption');
    const textForm = $('.ig-text-form');
    const err = $('.ds-error');
    caption.value = block.caption || '';
    $('.ig-align').value = ['left', 'center', 'right'].includes(block.align) ? block.align : '';
    $('.ig-border').checked = !!block.border;

    const bounds = () => {
      if (!items.length) return { x0: 0, y0: 0, w: stageCm, h: 0 };
      const x0 = Math.min(...items.map((i) => i.x));
      const y0 = Math.min(...items.map((i) => i.y));
      return { x0, y0, w: Math.max(...items.map((i) => i.x + i.w)) - x0, h: Math.max(...items.map((i) => i.y + i.h)) - y0 };
    };
    // Bildschirm-Pixel je cm: Die Bühne ist so breit wie der Rahmen beim Öffnen (bzw. nach „Breite“).
    let scale = 1;
    const layout = () => {
      // Rand für die Griffe an den Ecken (ragen über das Teil hinaus).
      const avail = Math.min(900, ($('.ig-stage-wrap').clientWidth || 620) - 20);
      scale = avail / stageCm;
      const b = bounds();
      stage.style.width = `${stageCm * scale}px`;
      stage.style.height = `${(Math.max(b.y0 + b.h, stageCm * 0.2) + 3) * scale}px`;
    };
    const place = (node, it) => {
      node.style.left = `${it.x * scale}px`;
      node.style.top = `${it.y * scale}px`;
      node.style.width = `${it.w * scale}px`;
      node.style.height = `${it.h * scale}px`;
    };
    const textLook = (node, it) => {
      node.style.fontSize = `${(it.size || 11) * PT_CM * scale}px`;
      node.style.padding = `${2 * PT_CM * scale}px ${4 * PT_CM * scale}px`;
      node.style.textAlign = it.align || 'left';
      node.style.background = it.fill ? FRAME_FILLS[it.fill] : '';
      node.style.color = it.color ? FRAME_TEXT_COLORS[it.color] : '';
      node.style.border = it.border ? '1px solid #000' : '';
    };
    const showBox = () => {
      const b = bounds();
      bbox.style.cssText = `left:${b.x0 * scale}px;top:${b.y0 * scale}px;width:${b.w * scale}px;height:${b.h * scale}px`;
      sizeInfo.textContent = items.length ? `Rahmen: ${fmt(b.w)} × ${fmt(b.h)} cm` : 'Rahmen leer';
    };
    const draw = () => {
      layout();
      stage.querySelectorAll('.ig-item').forEach((n) => n.remove());
      items.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = `ig-item${isTextItem(it) ? ' ig-text-item' : ''}${it === selected ? ' ig-selected' : ''}`;
        el.dataset.i = String(i);
        place(el, it);
        if (isTextItem(it)) {
          textLook(el, it);
          el.innerHTML = `<div class="ig-text-body">${String(it.text).split('\n').map((l) => richText(l) || '&nbsp;').join('<br>')}</div><span class="ig-grip" title="Größe ziehen"></span>`;
        } else {
          el.innerHTML = `<img src="${escapeHtml(it.src)}" alt="${escapeHtml(it.alt || '')}" draggable="false"><span class="ig-grip" title="Größe ziehen"></span>`;
        }
        stage.appendChild(el);
      });
      showBox();
      const b = bounds();
      if (document.activeElement !== widthInput && items.length) widthInput.value = String(Math.round(b.w * 10) / 10);
      ['front', 'back', 'del'].forEach((act) => { $(`[data-ig="${act}"]`).disabled = !selected; });
      $('[data-ig="out"]').disabled = !selected || items.length < 2;
      // Felder des gewählten Textfensters
      textForm.hidden = !(selected && isTextItem(selected));
      if (!textForm.hidden && !textForm.contains(document.activeElement)) {
        $('.ig-text').value = selected.text;
        $('.ig-tsize').value = String(selected.size || 11);
        $('.ig-talign').value = selected.align || 'left';
        $('.ig-tborder').checked = !!selected.border;
        $('.ig-tfill').value = selected.fill || '';
        $('.ig-tcolor').value = selected.color || '';
      }
    };

    stage.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.ig-item');
      selected = el ? items[Number(el.dataset.i)] : null;
      stage.focus({ preventScroll: true });
      if (!el) { draw(); return; }
      e.preventDefault();
      const it = selected;
      const resize = !!e.target.closest('.ig-grip');
      const start = { x: it.x, y: it.y, w: it.w, h: it.h, cx: e.clientX, cy: e.clientY };
      const aspect = it.w / it.h;
      stage.setPointerCapture(e.pointerId);
      draw();
      const node = stage.querySelector(`.ig-item[data-i="${items.indexOf(it)}"]`);
      const move = (ev) => {
        const dx = (ev.clientX - start.cx) / scale;
        const dy = (ev.clientY - start.cy) / scale;
        if (resize && isTextItem(it)) {
          // Textfenster: Breite und Höhe frei.
          it.w = Math.max(0.5, Math.min(stageCm - it.x, snap(start.w + dx)));
          it.h = Math.max(0.4, snap(start.h + dy));
        } else if (resize) {
          // Bild: die größere Bewegung zählt, das Seitenverhältnis bleibt.
          const w = Math.max(0.5, Math.min(stageCm - it.x, snap(Math.max(start.w + dx, (start.h + dy) * aspect))));
          it.w = w;
          it.h = w / aspect;
        } else {
          it.x = Math.max(0, Math.min(stageCm - it.w, snap(start.x + dx)));
          it.y = Math.max(0, snap(start.y + dy));
        }
        place(node, it);
        showBox();
      };
      const up = () => {
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        draw();
      };
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
    });
    stage.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.ig-text-item');
      if (el) { $('.ig-text').focus(); $('.ig-text').select(); }
    });

    overlay.addEventListener('keydown', (e) => {
      if (!selected || e.target.matches('input, textarea, select')) return;
      if (e.key === 'Delete') { e.preventDefault(); items.splice(items.indexOf(selected), 1); selected = null; draw(); return; }
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const d = e.shiftKey ? 1 : STEP;
      if (e.key === 'ArrowLeft') selected.x = Math.max(0, selected.x - d);
      if (e.key === 'ArrowRight') selected.x = Math.min(stageCm - selected.w, selected.x + d);
      if (e.key === 'ArrowUp') selected.y = Math.max(0, selected.y - d);
      if (e.key === 'ArrowDown') selected.y += d;
      draw();
    });

    // Felder des Textfensters wirken sofort.
    const editText = () => {
      if (!selected || !isTextItem(selected)) return;
      selected.text = $('.ig-text').value;
      const size = Number(String($('.ig-tsize').value).replace(',', '.'));
      if (size >= 4 && size <= 72) selected.size = Math.round(size * 2) / 2;
      selected.align = $('.ig-talign').value;
      selected.border = $('.ig-tborder').checked;
      selected.fill = $('.ig-tfill').value;
      selected.color = $('.ig-tcolor').value;
      draw();
    };
    textForm.addEventListener('input', editText);
    textForm.addEventListener('change', editText);

    // Breite: alles gemeinsam größer oder kleiner, die Bühne wächst mit – die Schrift auch.
    widthInput.addEventListener('change', () => {
      const next = Math.max(1, Math.min(GROUP_MAX_WIDTH_CM, Number(String(widthInput.value).replace(',', '.')) || 0));
      const b = bounds();
      if (!next || !b.w || !items.length) return;
      const f = next / b.w;
      items.forEach((it) => {
        it.x = (it.x - b.x0) * f; it.y = (it.y - b.y0) * f; it.w *= f; it.h *= f;
        if (isTextItem(it)) it.size = Math.max(4, Math.min(72, Math.round((it.size || 11) * f * 2) / 2));
      });
      stageCm = next;
      draw();
    });

    $('.ig-tools').addEventListener('click', (e) => {
      const act = e.target.closest('[data-ig]')?.dataset.ig;
      if (!act) return;
      if (act === 'text') {
        const b = bounds();
        const it = { text: 'Text', size: 11, x: 0, y: items.length ? b.y0 + b.h + 0.3 : 0, w: Math.min(6, stageCm), h: 1 };
        items.push(it);
        selected = it;
        draw();
        $('.ig-text').focus();
        $('.ig-text').select();
        return;
      }
      if (act === 'row') {
        const images = items.filter((it) => !isTextItem(it));
        if (!images.length) return;
        const row = toCm(groupRow(images.map((it) => ({ src: it.src, alt: it.alt, source: it.source, aspect: it.w / it.h })), bounds().w));
        // Textfenster bleiben, wo sie sind; die Reihe beginnt oben links.
        items = [...row.items, ...items.filter(isTextItem)];
        selected = null;
      } else if (selected && (act === 'front' || act === 'back')) {
        items.splice(items.indexOf(selected), 1);
        if (act === 'front') items.push(selected); else items.unshift(selected);
      } else if (selected && act === 'del') {
        items.splice(items.indexOf(selected), 1);
        selected = null;
      } else if (selected && act === 'out' && items.length > 1) {
        items.splice(items.indexOf(selected), 1);
        extracted.push(isTextItem(selected)
          ? { type: 'text', text: String(selected.text).split('\n').join('\n\n') }
          : { type: 'image', src: selected.src, ...(selected.alt ? { alt: selected.alt } : {}), width: `${Math.round(selected.w * 100) / 100}cm`, ...(selected.source ? { source: selected.source } : {}) });
        selected = null;
      }
      draw();
    });

    const close = (result) => {
      window.removeEventListener('resize', draw);
      overlay.remove();
      resolve(result);
    };
    const current = () => {
      const base = { ...block };
      if (caption.value.trim()) base.caption = caption.value.trim(); else delete base.caption;
      if ($('.ig-align').value) base.align = $('.ig-align').value; else delete base.align;
      if ($('.ig-border').checked) base.border = true; else delete base.border;
      return fromCm(items, base);
    };
    $('.ig-cancel').addEventListener('click', () => close(null));
    $('.ig-ungroup').addEventListener('click', () => close({ ungroup: [...(items.length ? ungroup(current()) : []), ...extracted] }));
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!items.length) { err.textContent = 'Der Rahmen ist leer – ein Textfenster oder Bild hinzufügen, oder „Gruppierung lösen“.'; return; }
      close({ block: current(), extracted });
    });
    window.addEventListener('resize', draw);
    requestAnimationFrame(draw);
  });
}
