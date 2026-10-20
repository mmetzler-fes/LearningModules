import { escapeHtml, escapeAttr } from '../utils.js';
import { AI_PROMPT_TYPES, AI_PROMPT_PART_SIZE, buildAiPrompt } from '../ai-prompt.js';
import { nextcloudState } from './nextcloud.js';
import { DEFAULT_IMAGE_STYLE, parseImageWords, buildImagePrompt, matchImageFiles } from '../image-words.js';
import { DocPromptView } from './doc-prompt-view.js';

// ==================== KI-PROMPT-GENERATOR ====================

const STORAGE_KEY = 'lm_ai_prompt';

/**
 * Eigene Seite "KI-Prompt": Angaben zum Quiz sammeln, daraus einen Prompt
 * bauen, der der KI das Importformat genau vorgibt. Die Antwort der KI kommt
 * über "📥 Thema importieren" herein (eingefügt oder als .json).
 *
 * Früher ein Popup – ein Klick daneben schloss es samt Eingaben. Jetzt bleibt
 * das Formular beim Wechsel der Ansicht stehen, und jede Eingabe landet sofort
 * im Browser, übersteht also auch ein Neuladen.
 */
export class AiPromptView {
  constructor(app) {
    this.app = app;
    this.box = document.getElementById('aiPromptPanel');
  }

  refresh() {
    // Nur einmal zeichnen – sonst wären Eingaben und erzeugter Prompt weg.
    if (this.box && !this.form) this._render();
    if (this.form) this._updateNextcloud();
    this._tabs();
  }

  /** Reiter „Quiz-Thema | Dokument“ – Dokumente nur mit Freischaltung 'worksheets'. */
  _tabs() {
    if (!this.box) return;
    const docs = (this.app.state.currentUser?.features || []).includes('worksheets');
    if (!docs) {
      this._tabBar?.remove();
      this._docBox?.remove();
      this._tabBar = this._docBox = this._docView = null;
      this.box.classList.remove('hidden');
      return;
    }
    if (this._tabBar) return;
    this._tabBar = document.createElement('div');
    this._tabBar.className = 'admin-tabs ai-prompt-tabs';
    this._tabBar.innerHTML = `<button type="button" class="admin-tab active" data-tab="quiz">🧠 Quiz-Thema</button>
      <button type="button" class="admin-tab" data-tab="doc">📄 Dokument (Arbeitsblatt, Klassenarbeit, Text)</button>`;
    this._docBox = document.createElement('div');
    this._docBox.className = 'ai-prompt-panel hidden';
    this.box.before(this._tabBar);
    this.box.after(this._docBox);
    this._tabBar.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (!tab) return;
      this._tabBar.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      this.box.classList.toggle('hidden', tab !== 'quiz');
      this._docBox.classList.toggle('hidden', tab !== 'doc');
      if (tab === 'doc' && !this._docView) {
        this._docView = new DocPromptView(this.app, this._docBox);
        await this._docView.render();
      }
    });
  }

  /**
   * Bilder aus der eigenen Nextcloud anbieten – nur bei verbundener
   * Nextcloud sichtbar (die kann nach dem ersten Zeichnen dazukommen).
   */
  async _updateNextcloud() {
    const box = this.form.querySelector('.ai-prompt-nc');
    box.classList.toggle('hidden', !nextcloudState.ready);
    if (!nextcloudState.ready || this._ncLoaded) return;
    this._ncLoaded = true;
    const res = await this.app.api.listNextcloudImages({});
    const select = this.form.elements.ncFolder;
    if (!res || res.message || !res.folders) { this._ncLoaded = false; return; }
    const wanted = this._load().ncFolder;
    select.innerHTML = res.folders.length
      ? res.folders.map((f) => `<option value="${escapeAttr(f)}" ${f === wanted ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')
      : '<option value="">(noch keine Ordner unter „Bilder“)</option>';
  }

  // ---------- Bilder zu Wörtern von einer KI erzeugen lassen ----------

  /** Ordner, in den die erzeugten Bilder kommen: eingetragen, sonst das Thema. */
  _imgFolder() {
    const f = this.form.elements;
    return f.imgFolder.value.trim() || f.title.value.trim() || 'KI-Bilder';
  }

  /** Zuordnung Wort → Datei neu berechnen und als Tabelle zeigen. */
  _renderImgTable() {
    const box = this.form.querySelector('.ai-img-table');
    const words = parseImageWords(this.form.elements.imgWords.value);
    const files = this._imgFiles || [];
    if (!words.length || !files.length) { box.innerHTML = ''; this._imgAssign = []; this._updateImgButton(); return; }
    this._imgAssign = matchImageFiles(words, files.map((f) => f.name)).assigned;
    const option = (i, sel) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i < 0 ? '— fehlt —' : escapeHtml(files[i].name)}</option>`;
    box.innerHTML = `<table class="ai-img-assign"><tbody>${words.map((w, k) => `
      <tr><td>${escapeHtml(w.word)}</td>
        <td><select data-k="${k}">${[-1, ...files.map((_, i) => i)].map((i) => option(i, this._imgAssign[k])).join('')}</select></td>
        <td class="ai-img-state">${this._imgAssign[k] >= 0 ? '✅' : '❌'}</td></tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
      this._imgAssign[Number(sel.dataset.k)] = Number(sel.value);
      sel.closest('tr').querySelector('.ai-img-state').textContent = Number(sel.value) >= 0 ? '✅' : '❌';
      this._updateImgButton();
    }));
    this._updateImgButton();
  }

  _updateImgButton() {
    const n = (this._imgAssign || []).filter((i) => i >= 0).length;
    const btn = this.form.querySelector('.btn-img-upload');
    btn.disabled = !n;
    btn.textContent = n ? `⬆ ${n} Bild${n === 1 ? '' : 'er'} nach „Bilder/${this._imgFolder()}“ laden` : '⬆ In die Nextcloud laden';
  }

  _addImgFiles(list) {
    const images = [...list].filter((f) => /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.type));
    if (images.length < list.length) this.app.showToast('Nur Bilder (PNG, JPEG, GIF, WebP, SVG) lassen sich hochladen.', 'info');
    this._imgFiles = [...(this._imgFiles || []), ...images];
    this._renderImgTable();
  }

  /** Zugeordnete Bilder unter dem Namen ihres Wortes hochladen; danach bietet der Quiz-Prompt den Ordner an. */
  async _uploadImgFiles() {
    const words = parseImageWords(this.form.elements.imgWords.value);
    const folder = this._imgFolder();
    const msg = this.form.querySelector('.ai-img-message');
    const btn = this.form.querySelector('.btn-img-upload');
    btn.disabled = true;
    let ok = 0;
    const failed = [];
    for (const [k, w] of words.entries()) {
      const i = (this._imgAssign || [])[k];
      if (i === undefined || i < 0) continue;
      msg.textContent = `⏳ ${w.word} …`;
      const res = await this.app.api.uploadNextcloudImage(this._imgFiles[i], null, { folder, name: w.slug, replace: true });
      if (res?.success) ok++; else failed.push(`${w.word}: ${res?.message || 'Fehler'}`);
    }
    this._ncLoaded = false;
    await this._updateNextcloud();
    const select = this.form.elements.ncFolder;
    if ([...select.options].some((o) => o.value === folder)) select.value = folder;
    this.form.elements.ncUse.checked = true;
    this._save();
    const missing = words.length - ok - failed.length;
    msg.className = `hint ai-img-message${failed.length ? ' login-error' : ''}`;
    msg.textContent = `${ok ? `✅ ${ok} Bild${ok === 1 ? '' : 'er'} in „Bilder/${folder}“ – der Quiz-Prompt bietet sie jetzt an.` : ''}`
      + (missing > 0 ? ` ${missing} Wort${missing === 1 ? '' : 'e'} ohne Bild.` : '')
      + (failed.length ? ` ❌ ${failed.join('; ')}` : '');
    btn.disabled = false;
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  _values() {
    const f = this.form.elements;
    return {
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      level: f.level.value.trim(),
      language: f.language.value.trim(),
      count: Number(f.count.value) || 10,
      types: [...this.form.querySelectorAll('input[name="types"]:checked')].map((b) => b.value),
      files: f.files.value,
      link: f.link.value.trim(),
      linkImages: f.linkImages.checked,
      ncUse: f.ncUse.checked,
      ncFolder: f.ncFolder.value,
      imgWords: f.imgWords.value,
      imgStyle: f.imgStyle.value,
      imgFolder: f.imgFolder.value,
    };
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values())); } catch (_) { /* egal */ }
  }

  _render() {
    const saved = this._load();
    const chosen = new Set(saved.types || ['multipleChoice', 'trueFalse', 'fillInTheBlanks']);
    const v = (key, fallback = '') => escapeAttr(saved[key] ?? fallback);
    this.box.innerHTML = `
      <form class="settings-group ai-prompt-form">
        <div class="form-group"><label>Thema
          <input name="title" maxlength="120" value="${v('title')}" placeholder="z. B. Kondensator im Gleichstromkreis" /></label></div>
        <div class="form-group"><label>Beschreibung des Quiz *
          <textarea name="description" rows="5" required placeholder="Was soll abgefragt werden, worauf liegt der Schwerpunkt?">${escapeHtml(saved.description || '')}</textarea></label></div>
        <div class="ai-prompt-row">
          <label>Klassenstufe / Niveau <input name="level" maxlength="60" value="${v('level')}" placeholder="z. B. TG11, B1" /></label>
          <label>Sprache <input name="language" maxlength="30" value="${v('language', 'Deutsch')}" /></label>
          <label>Anzahl Module <input name="count" type="number" min="1" max="60" value="${v('count', 10)}" /></label>
        </div>
        <div class="form-group"><label>Aufgabentypen</label>
          <div class="ai-prompt-types">${AI_PROMPT_TYPES.map((type) => `
            <label class="tag-filter-option"><input type="checkbox" name="types" value="${type}" ${chosen.has(type) ? 'checked' : ''} />
              ${(H5P_TYPES[type] || {}).icon || ''} ${escapeHtml((H5P_TYPES[type] || {}).name || type)}</label>`).join('')}
          </div></div>
        <div class="form-group"><label>Materialien, die du im KI-Chat anhängst (Dateinamen, je Zeile einer – optional)
          <textarea name="files" rows="3" placeholder="Arbeitsblatt_Kondensator.pdf&#10;Infoblatt_Kapazität.docx">${escapeHtml(saved.files || '')}</textarea></label>
          <span class="hint">Am zuverlässigsten: die Dateien direkt im KI-Chat hochladen. Einen geteilten Ordner kann die KI meist nicht öffnen.</span></div>
        <div class="form-group"><label>Geteilter Ordner, z. B. Nextcloud (optional)
          <input name="link" type="url" value="${v('link')}" placeholder="https://cloud.example.de/s/AbCdEf" /></label>
          <label class="tag-filter-mode"><input type="checkbox" name="linkImages" ${saved.linkImages ? 'checked' : ''} />
            <span>Bilder aus diesem öffentlichen Ordner per Link einbinden lassen</span></label></div>
        <div class="form-group ai-prompt-nc hidden">
          <label class="tag-filter-mode"><input type="checkbox" name="ncUse" ${saved.ncUse ? 'checked' : ''} />
            <span>☁️ Bilder aus meiner Nextcloud anbieten</span></label>
          <label>Ordner unter „Bilder“ <select name="ncFolder"><option value="${v('ncFolder')}">${escapeHtml(saved.ncFolder || '…')}</option></select></label>
          <span class="hint">Die KI bekommt die Dateinamen dieses Ordners und darf nur daraus wählen – sprechende Namen wie
            <code>flughafen-gate.jpg</code> helfen. Beim Import werden daraus Links auf deine Nextcloud.</span>
          <details class="ai-img-gen">
            <summary>🎨 Bilder erst von einer KI erzeugen lassen</summary>
            <p class="hint">Für Wörter, zu denen es noch keine Bilder gibt: Hier einen Prompt für eine Bild-KI (ChatGPT, Gemini,
              Copilot …) erzeugen, die Bilder dort erstellen lassen und herunterladen, dann hier hochladen. Jedes Bild bekommt
              den Namen seines Wortes; danach bietet der Quiz-Prompt sie an.</p>
            <label>Wörter / Begriffe (je Zeile eines)
              <textarea name="imgWords" rows="5" placeholder="Hund&#10;Katze&#10;Pferd">${escapeHtml(saved.imgWords || '')}</textarea></label>
            <div class="ai-prompt-row">
              <label>Stil <input name="imgStyle" value="${v('imgStyle', DEFAULT_IMAGE_STYLE)}" /></label>
              <label>Ordner unter „Bilder“ <input name="imgFolder" value="${v('imgFolder')}" placeholder="leer = Thema" /></label>
            </div>
            <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-img-prompt">🎨 Prompt für Bilder</button></div>
            <div class="ai-img-prompt hidden">
              <textarea readonly rows="10" class="ai-img-output"></textarea>
              <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-img-copy">📋 Kopieren</button></div>
            </div>
            <div class="ai-img-drop">
              <button type="button" class="btn btn-secondary btn-img-pick">📤 Bilder hochladen</button>
              <span class="hint">oder hierher ziehen – die Zuordnung zu den Wörtern macht die App, falsche lassen sich unten ändern.</span>
            </div>
            <div class="ai-img-table"></div>
            <div class="confirm-actions"><button type="button" class="btn btn-primary btn-img-upload" disabled>⬆ In die Nextcloud laden</button></div>
            <p class="hint ai-img-message"></p>
          </details></div>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">✨ Prompt erzeugen</button>
        </div>
        <div class="ai-prompt-result hidden">
          <textarea readonly rows="16" class="ai-prompt-output"></textarea>
          <p class="hint ai-prompt-parts hidden"></p>
          <div class="confirm-actions">
            <button type="button" class="btn btn-primary btn-copy">📋 Kopieren</button>
            <button type="button" class="btn btn-secondary btn-save">💾 Als Textdatei</button>
          </div>
        </div>
      </form>`;

    const form = this.box.querySelector('form');
    this.form = form;
    const output = form.querySelector('.ai-prompt-output');
    form.addEventListener('input', () => this._save());
    // Bilder zu Wörtern von einer KI erzeugen lassen
    form.querySelector('.btn-img-prompt').addEventListener('click', () => {
      const words = parseImageWords(form.elements.imgWords.value);
      if (!words.length) { this.app.showToast('Bitte zuerst Wörter eintragen, je Zeile eines.', 'error'); return; }
      form.querySelector('.ai-img-output').value = buildImagePrompt(words, form.elements.imgStyle.value.trim(), form.elements.language.value.trim() || 'Deutsch');
      form.querySelector('.ai-img-prompt').classList.remove('hidden');
    });
    form.querySelector('.btn-img-copy').addEventListener('click', async () => {
      const out = form.querySelector('.ai-img-output');
      try { await navigator.clipboard.writeText(out.value); this.app.showToast('Prompt kopiert – in der Bild-KI einfügen.', 'success'); } catch (_) { out.select(); }
    });
    form.querySelector('.btn-img-pick').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
      input.onchange = () => this._addImgFiles(input.files);
      input.click();
    });
    const drop = form.querySelector('.ai-img-gen');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
    drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-dragover'); });
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-dragover'); this._addImgFiles(e.dataTransfer?.files || []); });
    form.elements.imgWords.addEventListener('input', () => this._renderImgTable());
    form.elements.imgFolder.addEventListener('input', () => this._updateImgButton());
    form.elements.title.addEventListener('input', () => this._updateImgButton());
    form.querySelector('.btn-img-upload').addEventListener('click', () => this._uploadImgFiles());
    form.addEventListener('change', () => this._save());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = this._values();
      if (values.types.length === 0) { this.app.showToast('Bitte mindestens einen Aufgabentyp wählen.', 'error'); return; }
      this._save();
      // Bilder der gewählten Nextcloud-Ordners als nc:-Verweise (der Import löst sie auf).
      if (values.ncUse && nextcloudState.ready && values.ncFolder) {
        const res = await this.app.api.listNextcloudImages({ folder: values.ncFolder });
        values.ncImages = (res?.images || []).map((img) => `nc:${res.current}/${img.name}`);
        if (!values.ncImages.length) this.app.showToast(`Im Ordner „${values.ncFolder}“ liegen keine Bilder – Prompt ohne Bilder.`, 'info');
      }
      output.value = buildAiPrompt(values);
      // Viele Module kommen in Teilen – sonst bricht die KI mitten im JSON ab.
      const parts = Math.ceil(values.count / AI_PROMPT_PART_SIZE);
      const partsHint = form.querySelector('.ai-prompt-parts');
      partsHint.classList.toggle('hidden', parts < 2);
      partsHint.innerHTML = `Die KI antwortet in <strong>${parts} Teilen</strong> zu je höchstens ${AI_PROMPT_PART_SIZE} Modulen
        – mit „weiter“ kommt der nächste. Jeden Teil kopieren und einfügen: Teil 1 über
        <strong>🏠 LernModule → 📥 Thema importieren</strong>, die weiteren im neuen Thema über
        <strong>📥 Module importieren</strong> – jeweils einfügen oder als <code>.json</code>-Datei wählen.`;
      form.querySelector('.ai-prompt-result').classList.remove('hidden');
      output.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    form.querySelector('.btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(output.value);
        this.app.showToast('Prompt kopiert – im KI-Chat einfügen und die Materialien anhängen.', 'success');
      } catch (_) {
        output.select();
        this.app.showToast('Bitte mit Strg+C kopieren', 'info');
      }
    });
    form.querySelector('.btn-save').addEventListener('click', () => {
      const name = (form.elements.title.value.trim() || 'Lernthema').replace(/[^\wäöüÄÖÜß -]+/g, '').trim() || 'Lernthema';
      const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `KI-Prompt ${name}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }
}
