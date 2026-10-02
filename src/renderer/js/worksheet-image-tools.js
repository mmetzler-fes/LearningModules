/**
 * Bildwerkzeuge für den Arbeitsblatt-Editor (Modultyp "Text / Arbeitsblatt").
 *
 * - "🖼 Bild einfügen" an der Schreibmarke; auch Einfügen aus der
 *   Zwischenablage (Screenshot) und Hineinziehen einer Bilddatei.
 * - Klick auf ein Bild wählt es aus; darunter erscheint eine Leiste:
 *   Breite, Lage (im Text, links/rechts umflossen, eigene Zeile), Rahmen,
 *   Beschreibung (Alt-Text), nach oben/unten verschieben, ersetzen, löschen.
 *
 * Gespeichert wird nur, was die Bereinigung erlaubt: width-Attribut und die
 * festen Klassen aus WORKSHEET_IMAGE_CLASSES (utils.js). Große Fotos werden
 * beim Einfügen verkleinert – sie landen als data:-Bild im Modul.
 *
 * Klassisches Skript (wie content-editors.js), daher eine globale Klasse.
 */
(function () {
  const MAX_EDGE = 1600;            // längste Kante nach dem Verkleinern
  const KEEP_BYTES = 600 * 1024;    // kleinere Dateien bleiben unverändert
  const LAYOUTS = [
    { cls: '', icon: '⎵', title: 'Im Text (wie ein Buchstabe)' },
    { cls: 'ws-float-left', icon: '⬅', title: 'Links, Text fließt rechts vorbei' },
    { cls: 'ws-img-center', icon: '⬛', title: 'Eigene Zeile, mittig' },
    { cls: 'ws-float-right', icon: '➡', title: 'Rechts, Text fließt links vorbei' },
  ];
  const LAYOUT_CLASSES = LAYOUTS.map((l) => l.cls).filter(Boolean);

  /** Datei → data:-URL; Fotos über MAX_EDGE werden verkleinert. */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) {
        reject(new Error('Bitte ein Bild wählen (PNG, JPEG, GIF, WebP oder SVG).'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Die Datei ließ sich nicht lesen.'));
      reader.onload = () => {
        const dataUrl = String(reader.result);
        // SVG und GIF (evtl. animiert) nicht anfassen, kleine Dateien auch nicht.
        if (/svg|gif/.test(file.type)) { resolve({ src: dataUrl }); return; }
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale === 1 && file.size <= KEEP_BYTES) { resolve({ src: dataUrl, width: img.naturalWidth }); return; }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          // Fotos als JPEG, Grafiken mit wenigen Farben/Transparenz als PNG.
          const src = file.type === 'image/jpeg'
            ? canvas.toDataURL('image/jpeg', 0.85)
            : canvas.toDataURL('image/png');
          resolve({ src, width: canvas.width });
        };
        img.onerror = () => resolve({ src: dataUrl });
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  class WorksheetImageTools {
    /**
     * @param editor  die bearbeitbare Fläche (contenteditable)
     * @param hidden  verstecktes Feld, das den HTML-Inhalt zum Speichern hält
     * @param toolbar Werkzeugleiste des Editors (bekommt den Knopf "Bild")
     */
    constructor(editor, hidden, toolbar) {
      this.editor = editor;
      this.hidden = hidden;
      this.selected = null;
      this.savedRange = null;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rt-btn rt-btn-image';
      btn.title = 'Bild einfügen (auch per Einfügen aus der Zwischenablage oder Hineinziehen)';
      btn.textContent = '🖼 Bild';
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // Schreibmarke behalten
      btn.addEventListener('click', () => this.insertFromFile());
      toolbar.appendChild(btn);

      this.panel = this.buildPanel();
      // Zwischen Werkzeugleiste und Text – so bleibt sie auch bei langen Blättern sichtbar.
      editor.parentNode.insertBefore(this.panel, editor);

      // Schreibmarke merken, damit "Bild einfügen" an der richtigen Stelle landet.
      document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
          this.savedRange = sel.getRangeAt(0).cloneRange();
        }
      });

      editor.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') this.select(e.target);
        else this.select(null);
      });
      editor.addEventListener('keydown', (e) => {
        if (!this.selected) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); }
        else if (e.key === 'Escape') this.select(null);
      });
      // Bilder aus der Zwischenablage (Screenshot) – vor dem Text-Einfügen des Editors.
      editor.addEventListener('paste', (e) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.insertFile(file);
      }, true);
      editor.addEventListener('drop', (e) => {
        const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (range) this.savedRange = range;
        this.insertFile(file);
      });
    }

    // ---- Einfügen ----

    async insertFromFile() {
      const file = await pickFile();
      if (file) this.insertFile(file);
    }

    async insertFile(file) {
      let img;
      try {
        img = await readImage(file);
      } catch (err) {
        window.alert(err.message);
        return;
      }
      const el = document.createElement('img');
      el.src = img.src;
      el.alt = (file.name || '').replace(/\.[^.]+$/, '');
      // Nicht breiter als die Fläche – die Breite lässt sich danach anpassen.
      const max = this.contentWidth();
      if (img.width) el.setAttribute('width', String(Math.min(img.width, max)));
      el.className = 'ws-img-center';
      this.insertNode(el);
      this.select(el);
      this.changed();
    }

    /** Bild als eigenen Absatz an der gemerkten Schreibmarke (sonst am Ende). */
    insertNode(el) {
      const p = document.createElement('p');
      p.appendChild(el);
      const range = this.savedRange && this.editor.contains(this.savedRange.commonAncestorContainer) ? this.savedRange : null;
      let block = range ? range.startContainer : null;
      while (block && block !== this.editor && block.parentNode !== this.editor) block = block.parentNode;
      if (block && block !== this.editor) block.after(p);
      else this.editor.appendChild(p);
    }

    contentWidth() {
      const style = getComputedStyle(this.editor);
      return Math.max(100, Math.round(this.editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    }

    // ---- Auswahl und Leiste ----

    buildPanel() {
      const panel = document.createElement('div');
      panel.className = 'ws-image-panel hidden';
      panel.innerHTML = `
        <span class="ws-image-panel-title">🖼 Bild</span>
        <label class="ws-image-width" title="Breite im Verhältnis zur Seitenbreite">
          Breite <input type="range" min="10" max="100" step="5" class="ws-width-range" />
          <span class="ws-width-value"></span>
        </label>
        <span class="ws-image-group" role="group" aria-label="Lage">
          ${LAYOUTS.map((l) => `<button type="button" class="rt-btn ws-layout" data-cls="${l.cls}" title="${l.title}">${l.icon}</button>`).join('')}
        </span>
        <label class="ws-image-check" title="Dünner Rahmen um das Bild"><input type="checkbox" class="ws-border" /> Rahmen</label>
        <input type="text" class="ws-alt" placeholder="Beschreibung (für Screenreader)" maxlength="200" />
        <span class="ws-image-group">
          <button type="button" class="rt-btn ws-up" title="Einen Absatz nach oben">▲</button>
          <button type="button" class="rt-btn ws-down" title="Einen Absatz nach unten">▼</button>
          <button type="button" class="rt-btn ws-replace" title="Anderes Bild an derselben Stelle">⟳ Ersetzen</button>
          <button type="button" class="rt-btn ws-delete" title="Bild löschen (Entf)">🗑</button>
          <button type="button" class="rt-btn ws-close" title="Auswahl aufheben (Esc)">✕</button>
        </span>`;
      // Klicks in der Leiste sollen die Auswahl im Editor nicht verlieren.
      panel.addEventListener('mousedown', (e) => { if (!e.target.matches('input')) e.preventDefault(); });

      const range = panel.querySelector('.ws-width-range');
      range.addEventListener('input', () => {
        if (!this.selected) return;
        const px = Math.round((this.contentWidth() * Number(range.value)) / 100);
        this.selected.setAttribute('width', String(px));
        this.showWidth();
        this.changed();
      });
      panel.querySelectorAll('.ws-layout').forEach((b) => b.addEventListener('click', () => this.setLayout(b.dataset.cls)));
      panel.querySelector('.ws-border').addEventListener('change', (e) => {
        this.selected?.classList.toggle('ws-img-border', e.target.checked);
        this.changed();
      });
      panel.querySelector('.ws-alt').addEventListener('input', (e) => {
        if (!this.selected) return;
        if (e.target.value.trim()) this.selected.alt = e.target.value.trim(); else this.selected.removeAttribute('alt');
        this.changed();
      });
      panel.querySelector('.ws-up').addEventListener('click', () => this.move(-1));
      panel.querySelector('.ws-down').addEventListener('click', () => this.move(1));
      panel.querySelector('.ws-replace').addEventListener('click', () => this.replace());
      panel.querySelector('.ws-delete').addEventListener('click', () => this.remove());
      panel.querySelector('.ws-close').addEventListener('click', () => this.select(null));
      return panel;
    }

    select(img) {
      this.editor.querySelectorAll('img.ws-selected').forEach((i) => i.classList.remove('ws-selected'));
      this.selected = img;
      this.panel.classList.toggle('hidden', !img);
      if (!img) return;
      img.classList.add('ws-selected');
      this.panel.querySelector('.ws-border').checked = img.classList.contains('ws-img-border');
      this.panel.querySelector('.ws-alt').value = img.getAttribute('alt') || '';
      const current = LAYOUT_CLASSES.find((c) => img.classList.contains(c)) || '';
      this.panel.querySelectorAll('.ws-layout').forEach((b) => b.classList.toggle('active', b.dataset.cls === current));
      const width = Number(img.getAttribute('width')) || img.getBoundingClientRect().width;
      this.panel.querySelector('.ws-width-range').value = String(Math.max(10, Math.min(100, Math.round((width / this.contentWidth()) * 100))));
      this.showWidth();
    }

    showWidth() {
      const w = Number(this.selected?.getAttribute('width')) || Math.round(this.selected?.getBoundingClientRect().width || 0);
      this.panel.querySelector('.ws-width-value').textContent = w ? `${w} px` : '';
    }

    setLayout(cls) {
      const img = this.selected;
      if (!img) return;
      LAYOUT_CLASSES.forEach((c) => img.classList.remove(c));
      if (cls) img.classList.add(cls);
      this.select(img);
      this.changed();
    }

    /** Den Absatz mit dem Bild vor den vorigen bzw. hinter den nächsten Block schieben. */
    move(dir) {
      const img = this.selected;
      if (!img) return;
      let block = img;
      while (block.parentNode && block.parentNode !== this.editor) block = block.parentNode;
      if (block.parentNode !== this.editor) return;
      // Steht das Bild mit Text in einem Absatz, wandert es allein in einen eigenen.
      if (block.textContent.trim() || block.querySelectorAll('img').length > 1) {
        const p = document.createElement('p');
        p.appendChild(img);
        block.after(p);
        block = p;
      }
      const target = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
      if (!target) return;
      if (dir < 0) target.before(block); else target.after(block);
      img.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.select(img);
      this.changed();
    }

    async replace() {
      const img = this.selected;
      if (!img) return;
      const file = await pickFile();
      if (!file) return;
      try {
        const data = await readImage(file);
        img.src = data.src;
        this.changed();
      } catch (err) {
        window.alert(err.message);
      }
    }

    remove() {
      const img = this.selected;
      if (!img) return;
      const parent = img.parentNode;
      img.remove();
      // Ein nun leerer Absatz soll keine Lücke hinterlassen.
      if (parent && parent !== this.editor && !parent.textContent.trim() && !parent.querySelector('img,table')) parent.remove();
      this.select(null);
      this.changed();
    }

    /** Inhalt ins versteckte Feld – ohne die Markierung der Auswahl. */
    changed() {
      const clone = this.editor.cloneNode(true);
      clone.querySelectorAll('img.ws-selected').forEach((i) => i.classList.remove('ws-selected'));
      clone.querySelectorAll('[class=""]').forEach((el) => el.removeAttribute('class'));
      this.hidden.value = clone.innerHTML;
    }
  }

  window.WorksheetImageTools = WorksheetImageTools;
})();
