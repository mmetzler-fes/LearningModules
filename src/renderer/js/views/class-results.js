import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== KLASSENERGEBNISSE ====================

const failed = (res) => !res || res.statusCode >= 400;
const MODE_LABELS = {
  quiz: '🧠 Quiz', exam: '📝 Klassenarbeit', learn: '💡 Lernen', companion: '🦉 Lernbegleitung', contest: '🏆 Quiz-Arena',
};

function loadPref(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function savePref(key, value) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (_) { /* egal */ }
}

/** Mittelwert der Erfolgsquote; Durchläufe ohne bewertbare Aufgaben zählen nicht mit. */
function avg(list) {
  const graded = list.filter((r) => r.totalQuestions);
  if (graded.length === 0) return null;
  return Math.round(graded.reduce((sum, r) => sum + (r.percentage || 0), 0) / graded.length);
}
const best = (list) => {
  const graded = list.filter((r) => r.totalQuestions);
  return graded.length ? Math.max(...graded.map((r) => r.percentage || 0)) : null;
};
const pct = (v) => (v === null ? '–' : `${v} %`);
const pctClass = (v) => (v === null ? '' : v >= 70 ? 'good' : v >= 40 ? 'medium' : 'poor');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');
const runs = (n) => (n === 1 ? '1 Durchlauf' : `${n} Durchläufe`);

/** Kalenderwoche als Schlüssel – für „aktive Wochen“ im Jahresüberblick. */
function weekKey(iso) {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-${week}`;
}

/**
 * Ergebnisse über Klassenlinks, nach Klasse: je Schüler alle Durchläufe, je
 * Test die ganze Klasse (wer fehlt noch?) und ein Jahresüberblick über das
 * Engagement.
 */
export class ClassResultsView {
  constructor(app) {
    this.app = app;
    this._yearSel  = document.getElementById('crYear');
    this._classSel = document.getElementById('crClass');
    this._content  = document.getElementById('crContent');
    this._tabs     = document.querySelectorAll('[data-cr-tab]');
    this._tab = ['students', 'tests', 'year'].includes(loadPref('lm_cr_tab')) ? loadPref('lm_cr_tab') : 'students';
    this._year = null;
    this._classId = loadPref('lm_cr_class');
    this._data = null;
    this._openGroups = new Set();

    this._yearSel?.addEventListener('change', async () => {
      this._year = this._yearSel.value;
      await this._loadClasses();
      this._load();
    });
    this._classSel?.addEventListener('change', () => {
      this._classId = this._classSel.value || null;
      savePref('lm_cr_class', this._classId);
      this._load();
    });
    this._tabs.forEach((btn) => btn.addEventListener('click', () => {
      this._tab = btn.dataset.crTab;
      savePref('lm_cr_tab', this._tab);
      this._render();
    }));
  }

  async refresh() {
    const info = await this.app.api.getSchoolYear();
    const years = Array.isArray(info?.years) ? info.years : [];
    if (!this._year || !years.includes(this._year)) this._year = info?.current || years[0] || null;
    this._yearSel.innerHTML = years
      .map((y) => `<option value="${escapeAttr(y)}" ${y === this._year ? 'selected' : ''}>${escapeHtml(y)}${y === info.current ? ' (aktuell)' : ''}</option>`)
      .join('');
    await this._loadClasses();
    await this._load();
  }

  async _loadClasses() {
    const classes = this._year ? await this.app.api.getClasses(this._year) : [];
    this._classes = Array.isArray(classes) ? classes : [];
    if (!this._classes.some((c) => c.id === this._classId)) this._classId = this._classes[0]?.id || null;
    this._classSel.innerHTML = this._classes.length
      ? this._classes.map((c) => `<option value="${escapeAttr(c.id)}" ${c.id === this._classId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
      : '<option value="">– keine Klassen –</option>';
  }

  async _load() {
    this._data = null;
    if (this._classId) {
      const res = await this.app.api.getClassResults(this._classId);
      if (failed(res)) this.app.showToast('Fehler: ' + (res?.message || 'Ergebnisse nicht abrufbar'), 'error');
      else this._data = res;
    }
    this._render();
  }

  /** Schüler der Liste und ihre Ergebnisse; dazu Ergebnisse, die niemandem zugeordnet sind. */
  _rows() {
    const { class: klasse, results } = this._data;
    const byStudent = new Map();
    const unassigned = new Map();
    const ids = new Set(klasse.students.map((s) => s.id));
    for (const r of results) {
      if (r.studentId && ids.has(r.studentId)) {
        if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
        byStudent.get(r.studentId).push(r);
      } else {
        const key = r.studentName || '—';
        if (!unassigned.has(key)) unassigned.set(key, []);
        unassigned.get(key).push(r);
      }
    }
    const rows = klasse.students.map((s) => ({
      key: s.id,
      label: s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName,
      pending: s.status === 'pending',
      results: byStudent.get(s.id) || [],
    }));
    const extra = [...unassigned.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'de'))
      .map(([name, list]) => ({ key: `name:${name}`, label: name, unassigned: true, results: list }));
    return { rows, extra };
  }

  _render() {
    this._tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.crTab === this._tab));
    if (!this._classId) {
      this._content.innerHTML = `<div class="empty-state"><span class="empty-icon">🏫</span>
        <p>Im ${escapeHtml(this._year || '')} gibt es noch keine Klassen.</p></div>`;
      return;
    }
    if (!this._data) { this._content.innerHTML = ''; return; }
    if (this._tab === 'tests') this._renderTests();
    else if (this._tab === 'year') this._renderYear();
    else this._renderStudents();
  }

  // ---- Schüler: je Schüler alle Durchläufe ----

  _renderStudents() {
    const { rows, extra } = this._rows();
    this._content.innerHTML = '';
    if (rows.length === 0 && extra.length === 0) {
      this._content.innerHTML = '<div class="empty-state"><p>Die Klasse hat noch keine Schüler und keine Ergebnisse.</p></div>';
      return;
    }
    const block = (row) => {
      const list = [...row.results].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const box = document.createElement('details');
      box.className = 'result-group result-group-student';
      box.open = this._openGroups.has(row.key);
      box.addEventListener('toggle', () => (box.open ? this._openGroups.add(row.key) : this._openGroups.delete(row.key)));
      const meta = list.length
        ? `${runs(list.length)} · Ø ${pct(avg(list))} · zuletzt ${date(list[0].timestamp)}`
        : '<span class="cr-missing">noch keine Ergebnisse</span>';
      box.innerHTML = `<summary>
        <span class="result-group-title">${escapeHtml(row.label)}${row.pending ? ' <small class="class-pending-note">unbestätigt</small>' : ''}</span>
        <span class="result-group-meta">${meta}</span></summary>`;
      for (const r of list) box.appendChild(this.app.resultsView._renderResultCard(r, () => this._load()));
      return box;
    };
    for (const row of rows) this._content.appendChild(block(row));
    if (extra.length) {
      const head = document.createElement('h3');
      head.className = 'cr-subhead';
      head.textContent = 'Nicht zugeordnet';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Durchläufe über einen Klassenlink, die keinem Schüler der Liste gehören – etwa von vor der Schülerliste oder eines entfernten Schülers.';
      this._content.append(head, hint);
      for (const row of extra) this._content.appendChild(block(row));
    }
  }

  // ---- Tests: je Klassenlink die ganze Klasse ----

  _renderTests() {
    const { rows } = this._rows();
    const { results } = this._data;
    const tests = new Map();
    for (const r of results) {
      const key = r.linkId || r.linkName || '—';
      if (!tests.has(key)) tests.set(key, { name: r.linkName || 'Ohne Link', results: [] });
      tests.get(key).results.push(r);
    }
    if (tests.size === 0) {
      this._content.innerHTML = '<div class="empty-state"><p>Über die Klassenlinks dieser Klasse gibt es noch keine Ergebnisse.</p></div>';
      return;
    }
    const latest = (t) => Math.max(...t.results.map((r) => new Date(r.timestamp).getTime()));
    const list = [...tests.entries()].sort(([, a], [, b]) => latest(b) - latest(a));
    this._content.innerHTML = '';
    for (const [key, test] of list) {
      const done = rows.filter((row) => test.results.some((r) => r.studentId === row.key));
      const missing = rows.filter((row) => !row.pending && !test.results.some((r) => r.studentId === row.key));
      const modes = [...new Set(test.results.map((r) => r.mode).filter(Boolean))];
      const box = document.createElement('details');
      box.className = 'result-group result-group-link';
      box.open = this._openGroups.has(`test:${key}`);
      box.addEventListener('toggle', () => (box.open ? this._openGroups.add(`test:${key}`) : this._openGroups.delete(`test:${key}`)));
      box.innerHTML = `<summary>
          <span class="result-group-title">🔗 ${escapeHtml(test.name)}
            ${modes.map((m) => `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[m] || m)}</span>`).join('')}</span>
          <span class="result-group-meta">${done.length} von ${done.length + missing.length} · Ø ${pct(avg(test.results))} · zuletzt ${date(new Date(latest(test)).toISOString())}
            ${missing.length ? ` · <span class="cr-missing">${missing.length} fehlen</span>` : ''}</span>
        </summary>
        <table class="class-students cr-table">
          <thead><tr><th>Schüler</th><th>Durchläufe</th><th>Bestes</th><th>Zuletzt</th></tr></thead>
          <tbody>${rows.map((row) => {
            const mine = test.results.filter((r) => r.studentId === row.key);
            if (!mine.length) return row.pending ? '' : `<tr class="cr-row-missing"><td>${escapeHtml(row.label)}</td><td colspan="3"><span class="cr-missing">fehlt noch</span></td></tr>`;
            const b = best(mine);
            const last = mine.reduce((a, r) => (new Date(r.timestamp) > new Date(a.timestamp) ? r : a));
            return `<tr><td>${escapeHtml(row.label)}</td><td>${mine.length}</td>
              <td><span class="result-score ${pctClass(b)}">${pct(b)}</span></td><td>${date(last.timestamp)}</td></tr>`;
          }).join('')}</tbody>
        </table>`;
      this._content.appendChild(box);
    }
  }

  // ---- Jahresüberblick: Engagement je Schüler ----

  _renderYear() {
    const { rows } = this._rows();
    const { results } = this._data;
    const testCount = new Set(results.map((r) => r.linkId || r.linkName)).size;
    const cells = rows.map((row) => {
      const list = row.results;
      const tests = new Set(list.map((r) => r.linkId || r.linkName)).size;
      const weeks = new Set(list.map((r) => weekKey(r.timestamp))).size;
      const last = list.length ? list.reduce((a, r) => (new Date(r.timestamp) > new Date(a.timestamp) ? r : a)).timestamp : null;
      const a = avg(list);
      return `<tr class="${list.length ? '' : 'cr-row-missing'}">
        <td>${escapeHtml(row.label)}${row.pending ? ' <small class="class-pending-note">unbestätigt</small>' : ''}</td>
        <td>${list.length}</td>
        <td>${tests}${testCount ? ` / ${testCount}` : ''}</td>
        <td>${weeks}</td>
        <td><span class="result-score ${pctClass(a)}">${pct(a)}</span></td>
        <td>${date(last)}</td></tr>`;
    });
    const total = avg(results);
    this._content.innerHTML = rows.length === 0
      ? '<div class="empty-state"><p>Die Klasse hat noch keine Schüler.</p></div>'
      : `<p class="hint">${escapeHtml(this._data.class.schoolYear || '')}: ${runs(results.length)} über ${testCount} Test(s), Ø ${pct(total)}.
           „Tests“ zählt die verschiedenen Klassenlinks, „aktive Wochen“ die Kalenderwochen mit mindestens einem Durchlauf.</p>
         <table class="class-students cr-table">
           <thead><tr><th>Schüler</th><th>Durchläufe</th><th>Tests</th><th>Aktive Wochen</th><th>Ø</th><th>Zuletzt</th></tr></thead>
           <tbody>${cells.join('')}</tbody>
         </table>`;
  }
}
