/**
 * "🧩 Bild zusammenstellen": mehrere Bilder in einem Raster zu EINEM Bild
 * (Collage). Das Ergebnis ist ein gewöhnliches Bild (data-URL) und landet
 * direkt im Modul – etwa als Hintergrund einer Drag-and-Drop-Aufgabe. Es
 * gibt bewusst keine Verknüpfung zu einem anderen Modul: Das Bild gehört
 * fest zur Aufgabe und funktioniert so auch mit Shop, Export und Kopie.
 *
 * Aufruf: openImageComposer().then((dataUrl) => …)  – null bei Abbruch.
 * Klassisches Skript (wie content-editors.js), daher eine globale Funktion.
 */
(function () {
  const LAYOUTS = [
    { rows: 1, cols: 2, label: '2 nebeneinander' },
    { rows: 1, cols: 3, label: '3 nebeneinander' },
    { rows: 2, cols: 1, label: '2 untereinander' },
    { rows: 2, cols: 2, label: '2 × 2' },
    { rows: 2, cols: 3, label: '2 × 3' },
    { rows: 3, cols: 2, label: '3 × 2' },
    { rows: 3, cols: 3, label: '3 × 3' },
  ];
  const RATIOS = { '4:3': 3 / 4, '1:1': 1, '16:9': 9 / 16, '3:4': 4 / 3 };
  const WIDTH = 1600;          // Breite des fertigen Bildes in Pixeln
  const CAPTION_H = 54;        // Höhe des Beschriftungsstreifens je Zelle

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
      img.src = src;
    });
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  /** Zeichnet die Collage auf ein Canvas. cells: [{ img, caption }] */
  function draw(canvas, s) {
    const gap = s.gap;
    const cellW = Math.floor((WIDTH - gap * (s.cols + 1)) / s.cols);
    const imgH = Math.round(cellW * RATIOS[s.ratio]);
    const capH = s.captions ? CAPTION_H : 0;
    const cellH = imgH + capH;
    canvas.width = WIDTH;
    canvas.height = gap * (s.rows + 1) + cellH * s.rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const cell = s.cells[r * s.cols + c] || {};
        const x = gap + c * (cellW + gap);
        const y = gap + r * (cellH + gap);
        if (cell.img) {
          const iw = cell.img.naturalWidth;
          const ih = cell.img.naturalHeight;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cellW, imgH);
          ctx.clip();
          if (s.fit === 'cover') {
            // Füllen: zuschneiden, Mitte bleibt sichtbar
            const k = Math.max(cellW / iw, imgH / ih);
            ctx.drawImage(cell.img, x + (cellW - iw * k) / 2, y + (imgH - ih * k) / 2, iw * k, ih * k);
          } else {
            // Ganz zeigen: ggf. mit Rand
            const k = Math.min(cellW / iw, imgH / ih);
            ctx.drawImage(cell.img, x + (cellW - iw * k) / 2, y + (imgH - ih * k) / 2, iw * k, ih * k);
          }
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(128,128,128,0.15)';
          ctx.fillRect(x, y, cellW, imgH);
          ctx.fillStyle = 'rgba(100,100,100,0.7)';
          ctx.font = '28px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`Bild ${r * s.cols + c + 1}`, x + cellW / 2, y + imgH / 2);
        }
        if (capH && cell.caption) {
          ctx.fillStyle = s.textColor;
          ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(cell.caption, x + cellW / 2, y + imgH + capH / 2, cellW - 12);
        }
      }
    }
  }

  window.openImageComposer = function openImageComposer() {
    return new Promise((resolve) => {
      const s = {
        rows: 2, cols: 2, ratio: '4:3', fit: 'cover', gap: 12, captions: false,
        background: '#ffffff', textColor: '#1e293b', cells: [],
      };
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card ic-card">
          <h3>🧩 Bild zusammenstellen</h3>
          <p class="hint">Mehrere Bilder werden zu einem Bild – z. B. als Hintergrund für Drag and Drop.
            Feld anklicken, um ein Bild zu wählen.</p>
          <div class="ic-controls">
            <label>Anordnung <select class="ic-layout">${LAYOUTS.map((l, i) =>
              `<option value="${i}" ${l.rows === 2 && l.cols === 2 ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
            <label>Seitenverhältnis <select class="ic-ratio">${Object.keys(RATIOS).map((k) =>
              `<option ${k === '4:3' ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
            <label>Bilder <select class="ic-fit">
              <option value="cover">füllen (zuschneiden)</option><option value="contain">ganz zeigen</option></select></label>
            <label>Abstand <input type="range" class="ic-gap" min="0" max="48" step="4" value="12" /></label>
            <label>Hintergrund <input type="color" class="ic-bg" value="#ffffff" /></label>
            <label class="ic-check"><input type="checkbox" class="ic-captions" /> Beschriftungen</label>
          </div>
          <div class="ic-cells"></div>
          <canvas class="ic-preview"></canvas>
          <div class="confirm-actions">
            <button class="btn btn-primary ic-ok">Übernehmen</button>
            <button class="btn btn-secondary ic-cancel">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const canvas = overlay.querySelector('.ic-preview');
      const cellsBox = overlay.querySelector('.ic-cells');

      const redraw = () => draw(canvas, s);
      const renderCells = () => {
        const n = s.rows * s.cols;
        cellsBox.style.gridTemplateColumns = `repeat(${s.cols}, 1fr)`;
        cellsBox.innerHTML = '';
        for (let i = 0; i < n; i++) {
          const cell = s.cells[i] || (s.cells[i] = {});
          const el = document.createElement('div');
          el.className = 'ic-cell';
          el.innerHTML = `
            <button type="button" class="ic-pick" title="Bild wählen">${cell.img ? `<img src="${cell.img.src}" alt="" />` : `➕ Bild ${i + 1}`}</button>
            ${cell.img ? '<button type="button" class="ic-clear" title="Bild entfernen">✕</button>' : ''}
            <input type="text" class="ic-caption ${s.captions ? '' : 'hidden'}" placeholder="Beschriftung" value="${esc(cell.caption || '')}" maxlength="40" />`;
          el.querySelector('.ic-pick').addEventListener('click', async () => {
            const src = await pickFile();
            if (!src) return;
            try {
              cell.img = await loadImage(src);
              renderCells();
              redraw();
            } catch (err) { window.alert(err.message); }
          });
          el.querySelector('.ic-clear')?.addEventListener('click', () => { cell.img = null; renderCells(); redraw(); });
          el.querySelector('.ic-caption').addEventListener('input', (e) => { cell.caption = e.target.value; redraw(); });
          cellsBox.appendChild(el);
        }
      };

      overlay.querySelector('.ic-layout').addEventListener('change', (e) => {
        const l = LAYOUTS[Number(e.target.value)];
        s.rows = l.rows; s.cols = l.cols;
        renderCells(); redraw();
      });
      overlay.querySelector('.ic-ratio').addEventListener('change', (e) => { s.ratio = e.target.value; redraw(); });
      overlay.querySelector('.ic-fit').addEventListener('change', (e) => { s.fit = e.target.value; redraw(); });
      overlay.querySelector('.ic-gap').addEventListener('input', (e) => { s.gap = Number(e.target.value); redraw(); });
      overlay.querySelector('.ic-bg').addEventListener('input', (e) => { s.background = e.target.value; redraw(); });
      overlay.querySelector('.ic-captions').addEventListener('change', (e) => { s.captions = e.target.checked; renderCells(); redraw(); });

      const close = (value) => { overlay.remove(); resolve(value); };
      overlay.querySelector('.ic-cancel').addEventListener('click', () => close(null));
      overlay.querySelector('.ic-ok').addEventListener('click', () => {
        const used = s.cells.slice(0, s.rows * s.cols).filter((c) => c.img).length;
        if (!used) { window.alert('Bitte mindestens ein Bild wählen.'); return; }
        redraw();
        close(canvas.toDataURL('image/jpeg', 0.9));
      });

      renderCells();
      redraw();
    });
  };
})();
