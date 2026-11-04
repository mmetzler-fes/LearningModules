import { escapeHtml, escapeAttr } from '../utils.js';
import { AI_PROMPT_TYPES, AI_PROMPT_PART_SIZE, buildAiPrompt, docSpecToText, promptSize } from '../ai-prompt.js';
import { nextcloudState } from './nextcloud.js';
import { DEFAULT_IMAGE_STYLE, parseImageWords, buildImagePrompt, matchImageFiles } from '../image-words.js';
import { DocPromptView } from './doc-prompt-view.js';
import { PromptMaterial, presetPromptMaterial, resetPromptMaterial } from './prompt-material.js';
import { copyWhenReady, mountAnswerBox } from './ai-answer.js';

// ==================== KI-PROMPT-GENERATOR ====================

const STORAGE_KEY = 'lm_ai_prompt';


/**
 * Eigene Seite „KI-Lernmodul“: gemeinsame Angaben einmal oben, darunter je
 * Auswahl (📄 Dokument, 🧠 Quiz) ein Schritt: Prompt erzeugen und kopieren,
 * Antwort der KI einfügen, prüfen und übernehmen. Der erste Import legt das
 * Lernthema an (unter „Unsortiert“ oder am gewählten Ort), alle weiteren
 * kommen hinein. Ein übernommenes Dokument ist Material für den Quiz-Prompt.
 *
 * Eingaben bleiben im Browser, Anhänge nur für einen Prompt.
 */
export class AiPromptView {
  constructor(app) {
    this.app = app;
    this.box = document.getElementById('aiPromptPanel');
    this.target = { nodeId: null, topicId: null, label: '' };
    this.run = { topicId: null, title: '', count: 0, docs: [] };
  }

  _docsOn() {
    return (this.app.state.currentUser?.features || []).includes('worksheets');
  }

  refresh() {
    // Nur einmal zeichnen – sonst wären Eingaben und erzeugter Prompt weg.
    if (this.box && !this.form) this._render();
    if (this.form) this._updateNextcloud();
    this._syncSteps();
    this._renderRun();
    // Anhänge bleiben nicht liegen. Nur die Quelle aus dem ⋯-Menü gilt beim Öffnen.
    this._clearAttachments();
    this._docView?.clearAttachments();
    if (!this._keepMaterial) resetPromptMaterial();
  }

  /** Dateinamen, geteilter Ordner und Nextcloud-Bilder gelten nur für einen Prompt. */
  _clearAttachments() {
    if (!this.form) return;
    const f = this.form.elements;
    f.files.value = '';
    f.link.value = '';
    f.linkImages.checked = false;
    f.ncUse.checked = false;
  }

  /**
   * Aus dem Notizbuch: Ziel festlegen (Book, Bereich, Abschnitt oder Lernthema),
   * auf Wunsch mit den Dokumenten dieser Stelle als Material.
   * @param o { nodeId, topicId, topicTitle, label, material: 'n:…' | 't:…' }
   */
  async openFor({ nodeId = null, topicId = null, topicTitle = '', label = '', material = null } = {}) {
    this.target = { nodeId, topicId, label };
    this.run = { topicId, title: topicTitle, count: 0, docs: [] };
    if (material) presetPromptMaterial(material);
    this._keepMaterial = !!material;
    try { await this.app.navigateToView('teacher-ai-prompt'); } finally { this._keepMaterial = false; }
    if (material) {
      await this._material?.render();
      this.box.querySelector('.ai-material').open = true;
    }
    await this._docView?.loadContext();
  }

  /** Gemeinsame Angaben für alle Schritte. */
  shared() {
    const f = this.sharedForm.elements;
    return { title: f.title.value.trim(), description: f.description.value.trim(), level: f.level.value.trim(), language: f.language.value.trim() };
  }

  /** Pflichtangaben da? Sonst zeigt der Browser den Hinweis am Feld. */
  sharedValid() {
    return this.sharedForm.reportValidity();
  }

  /** Eine Antwort ist übernommen: beim ersten Mal Lernthema benennen und einsortieren. */
  async onImported(data, docs) {
    if (!this.run.topicId) {
      this.run.topicId = data.topicId;
      this.run.title = data.topicTitle || '';
      const { title } = this.shared();
      if (title && title !== this.run.title) {
        await this.app.api.saveTopic({ id: data.topicId, title }, true);
        this.run.title = title;
      }
      if (this.target.nodeId) await this.app.api.moveInNotebook('topic', data.topicId, this.target.nodeId, null);
    }
    this.run.count += data.importedCount || 0;
    this.run.docs.push(...docs.map((d) => ({ title: d.title, path: '', text: docSpecToText(d.spec) })));
    this._renderRun();
  }

  /** Das Ziel und was schon übernommen ist. */
  _renderRun() {
    const line = this.box?.querySelector('.ai-run');
    if (!line) return;
    const place = this.target.label ? `📂 ${escapeHtml(this.target.label)}` : '🗂 Unsortiert';
    const running = this.run.topicId && (this.run.count || this.target.topicId);
    line.innerHTML = this.target.topicId
      ? `<strong>Ziel:</strong> 📘 Lernthema „${escapeHtml(this.run.title)}“${this.run.count ? ` · ${this.run.count} neue${this.run.count === 1 ? 's Modul' : ' Module'}` : ''}`
      : running
        ? `<strong>Lernthema:</strong> 📘 „${escapeHtml(this.run.title)}“ in ${place} · ${this.run.count} Modul${this.run.count === 1 ? '' : 'e'}`
        : `<strong>Ziel:</strong> ${place} – das Lernthema entsteht mit der ersten übernommenen Antwort.`;
    this.box.querySelector('.btn-new-run').hidden = !running && !this.target.nodeId;
  }

  /** Neu beginnen: anderes Lernthema, leere Angaben, Ziel wieder „Unsortiert“. */
  _newRun() {
    this.target = { nodeId: null, topicId: null, label: '' };
    this.run = { topicId: null, title: '', count: 0, docs: [] };
    const f = this.sharedForm.elements;
    f.title.value = '';
    f.description.value = '';
    this._save();
    resetPromptMaterial();
    this._renderRun();
    this._docView?.loadContext();
  }

  /** Schritte passend zur Auswahl zeigen; Dokumente nur mit Freischaltung. */
  _syncSteps() {
    if (!this.sharedForm) return;
    const docs = this._docsOn();
    const f = this.sharedForm;
    f.querySelector('.ai-pick-doc').hidden = !docs;
    if (docs && !this._docView) {
      this._docView = new DocPromptView(this.app, this.box.querySelector('.ai-doc-box'), this);
      this._docView.render();
    }
    this.box.querySelector('[data-step="doc"]').hidden = !docs || !f.elements.stepDoc.checked;
    this.box.querySelector('[data-step="quiz"]').hidden = !f.elements.stepQuiz.checked;
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
    return f.imgFolder.value.trim() || this.shared().title || 'KI-Bilder';
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
    try {
      // Anhänge kommen nicht zurück, auch nicht aus älteren Speicherständen.
      const { files, link, linkImages, ncUse, ...rest } = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      return rest;
    } catch (_) { return {}; }
  }

  _values() {
    const f = this.form.elements;
    return {
      ...this.shared(),
      stepDoc: this.sharedForm.elements.stepDoc.checked,
      stepQuiz: this.sharedForm.elements.stepQuiz.checked,
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

  /** Prompt bauen und gleich kopieren – der Kopierauftrag startet noch im Klick. */
  async _generate(output) {
    const form = this.form;
    const job = this._buildPrompt();
    const copied = copyWhenReady(job.then((b) => b.prompt));
    let built;
    try { built = await job; } catch (err) { this.app.showToast(err.message, 'error'); return; }
    output.value = built.prompt;
    const ok = await copied;
    const copiedHint = form.querySelector('.ai-prompt-copied');
    copiedHint.textContent = ok ? '✅ Prompt ist kopiert – im KI-Chat einfügen, die Antwort kommt unten ins Feld.' : '⚠️ Kopieren war nicht möglich – bitte unter „Prompt ansehen“ markieren und kopieren.';
    form.querySelector('.ai-prompt-details').open = !ok;
    form.querySelector('.ai-prompt-size').textContent = promptSize(built.prompt) + this._material.note(built.values.material);
    // Viele Module kommen in Teilen – sonst bricht die KI mitten im JSON ab.
    const parts = Math.ceil(built.values.count / AI_PROMPT_PART_SIZE);
    const partsHint = form.querySelector('.ai-prompt-parts');
    partsHint.classList.toggle('hidden', parts < 2);
    partsHint.innerHTML = `Die KI antwortet in <strong>${parts} Teilen</strong> zu je höchstens ${AI_PROMPT_PART_SIZE} Modulen: Jeden Teil unten einfügen und übernehmen, dann im Chat „weiter“ schreiben.`;
    form.querySelector('.ai-prompt-result').classList.remove('hidden');
    this._clearAttachments();
    resetPromptMaterial();
    this._save();
  }

  async _buildPrompt() {
    const values = this._values();
    if (values.types.length === 0) throw new Error('Bitte mindestens einen Aufgabentyp wählen.');
    this._save();
    // Bilder der gewählten Nextcloud-Ordners als nc:-Verweise (der Import löst sie auf).
    if (values.ncUse && nextcloudState.ready && values.ncFolder) {
      const res = await this.app.api.listNextcloudImages({ folder: values.ncFolder });
      values.ncImages = (res?.images || []).map((img) => `nc:${res.current}/${img.name}`);
      if (!values.ncImages.length) this.app.showToast(`Im Ordner „${values.ncFolder}“ liegen keine Bilder – Prompt ohne Bilder.`, 'info');
    }
    // Was in diesem Durchlauf schon als Dokument übernommen ist, gibt den Stoff vor.
    values.material = [...await this._material.collect(), ...this.run.docs];
    return { values, prompt: buildAiPrompt(values) };
  }

  _render() {
    const saved = this._load();
    const chosen = new Set(saved.types || ['multipleChoice', 'trueFalse', 'fillInTheBlanks']);
    const v = (key, fallback = '') => escapeAttr(saved[key] ?? fallback);
    const stepOn = (key) => saved[key] !== false;
    this.box.innerHTML = `
      <form class="settings-group ai-prompt-form ai-shared">
        <div class="ai-run-line"><div class="ai-run"></div><button type="button" class="btn btn-secondary btn-sm btn-new-run" hidden>🔄 Neu beginnen</button></div>
        <div class="form-group"><label>Thema
          <input name="title" maxlength="120" value="${v('title')}" placeholder="z. B. Normalisierung von Datenbanken" /></label></div>
        <div class="form-group"><label>Beschreibung *
          <textarea name="description" rows="4" required placeholder="Was sollen die Schüler lernen, worauf liegt der Schwerpunkt? Gilt für alle Inhalte unten.">${escapeHtml(saved.description || '')}</textarea></label></div>
        <div class="ai-prompt-row">
          <label>Klassenstufe / Niveau <input name="level" maxlength="60" value="${v('level')}" placeholder="z. B. TG11, B1" /></label>
          <label>Sprache <input name="language" maxlength="30" value="${v('language', 'Deutsch')}" /></label>
        </div>
        <details class="form-group ai-material"><summary>📓 Material aus dem Notizbuch (optional)</summary><div class="pm-box"></div></details>
        <div class="form-group"><label>Was soll entstehen?</label>
          <div class="ai-prompt-types">
            <label class="tag-filter-option ai-pick-doc"><input type="checkbox" name="stepDoc" ${stepOn('stepDoc') ? 'checked' : ''} /> 📄 Dokument</label>
            <label class="tag-filter-option"><input type="checkbox" name="stepQuiz" ${stepOn('stepQuiz') ? 'checked' : ''} /> 🧠 Quiz</label>
          </div></div>
      </form>
      <section class="ai-step" data-step="doc"><h3>📄 Dokument</h3><div class="ai-doc-box"></div></section>
      <section class="ai-step" data-step="quiz"><h3>🧠 Quiz</h3>
      <form class="settings-group ai-prompt-form ai-quiz-form">
        <div class="ai-prompt-row"><label>Anzahl Module <input name="count" type="number" min="1" max="60" value="${v('count', 10)}" /></label></div>
        <div class="form-group"><label>Aufgabentypen</label>
          <div class="ai-prompt-types">${AI_PROMPT_TYPES.map((type) => `
            <label class="tag-filter-option"><input type="checkbox" name="types" value="${type}" ${chosen.has(type) ? 'checked' : ''} />
              ${(H5P_TYPES[type] || {}).icon || ''} ${escapeHtml((H5P_TYPES[type] || {}).name || type)}</label>`).join('')}
          </div></div>
        <details class="ai-attach"><summary>📎 Anhänge im KI-Chat, geteilter Ordner, Bilder (optional)</summary>
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
        </details>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">🤖 Prompt erzeugen und kopieren</button>
        </div>
        <div class="ai-prompt-result hidden">
          <p class="hint ai-prompt-copied"></p>
          <p class="hint ai-prompt-size"></p>
          <p class="hint ai-prompt-parts hidden"></p>
          <details class="ai-prompt-details"><summary>Prompt ansehen</summary>
            <textarea readonly rows="16" class="ai-prompt-output"></textarea>
            <div class="confirm-actions">
              <button type="button" class="btn btn-secondary btn-copy">📋 Kopieren</button>
              <button type="button" class="btn btn-secondary btn-save">💾 Als Textdatei</button>
            </div>
          </details>
        </div>
      </form>
      <div class="ai-answer"></div></section>`;

    this.sharedForm = this.box.querySelector('.ai-shared');
    const form = this.box.querySelector('.ai-quiz-form');
    this.form = form;
    mountAnswerBox(this.app, this.box.querySelector('.ai-answer'), {
      heading: 'Antwort der KI (Quiz)',
      docsOn: this._docsOn(),
      getTopicId: () => this.run.topicId,
      onImported: (data, docs) => this.onImported(data, docs),
    });
    this.sharedForm.addEventListener('submit', (e) => e.preventDefault());
    this.sharedForm.addEventListener('input', () => this._save());
    this.sharedForm.addEventListener('change', () => { this._save(); this._syncSteps(); });
    this.box.querySelector('.btn-new-run').addEventListener('click', () => this._newRun());
    const output = form.querySelector('.ai-prompt-output');
    this._material = this.material = new PromptMaterial(this.app, this.sharedForm.querySelector('.pm-box'));
    this._material.render();
    form.addEventListener('input', () => this._save());
    // Bilder zu Wörtern von einer KI erzeugen lassen
    form.querySelector('.btn-img-prompt').addEventListener('click', () => {
      const words = parseImageWords(form.elements.imgWords.value);
      if (!words.length) { this.app.showToast('Bitte zuerst Wörter eintragen, je Zeile eines.', 'error'); return; }
      form.querySelector('.ai-img-output').value = buildImagePrompt(words, form.elements.imgStyle.value.trim(), this.shared().language || 'Deutsch');
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
    this.sharedForm.elements.title.addEventListener('input', () => this._updateImgButton());
    form.querySelector('.btn-img-upload').addEventListener('click', () => this._uploadImgFiles());
    form.addEventListener('change', () => this._save());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.sharedValid()) return;
      this._generate(output);
    });
    form.querySelector('.btn-copy').addEventListener('click', async () => {
      if (await copyWhenReady(Promise.resolve(output.value))) { this.app.showToast('Prompt kopiert – im KI-Chat einfügen.', 'success'); return; }
      output.select();
      this.app.showToast('Bitte mit Strg+C kopieren', 'info');
    });
    form.querySelector('.btn-save').addEventListener('click', () => {
      const name = (this.shared().title || 'Lernthema').replace(/[^\wäöüÄÖÜß -]+/g, '').trim() || 'Lernthema';
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
