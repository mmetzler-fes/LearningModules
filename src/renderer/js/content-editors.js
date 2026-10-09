function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlPreservingText(text) {
  return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

// Drag & Drop-Editor: Zonen rasten in Viertelprozent-Schritten ein (vorher
// ganze Prozent - auf einem breiten Bild waren das fast 10 px Sprung).
const DND_GRID = 0.25;
const dndSnap = (v) => Math.round(v / DND_GRID) * DND_GRID;
// CSS-Zentimeter in Pixeln (96 dpi): neue Zonen starten bei ca. 1 x 1 cm.
const DND_DEFAULT_ZONE_PX = 96 / 2.54;
// Kleiner laesst sich eine Zone nicht ziehen oder zeichnen.
const DND_MIN_ZONE_PX = 12;

/**
 * Kleines Kontextmenue an der Zeigerposition. Schliesst bei Klick daneben,
 * Escape, Scrollen oder wenn ein Eintrag gewaehlt wurde.
 * items: [{ label, onClick, danger }]
 *
 * Kopie von showContextMenu in utils.js (dieses Skript kann nicht importieren).
 */
function showContextMenu(x, y, items) {
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
 * Schriftgröße der Markierung setzen; `null` heißt Normalgröße. Verschachtelte
 * Größenangaben in der Markierung fallen dabei weg – sonst bliebe ein XXL
 * innerhalb des Textes stehen, den man gerade auf "Normal" stellt.
 *
 * Trick: execCommand markiert die Auswahl mit <font size="7">, danach wird
 * dieses Element auf die gewünschte Größe gesetzt bzw. aufgelöst.
 */
function applyFontSize(editor, size) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  const marked = [...editor.querySelectorAll('font[size="7"]')];
  if (!marked.length) return;
  // Was markiert war, bleibt danach markiert – der Format-Pinsel und weitere
  // Befehle arbeiten mit derselben Auswahl weiter.
  const first = marked[0].firstChild;
  const last = marked[marked.length - 1].lastChild;
  for (const el of marked) {
    // Innere Größenangaben entfernen (Elemente auflösen, Text behalten).
    el.querySelectorAll('font[size]').forEach((inner) => inner.replaceWith(...inner.childNodes));
    // Steckt die Markierung in einem Abschnitt mit eigener Größe, wird sie
    // daraus herausgelöst – sonst bliebe "Normal" wirkungslos.
    let outer = el.parentNode && el.parentNode.closest ? el.parentNode.closest('font[size]') : null;
    while (outer && editor.contains(outer)) {
      liftOutOf(el, outer);
      outer = el.parentNode && el.parentNode.closest ? el.parentNode.closest('font[size]') : null;
    }
    if (size) {
      el.setAttribute('size', size);
    } else {
      el.replaceWith(...el.childNodes);
    }
  }
  if (first && last && editor.contains(first) && editor.contains(last)) {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Hebt `el` aus `ancestor` heraus: `ancestor` wird in einen Teil davor und
 * einen danach geteilt, `el` steht dazwischen. Inline-Elemente auf dem Weg
 * (z. B. <b>) werden mitgeteilt, damit das übrige Format erhalten bleibt.
 */
function liftOutOf(el, ancestor) {
  let node = el;
  let parent = node.parentNode;
  for (;;) {
    const after = parent.cloneNode(false);
    while (node.nextSibling) after.appendChild(node.nextSibling);
    parent.after(after);
    if (!after.firstChild) after.remove();
    if (parent === ancestor) {
      parent.after(node);
      if (!parent.firstChild) parent.remove();
      return;
    }
    const mid = parent.cloneNode(false);
    parent.after(mid);
    mid.appendChild(node);
    if (!parent.firstChild) parent.remove();
    node = mid;
    parent = node.parentNode;
  }
}

/**
 * Format übertragen ("Pinsel" wie in LibreOffice): Zeichenformat an der
 * Schreibmarke merken – fett, kursiv, unterstrichen, durchgestrichen, hoch-/
 * tiefgestellt, Schriftgröße – und auf den nächsten markierten Text
 * übertragen. Ein Klick ins Wort ohne Markierung nimmt das ganze Wort.
 * Doppelklick auf den Pinsel: bleibt aktiv, bis Esc oder erneuter Klick.
 */
class FormatPainter {
  constructor(editor, button) {
    this.editor = editor;
    this.button = button;
    this.format = null;
    this.sticky = false;
    if (!button) return;

    button.addEventListener('mousedown', (e) => e.preventDefault()); // Auswahl behalten
    button.addEventListener('click', (e) => {
      // Zweiter Klick eines Doppelklicks: Pinsel bleibt für mehrere Stellen aktiv.
      if (this.format && e.detail >= 2) { this.sticky = true; return; }
      if (this.format) { this.stop(); return; }
      this.start(false);
    });

    editor.addEventListener('mouseup', () => setTimeout(() => this.applyIfActive(), 0));
    editor.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.format) this.stop(); });
  }

  /** Format an der Schreibmarke bzw. am Anfang der Markierung lesen. */
  capture() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !this.editor.contains(sel.anchorNode)) return null;
    const state = (cmd) => { try { return document.queryCommandState(cmd); } catch (_) { return false; } };
    let node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
    const font = node.closest ? node.closest('font[size]') : null;
    return {
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      strikeThrough: state('strikeThrough'),
      subscript: state('subscript'),
      superscript: state('superscript'),
      size: font && this.editor.contains(font) ? font.getAttribute('size') : null,
    };
  }

  start(sticky) {
    this.format = this.capture();
    if (!this.format) {
      window.alert('Zuerst in den Text klicken, dessen Format übertragen werden soll.');
      return;
    }
    this.sticky = sticky;
    this.button.classList.add('active');
    this.editor.classList.add('rt-painting');
  }

  stop() {
    this.format = null;
    this.sticky = false;
    this.button.classList.remove('active');
    this.editor.classList.remove('rt-painting');
  }

  applyIfActive() {
    if (!this.format) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !this.editor.contains(sel.anchorNode)) return;
    // Nur geklickt: das Wort unter der Schreibmarke nehmen.
    if (sel.isCollapsed && sel.modify) {
      sel.modify('move', 'backward', 'word');
      sel.modify('extend', 'forward', 'word');
      // Leerzeichen am Wortende nicht mitformatieren.
      const text = sel.toString();
      const trailing = text.length - text.replace(/\s+$/, '').length;
      for (let i = 0; i < trailing; i++) sel.modify('extend', 'backward', 'character');
    }
    if (sel.isCollapsed) return;

    const f = this.format;
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('removeFormat', false, null);
    if (f.size) applyFontSize(this.editor, f.size);
    for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript']) {
      if (f[cmd]) document.execCommand(cmd, false, null);
    }
    this.editor.dispatchEvent(new Event('input'));
    if (!this.sticky) this.stop();
  }
}

/**
 * Begriffe, die öfter erwartet werden, als sie in der Ablage liegen:
 * Map Text → { zones, pieces }. Mehrfach verwendbare Elemente reichen immer.
 * Dieselbe Regel wie die Auswertung (dndExpectedMappings in answer-eval.js).
 */
function dndShortage(content) {
  const zones = (content && content.dropZones) || [];
  const drags = ((content && content.draggables) || []).filter((d) => d.text);
  const demand = new Map();
  for (const z of zones) {
    if (!z.label) continue;
    const targeted = [...new Set(drags.filter((d) => d.correctZone === z.label).map((d) => d.text))];
    const own = z.correctDraggable || '';
    const texts = !own ? targeted : targeted.includes(own) ? targeted : [own];
    for (const t of texts) demand.set(t, (demand.get(t) || 0) + 1);
  }
  const out = new Map();
  for (const [text, need] of demand) {
    const same = drags.filter((d) => d.text === text);
    if (same.some((d) => d.multiple)) continue;
    if (need > same.length) out.set(text, { zones: need, pieces: same.length });
  }
  return out;
}
if (typeof window !== 'undefined') window.dndShortage = dndShortage;

class ContentEditorManager {
  constructor(containerEl) {
    this.container = containerEl;
    this.currentType = null;
    this.listCounters = {};
  }

  /**
   * Render the editor for a given H5P type with optional existing data.
   */
  render(typeId, existingData = {}) {
    const typeDef = H5P_TYPES[typeId];
    if (!typeDef) {
      this.container.innerHTML = '';
      this.container.classList.remove('active');
      this.currentType = null;
      return;
    }

    let data = existingData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        data = {};
      }
    }

    this.currentType = typeId;
    this.listCounters = {};
    this._h5pNativeData = null;
    // Zustand eines vorher gewählten Spezial-Editors darf nicht nachwirken.
    this.dndState = null;
    this.hsEditor = null;
    this.brEditor = null;
    this.container.innerHTML = '';
    this.container.classList.add('active');

    // h5p_native: read-only editor — preserve raw content, show info only
    if (typeId === 'h5p_native') {
      this._h5pNativeData = data;
      const heading = document.createElement('h4');
      heading.textContent = `${typeDef.icon} ${typeDef.name} — Inhalt konfigurieren`;
      this.container.appendChild(heading);
      const info = document.createElement('p');
      info.style.cssText = 'color:var(--text-secondary);font-size:0.88rem;margin:8px 0;';
      info.textContent = `H5P-Bibliothek: ${data.library || '—'}. Der Inhalt wird im Original gespeichert und nicht bearbeitet.`;
      this.container.appendChild(info);
      return;
    }

    // Special visual editor for Drag and Drop
    if (typeDef.editorType === 'dragAndDrop') {
      this.renderDragAndDropEditor(typeDef, data);
      return;
    }

    // Branching Scenario: Schritte mit Verzweigungen (branching-editor.js)
    if (typeDef.editorType === 'branching' && typeof BranchingEditor !== 'undefined') {
      this.brEditor = new BranchingEditor(this, this.container, typeDef, data);
      return;
    }

    // Image Hotspots: Hotspots direkt auf dem Bild setzen (hotspot-editor.js)
    if (typeDef.editorType === 'imageHotspots' && typeof HotspotEditor !== 'undefined') {
      this.hsEditor = new HotspotEditor(this.container, typeDef, data);
      return;
    }

    const heading = document.createElement('h4');
    heading.textContent = `${typeDef.icon} ${typeDef.name} — Inhalt konfigurieren`;
    this.container.appendChild(heading);

    const normalFields = (typeDef.fields || []).filter((field) => !field.advanced);
    const advancedFields = (typeDef.fields || []).filter((field) => field.advanced);

    for (const field of normalFields) {
      const value = data[field.key];
      this.renderField(this.container, field, value);
    }

    if (advancedFields.length > 0) {
      const details = document.createElement('details');
      details.style.cssText = 'margin-top:12px; border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden;';
      const summary = document.createElement('summary');
      summary.textContent = 'Erweiterte Optionen';
      summary.style.cssText = 'padding:10px 12px; cursor:pointer; font-weight:600; background:var(--bg-primary);';
      details.appendChild(summary);

      const body = document.createElement('div');
      body.style.cssText = 'padding:12px; background:var(--bg-secondary);';
      details.appendChild(body);

      for (const field of advancedFields) {
        const value = data[field.key];
        this.renderField(body, field, value);
      }

      this.container.appendChild(details);
    }
  }

  /**
   * Render a single field into a parent container.
   */
  renderField(parent, field, value) {
    switch (field.type) {
      case 'text':
        this.renderTextField(parent, field, value);
        break;
      case 'worksheet':
        this.renderWorksheetField(parent, field, value);
        break;
      case 'textarea':
        this.renderTextareaField(parent, field, value);
        break;
      case 'richtext':
        this.renderRichtextField(parent, field, value);
        break;
      case 'number':
        this.renderNumberField(parent, field, value);
        break;
      case 'select':
        this.renderSelectField(parent, field, value);
        break;
      case 'checkbox':
        this.renderCheckboxField(parent, field, value);
        break;
      case 'list':
        this.renderListField(parent, field, value);
        break;
      case 'image':
        this.renderImageField(parent, field, value);
        break;
      case 'audio':
        this.renderAudioField(parent, field, value);
        break;
      case 'group':
        this.renderGroupField(parent, field, value);
        break;
      case 'uploadTest':
        this.renderUploadTestField(parent);
        break;
    }
  }

  /**
   * Audio Recorder: Nextcloud-Ablage prüfen. Lädt eine kleine Textdatei hoch
   * – kommt sie in der Nextcloud an, klappt es auch mit den Aufnahmen.
   */
  renderUploadTestField(parent) {
    const row = document.createElement('div');
    row.className = 'form-group upload-test';
    row.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm">🔌 Verbindung testen</button>
      <span class="hint upload-test-status">Tipp: In Nextcloud „Teilen → Link“ und als Berechtigung
        <strong>„Dateiablage (nur Hochladen)“</strong> wählen – dann sehen Schüler keine Aufnahmen anderer.</span>`;
    const status = row.querySelector('.upload-test-status');
    row.querySelector('button').addEventListener('click', async () => {
      const url = this.container.querySelector('[name="content_uploadUrl"]')?.value.trim();
      const pw = this.container.querySelector('[name="content_uploadPassword"]')?.value || '';
      if (!url) { status.textContent = 'Bitte zuerst den Freigabelink eintragen.'; return; }
      status.textContent = 'Teste …';
      const token = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');
      try {
        const res = await fetch('/api/topics/recording-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ uploadUrl: url, uploadPassword: pw }),
        });
        const data = await res.json();
        status.textContent = res.ok && data.success
          ? '✅ Verbindung klappt – in der Nextcloud liegt jetzt „LernModule-Verbindungstest.txt“.'
          : `⚠️ ${data.message || 'Test fehlgeschlagen.'}`;
      } catch (err) {
        status.textContent = `⚠️ ${err.message}`;
      }
    });
    parent.appendChild(row);
  }

  /**
   * Inhalt eines Arbeitsblatts: Texteditor plus Übernahme aus einem
   * Writer-Dokument (.odt). Die Umwandlung macht der Server; zurück kommt
   * HTML, das hier im Editor landet und vor dem Speichern noch geändert
   * werden kann.
   */
  renderWorksheetField(parent, field, value) {
    const bar = document.createElement('div');
    bar.className = 'worksheet-import';
    bar.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm">📄 Aus LibreOffice Writer (.odt) übernehmen</button>
      <span class="hint">Überschriften, Absätze, Listen, Tabellen, Bilder und Zeichnungen.
        Das Seitenlayout wird vereinfacht. Bilder danach anklicken, um Größe und Lage anzupassen.</span>
      <div class="worksheet-import-status hint"></div>`;
    parent.appendChild(bar);

    this.renderRichtextField(parent, { ...field, type: 'richtext' }, value);
    const surface = parent.querySelector(`.rich-text-surface[data-field-key="${field.key}"]`);
    const hidden = parent.querySelector(`input[name="content_${field.key}"]`);
    surface?.classList.add('worksheet-content');
    const status = bar.querySelector('.worksheet-import-status');
    // Bilder einfügen, anordnen, in der Größe ändern, löschen.
    const tools = surface && typeof WorksheetImageTools !== 'undefined'
      ? new WorksheetImageTools(surface, hidden, surface.parentNode.querySelector('.rich-text-toolbar'))
      : null;

    bar.querySelector('button').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.odt,.ott,.fodt,application/vnd.oasis.opendocument.text';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        // Der Bestätigungsdialog der App, sofern sie ihn bereitstellt.
        const ask = window.appConfirm || ((m) => Promise.resolve(window.confirm(m)));
        if ((surface.textContent.trim() || surface.querySelector('img')) && !(await ask('Den bisherigen Inhalt durch das Dokument ersetzen?'))) return;
        status.textContent = 'Wird übernommen …';
        const form = new FormData();
        form.append('file', file);
        const token = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');
        try {
          const res = await fetch('/api/interchange/odt-to-html', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
          tools?.select(null);
          surface.innerHTML = data.html;
          hidden.value = data.html;
          // Ein leerer Modultitel bekommt den des Dokuments.
          const title = document.getElementById('moduleTitle');
          if (title && !title.value.trim()) title.value = data.title || '';
          const s = data.stats || {};
          status.innerHTML = `✅ Übernommen: ${s.headings || 0} Überschriften, ${s.paragraphs || 0} Absätze, ` +
            `${s.tables || 0} Tabellen, ${s.images || 0} Bilder.` +
            (data.warnings && data.warnings.length
              ? `<br>⚠️ ${data.warnings.map((w) => escapeHtml(w)).join('<br>⚠️ ')}`
              : '');
        } catch (err) {
          status.textContent = `Übernahme fehlgeschlagen: ${err.message}`;
        }
      };
      input.click();
    });
  }

  renderImageField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const wrap = document.createElement('div');
    wrap.className = 'image-field-wrap';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = `content_${field.key}`;
    hidden.value = value || '';

    const preview = document.createElement('div');
    preview.className = 'image-field-preview';
    if (value) {
      preview.innerHTML = `<img src="${value}" />`;
    } else {
      preview.textContent = 'Kein Bild ausgewählt';
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'image-field-buttons';

    const btnFile = document.createElement('button');
    btnFile.type = 'button';
    btnFile.className = 'btn btn-secondary btn-sm';
    btnFile.textContent = '📁 Bild auswählen';
    btnFile.addEventListener('click', async () => {
      const result = await appApi.selectImage();
      if (result && result.success) {
        hidden.value = result.dataUrl;
        preview.innerHTML = `<img src="${result.dataUrl}" />`;
        btnRemove.style.display = '';
      }
    });

    const btnUrl = document.createElement('button');
    btnUrl.type = 'button';
    btnUrl.className = 'btn btn-secondary btn-sm';
    btnUrl.textContent = '🔗 URL eingeben';
    btnUrl.addEventListener('click', () => {
      const url = prompt('Bild-URL eingeben:', hidden.value || '');
      if (url !== null && url.trim()) {
        hidden.value = url.trim();
        preview.innerHTML = `<img src="${url.trim()}" />`;
        btnRemove.style.display = '';
      }
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-danger btn-sm';
    btnRemove.textContent = '✕ Entfernen';
    btnRemove.style.display = value ? '' : 'none';
    btnRemove.addEventListener('click', () => {
      hidden.value = '';
      preview.innerHTML = '';
      preview.textContent = 'Kein Bild ausgewählt';
      btnRemove.style.display = 'none';
    });

    // Mehrere Bilder zu einem zusammenstellen (image-composer.js)
    const btnCompose = document.createElement('button');
    btnCompose.type = 'button';
    btnCompose.className = 'btn btn-secondary btn-sm';
    btnCompose.textContent = '🧩 Zusammenstellen';
    btnCompose.title = 'Mehrere Bilder zu einem Bild zusammenstellen (Collage)';
    btnCompose.addEventListener('click', async () => {
      if (typeof openImageComposer !== 'function') return;
      const dataUrl = await openImageComposer();
      if (!dataUrl) return;
      hidden.value = dataUrl;
      preview.innerHTML = `<img src="${dataUrl}" />`;
      btnRemove.style.display = '';
    });

    btnRow.appendChild(btnFile);
    btnRow.appendChild(btnUrl);
    btnRow.appendChild(btnCompose);
    btnRow.appendChild(btnRemove);

    wrap.appendChild(hidden);
    wrap.appendChild(preview);
    wrap.appendChild(btnRow);
    group.appendChild(wrap);
    parent.appendChild(group);
  }

  renderAudioField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const wrap = document.createElement('div');
    wrap.className = 'audio-field-wrap';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = `content_${field.key}`;
    hidden.value = value || '';

    const preview = document.createElement('div');
    preview.className = 'audio-field-preview';
    if (value) {
      preview.innerHTML = `<audio controls src="${value}" style="width:100%;max-width:320px;"></audio>`;
    } else {
      preview.textContent = 'Kein Audio ausgewählt';
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'audio-field-buttons';

    const btnFile = document.createElement('button');
    btnFile.type = 'button';
    btnFile.className = 'btn btn-secondary btn-sm';
    btnFile.textContent = '🎵 Audio auswählen';
    btnFile.addEventListener('click', async () => {
      const result = await appApi.selectAudio();
      if (result && result.success) {
        hidden.value = result.dataUrl;
        preview.innerHTML = `<audio controls src="${result.dataUrl}" style="width:100%;max-width:320px;"></audio>`;
        btnRemove.style.display = '';
      }
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-danger btn-sm';
    btnRemove.textContent = '✕ Entfernen';
    btnRemove.style.display = value ? '' : 'none';
    btnRemove.addEventListener('click', () => {
      hidden.value = '';
      preview.innerHTML = '';
      preview.textContent = 'Kein Audio ausgewählt';
      btnRemove.style.display = 'none';
    });

    btnRow.appendChild(btnFile);
    btnRow.appendChild(btnRemove);

    wrap.appendChild(hidden);
    wrap.appendChild(preview);
    wrap.appendChild(btnRow);
    group.appendChild(wrap);
    parent.appendChild(group);
  }

  renderTextField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const input = document.createElement('input');
    input.type = 'text';
    input.name = `content_${field.key}`;
    input.value = value || field.default || '';
    input.placeholder = field.placeholder || '';
    if (field.required) input.required = true;
    group.appendChild(input);
    parent.appendChild(group);
  }

  renderTextareaField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const textarea = document.createElement('textarea');
    textarea.name = `content_${field.key}`;
    textarea.rows = 4;
    textarea.value = value || field.default || '';
    textarea.placeholder = field.placeholder || '';
    if (field.required) textarea.required = true;
    group.appendChild(textarea);
    parent.appendChild(group);
  }

  renderRichtextField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);

    const wrapper = document.createElement('div');
    wrapper.className = 'rich-text-editor';

    // Toolbar (Compact Styling)
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-text-toolbar';
    toolbar.innerHTML = `
      <select class="rt-select rt-block-format" title="Textformat">
        <option value="p">¶ Stil</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
      </select>
      <div class="rt-separator"></div>
      <select class="rt-select rt-spacing" title="Absatz-Abstand">
        <option value="" disabled selected>↕ Abstand</option>
        <option value="0px">0px</option>
        <option value="12px">12px</option>
        <option value="20px">20px</option>
      </select>
      <div class="rt-separator"></div>
      <select class="rt-select rt-font-size" title="Schriftgröße des markierten Texts">
        <option value="" disabled selected>Aa Größe</option>
        <option value="1">XS</option>
        <option value="2">S</option>
        <option value="normal">Normal</option>
        <option value="4">L</option>
        <option value="5">XL</option>
        <option value="6">XXL</option>
      </select>
      <div class="rt-separator"></div>
      <button type="button" class="rt-btn rt-btn-painter" title="Format übertragen: erst Text mit dem gewünschten Format anklicken, dann Pinsel, dann Zieltext markieren. Doppelklick: mehrfach übertragen, Esc beendet.">🖌</button>
      <button type="button" class="rt-btn" data-cmd="bold" title="Fett"><b>B</b></button>
      <button type="button" class="rt-btn" data-cmd="italic" title="Kursiv"><i style="font-family:serif;font-weight:600;">I</i></button>
      <button type="button" class="rt-btn" data-cmd="underline" title="Unterstrichen"><u>U</u></button>
      <button type="button" class="rt-btn" data-cmd="strikeThrough" title="Durchgestrichen"><s>S</s></button>
      <div class="rt-separator"></div>
      <button type="button" class="rt-btn" data-cmd="insertUnorderedList" title="Aufzählungsliste">≡ ⁝</button>
      <button type="button" class="rt-btn" data-cmd="insertOrderedList" title="Nummerierte Liste">1. ⁝</button>
      <div class="rt-separator"></div>
      <button type="button" class="rt-btn rt-btn-link" title="Link einfügen">🔗</button>
      <button type="button" class="rt-btn rt-btn-table" title="Tabelle einfügen">▦ Table</button>
      <div class="rt-separator"></div>
      <button type="button" class="rt-btn rt-btn-clear" title="Formatierung entfernen">T\u2093</button>
    `;

    // Editable area
    const editor = document.createElement('div');
    editor.className = 'rich-text-surface';
    editor.contentEditable = 'true';
    editor.dataset.fieldKey = field.key;
    const hasMarkup = /<\/?[a-z][\s\S]*>/i.test(value || '');
    editor.innerHTML = hasMarkup ? (value || '') : escapeHtmlPreservingText(value || '');
    if (field.placeholder) editor.dataset.placeholder = field.placeholder;

    // Attach Event Listeners to Toolbar
    toolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editor.focus();
        document.execCommand(btn.dataset.cmd, false, null);
      });
    });

    toolbar.querySelector('.rt-block-format').addEventListener('change', (e) => {
      if (!e.target.value) return;
      editor.focus();
      document.execCommand('formatBlock', false, e.target.value);
      e.target.value = 'p'; // reset visually to avoid confusion when selection changes
    });

    toolbar.querySelector('.rt-font-size').addEventListener('change', (e) => {
      const value = e.target.value;
      // Zurück auf die Beschriftung – so löst auch dieselbe Größe erneut aus.
      e.target.selectedIndex = 0;
      if (!value) return;
      editor.focus();
      applyFontSize(editor, value === 'normal' ? null : value);
      editor.dispatchEvent(new Event('input'));
    });

    new FormatPainter(editor, toolbar.querySelector('.rt-btn-painter'));

    toolbar.querySelector('.rt-spacing').addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      editor.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node = sel.getRangeAt(0).commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentNode;
        while (node && node !== editor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
          node = node.parentNode;
        }
        if (node && node !== editor) {
          node.style.marginBottom = val;
        } else {
          document.execCommand('formatBlock', false, 'p');
          node = sel.getRangeAt(0).commonAncestorContainer;
          if (node.nodeType === 3) node = node.parentNode;
          while (node && node !== editor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
            node = node.parentNode;
          }
          if (node && node !== editor) node.style.marginBottom = val;
        }
      }
      e.target.selectedIndex = 0; // reset visually
    });

    toolbar.querySelector('.rt-btn-link').addEventListener('click', () => {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      
      const url = prompt('Link-URL eingeben:', 'https://');
      if (url) {
        editor.focus();
        document.execCommand('createLink', false, url.trim());
      }
    });

    toolbar.querySelector('.rt-btn-table').addEventListener('click', () => {
      editor.focus();
      const tableHtml = '<table class="h5p-table" style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:10px;" border="1"><tbody><tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr><tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr></tbody></table><p><br></p>';
      document.execCommand('insertHTML', false, tableHtml);
    });

    toolbar.querySelector('.rt-btn-clear').addEventListener('click', () => {
      editor.focus();
      document.execCommand('removeFormat', false, null);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        document.execCommand('formatBlock', false, 'p');
      }
    });

    // Hidden input to hold the HTML value for collectData
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = `content_${field.key}`;
    hidden.value = value || '';
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.originalEvent || e).clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    editor.addEventListener('input', () => { hidden.value = editor.innerHTML; });
    editor.addEventListener('blur', () => { hidden.value = editor.innerHTML; });

    wrapper.appendChild(toolbar);
    wrapper.appendChild(editor);
    group.appendChild(wrapper);
    group.appendChild(hidden);
    parent.appendChild(group);

    // Felder mit images: true bekommen die Bildwerkzeuge des Arbeitsblatts.
    if (field.images && typeof WorksheetImageTools !== 'undefined') {
      editor.classList.add('worksheet-content', 'rt-with-images');
      new WorksheetImageTools(editor, hidden, toolbar);
    }
  }

  renderNumberField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const input = document.createElement('input');
    input.type = 'number';
    // Ohne step nimmt der Browser nur ganze Zahlen an (z. B. keine Toleranz 0,5).
    input.step = field.step || 'any';
    input.name = `content_${field.key}`;
    input.value = value !== undefined ? value : (field.default || 0);
    group.appendChild(input);
    parent.appendChild(group);
  }

  renderSelectField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const select = document.createElement('select');
    select.name = `content_${field.key}`;
    for (const opt of field.options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (value === opt.value || (!value && field.default === opt.value)) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    group.appendChild(select);
    parent.appendChild(group);
  }

  renderCheckboxField(parent, field, value) {
    const group = document.createElement('div');
    group.className = 'form-group checkbox-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = `content_${field.key}`;
    input.id = `content_${field.key}`;
    input.checked = value !== undefined ? !!value : !!field.default;
    const label = document.createElement('label');
    label.htmlFor = `content_${field.key}`;
    label.textContent = field.label;
    group.appendChild(input);
    group.appendChild(label);
    parent.appendChild(group);
  }

  renderListField(parent, field, value) {
    const group = this.createFormGroup(field.label);
    const listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    listContainer.dataset.fieldKey = field.key;

    this.listCounters[field.key] = 0;

    // Render existing items
    const items = Array.isArray(value) ? value : [];
    for (const item of items) {
      this.addListItem(listContainer, field, item);
    }

    // Add button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-add-item';
    addBtn.textContent = `+ ${field.label} hinzufügen`;
    addBtn.addEventListener('click', () => {
      this.addListItem(listContainer, field, {});
    });

    group.appendChild(listContainer);
    group.appendChild(addBtn);
    parent.appendChild(group);

    // Start with one empty item if none exist
    if (items.length === 0) {
      this.addListItem(listContainer, field, {});
    }
  }

  addListItem(container, field, itemData) {
    const idx = this.listCounters[field.key]++;
    const item = document.createElement('div');
    item.className = 'editor-item';

    const header = document.createElement('div');
    header.className = 'editor-item-header';
    const h5 = document.createElement('h5');
    h5.textContent = `#${idx + 1}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = '✕ Entfernen';
    removeBtn.addEventListener('click', () => {
      item.remove();
    });
    header.appendChild(h5);
    header.appendChild(removeBtn);
    item.appendChild(header);

    for (const subField of field.itemFields) {
      const compositeField = {
        ...subField,
        key: `${field.key}_${idx}_${subField.key}`,
      };
      const val = itemData ? itemData[subField.key] : undefined;
      this.renderField(item, compositeField, val);
    }

    container.appendChild(item);
  }

  renderGroupField(parent, field, value) {
    const group = this.createFormGroup(field.label);
    const groupContainer = document.createElement('div');
    groupContainer.className = 'editor-item';

    const data = value || {};
    for (const subField of field.fields) {
      const compositeField = {
        ...subField,
        key: `${field.key}_${subField.key}`,
      };
      this.renderField(groupContainer, compositeField, data[subField.key]);
    }

    group.appendChild(groupContainer);
    parent.appendChild(group);
  }

  createFormGroup(label, required) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const labelEl = document.createElement('label');
    labelEl.textContent = label + (required ? ' *' : '');
    group.appendChild(labelEl);
    return group;
  }

  /**
   * Collect all content data from the editor.
   */
  collectData() {
    if (!this.currentType) return {};

    // h5p_native: return the original content unchanged
    if (this.currentType === 'h5p_native') {
      return this._h5pNativeData || {};
    }

    // Special handling for Drag and Drop visual editor
    if (this.dndState) {
      return this.collectDragAndDropData();
    }
    if (this.hsEditor) {
      return this.hsEditor.collect();
    }
    if (this.brEditor) {
      return this.brEditor.collect();
    }

    const typeDef = H5P_TYPES[this.currentType];
    const data = {};

    for (const field of typeDef.fields) {
      data[field.key] = this.collectFieldData(field);
    }

    return data;
  }

  collectFieldData(field) {
    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'richtext':
      case 'worksheet':
      case 'number':
      case 'select':
      case 'image':
      case 'audio': {
        const el = this.container.querySelector(`[name="content_${field.key}"]`);
        if (!el) return field.default || '';
        if (field.type === 'number') return parseFloat(el.value) || 0;
        return el.value;
      }
      case 'checkbox': {
        const el = this.container.querySelector(`[name="content_${field.key}"]`);
        return el ? el.checked : !!field.default;
      }
      case 'list': {
        return this.collectListData(field);
      }
      case 'group': {
        return this.collectGroupData(field);
      }
      default:
        return null;
    }
  }

  collectListData(field) {
    const container = this.container.querySelector(`[data-field-key="${field.key}"]`);
    if (!container) return [];

    const items = container.querySelectorAll('.editor-item');
    const result = [];

    items.forEach((itemEl, idx) => {
      const itemData = {};
      for (const subField of field.itemFields) {
        const compositeKey = `${field.key}_${idx}_${subField.key}`;
        const el = itemEl.querySelector(`[name="content_${compositeKey}"]`);
        if (!el) continue;
        if (subField.type === 'checkbox') {
          itemData[subField.key] = el.checked;
        } else if (subField.type === 'number') {
          itemData[subField.key] = parseFloat(el.value) || 0;
        } else {
          itemData[subField.key] = el.value;
        }
      }
      result.push(itemData);
    });

    return result;
  }

  /**
   * Override for list items that contain 'image' subfields:
   * The hidden input inside .image-field-wrap needs to be found too.
   */
  // (image fields already use hidden inputs with name="content_...", so the
  //  existing querySelector logic works without changes.)

  collectGroupData(field) {
    const data = {};
    for (const subField of field.fields) {
      const compositeKey = `${field.key}_${subField.key}`;
      const el = this.container.querySelector(`[name="content_${compositeKey}"]`);
      if (!el) continue;
      if (subField.type === 'checkbox') {
        data[subField.key] = el.checked;
      } else if (subField.type === 'number') {
        data[subField.key] = parseFloat(el.value) || 0;
      } else {
        data[subField.key] = el.value;
      }
    }
    return data;
  }

  // ==================== DRAG AND DROP VISUAL EDITOR ====================

  renderDragAndDropEditor(typeDef, data) {
    this.dndState = {
      backgroundImage: data.backgroundImage || '',
      randomOrder: !!data.randomOrder,
      dropZones: (data.dropZones || []).map((z, i) => {
        let correctDraggable = z.correctDraggable || '';
        // If missing, try to infer from draggables for a robust editor UI
        if (!correctDraggable && z.label) {
          const matchingDrag = (data.draggables || []).find(d => d.correctZone === z.label);
          if (matchingDrag) correctDraggable = matchingDrag.text;
        }
        return {
          id: i,
          label: z.label || '',
          correctDraggable,
          group: z.group || '',
          x: z.x ?? 10,
          y: z.y ?? 10,
          width: z.width ?? 20,
          height: z.height ?? 15,
        };
      }),
      draggables: (data.draggables || []).map((d) => ({
        text: d.text || '',
        correctZone: d.correctZone || '',
        multiple: !!d.multiple,
      })),
      nextZoneId: (data.dropZones || []).length,
      selectedZone: null,
      drawMode: false,
    };

    const heading = document.createElement('h4');
    heading.textContent = `${typeDef.icon} ${typeDef.name} — Inhalt konfigurieren`;
    this.container.appendChild(heading);

    // Task description (rich text)
    this.renderRichtextField(this.container, { key: 'dnd_taskDescription', label: 'Aufgabenbeschreibung', type: 'richtext' }, data.taskDescription || '');

    // Reihenfolge je Schüler mischen (gegen Abschreiben vom Nachbarn)
    const mixRow = document.createElement('label');
    mixRow.className = 'tag-filter-mode dnd-random-order';
    mixRow.innerHTML = '<input type="checkbox" /> <span><strong>🔀 Reihenfolge mischen</strong> – jeder Schüler sieht die ziehbaren '
      + 'Elemente (ohne Hintergrundbild auch die Zonen) in anderer Reihenfolge.</span>';
    const mixBox = mixRow.querySelector('input');
    mixBox.checked = this.dndState.randomOrder;
    mixBox.addEventListener('change', () => { this.dndState.randomOrder = mixBox.checked; });
    this.container.appendChild(mixRow);

    // Background image section
    const imgGroup = this.createFormGroup('Hintergrundbild *');
    const imgControls = document.createElement('div');
    imgControls.className = 'dnd-img-controls';

    const btnSelectImg = document.createElement('button');
    btnSelectImg.type = 'button';
    btnSelectImg.className = 'btn btn-secondary';
    btnSelectImg.textContent = '📁 Bild auswählen';

    const imgStatus = document.createElement('span');
    imgStatus.className = 'dnd-img-status';
    imgStatus.textContent = this.dndState.backgroundImage ? '✅ Bild geladen' : 'Kein Bild ausgewählt';

    const btnRemoveImg = document.createElement('button');
    btnRemoveImg.type = 'button';
    btnRemoveImg.className = 'btn btn-danger btn-sm';
    btnRemoveImg.textContent = '✕ Entfernen';
    btnRemoveImg.style.display = this.dndState.backgroundImage ? '' : 'none';

    const btnComposeImg = document.createElement('button');
    btnComposeImg.type = 'button';
    btnComposeImg.className = 'btn btn-secondary';
    btnComposeImg.textContent = '🧩 Bild zusammenstellen';
    btnComposeImg.title = 'Mehrere Bilder zu einem Hintergrundbild zusammenstellen (Collage)';

    imgControls.appendChild(btnSelectImg);
    imgControls.appendChild(btnComposeImg);
    imgControls.appendChild(imgStatus);
    imgControls.appendChild(btnRemoveImg);
    imgGroup.appendChild(imgControls);
    this.container.appendChild(imgGroup);

    // Image canvas area
    const canvasGroup = document.createElement('div');
    canvasGroup.className = 'dnd-canvas-wrapper';

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'dnd-canvas';
    canvasContainer.id = 'dnd-canvas';

    const placeholder = document.createElement('div');
    placeholder.className = 'dnd-canvas-placeholder';
    placeholder.textContent = 'Bild wird hier angezeigt. Wähle zuerst ein Hintergrundbild aus.';

    canvasContainer.appendChild(placeholder);
    canvasGroup.appendChild(canvasContainer);

    // Click on canvas background deselects active zone
    canvasContainer.addEventListener('click', (e) => {
      const img = canvasContainer.querySelector('.dnd-canvas-img');
      if (e.target === canvasContainer || e.target === img) {
        this.dndState.selectedZone = null;
        this.refreshDndCanvas();
      }
    });

    // Zone toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'dnd-toolbar';
    const btnAddZone = document.createElement('button');
    btnAddZone.type = 'button';
    btnAddZone.className = 'btn btn-primary btn-sm';
    btnAddZone.id = 'dnd-btn-add-zone';
    btnAddZone.textContent = '➕ Ablagezone hinzufügen';
    const btnDrawZone = document.createElement('button');
    btnDrawZone.type = 'button';
    btnDrawZone.className = 'btn btn-secondary btn-sm';
    btnDrawZone.id = 'dnd-btn-draw-zone';
    btnDrawZone.textContent = '✏️ Zone zeichnen';
    const drawHint = document.createElement('span');
    drawHint.className = 'dnd-draw-hint hidden';
    drawHint.id = 'dnd-draw-hint';
    drawHint.textContent = 'Klicke und ziehe auf dem Bild um eine Zone zu zeichnen. ESC zum Abbrechen.';
    toolbar.appendChild(btnAddZone);
    toolbar.appendChild(btnDrawZone);
    toolbar.appendChild(drawHint);
    canvasGroup.appendChild(toolbar);
    this.container.appendChild(canvasGroup);

    // Drop zones list
    const zonesGroup = this.createFormGroup('Ablagezonen');
    const zonesList = document.createElement('div');
    zonesList.className = 'dnd-zones-list';
    zonesList.id = 'dnd-zones-list';
    zonesGroup.appendChild(zonesList);
    this.container.appendChild(zonesGroup);

    // Draggables section
    const dragsGroup = this.createFormGroup('Ziehbare Elemente');
    const dragsList = document.createElement('div');
    dragsList.className = 'dnd-drags-list';
    dragsList.id = 'dnd-drags-list';
    dragsGroup.appendChild(dragsList);

    const btnAddDrag = document.createElement('button');
    btnAddDrag.type = 'button';
    btnAddDrag.className = 'btn-add-item';
    btnAddDrag.textContent = '+ Ziehbares Element hinzufügen';
    btnAddDrag.addEventListener('click', () => {
      this.dndState.draggables.push({ text: '', correctZone: '', multiple: false });
      this.refreshDndDraggables();
    });
    dragsGroup.appendChild(btnAddDrag);
    this.container.appendChild(dragsGroup);

    // Wire up image selection
    btnSelectImg.addEventListener('click', async () => {
      const result = await appApi.selectImage();
      if (result && result.success) {
        this.dndState.backgroundImage = result.dataUrl;
        imgStatus.textContent = '✅ Bild geladen';
        btnRemoveImg.style.display = '';
        this.refreshDndCanvas();
      }
    });
    btnComposeImg.addEventListener('click', async () => {
      if (typeof openImageComposer !== 'function') return;
      const dataUrl = await openImageComposer();
      if (!dataUrl) return;
      this.dndState.backgroundImage = dataUrl;
      imgStatus.textContent = '✅ Zusammengestelltes Bild';
      btnRemoveImg.style.display = '';
      this.refreshDndCanvas();
    });
    btnRemoveImg.addEventListener('click', () => {
      this.dndState.backgroundImage = '';
      imgStatus.textContent = 'Kein Bild ausgewählt';
      btnRemoveImg.style.display = 'none';
      this.refreshDndCanvas();
    });

    // Wire up zone buttons
    btnAddZone.addEventListener('click', () => {
      if (!this.dndState.backgroundImage) return;
      const id = this.dndState.nextZoneId++;
      // Ca. 1 x 1 cm, mittig im Bild
      const rect = canvasContainer.getBoundingClientRect();
      const width = rect.width ? dndSnap((DND_DEFAULT_ZONE_PX / rect.width) * 100) : 5;
      const height = rect.height ? dndSnap((DND_DEFAULT_ZONE_PX / rect.height) * 100) : 5;
      this.dndState.dropZones.push({
        id, label: `Ablagezone ${id + 1}`, correctDraggable: '',
        x: dndSnap(50 - width / 2), y: dndSnap(50 - height / 2), width, height,
      });
      this.refreshDndCanvas();
      this.refreshDndZonesList();
      this.refreshDndDraggables();
    });

    // Draw mode
    btnDrawZone.addEventListener('click', () => {
      if (!this.dndState.backgroundImage) return;
      this.dndState.drawMode = !this.dndState.drawMode;
      btnDrawZone.classList.toggle('active', this.dndState.drawMode);
      drawHint.classList.toggle('hidden', !this.dndState.drawMode);
      canvasContainer.classList.toggle('dnd-drawing', this.dndState.drawMode);
    });

    // ESC key to exit draw mode
    this._dndKeyHandler = (e) => {
      if (e.key === 'Escape' && this.dndState.drawMode) {
        this.dndState.drawMode = false;
        btnDrawZone.classList.remove('active');
        drawHint.classList.add('hidden');
        canvasContainer.classList.remove('dnd-drawing');
      }
    };
    document.addEventListener('keydown', this._dndKeyHandler);

    // Draw mode pointer events on canvas
    this._setupDndDrawing(canvasContainer);

    // Initial render
    this.refreshDndCanvas();
    this.refreshDndZonesList();
    this.refreshDndDraggables();
  }

  _setupDndDrawing(canvas) {
    let drawing = false;
    let startX = 0, startY = 0;
    let drawRect = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.dndState.drawMode) return;
      if (e.target.closest('.dnd-zone-overlay')) return;
      const rect = canvas.getBoundingClientRect();
      startX = ((e.clientX - rect.left) / rect.width) * 100;
      startY = ((e.clientY - rect.top) / rect.height) * 100;
      drawing = true;
      drawRect = document.createElement('div');
      drawRect.className = 'dnd-draw-rect';
      drawRect.style.left = startX + '%';
      drawRect.style.top = startY + '%';
      drawRect.style.width = '0%';
      drawRect.style.height = '0%';
      canvas.appendChild(drawRect);
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !drawRect) return;
      const rect = canvas.getBoundingClientRect();
      const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      drawRect.style.left = x + '%';
      drawRect.style.top = y + '%';
      drawRect.style.width = w + '%';
      drawRect.style.height = h + '%';
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drawing || !drawRect) return;
      drawing = false;
      const rect = canvas.getBoundingClientRect();
      const curX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const curY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      const x = dndSnap(Math.min(startX, curX));
      const y = dndSnap(Math.min(startY, curY));
      const w = dndSnap(Math.abs(curX - startX));
      const h = dndSnap(Math.abs(curY - startY));
      drawRect.remove();
      drawRect = null;

      // Zu klein (meist ein versehentlicher Klick): ignorieren
      if ((w / 100) * rect.width < DND_MIN_ZONE_PX || (h / 100) * rect.height < DND_MIN_ZONE_PX) return;

      const id = this.dndState.nextZoneId++;
      this.dndState.dropZones.push({ id, label: `Ablagezone ${id + 1}`, correctDraggable: '', x, y, width: w, height: h });
      this.refreshDndCanvas();
      this.refreshDndZonesList();
      this.refreshDndDraggables();
    });
  }

  refreshDndCanvas() {
    const canvas = this.container.querySelector('#dnd-canvas');
    if (!canvas) return;

    // Remove old overlays and placeholder, keep image if any
    canvas.querySelectorAll('.dnd-zone-overlay, .dnd-canvas-placeholder').forEach((el) => el.remove());

    if (!this.dndState.backgroundImage) {
      const img = canvas.querySelector('.dnd-canvas-img');
      if (img) img.remove();
      const ph = document.createElement('div');
      ph.className = 'dnd-canvas-placeholder';
      ph.textContent = 'Bild wird hier angezeigt. Wähle zuerst ein Hintergrundbild aus.';
      canvas.appendChild(ph);
      return;
    }

    // Set background image
    let img = canvas.querySelector('.dnd-canvas-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'dnd-canvas-img';
      img.draggable = false;
      canvas.prepend(img);
    }
    if (img.src !== this.dndState.backgroundImage) {
      img.src = this.dndState.backgroundImage;
    }

    // Render drop zones
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    this.dndState.dropZones.forEach((zone, i) => {
      const overlay = document.createElement('div');
      overlay.className = 'dnd-zone-overlay';
      overlay.dataset.zoneId = zone.id;
      const color = colors[i % colors.length];
      overlay.style.left = zone.x + '%';
      overlay.style.top = zone.y + '%';
      overlay.style.width = zone.width + '%';
      overlay.style.height = zone.height + '%';
      overlay.style.borderColor = color;
      overlay.style.background = color + '25';

      if (this.dndState.selectedZone === zone.id) {
        overlay.classList.add('selected');
      }

      const label = document.createElement('span');
      label.className = 'dnd-zone-label';
      label.style.background = color;
      label.textContent = zone.label || `Zone ${i + 1}`;
      if (zone.group) label.textContent += ` · 🔀 ${zone.group}`;
      // Zugeordnet? Dann gleich am Bild sehen, was erwartet wird – und was noch fehlt.
      const right = this._dndRightTexts(zone);
      if (right.length) label.textContent += ` → ${right.join(' · ')}`;
      else overlay.classList.add('dnd-zone-unassigned');
      overlay.title = right.length ? `Erwartet: ${right.join(', ')}` : 'Noch nichts zugeordnet – Doppelklick oder Rechtsklick › Zuordnen';
      overlay.appendChild(label);

      // Eckmarken: zeigen, wo die Groesse geaendert wird. Reine Anzeige, das
      // Anfassen selbst erkennt _makeDndZoneInteractive an der Zeigerposition.
      ['nw', 'ne', 'sw', 'se'].forEach((c) => {
        const mark = document.createElement('span');
        mark.className = `dnd-zone-corner dnd-zone-corner-${c}`;
        overlay.appendChild(mark);
      });

      // Click to select
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dndState.selectedZone = zone.id;
        // Nur die Markierung umschalten statt neu zu zeichnen – sonst wäre
        // das Element beim zweiten Klick ein anderes und der Doppelklick käme nicht an.
        canvas.querySelectorAll('.dnd-zone-overlay').forEach((o) => o.classList.toggle('selected', o === overlay));
      });
      // Doppelklick: gleich zuordnen
      overlay.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openDndAssignPicker(zone, e.clientX, e.clientY);
      });

      // Rechtsklick (bzw. langes Tippen): Zone duplizieren oder loeschen
      overlay.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: '🎯 Zuordnen …', onClick: () => this._openDndAssignPicker(zone, e.clientX, e.clientY) },
          { label: '⧉ Duplizieren', onClick: () => this._duplicateDndZone(zone.id) },
          { label: '🗑 Ablagezone löschen', danger: true, onClick: () => this._removeDndZone(zone.id) },
        ]);
      });

      this._makeDndZoneInteractive(overlay, zone, canvas);

      canvas.appendChild(overlay);
    });
  }

  /**
   * Erwartetes Element einer Zone setzen – aus der Zonenliste oder per
   * „Zuordnen“ direkt am Bild. Beide Seiten bleiben gleich: Das bisher
   * erwartete Element lässt die Zone los (sonst hätte sie unbemerkt zwei
   * richtige Elemente), das neue zielt auf sie, sofern es noch kein Ziel hat.
   */
  _dndSetZoneExpected(zone, value) {
    const before = zone.correctDraggable;
    zone.correctDraggable = value || '';
    if (before && before !== zone.correctDraggable) {
      this.dndState.draggables.forEach((d) => {
        if (d.text === before && d.correctZone === zone.label) d.correctZone = '';
      });
    }
    this.dndState.draggables.forEach((d) => {
      if (d.text === zone.correctDraggable && !d.correctZone) d.correctZone = zone.label;
    });
    this.refreshDndDraggables();
    this.refreshDndZonesList();
    this.refreshDndCanvas();
  }

  /**
   * Auswahl direkt an der Zone: alle Begriffe, mit Suche. Spart bei vielen
   * Zonen das Hin- und Herscrollen zwischen Bild und Zonenliste. Begriffe,
   * die schon andere Zonen erwarten, sind gekennzeichnet.
   */
  _openDndAssignPicker(zone, x, y) {
    document.querySelectorAll('.ctx-menu').forEach((m) => m._close && m._close());
    const texts = [...new Set(this.dndState.draggables.map((d) => d.text).filter(Boolean))];
    const usedAt = (t) => this.dndState.dropZones
      .filter((z) => z !== zone && this._dndRightTexts(z).includes(t))
      .map((z) => z.label);
    const multiple = (t) => this.dndState.draggables.some((d) => d.text === t && d.multiple);

    const menu = document.createElement('div');
    menu.className = 'ctx-menu dnd-assign-picker';
    menu.innerHTML = `
      <div class="dnd-assign-head">🎯 ${escapeHtml(zone.label)} erwartet:</div>
      ${texts.length > 6 ? '<input type="search" class="dnd-assign-search" placeholder="Begriff suchen…" />' : ''}
      <div class="dnd-assign-list"></div>`;
    const list = menu.querySelector('.dnd-assign-list');
    const search = menu.querySelector('.dnd-assign-search');
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        const first = list.querySelector('.ctx-menu-item:not(.dnd-assign-none)');
        if (first) { e.preventDefault(); first.click(); }
      }
    };
    menu._close = close;
    const choose = (value) => { close(); this._dndSetZoneExpected(zone, value); };
    const render = () => {
      const q = (search?.value || '').trim().toLowerCase();
      list.innerHTML = '';
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'ctx-menu-item dnd-assign-none';
      none.textContent = '— Kein Element —';
      none.addEventListener('click', () => choose(''));
      if (!q) list.appendChild(none);
      if (!texts.length) {
        list.insertAdjacentHTML('beforeend', '<p class="dnd-assign-empty">Noch keine ziehbaren Elemente – unten unter „Ziehbare Elemente“ anlegen.</p>');
      }
      for (const t of texts.filter((t) => !q || t.toLowerCase().includes(q))) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctx-menu-item' + (zone.correctDraggable === t ? ' active' : '');
        const elsewhere = usedAt(t);
        btn.innerHTML = `${zone.correctDraggable === t ? '✓ ' : ''}${escapeHtml(t)}`
          + (elsewhere.length ? ` <span class="dnd-assign-used${multiple(t) ? '' : ' warn'}" title="${multiple(t) ? 'mehrfach verwendbar' : 'liegt nur einmal in der Ablage'}">schon bei ${escapeHtml(elsewhere.slice(0, 2).join(', '))}${elsewhere.length > 2 ? ' …' : ''}</span>` : '');
        btn.addEventListener('click', () => choose(t));
        list.appendChild(btn);
      }
    };
    search?.addEventListener('input', render);
    render();
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    (search || list.querySelector('.ctx-menu-item.active') || list.querySelector('.ctx-menu-item'))?.focus();
  }

  /**
   * Neue Zone gleicher Groesse direkt neben der Vorlage – rechts, sonst
   * links, sonst darunter bzw. darueber. Mehrfach dupliziert entsteht so eine
   * Reihe gleich grosser Zonen. Die Gruppe (austauschbare Zonen) wird
   * uebernommen, die richtige Antwort nicht – die gehoert zu genau einer Zone.
   */
  _duplicateDndZone(id) {
    const src = this.dndState.dropZones.find((z) => z.id === id);
    if (!src) return;
    const gap = 1;
    let { x, y } = src;
    if (src.x + 2 * src.width + gap <= 100) x = src.x + src.width + gap;
    else if (src.x - src.width - gap >= 0) x = src.x - src.width - gap;
    else if (src.y + 2 * src.height + gap <= 100) y = src.y + src.height + gap;
    else y = Math.max(0, src.y - src.height - gap);
    const newId = this.dndState.nextZoneId++;
    const copy = {
      ...src,
      id: newId,
      label: `Ablagezone ${newId + 1}`,
      correctDraggable: '',
      x: dndSnap(x),
      y: dndSnap(y),
    };
    this.dndState.dropZones.push(copy);
    this.dndState.selectedZone = newId;
    this.refreshDndCanvas();
    this.refreshDndZonesList();
    this.refreshDndDraggables();
  }

  _removeDndZone(id) {
    this.dndState.dropZones = this.dndState.dropZones.filter((z) => z.id !== id);
    if (this.dndState.selectedZone === id) this.dndState.selectedZone = null;
    this.refreshDndCanvas();
    this.refreshDndZonesList();
    this.refreshDndDraggables();
  }

  /**
   * Welche Ecke der Zone liegt unter dem Zeiger ('nw', 'ne', 'sw', 'se')?
   * null heisst: Flaeche, also verschieben. Der Fangbereich waechst fuer
   * Finger, bleibt aber hoechstens ein Drittel der Zone, damit auch eine
   * kleine Zone in der Mitte noch verschiebbar ist.
   */
  _dndCornerAt(overlay, e) {
    const r = overlay.getBoundingClientRect();
    const grip = Math.min(e.pointerType === 'touch' ? 16 : 10, r.width / 3, r.height / 3);
    const nearL = e.clientX - r.left <= grip;
    const nearR = r.right - e.clientX <= grip;
    const nearT = e.clientY - r.top <= grip;
    const nearB = r.bottom - e.clientY <= grip;
    if (nearT && nearL) return 'nw';
    if (nearT && nearR) return 'ne';
    if (nearB && nearL) return 'sw';
    if (nearB && nearR) return 'se';
    return null;
  }

  /**
   * Verschieben und Groesse aendern in einem: An den Ecken zeigt der Zeiger
   * den Groessen-Cursor und zieht die Ecke (die gegenueberliegende bleibt
   * stehen), sonst den Verschieben-Cursor und bewegt die ganze Zone.
   */
  _makeDndZoneInteractive(overlay, zone, canvas) {
    const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
    let mode = null; // 'move' | Ecke
    let offsetX = 0, offsetY = 0;
    let fixedX = 0, fixedY = 0;

    const toPct = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
        minW: (DND_MIN_ZONE_PX / rect.width) * 100,
        minH: (DND_MIN_ZONE_PX / rect.height) * 100,
      };
    };
    const apply = () => {
      overlay.style.left = zone.x + '%';
      overlay.style.top = zone.y + '%';
      overlay.style.width = zone.width + '%';
      overlay.style.height = zone.height + '%';
    };

    overlay.addEventListener('pointerdown', (e) => {
      if (this.dndState.drawMode || e.button !== 0) return;
      const p = toPct(e);
      const corner = this._dndCornerAt(overlay, e);
      if (corner) {
        mode = corner;
        // Gegenueberliegende Ecke bleibt fest
        fixedX = corner.includes('w') ? zone.x + zone.width : zone.x;
        fixedY = corner.includes('n') ? zone.y + zone.height : zone.y;
      } else {
        mode = 'move';
        offsetX = p.x - zone.x;
        offsetY = p.y - zone.y;
      }
      overlay.style.cursor = corner ? cursors[corner] : 'grabbing';
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    overlay.addEventListener('pointermove', (e) => {
      if (!mode) {
        if (this.dndState.drawMode) return;
        const corner = this._dndCornerAt(overlay, e);
        overlay.style.cursor = corner ? cursors[corner] : 'move';
        return;
      }
      const p = toPct(e);
      if (mode === 'move') {
        zone.x = dndSnap(Math.max(0, Math.min(100 - zone.width, p.x - offsetX)));
        zone.y = dndSnap(Math.max(0, Math.min(100 - zone.height, p.y - offsetY)));
      } else {
        const curX = Math.max(0, Math.min(100, p.x));
        const curY = Math.max(0, Math.min(100, p.y));
        if (mode.includes('w')) {
          const left = dndSnap(Math.min(curX, fixedX - p.minW));
          zone.x = Math.max(0, left);
          zone.width = dndSnap(fixedX - zone.x);
        } else {
          zone.x = fixedX;
          zone.width = dndSnap(Math.min(100 - fixedX, Math.max(p.minW, curX - fixedX)));
        }
        if (mode.includes('n')) {
          const top = dndSnap(Math.min(curY, fixedY - p.minH));
          zone.y = Math.max(0, top);
          zone.height = dndSnap(fixedY - zone.y);
        } else {
          zone.y = fixedY;
          zone.height = dndSnap(Math.min(100 - fixedY, Math.max(p.minH, curY - fixedY)));
        }
      }
      apply();
    });

    const end = () => {
      if (!mode) return;
      mode = null;
      overlay.style.cursor = '';
      this.refreshDndZonesList();
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }

  refreshDndZonesList() {
    const list = this.container.querySelector('#dnd-zones-list');
    if (!list) return;
    list.innerHTML = '';

    if (this.dndState.dropZones.length === 0) {
      list.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">Noch keine Ablagezonen definiert.</p>';
      return;
    }

    // Kurzanleitung: Der häufigste Fall braucht nur die Auswahl an der Zone.
    const howto = document.createElement('p');
    howto.className = 'dnd-group-hint dnd-howto';
    howto.innerHTML = '👉 <strong>Ein Begriff je Zone:</strong> hier bei jeder Zone das erwartete Element wählen – oder direkt am Bild: '
      + '<strong>Doppelklick auf die Zone</strong> (bzw. Rechtsklick › 🎯 Zuordnen). '
      + 'Das „Ziel“ bei den ziehbaren Elementen unten trägt der Editor dann selbst ein; es ist dieselbe Zuordnung von der anderen Seite. '
      + 'Derselbe Begriff in mehreren Zonen: unten beim Element „mehrfach“ ankreuzen. '
      + '<button type="button" class="help-hint" data-help="moodle-und-h5p#ein-begriff-je-zone-der-normalfall" title="Hilfe: Zuordnung" aria-label="Hilfe">?</button>';
    list.appendChild(howto);

    const shortage = dndShortage(this.dndState);

    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    this.dndState.dropZones.forEach((zone, i) => {
      const item = document.createElement('div');
      item.className = 'dnd-zone-item';
      const color = colors[i % colors.length];

      const colorDot = document.createElement('span');
      colorDot.className = 'dnd-zone-dot';
      colorDot.style.background = color;

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = zone.label;
      labelInput.placeholder = 'Zonenbezeichnung...';
      labelInput.className = 'dnd-zone-label-input';
      let oldLabel = zone.label;
      labelInput.addEventListener('input', () => {
        const newLabel = labelInput.value;
        zone.label = newLabel;
        this.dndState.draggables.forEach(d => {
          if (d.correctZone === oldLabel) d.correctZone = newLabel;
        });
        oldLabel = newLabel;
        this.refreshDndCanvas();
        this.refreshDndDraggables();
      });

      const posLabel = document.createElement('span');
      posLabel.className = 'dnd-zone-pos';
      posLabel.textContent = `${zone.x}%, ${zone.y}% — ${zone.width}×${zone.height}%`;

      const targetLabel = document.createElement('span');
      targetLabel.innerHTML = '&nbsp;➡ Erwartetes Wort:&nbsp;';
      targetLabel.style.fontSize = '0.85rem';
      targetLabel.style.color = 'var(--text-secondary)';

      const dragSelect = document.createElement('select');
      dragSelect.className = 'dnd-zone-drag-select';
      dragSelect.style.flex = '1';
      
      const emptyOptD = document.createElement('option');
      emptyOptD.value = '';
      emptyOptD.textContent = '— Kein Element —';
      dragSelect.appendChild(emptyOptD);
      
      const uniqueDrags = [...new Set(this.dndState.draggables.map(d => d.text).filter(Boolean))];
      uniqueDrags.forEach((dragText) => {
        const opt = document.createElement('option');
        opt.value = dragText;
        opt.textContent = dragText;
        if (zone.correctDraggable === dragText) opt.selected = true;
        dragSelect.appendChild(opt);
      });
      dragSelect.addEventListener('change', () => this._dndSetZoneExpected(zone, dragSelect.value));

      // Was in diese Zone gehört – bei mehreren Elementen alle.
      const rightTexts = this._dndRightTexts(zone);
      const rightInfo = document.createElement('span');
      rightInfo.className = 'dnd-zone-right';
      rightInfo.textContent = rightTexts.length > 1 ? `✓ ${rightTexts.length} richtig: ${rightTexts.join(' · ')}` : '';
      // Wird ein Begriff öfter erwartet, als er in der Ablage liegt, ist die Aufgabe nicht lösbar.
      const short = rightTexts.filter((t) => shortage.has(t));
      const warnInfo = document.createElement('span');
      warnInfo.className = 'dnd-zone-warn';
      warnInfo.textContent = short.map((t) => `⚠ „${t}“ wird in ${shortage.get(t).zones} Zonen erwartet, liegt aber nur ${shortage.get(t).pieces}× in der Ablage – unten bei „${t}“ „mehrfach“ ankreuzen.`).join(' ');

      const groupLabel = document.createElement('span');
      groupLabel.innerHTML = '&nbsp;🔀 Gruppe:&nbsp;';
      groupLabel.style.fontSize = '0.85rem';
      groupLabel.style.color = 'var(--text-secondary)';

      // Ablagegruppe als Auswahl statt Freitext: vorhandene Gruppen wählen oder
      // per "Neue Gruppe" eine anlegen. Unbekannte (z. B. importierte) IDs
      // bleiben als Option erhalten.
      const groupSelect = document.createElement('select');
      groupSelect.className = 'dnd-zone-group-input';
      groupSelect.title = 'Zonen derselben Ablagegruppe sind untereinander vertauschbar (z. B. symmetrische Eingänge eines Oder-Gatters). „Keine“ für feste Zuordnung.';
      const noGroupOpt = document.createElement('option');
      noGroupOpt.value = '';
      noGroupOpt.textContent = '— keine —';
      groupSelect.appendChild(noGroupOpt);
      this._dndGroupNames().forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (zone.group === name) opt.selected = true;
        groupSelect.appendChild(opt);
      });
      const newGroupOpt = document.createElement('option');
      newGroupOpt.value = '__new__';
      newGroupOpt.textContent = '➕ Neue Gruppe';
      groupSelect.appendChild(newGroupOpt);
      groupSelect.addEventListener('change', () => {
        zone.group = groupSelect.value === '__new__' ? this._dndNextGroupName() : groupSelect.value;
        this.refreshDndCanvas();
        this.refreshDndZonesList();
      });

      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn btn-danger btn-sm';
      btnRemove.textContent = '✕';
      btnRemove.addEventListener('click', () => this._removeDndZone(zone.id));

      item.appendChild(colorDot);
      item.appendChild(labelInput);
      item.appendChild(targetLabel);
      item.appendChild(dragSelect);
      item.appendChild(groupLabel);
      item.appendChild(groupSelect);
      item.appendChild(posLabel);
      item.appendChild(btnRemove);
      if (rightInfo.textContent) item.appendChild(rightInfo);
      if (warnInfo.textContent) item.appendChild(warnInfo);
      list.appendChild(item);
    });

    const multiHint = document.createElement('p');
    multiHint.className = 'dnd-group-hint';
    multiHint.innerHTML = '🧺 Mehrere richtige Elemente je Zone: Bei den ziehbaren Elementen dieselbe Zone als Ziel wählen – die Zone ist dann richtig, wenn alle drin liegen. '
      + '<button type="button" class="help-hint" data-help="moodle-und-h5p#mehrere-elemente-je-zone" title="Hilfe: mehrere Elemente je Zone" aria-label="Hilfe">?</button>';
    list.appendChild(multiHint);

    const hint = document.createElement('p');
    hint.className = 'dnd-group-hint';
    hint.textContent = '🔀 Ablagegruppen: Zonen derselben Gruppe sind untereinander vertauschbar – ein Element zählt als richtig, wenn es in irgendeiner Zone seiner Gruppe liegt. Eine Gruppe braucht mindestens zwei Zonen.';
    list.appendChild(hint);
  }

  /**
   * Richtige Elemente einer Zone – dieselbe Regel wie in der Auswertung
   * (answer-eval.js, dndExpectedMappings): alle Elemente mit dieser Zone als
   * Ziel, solange das Erwartete Wort darunter ist oder fehlt.
   */
  _dndRightTexts(zone) {
    const targeted = [...new Set(this.dndState.draggables.filter((d) => d.correctZone === zone.label && d.text).map((d) => d.text))];
    const own = zone.correctDraggable || '';
    return !own ? targeted : targeted.includes(own) ? targeted : [own];
  }

  _dndGroupNames() {
    return [...new Set(this.dndState.dropZones.map((z) => z.group).filter(Boolean))].sort();
  }

  _dndNextGroupName() {
    const used = new Set(this._dndGroupNames());
    for (let n = 0; ; n++) {
      // Gruppe A … Z, danach Gruppe AA, AB, …
      let suffix = '';
      for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) suffix = String.fromCharCode(65 + (k % 26)) + suffix;
      const name = `Gruppe ${suffix}`;
      if (!used.has(name)) return name;
    }
  }

  refreshDndDraggables() {
    const list = this.container.querySelector('#dnd-drags-list');
    if (!list) return;
    list.innerHTML = '';

    this.dndState.draggables.forEach((drag, i) => {
      const item = document.createElement('div');
      item.className = 'dnd-drag-item';

      const numLabel = document.createElement('span');
      numLabel.className = 'dnd-drag-num';
      numLabel.textContent = `#${i + 1}`;

      const wordLabel = document.createElement('span');
      wordLabel.innerHTML = '&nbsp;Wort:&nbsp;';
      wordLabel.style.fontSize = '0.85rem';
      wordLabel.style.color = 'var(--text-secondary)';

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = drag.text;
      textInput.placeholder = 'Ziehbarer Text...';
      textInput.className = 'dnd-drag-text-input';
      textInput.style.flex = '1';
      let oldDragText = drag.text;
      textInput.addEventListener('input', () => { 
        const newDragText = textInput.value;
        drag.text = newDragText;
        this.dndState.dropZones.forEach(z => {
          if (z.correctDraggable === oldDragText) z.correctDraggable = newDragText;
        });
        oldDragText = newDragText;
        this.refreshDndZonesList();
      });

      const targetLabel = document.createElement('span');
      targetLabel.innerHTML = '&nbsp;➡ Ziel:&nbsp;';
      targetLabel.style.fontSize = '0.85rem';
      targetLabel.style.color = 'var(--text-secondary)';

      const zoneSelect = document.createElement('select');
      zoneSelect.className = 'dnd-drag-zone-select';
      zoneSelect.style.flex = '1';
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '— Keine Zone —';
      zoneSelect.appendChild(emptyOpt);
      this.dndState.dropZones.forEach((zone) => {
        const opt = document.createElement('option');
        opt.value = zone.label;
        opt.textContent = zone.label;
        if (drag.correctZone === zone.label) opt.selected = true;
        zoneSelect.appendChild(opt);
      });
      zoneSelect.addEventListener('change', () => {
        const before = drag.correctZone;
        drag.correctZone = zoneSelect.value;
        const zoneOf = (label) => this.dndState.dropZones.find((z) => z.label === label);
        // Neue Zone ohne Erwartetes Wort: dieses Element eintragen.
        const target = zoneOf(drag.correctZone);
        if (target && !target.correctDraggable) target.correctDraggable = drag.text;
        // Alte Zone erwartete genau dieses Element: auf ein verbliebenes umstellen.
        const old = before && before !== drag.correctZone ? zoneOf(before) : null;
        if (old && old.correctDraggable === drag.text
          && !this.dndState.draggables.some((d) => d !== drag && d.text === drag.text && d.correctZone === before)) {
          old.correctDraggable = this.dndState.draggables.find((d) => d.correctZone === before && d.text)?.text || '';
        }
        this.refreshDndZonesList();
      });

      const chkWrap = document.createElement('label');
      chkWrap.style.display = 'flex';
      chkWrap.style.alignItems = 'center';
      chkWrap.style.gap = '4px';
      chkWrap.style.margin = '0 10px';
      chkWrap.style.fontSize = '0.8rem';
      chkWrap.style.color = 'var(--text-secondary)';
      chkWrap.style.cursor = 'pointer';
      
      const chkInput = document.createElement('input');
      chkInput.type = 'checkbox';
      chkInput.checked = !!drag.multiple;
      chkInput.addEventListener('change', () => { drag.multiple = chkInput.checked; this.refreshDndZonesList(); });
      chkWrap.appendChild(chkInput);
      chkWrap.appendChild(document.createTextNode('Mehrfach nutzbar'));

      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn btn-danger btn-sm';
      btnRemove.textContent = '✕';
      btnRemove.addEventListener('click', () => {
        this.dndState.draggables.splice(i, 1);
        this.refreshDndDraggables();
      });

      item.appendChild(numLabel);
      item.appendChild(wordLabel);
      item.appendChild(textInput);
      item.appendChild(targetLabel);
      item.appendChild(zoneSelect);
      item.appendChild(chkWrap);
      item.appendChild(btnRemove);
      list.appendChild(item);
    });
  }

  collectDragAndDropData() {
    const descHidden = this.container.querySelector('[name="content_dnd_taskDescription"]');
    const descFallback = this.container.querySelector('#dnd-editor-desc');
    return {
      taskDescription: descHidden ? descHidden.value : (descFallback ? descFallback.value : ''),
      backgroundImage: this.dndState.backgroundImage,
      randomOrder: !!this.dndState.randomOrder,
      dropZones: this.dndState.dropZones.map((z) => ({
        label: z.label,
        correctDraggable: z.correctDraggable,
        group: z.group || '',
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
      })),
      draggables: this.dndState.draggables.filter((d) => d.text.trim()).map((d) => ({
        text: d.text,
        correctZone: d.correctZone,
        multiple: d.multiple,
      })),
    };
  }

  /**
   * Clear the editor.
   */
  clear() {
    if (this._dndKeyHandler) {
      document.removeEventListener('keydown', this._dndKeyHandler);
      this._dndKeyHandler = null;
    }
    this.dndState = null;
    this.hsEditor = null;
    this.brEditor = null;
    this._h5pNativeData = null;
    this.container.innerHTML = '';
    this.container.classList.remove('active');
    this.currentType = null;
    this.listCounters = {};
  }
}
