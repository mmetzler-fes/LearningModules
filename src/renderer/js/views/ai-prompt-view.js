import { escapeHtml, escapeAttr } from '../utils.js';
import { AI_PROMPT_TYPES, AI_PROMPT_PART_SIZE, buildAiPrompt } from '../ai-prompt.js';

// ==================== KI-PROMPT-GENERATOR ====================

const STORAGE_KEY = 'lm_ai_prompt';

/**
 * Eigene Seite "KI-Prompt": Angaben zum Quiz sammeln, daraus einen Prompt
 * bauen, der der KI das Importformat genau vorgibt. Die Antwort der KI kommt
 * als .json über "📥 Thema importieren" herein.
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
    if (!this.box || this.form) return;
    this._render();
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
    form.addEventListener('change', () => this._save());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = this._values();
      if (values.types.length === 0) { this.app.showToast('Bitte mindestens einen Aufgabentyp wählen.', 'error'); return; }
      this._save();
      output.value = buildAiPrompt(values);
      // Viele Module kommen in Teilen – sonst bricht die KI mitten im JSON ab.
      const parts = Math.ceil(values.count / AI_PROMPT_PART_SIZE);
      const partsHint = form.querySelector('.ai-prompt-parts');
      partsHint.classList.toggle('hidden', parts < 2);
      partsHint.innerHTML = `Die KI antwortet in <strong>${parts} Teilen</strong> zu je höchstens ${AI_PROMPT_PART_SIZE} Modulen
        – mit „weiter“ kommt der nächste. Jeden Teil als eigene <code>.json</code> speichern: Teil 1 über
        <strong>🏠 LernModule → 📥 Thema importieren</strong>, die weiteren im neuen Thema über <strong>📥 Module importieren</strong>.`;
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
