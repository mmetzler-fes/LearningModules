import { escapeHtml, escapeAttr } from '../utils.js';
import { playFanfare } from './contest.js';

// ==================== LERNBEGLEITER (EINSTELLUNGEN) ====================

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Seite "Lernbegleiter": eigene Kommentare, Joker, Zeitstrafe und Tusch.
 *
 * Schuladmins pflegen hier zusätzlich die Vorgaben der Schule und sehen die
 * Ergänzungen der Kolleginnen und Kollegen – gute Kommentare lassen sich mit
 * einem Klick für alle übernehmen.
 */
export class CompanionSettingsView {
  constructor(app) {
    this.app = app;
    this.box = document.getElementById('companionSettings');
  }

  async refresh() {
    if (!this.box) return;
    this.box.innerHTML = '<p class="hint">Wird geladen …</p>';
    const data = await this.app.api.getCompanion().catch(() => null);
    if (!data || !data.categories) {
      this.box.innerHTML = `<p class="login-error">${escapeHtml(data?.message || 'Laden fehlgeschlagen.')}</p>`;
      return;
    }
    this.data = data;
    this.colleagues = data.isSchoolAdmin ? await this.app.api.getCompanionColleagues().catch(() => []) : [];
    if (!Array.isArray(this.colleagues)) this.colleagues = [];
    this._render();
  }

  _render() {
    const d = this.data;
    const schoolCfg = d.school?.config || {};
    this.box.innerHTML = `
      <div class="settings-group">
        <h3>🦉 Mein Lernbegleiter</h3>
        <p class="hint">Gilt für alle deine Schülerfreigaben mit Lernbegleitung bzw. Quiz-Arena.
          Leere Felder übernehmen die Vorgabe ${d.school ? 'der Schule' : ''} (in Grau angezeigt).</p>
        ${this._settingsForm('mine', d.mine || {}, d.inherited)}
        ${this._commentsForm('mine', d.mine || {}, { showSchool: true })}
        <div class="form-actions">
          <button class="btn btn-primary" data-save="mine">💾 Speichern</button>
        </div>
      </div>
      ${d.isSchoolAdmin ? `
        <div class="settings-group" style="margin-top:24px;">
          <h3>🏫 Vorgaben der Schule „${escapeHtml(d.school.name)}“</h3>
          <p class="hint">Grundlage für alle Lehrkräfte eurer Schule. Jede Lehrkraft kann Joker, Zeitstrafe und Tusch
            für sich überschreiben und eigene Kommentare ergänzen.</p>
          ${this._settingsForm('school', schoolCfg, d.defaults.settings)}
          ${this._commentsForm('school', schoolCfg, { showSchool: false })}
          <div class="form-actions">
            <button class="btn btn-primary" data-save="school">💾 Schulvorgaben speichern</button>
          </div>
        </div>
        <div class="settings-group" style="margin-top:24px;">
          <h3>👥 Ergänzungen der Kolleginnen und Kollegen</h3>
          <p class="hint">Kommentare, die Lehrkräfte eurer Schule für sich angelegt haben. Mit ➕ übernimmst du sie
            in die Schulvorgaben – dann haben alle etwas davon.</p>
          ${this._colleaguesHtml()}
        </div>` : ''}`;

    this.box.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => this._save(btn.dataset.save));
    });
    this.box.querySelectorAll('[data-try-sound]').forEach((btn) => {
      btn.addEventListener('click', () => this._trySound(btn.dataset.trySound));
    });
    this.box.querySelectorAll('[data-adopt]').forEach((btn) => {
      btn.addEventListener('click', () => this._adopt(JSON.parse(btn.dataset.adopt)));
    });
  }

  _settingsForm(scope, cfg, inherited) {
    const val = (v) => (v === null || v === undefined ? '' : escapeAttr(String(v)));
    return `
      <div class="companion-settings-grid">
        <label>Joker je Durchlauf
          <input type="number" min="0" max="10" data-field="${scope}:jokerMax" value="${val(cfg.jokerMax)}"
            placeholder="${inherited.jokerMax}" />
        </label>
        <label>Erste Zeitstrafe (Sekunden)
          <input type="number" min="0" max="600" data-field="${scope}:penaltyStart" value="${val(cfg.penaltyStart)}"
            placeholder="${inherited.penaltyStart}" />
        </label>
        <label>Längste Zeitstrafe (Sekunden)
          <input type="number" min="0" max="600" data-field="${scope}:penaltyMax" value="${val(cfg.penaltyMax)}"
            placeholder="${inherited.penaltyMax}" />
        </label>
      </div>
      <p class="hint">Die Zeitstrafe beginnt nach dem dritten Fehlversuch und wächst mit jedem weiteren
        (z. B. 30 → 60 → 90 → 120 s). 0 schaltet sie ab.</p>
      <div class="form-group">
        <label>Tusch für die Siegerehrung in der Quiz-Arena</label>
        <div class="quicklink-url-row">
          <input type="url" data-field="${scope}:soundUrl" value="${val(cfg.soundUrl)}"
            placeholder="${scope === 'mine' && this.data.school?.config?.soundUrl ? 'leer = Tusch der Schule' : 'leer = eingebaute Fanfare'} · z. B. https://cloud.schule.de/s/AbC123" />
          <button type="button" class="btn btn-secondary btn-sm" data-try-sound="${scope}">▶️ Probehören</button>
        </div>
        <span class="hint">Nextcloud-Freigabelink auf eine Audiodatei (mp3, ogg, wav, m4a) oder ein anderer https-Link.</span>
      </div>`;
  }

  _commentsForm(scope, cfg, { showSchool }) {
    const d = this.data;
    const schoolComments = d.school?.config?.comments || {};
    return `
      <h4 style="margin-top:16px;">Kommentare der Eule</h4>
      <p class="hint">Je Lage zieht die Eule zufällig einen Kommentar. Eigene Kommentare: einer pro Zeile.</p>
      <div class="companion-comment-grid">
        ${d.categories.map((cat) => {
          const builtin = d.defaults.comments[cat.key] || [];
          const school = showSchool ? schoolComments[cat.key] || [] : [];
          const own = (cfg.comments || {})[cat.key] || [];
          return `
            <div class="companion-comment-card">
              <strong>${escapeHtml(cat.label)}</strong>
              <div class="companion-fixed">
                ${builtin.map((c) => `<span class="companion-chip" title="Grundausstattung">${escapeHtml(c)}</span>`).join('')}
                ${school.map((c) => `<span class="companion-chip is-school" title="Vorgabe der Schule">🏫 ${escapeHtml(c)}</span>`).join('')}
              </div>
              <textarea rows="3" data-comments="${scope}:${cat.key}"
                placeholder="${scope === 'school' ? 'Kommentare für die ganze Schule' : 'Eigene Kommentare'}">${escapeHtml(own.join('\n'))}</textarea>
            </div>`;
        }).join('')}
      </div>`;
  }

  _colleaguesHtml() {
    if (!this.colleagues.length) return '<p class="hint">Bisher hat niemand eigene Kommentare ergänzt.</p>';
    const labels = Object.fromEntries(this.data.categories.map((c) => [c.key, c.label]));
    return this.colleagues.map((t) => `
      <div class="companion-colleague">
        <strong>${escapeHtml(t.name)}</strong>
        ${Object.entries(t.comments).map(([key, list]) => `
          <div class="companion-colleague-cat">
            <span class="hint">${escapeHtml(labels[key] || key)}:</span>
            ${list.map((c) => `
              <span class="companion-chip">${escapeHtml(c)}
                <button type="button" class="companion-adopt" title="In die Schulvorgaben übernehmen"
                  data-adopt="${escapeAttr(JSON.stringify({ key, items: [c] }))}">➕</button>
              </span>`).join('')}
            ${list.length > 1 ? `<button type="button" class="btn btn-secondary btn-sm"
              data-adopt="${escapeAttr(JSON.stringify({ key, items: list }))}">alle übernehmen</button>` : ''}
          </div>`).join('')}
      </div>`).join('');
  }

  _collect(scope) {
    const num = (field) => {
      const v = this.box.querySelector(`[data-field="${scope}:${field}"]`)?.value.trim();
      return v === '' || v === undefined ? null : Number(v);
    };
    const comments = {};
    this.box.querySelectorAll(`[data-comments^="${scope}:"]`).forEach((ta) => {
      const key = ta.dataset.comments.split(':')[1];
      const list = lines(ta.value);
      if (list.length) comments[key] = list;
    });
    return {
      jokerMax: num('jokerMax'),
      penaltyStart: num('penaltyStart'),
      penaltyMax: num('penaltyMax'),
      soundUrl: this.box.querySelector(`[data-field="${scope}:soundUrl"]`)?.value.trim() || '',
      comments,
    };
  }

  async _save(scope) {
    const body = this._collect(scope);
    const res = scope === 'school'
      ? await this.app.api.saveSchoolCompanion(body).catch(() => null)
      : await this.app.api.saveMyCompanion(body).catch(() => null);
    if (!res || !res.categories) {
      this.app.showToast(res?.message || 'Speichern fehlgeschlagen.', 'error');
      return;
    }
    this.app.showToast(scope === 'school' ? 'Schulvorgaben gespeichert.' : 'Lernbegleiter gespeichert.', 'success');
    await this.refresh();
  }

  /** Kommentare in die Schulvorgaben übernehmen und gleich speichern. */
  async _adopt({ key, items }) {
    const ta = this.box.querySelector(`[data-comments="school:${key}"]`);
    if (!ta) return;
    const list = lines(ta.value);
    for (const c of items) if (!list.includes(c)) list.push(c);
    ta.value = list.join('\n');
    await this._save('school');
  }

  _trySound(scope) {
    const raw = this.box.querySelector(`[data-field="${scope}:soundUrl"]`)?.value.trim();
    // Nextcloud-Freigabe: die Datei selbst liegt unter …/download.
    const m = /^(https:\/\/.+?\/(?:index\.php\/)?s\/[A-Za-z0-9]+)\/?$/.exec(raw || '');
    const url = m ? `${m[1].replace('/index.php/s/', '/s/')}/download` : raw;
    if (!url) {
      // Ohne Adresse: eingebaute Fanfare (bzw. bei der Lehrkraft der Tusch der Schule).
      const fallback = scope === 'mine' ? this.data.effective?.soundUrl : null;
      playFanfare(fallback || null);
      return;
    }
    new Audio(url).play().catch(() => this.app.showToast('Diese Datei lässt sich nicht abspielen. Ist die Freigabe öffentlich?', 'error'));
  }
}
