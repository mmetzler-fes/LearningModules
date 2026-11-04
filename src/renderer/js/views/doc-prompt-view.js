import { escapeHtml, escapeAttr } from '../utils.js';
import { buildDocPrompt, promptSize } from '../ai-prompt.js';
import { nextcloudState } from './nextcloud.js';
import { resetPromptMaterial } from './prompt-material.js';
import { copyWhenReady, mountAnswerBox } from './ai-answer.js';
import { specToPm } from '../../lm-editor/src/doc/pm-convert.js';
import { pmToMarkdown } from '../../lm-editor/src/doc/pm-markdown.js';

const STORAGE_KEY = 'lm_doc_prompt';
const KINDS = [['arbeitsblatt', 'Arbeitsblatt'], ['klassenarbeit', 'Klassenarbeit'], ['text', 'Text zum Lesen']];

/**
 * Schritt „Dokument“ im KI-Ablauf (Modultyp „Dokument“, Freischaltung 'worksheets'):
 * Art und Umfang angeben; Kurs und KI-Vorgaben des Zielordners fließen ein. Die
 * Antwort der KI ist je Blatt ein Dokument in Markdown und kommt ins Antwortfeld.
 */
export class DocPromptView {
  constructor(app, box, host) {
    this.app = app;
    this.box = box;
    this.host = host; // AiPromptView: gemeinsame Angaben, Ziel, Material, Durchlauf
  }

  _load() {
    try {
      // Anhänge kommen nicht zurück, auch nicht aus älteren Speicherständen.
      const { files, ncUse, exampleIds, ...rest } = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      return rest;
    } catch (_) { return {}; }
  }

  /** Dateinamen, Nextcloud-Bilder und Vorbilder gelten nur für einen Prompt. */
  clearAttachments() {
    if (!this.form) return;
    this.form.elements.files.value = '';
    this.form.elements.ncUse.checked = false;
    this.form.querySelectorAll('input[name="example"]').forEach((b) => { b.checked = false; });
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values())); } catch (_) { /* egal */ }
  }

  _values() {
    const f = this.form.elements;
    return {
      ...this.host.shared(),
      nodeId: this.host.target.nodeId,
      kind: f.kind.value,
      pages: Number(f.pages.value) || 3,
      sheets: Number(f.sheets.value) || 1,
      files: f.files.value,
      ncUse: f.ncUse.checked,
      ncFolder: f.ncFolder.value,
      exampleIds: [...this.form.querySelectorAll('input[name="example"]:checked')].map((b) => b.value),
    };
  }

  async render() {
    const saved = this._load();
    const v = (key, fallback = '') => escapeAttr(saved[key] ?? fallback);
    this.box.innerHTML = `
      <form class="settings-group ai-prompt-form doc-prompt-form">
        <p class="hint doc-prompt-context"></p>
        <div class="ai-prompt-row">
          <label>Art <select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === (saved.kind || 'arbeitsblatt') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Seiten je Blatt <input name="pages" type="number" min="1" max="10" value="${v('pages', 3)}" /></label>
          <label>Anzahl Blätter <input name="sheets" type="number" min="1" max="10" value="${v('sheets', 1)}" /></label>
        </div>
        <div class="form-group doc-prompt-examples hidden">
          <label>Vorhandene Blätter als Vorbild <span class="hint">– ihr Inhalt kommt in den Prompt (Stil, Niveau, Aufbau); keine Anhänge nötig</span></label>
          <div class="doc-prompt-example-list"></div>
        </div>
        <details class="ai-attach"><summary>📎 Anhänge im KI-Chat, Bilder (optional)</summary>
        <div class="form-group"><label>Materialien, die du im KI-Chat anhängst (Dateinamen, je Zeile einer – optional)
          <textarea name="files" rows="3" placeholder="Skript_AD-Wandler.pdf">${escapeHtml(saved.files || '')}</textarea></label></div>
        <div class="form-group ai-prompt-nc ${nextcloudState.ready ? '' : 'hidden'}">
          <label class="tag-filter-mode"><input type="checkbox" name="ncUse" ${saved.ncUse ? 'checked' : ''} />
            <span>☁️ Bilder aus meiner Nextcloud anbieten</span></label>
          <label>Ordner unter „Bilder“ <select name="ncFolder"><option value="${v('ncFolder')}">${escapeHtml(saved.ncFolder || '…')}</option></select></label></div>
        </details>
        <div class="confirm-actions"><button type="submit" class="btn btn-primary">🤖 Prompt erzeugen und kopieren</button></div>
        <div class="ai-prompt-result hidden">
          <p class="hint ai-prompt-copied"></p>
          <p class="hint doc-prompt-size"></p>
          <details class="ai-prompt-details"><summary>Prompt ansehen</summary>
            <textarea readonly rows="16" class="ai-prompt-output"></textarea>
            <div class="confirm-actions"><button type="button" class="btn btn-secondary btn-copy">📋 Kopieren</button></div>
          </details>
        </div>
      </form>
      <div class="ai-answer"></div>`;
    const form = this.form = this.box.querySelector('form');
    const output = form.querySelector('.ai-prompt-output');
    mountAnswerBox(this.app, this.box.querySelector('.ai-answer'), {
      heading: 'Antwort der KI (Dokument, je Blatt eine)',
      docsOn: true,
      getTopicId: () => this.host.run.topicId,
      onImported: (data, docs) => this.host.onImported(data, docs),
    });
    form.addEventListener('input', () => this._save());
    form.addEventListener('change', () => this._save());
    this.loadContext();
    if (nextcloudState.ready) {
      const res = await this.app.api.listNextcloudImages({}).catch(() => null);
      if (res?.folders) {
        form.elements.ncFolder.innerHTML = res.folders.map((f) => `<option value="${escapeAttr(f)}" ${f === saved.ncFolder ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')
          || '<option value="">(noch keine Ordner unter „Bilder“)</option>';
      }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.host.sharedValid()) return;
      const job = this._buildPrompt();
      const copied = copyWhenReady(job.then((b) => b.prompt));
      let built;
      try { built = await job; } catch (err) { this.app.showToast(err.message, 'error'); return; }
      output.value = built.prompt;
      const ok = await copied;
      form.querySelector('.ai-prompt-copied').textContent = ok ? '✅ Prompt ist kopiert – im KI-Chat einfügen, die Antwort kommt unten ins Feld.' : '⚠️ Kopieren war nicht möglich – bitte unter „Prompt ansehen“ markieren und kopieren.';
      form.querySelector('.ai-prompt-details').open = !ok;
      form.querySelector('.doc-prompt-size').textContent = promptSize(built.prompt) + this.host.material.note(built.values.material);
      form.querySelector('.ai-prompt-result').classList.remove('hidden');
      this.clearAttachments();
      resetPromptMaterial();
      this._save();
    });
    form.querySelector('.btn-copy').addEventListener('click', async () => {
      if (await copyWhenReady(Promise.resolve(output.value))) { this.app.showToast('Prompt kopiert – im KI-Chat einfügen.', 'success'); return; }
      output.select();
      this.app.showToast('Bitte mit Strg+C kopieren', 'info');
    });
  }

  async _buildPrompt() {
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
      if (!res?.examples) throw new Error(res?.message || 'Vorbilder nicht abrufbar');
      values.examples = res.examples.map((ex) => ({ ...ex, markdown: pmToMarkdown(specToPm(ex.spec), { ids: false }) }));
    }
    values.material = await this.host.material.collect();
    return { values, prompt: buildDocPrompt(values) };
  }

  /** Kurs, KI-Vorgaben und vorhandene Blätter des Zielordners. */
  async loadContext() {
    if (!this.form) return;
    const nodeId = this.host.target.nodeId || '';
    const hint = this.form.querySelector('.doc-prompt-context');
    const res = await this.app.api.getDocPromptContext(nodeId).catch(() => null);
    this._ctx = res && !res.message ? res : null;
    this._renderExamples();
    if (!this._ctx) { hint.textContent = ''; return; }
    const bits = [];
    if (this._ctx.kurs) bits.push(`Kurs „${this._ctx.kurs}“`);
    if (this._ctx.aiGuidelines) bits.push(`KI-Vorgaben (${this._ctx.aiGuidelines.length} Zeichen) fließen ein`);
    if (this._ctx.sheets?.length) bits.push(`${this._ctx.sheets.length} vorhandene Blätter für Verweise`);
    hint.textContent = bits.join(' · ');
  }

  /** Blätter des Books zum Ankreuzen; die Auswahl gilt nur für den nächsten Prompt. */
  _renderExamples() {
    const box = this.form.querySelector('.doc-prompt-examples');
    const sheets = (this._ctx?.sheets || []).filter((s) => s.id)
      .sort((a, b) => String(a.pfad).localeCompare(String(b.pfad), 'de', { numeric: true }));
    box.classList.toggle('hidden', !sheets.length);
    box.querySelector('.doc-prompt-example-list').innerHTML = sheets.map((s) => `
      <label class="tag-filter-option"><input type="checkbox" name="example" value="${escapeAttr(s.id)}" />
        ${s.pfad ? `<span class="hint">${escapeHtml(s.pfad)}</span> ` : ''}${escapeHtml(s.titel || s.slug || 'Blatt')}</label>`).join('');
  }
}
