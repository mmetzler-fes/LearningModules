// ==================== BILDGRUPPE ANORDNEN (DIALOG) ====================
//
// „✥ Anordnen“ an einer Bildgruppe (Baustein `group`): Bilder ziehen, an der
// Ecke größer und kleiner ziehen (Seitenverhältnis bleibt), mit den Pfeiltasten
// fein schieben. Die Gruppe ist danach so groß wie ihre Bilder zusammen
// (image-group.js, fromCm); „Breite“ skaliert alles gemeinsam.

import { toCm, fromCm, groupRow, ungroup, GROUP_MAX_WIDTH_CM } from '../lm-editor/src/doc/image-group.js';
import { escapeHtml } from './utils.js';

const STEP = 0.1; // cm – Raster beim Ziehen und für die Pfeiltasten
const snap = (v) => Math.round(v / STEP) * STEP;
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Dialog öffnen. Ergebnis: { block, extracted } (extracted: herausgelöste
 * Bilder als Bild-Bausteine, kommen hinter die Gruppe), { ungroup: [Bild-Bausteine] }
 * oder null (Abbrechen).
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
        <h3>✥ Bildgruppe anordnen</h3>
        <p class="hint">Bilder ziehen; an der Ecke ziehen ändert die Größe. Pfeiltasten schieben das gewählte Bild (mit Umschalt weiter).</p>
        <div class="ds-field-form">
          <label>Breite <input type="number" class="ig-width" min="1" max="${GROUP_MAX_WIDTH_CM}" step="0.1"> cm</label>
          <span class="ig-size hint"></span>
        </div>
        <div class="ig-stage-wrap"><div class="ig-stage" tabindex="0"><div class="ig-bbox"></div></div></div>
        <div class="ig-tools">
          <button type="button" class="btn btn-secondary btn-sm" data-ig="row" title="Alle Bilder gleich hoch nebeneinander">▭▭ Als Reihe</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="front" title="Gewähltes Bild nach vorn">⬆ Nach vorn</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="back" title="Gewähltes Bild nach hinten">⬇ Nach hinten</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ig="out" title="Gewähltes Bild als eigenes Bild hinter die Gruppe">⇲ Aus der Gruppe lösen</button>
        </div>
        <div class="ds-field-form"><label class="ig-caption-label">Unterschrift <input type="text" class="ig-caption"></label></div>
        <p class="ds-error"></p>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Übernehmen</button>
          <button type="button" class="btn btn-secondary ig-ungroup" title="Jedes Bild wird wieder ein eigenes Bild">⊟ Gruppierung lösen</button>
          <button type="button" class="btn btn-secondary ig-cancel">Abbrechen</button>
        </div></form>`;
    document.body.appendChild(overlay);
    const stage = overlay.querySelector('.ig-stage');
    const bbox = overlay.querySelector('.ig-bbox');
    const widthInput = overlay.querySelector('.ig-width');
    const sizeInfo = overlay.querySelector('.ig-size');
    const caption = overlay.querySelector('.ig-caption');
    const err = overlay.querySelector('.ds-error');
    caption.value = block.caption || '';

    const bounds = () => {
      const x0 = Math.min(...items.map((i) => i.x));
      const y0 = Math.min(...items.map((i) => i.y));
      return { x0, y0, w: Math.max(...items.map((i) => i.x + i.w)) - x0, h: Math.max(...items.map((i) => i.y + i.h)) - y0 };
    };
    // Bildschirm-Pixel je cm: Die Bühne ist so breit wie die Gruppe beim Öffnen (bzw. nach „Breite“).
    let scale = 1;
    const layout = () => {
      // Rand für die Griffe an den Ecken (ragen über das Bild hinaus).
      const avail = Math.min(900, (overlay.querySelector('.ig-stage-wrap').clientWidth || 620) - 20);
      scale = avail / stageCm;
      const b = bounds();
      stage.style.width = `${stageCm * scale}px`;
      stage.style.height = `${(Math.max(b.y0 + b.h, stageCm * 0.2) + 3) * scale}px`;
    };
    const draw = () => {
      layout();
      stage.querySelectorAll('.ig-item').forEach((n) => n.remove());
      items.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = `ig-item${it === selected ? ' ig-selected' : ''}`;
        el.dataset.i = String(i);
        el.style.cssText = `left:${it.x * scale}px;top:${it.y * scale}px;width:${it.w * scale}px;height:${it.h * scale}px`;
        el.innerHTML = `<img src="${escapeHtml(it.src)}" alt="${escapeHtml(it.alt || '')}" draggable="false"><span class="ig-grip" title="Größe ziehen"></span>`;
        stage.appendChild(el);
      });
      const b = bounds();
      bbox.style.cssText = `left:${b.x0 * scale}px;top:${b.y0 * scale}px;width:${b.w * scale}px;height:${b.h * scale}px`;
      sizeInfo.textContent = `Gruppe: ${fmt(b.w)} × ${fmt(b.h)} cm`;
      if (document.activeElement !== widthInput) widthInput.value = String(Math.round(b.w * 10) / 10);
      overlay.querySelectorAll('[data-ig="front"], [data-ig="back"], [data-ig="out"]').forEach((btn) => { btn.disabled = !selected; });
      overlay.querySelector('[data-ig="out"]').disabled = !selected || items.length < 2;
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
        if (resize) {
          // Ecke unten rechts: die größere Bewegung zählt, das Seitenverhältnis bleibt.
          const w = Math.max(0.5, Math.min(stageCm - it.x, snap(Math.max(start.w + dx, (start.h + dy) * aspect))));
          it.w = w;
          it.h = w / aspect;
        } else {
          it.x = Math.max(0, Math.min(stageCm - it.w, snap(start.x + dx)));
          it.y = Math.max(0, snap(start.y + dy));
        }
        node.style.cssText = `left:${it.x * scale}px;top:${it.y * scale}px;width:${it.w * scale}px;height:${it.h * scale}px`;
        const b = bounds();
        bbox.style.cssText = `left:${b.x0 * scale}px;top:${b.y0 * scale}px;width:${b.w * scale}px;height:${b.h * scale}px`;
        sizeInfo.textContent = `Gruppe: ${fmt(b.w)} × ${fmt(b.h)} cm`;
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

    overlay.addEventListener('keydown', (e) => {
      if (!selected || !e.key.startsWith('Arrow') || e.target.matches('input')) return;
      e.preventDefault();
      const d = e.shiftKey ? 1 : STEP;
      if (e.key === 'ArrowLeft') selected.x = Math.max(0, selected.x - d);
      if (e.key === 'ArrowRight') selected.x = Math.min(stageCm - selected.w, selected.x + d);
      if (e.key === 'ArrowUp') selected.y = Math.max(0, selected.y - d);
      if (e.key === 'ArrowDown') selected.y += d;
      draw();
    });

    // Breite: alles gemeinsam größer oder kleiner, die Bühne wächst mit.
    widthInput.addEventListener('change', () => {
      const next = Math.max(1, Math.min(GROUP_MAX_WIDTH_CM, Number(String(widthInput.value).replace(',', '.')) || 0));
      const b = bounds();
      if (!next || !b.w) return;
      const f = next / b.w;
      items.forEach((it) => { it.x = (it.x - b.x0) * f; it.y = (it.y - b.y0) * f; it.w *= f; it.h *= f; });
      stageCm = next;
      draw();
    });

    overlay.querySelector('.ig-tools').addEventListener('click', (e) => {
      const act = e.target.closest('[data-ig]')?.dataset.ig;
      if (!act) return;
      if (act === 'row') {
        const row = toCm(groupRow(items.map((it) => ({ src: it.src, alt: it.alt, aspect: it.w / it.h })), bounds().w));
        items = row.items;
        stageCm = row.widthCm;
        selected = null;
      } else if (selected && (act === 'front' || act === 'back')) {
        items.splice(items.indexOf(selected), 1);
        if (act === 'front') items.push(selected); else items.unshift(selected);
      } else if (selected && act === 'out' && items.length > 1) {
        items.splice(items.indexOf(selected), 1);
        extracted.push({ type: 'image', src: selected.src, ...(selected.alt ? { alt: selected.alt } : {}), width: `${Math.round(selected.w * 100) / 100}cm` });
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
      return fromCm(items, base);
    };
    overlay.querySelector('.ig-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.ig-ungroup').addEventListener('click', () => close({ ungroup: [...ungroup(current()), ...extracted] }));
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!items.length) { err.textContent = 'Die Gruppe hat keine Bilder mehr.'; return; }
      close({ block: current(), extracted });
    });
    window.addEventListener('resize', draw);
    requestAnimationFrame(draw);
  });
}
