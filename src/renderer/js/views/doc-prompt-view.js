import { escapeHtml, escapeAttr } from '../utils.js';
import { AI_PROMPT_TYPES, buildDocPrompt, promptSize } from '../ai-prompt.js';
import { nextcloudState } from './nextcloud.js';
import { PromptMaterial } from './prompt-material.js';

const STORAGE_KEY = 'lm_doc_prompt';
const KINDS = [['arbeitsblatt', 'Arbeitsblatt'], ['klassenarbeit', 'Klassenarbeit'], ['text', 'Text zum Lesen']];

/**
 * KI-Prompt für Dokumente (Modultyp „Dokument“, Freischaltung 'worksheets'):
 * Zielordner wählen (dessen Kurs und KI-Vorgaben fließen ein), Fragestellung
 * und Umfang angeben. Die Antwort der KI ist je Blatt ein Thema im
 * Import-Format – eingelesen über „📥 Hier importieren“ am Zielordner.
 */
export class DocPromptView {
  constructor(app, box) {
    this.app = app;
    this.box = box;
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values())); } catch (_) { /* egal */ }
  }

  _values() {
    const f = this.form.elements;
    return {
      nodeId: f.nodeId.value,
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      kind: f.kind.value,
      level: f.level.value.trim(),
      language: f.language.value.trim(),
      pages: Number(f.pages.value) || 3,
      sheets: Number(f.sheets.value) || 1,
      quizCount: Number(f.quizCount.value) || 0,
      quizTypes: [...this.form.querySelectorAll('input[name="quizTypes"]:checked')].map((b) => b.value),
      files: f.files.value,
      ncUse: f.ncUse.checked,
      ncFolder: f.ncFolder.value,
      exampleIds: [...this.form.querySelectorAll('input[name="example"]:checked')].map((b) => b.value),
    };
  }

  /** Ordner als Pfad „Book › Bereich › Abschnitt“ für die Auswahl. */
  async _folders() {
    const data = await this.app.api.getNotebooks().catch(() => null);
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const label = (n) => {
      const parts = [];
      for (let x = n; x; x = x.parentId ? byId.get(x.parentId) : null) parts.unshift(x.title);
      return parts.join(' › ');
    };
    return nodes.map((n) => ({ id: n.id, label: label(n) })).sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }

  async render() {
    const saved = this._load();
    const v = (key, fallback = '') => escapeAttr(saved[key] ?? fallback);
    const chosen = new Set(saved.quizTypes || ['multipleChoice', 'trueFalse', 'fillInTheBlanks']);
    const folders = await this._folders();
    this.box.innerHTML = `
      <form class="settings-group ai-prompt-form doc-prompt-form">
        <div class="form-group"><label>Zielordner im Notebook
          <select name="nodeId"><option value="">– ohne (Unsortiert) –</option>
            ${folders.map((f) => `<option value="${escapeAttr(f.id)}" ${f.id === saved.nodeId ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
          </select></label>
          <span class="hint doc-prompt-context"></span></div>
        <div class="form-group doc-prompt-examples hidden">
          <label>Vorhandene Blätter als Vorbild <span class="hint">– ihr Inhalt kommt in den Prompt (Stil, Niveau, Aufbau); keine Anhänge nötig</span></label>
          <div class="doc-prompt-example-list"></div>
        </div>
        <div class="form-group"><label>Thema / Titel
          <input name="title" maxlength="120" value="${v('title')}" placeholder="z. B. Der AD-Wandler" /></label></div>
        <div class="form-group"><label>Fragestellung und Inhalt *
          <textarea name="description" rows="5" required placeholder="Was soll das Blatt vermitteln? Welche Aufgaben, welcher Schwerpunkt?">${escapeHtml(saved.description || '')}</textarea></label></div>
        <div class="ai-prompt-row">
          <label>Art <select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === (saved.kind || 'arbeitsblatt') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Klassenstufe / Niveau <input name="level" maxlength="60" value="${v('level')}" placeholder="z. B. TG11" /></label>
          <label>Sprache <input name="language" maxlength="30" value="${v('language', 'Deutsch')}" /></label>
        </div>
        <div class="ai-prompt-row">
          <label>Seiten je Blatt <input name="pages" type="number" min="1" max="10" value="${v('pages', 3)}" /></label>
          <label>Anzahl Blätter <input name="sheets" type="number" min="1" max="10" value="${v('sheets', 1)}" /></label>
          <label>Quiz-Module dazu <input name="quizCount" type="number" min="0" max="10" value="${v('quizCount', 0)}" /></label>
        </div>
        <div class="form-group doc-prompt-quiz"><label>Quiz-Typen (falls Quiz-Module dazu)</label>
          <div class="ai-prompt-types">${AI_PROMPT_TYPES.map((type) => `
            <label class="tag-filter-option"><input type="checkbox" name="quizTypes" value="${type}" ${chosen.has(type) ? 'checked' : ''} />
              ${(H5P_TYPES[type] || {}).icon || ''} ${escapeHtml((H5P_TYPES[type] || {}).name || type)}</label>`).join('')}</div></div>
        <div class="form-group pm-box"></div>
        <div class="form-group"><label>Materialien, die du im KI-Chat anhängst (Dateinamen, je Zeile einer – optional)
          <textarea name="files" rows="3" placeholder="Skript_AD-Wandler.pdf">${escapeHtml(saved.files || '')}</textarea></label></div>
        <div class="form-group ai-prompt-nc ${nextcloudState.ready ? '' : 'hidden'}">
          <label class="tag-filter-mode"><input type="checkbox" name="ncUse" ${saved.ncUse ? 'checked' : ''} />
            <span>☁️ Bilder aus meiner Nextcloud anbieten</span></label>
          <label>Ordner unter „Bilder“ <select name="ncFolder"><option value="${v('ncFolder')}">${escapeHtml(saved.ncFolder || '…')}</option></select></label></div>
        <div class="confirm-actions"><button type="submit" class="btn btn-primary">✨ Prompt erzeugen</button></div>
        <div class="ai-prompt-result hidden">
          <textarea readonly rows="16" class="ai-prompt-output"></textarea>
          <p class="hint doc-prompt-size"></p>
          <p class="hint">Antwort der KI kopieren und im Notebook am Zielordner über <strong>⋯ → 📥 Hier importieren</strong> einfügen –
            bei mehreren Blättern jede Antwort einzeln. Fehler im Dokument markiert danach der Editor.</p>
          <div class="confirm-actions"><button type="button" class="btn btn-primary btn-copy">📋 Kopieren</button></div>
        </div>
      </form>`;
    const form = this.form = this.box.querySelector('form');
    const output = form.querySelector('.ai-prompt-output');
    this.material = new PromptMaterial(this.app, form.querySelector('.pm-box'));
    await this.material.render();
    form.addEventListener('input', () => this._save());
    form.addEventListener('change', () => this._save());
    form.elements.nodeId.addEventListener('change', () => this._loadContext());
    this._loadContext();
    if (nextcloudState.ready) {
      const res = await this.app.api.listNextcloudImages({}).catch(() => null);
      if (res?.folders) {
        form.elements.ncFolder.innerHTML = res.folders.map((f) => `<option value="${escapeAttr(f)}" ${f === saved.ncFolder ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')
          || '<option value="">(noch keine Ordner unter „Bilder“)</option>';
      }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = this._values();
      this._save();
      const ctx = this._ctx || {};
      values.guidelines = ctx.aiGuidelines || '';
      values.kurs = ctx.kurs || '';
      values.existing = ctx.sheets || [];
      if (values.ncUse && nextcloudState.ready && values.ncFolder) {
        const res = await this.app.api.listNextcloudImages({ folder: values.ncFolder });
        values.ncImages = (res?.images || []).map((img) => `nc:${res.current}/${img.name}`);
      }
      if (values.exampleIds.length) {
        const res = await this.app.api.getDocPromptExamples(values.exampleIds).catch(() => null);
        if (!res?.examples) { this.app.showToast('Fehler: ' + (res?.message || 'Vorbilder nicht abrufbar'), 'error'); return; }
        values.examples = res.examples;
      }
      try { values.material = await this.material.collect(); } catch (err) { this.app.showToast(err.message, 'error'); return; }
      output.value = buildDocPrompt(values);
      form.querySelector('.doc-prompt-size').textContent = promptSize(output.value);
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
  }

  /** Kurs, KI-Vorgaben und vorhandene Blätter des Zielordners. */
  async _loadContext() {
    const nodeId = this.form.elements.nodeId.value;
    const hint = this.form.querySelector('.doc-prompt-context');
    const res = await this.app.api.getDocPromptContext(nodeId).catch(() => null);
    this._ctx = res && !res.message ? res : null;
    this._renderExamples();
    if (!this._ctx) { hint.textContent = ''; return; }
    const bits = [];
    if (this._ctx.kurs) bits.push(`Kurs „${this._ctx.kurs}“`);
    if (this._ctx.aiGuidelines) bits.push(`KI-Vorgaben (${this._ctx.aiGuidelines.length} Zeichen) fließen ein`);
    if (this._ctx.sheets?.length) bits.push(`${this._ctx.sheets.length} vorhandene Blätter für Verweise`);
    hint.textContent = bits.length ? bits.join(' · ') : 'Für diesen Ordner sind keine Kursangaben oder KI-Vorgaben eingestellt (⋯ → 📄 Dokument-Einstellungen).';
  }

  /** Blätter des Books zum Ankreuzen; die Auswahl bleibt gespeichert. */
  _renderExamples() {
    const box = this.form.querySelector('.doc-prompt-examples');
    const sheets = (this._ctx?.sheets || []).filter((s) => s.id)
      .sort((a, b) => String(a.pfad).localeCompare(String(b.pfad), 'de', { numeric: true }));
    box.classList.toggle('hidden', !sheets.length);
    const chosen = new Set(this._load().exampleIds || []);
    box.querySelector('.doc-prompt-example-list').innerHTML = sheets.map((s) => `
      <label class="tag-filter-option"><input type="checkbox" name="example" value="${escapeAttr(s.id)}" ${chosen.has(s.id) ? 'checked' : ''} />
        ${s.pfad ? `<span class="hint">${escapeHtml(s.pfad)}</span> ` : ''}${escapeHtml(s.titel || s.slug || 'Blatt')}</label>`).join('');
  }
}
