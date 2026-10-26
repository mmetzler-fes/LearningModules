import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== KLASSENNOTIZBUCH (LEHRKRAFT) ====================
//
// Je Klasse die Bereiche des Klassennotizbuchs (docs/klassennotizbuch.md):
// Inhaltsübersicht (die Klassenlinks als Zuweisungen), Nur für Lehrer,
// Klassenarbeiten, Schülerdaten, Ergebnisübersicht, Quiz-Arena, Live und der
// Klassenbuch-Link. Früher hieß die Ansicht „Klassenergebnisse“ – deren
// Reiter leben in Schülerdaten und Ergebnisübersicht weiter.

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

const TABS = ['content', 'teacher', 'exams', 'students', 'overview', 'contest', 'live', 'settings'];
// Reiter der früheren Klassenergebnisse → Bereich und Unterreiter.
const OLD_TABS = { tests: ['overview', 'tests'], year: ['overview', 'year'], works: ['students', 'works'] };
const TYPE_ICON = { document: '📄', attachment: '📎' };
const NODE_ICON = { book: '📓', area: '📂', section: '📑' };

/**
 * Klassennotizbuch: Bereiche je Klasse. Schülerdaten und Ergebnisübersicht
 * enthalten die Reiter der früheren Klassenergebnisse (je Schüler alle
 * Durchläufe, je Test die ganze Klasse, Jahresüberblick, Bearbeitungen).
 */
export class ClassResultsView {
  constructor(app) {
    this.app = app;
    this._yearSel  = document.getElementById('crYear');
    this._classSel = document.getElementById('crClass');
    this._content  = document.getElementById('crContent');
    this._out      = this._content;
    this._tabs     = document.querySelectorAll('[data-cr-tab]');
    const saved = loadPref('lm_cr_tab');
    this._tab = TABS.includes(saved) ? saved : OLD_TABS[saved]?.[0] || 'content';
    this._studentsSub = loadPref('lm_cr_students_sub') === 'works' || saved === 'works' ? 'works' : 'results';
    this._overviewSub = ['tests', 'year'].includes(loadPref('lm_cr_overview_sub')) ? loadPref('lm_cr_overview_sub') : OLD_TABS[saved]?.[0] === 'overview' ? saved : 'modules';
    this._cb = null;
    this._worksBy = loadPref('lm_cr_works_by') === 'link' ? 'link' : 'student';
    this._liveTimer = null;
    this._liveLink = null;
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
    this._cb = null;
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
    this._out = this._content;
    if (!this._classId) {
      this._out.innerHTML = `<div class="empty-state"><span class="empty-icon">🏫</span>
        <p>Im ${escapeHtml(this._year || '')} gibt es noch keine Klassen. Unter <strong>🏫 Klassen</strong> anlegen oder einlesen –
          jede Klasse hat dann ihr Klassennotizbuch.</p></div>`;
      return;
    }
    if (this._tab !== 'live') this._stopLive();
    if (this._tab === 'live') { this._renderLive(); return; }
    if (this._tab === 'content') { this._renderContent(); return; }
    if (this._tab === 'teacher') { this._renderTeacher(); return; }
    if (this._tab === 'exams') { this._renderExamsSection(); return; }
    if (this._tab === 'contest') { this._renderContest(); return; }
    if (this._tab === 'settings') { this._renderSettings(); return; }
    if (this._tab === 'students') {
      this._subBar([['results', '📈 Ergebnisse'], ['works', '✍️ Blätter']], this._studentsSub, (v) => {
        this._studentsSub = v;
        savePref('lm_cr_students_sub', v);
      });
      if (this._studentsSub === 'works') { this._renderWorks(); return; }
      if (this._data) this._renderStudents();
      return;
    }
    // Ergebnisübersicht
    this._subBar([['modules', '🧩 Je Modul'], ['tests', '📝 Je Aufgabe'], ['year', '📅 Jahresüberblick']], this._overviewSub, (v) => {
      this._overviewSub = v;
      savePref('lm_cr_overview_sub', v);
    });
    if (this._overviewSub === 'modules') { this._renderModules(); return; }
    if (!this._data) return;
    if (this._overviewSub === 'tests') this._renderTests();
    else this._renderYear();
  }

  /** Umschalter über einem Bereich; der Inhalt kommt darunter (this._out). */
  _subBar(options, current, onPick) {
    this._content.innerHTML = `<div class="cr-works-bar cb-subbar">${options.map(([v, label]) =>
      `<button type="button" class="btn btn-sm ${v === current ? 'btn-primary' : 'btn-secondary'}" data-sub="${v}">${label}</button>`).join('')}</div>
      <div class="cb-sub"></div>`;
    this._content.querySelectorAll('[data-sub]').forEach((btn) => btn.addEventListener('click', () => { onPick(btn.dataset.sub); this._render(); }));
    this._out = this._content.querySelector('.cb-sub');
  }

  // ---- Bearbeitungen: Blatt mit Stift- und Texteingaben je Schüler ----

  /**
   * Alle Bearbeitungen der Klasse, gruppiert nach Schüler oder nach Link;
   * Gruppen und Einträge mit den neuesten Eingaben zuerst. „Ansehen“ zeigt
   * das Blatt in der Fassung, die der Schüler hatte, mit seinen Eingaben.
   */
  async _renderWorks() {
    const classId = this._classId;
    this._out.innerHTML = '<p class="hint">Wird geladen …</p>';
    const works = await this.app.api.listWorks({ classId });
    if (classId !== this._classId || this._tab !== 'students' || this._studentsSub !== 'works') return;
    if (failed(works)) { this._out.innerHTML = `<p class="hint">Fehler: ${escapeHtml(works?.message || '?')}</p>`; return; }
    const when = (d) => new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const byStudent = this._worksBy === 'student';
    const groups = new Map();
    for (const w of works) {
      const key = byStudent ? w.studentId : w.linkId;
      if (!groups.has(key)) groups.set(key, { label: byStudent ? w.studentName : w.linkName || 'Link', items: [] });
      groups.get(key).items.push(w);
    }
    const latest = (g) => Math.max(...g.items.map((w) => new Date(w.updatedAt).getTime()));
    const sorted = [...groups.values()].sort((a, b) => latest(b) - latest(a));
    this._out.innerHTML = `
      <div class="cr-works-bar">
        <span class="hint">Gruppieren nach</span>
        <button type="button" class="btn btn-sm ${byStudent ? 'btn-primary' : 'btn-secondary'}" data-by="student">👤 Schüler</button>
        <button type="button" class="btn btn-sm ${byStudent ? 'btn-secondary' : 'btn-primary'}" data-by="link">🔗 Link</button>
        <span class="hint">· neueste Eingaben zuerst</span>
      </div>
      ${sorted.length ? sorted.map((g) => `
        <details class="result-group" open>
          <summary><strong>${escapeHtml(g.label)}</strong> <span class="hint">${g.items.length} Blatt · zuletzt ${escapeHtml(when(latest(g)))}</span></summary>
          <ul class="cr-works-list">${g.items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((w) => `
            <li data-id="${escapeAttr(w.id)}">
              <span class="cr-work-title">${escapeHtml(w.moduleTitle || 'Dokument')}</span>
              <span class="hint">${escapeHtml(byStudent ? w.linkName || '' : w.studentName)}${w.access === 'exam' ? ' · 📝 Klassenarbeit' : ''} · ${escapeHtml(when(w.updatedAt))}</span>
              <button type="button" class="btn btn-secondary btn-sm btn-work-open">👁 Ansehen</button>
            </li>`).join('')}</ul>
        </details>`).join('') : `<div class="empty-state"><span class="empty-icon">✍️</span>
          <p>Noch keine Bearbeitungen. Sie entstehen, wenn Schüler über einen Klassenlink ein Dokument mit „✍️ Mit Stift bearbeiten“ öffnen.</p></div>`}`;
    this._out.querySelectorAll('[data-by]').forEach((btn) => btn.addEventListener('click', () => {
      this._worksBy = btn.dataset.by;
      savePref('lm_cr_works_by', this._worksBy);
      this._renderWorks();
    }));
    this._out.querySelectorAll('.btn-work-open').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const full = await this.app.api.getWork(btn.closest('li').dataset.id);
        if (failed(full)) throw new Error(full?.message || 'nicht gefunden');
        const { openStudentWork } = await import('../ink/ink-open.js');
        await openStudentWork(this.app.api, full);
      } catch (err) {
        this.app.showToast('Fehler: ' + err.message, 'error');
      }
      btn.disabled = false;
    }));
  }

  // ---- Live: wer ist bei welcher Aufgabe? ----

  _stopLive() {
    clearTimeout(this._liveTimer);
    this._liveTimer = null;
  }

  /**
   * Alle Schüler der Klasse, je Aufgabe des gewählten Links ✓ erledigt,
   * ▶ gerade dran; ✍️ wer in den letzten Minuten mit dem Stift schreibt.
   * Frischt sich alle 5 Sekunden auf, solange der Reiter offen ist.
   */
  async _renderLive() {
    this._stopLive();
    const classId = this._classId;
    const view = document.getElementById('view-teacher-class-results');
    const live = await this.app.api.getLiveClass(classId);
    if (classId !== this._classId || this._tab !== 'live' || !view?.classList.contains('active')) return;
    if (failed(live)) { this._out.innerHTML = `<p class="hint">Fehler: ${escapeHtml(live?.message || '?')}</p>`; return; }
    const now = new Date(live.now).getTime();
    const links = new Map();
    for (const r of live.runs) if (!links.has(r.linkId)) links.set(r.linkId, r.linkName || 'Link');
    if (!links.has(this._liveLink)) this._liveLink = live.runs[0]?.linkId || null;
    const runs = live.runs.filter((r) => r.linkId === this._liveLink);
    const steps = runs.reduce((longest, r) => (r.steps.length > longest.length ? r.steps : longest), []);
    const byStudent = new Map(runs.map((r) => [r.studentId, r]));
    const inkBy = new Map();
    for (const w of live.ink) {
      if (now - new Date(w.updatedAt).getTime() > 10 * 60 * 1000) continue;
      if (!inkBy.has(w.studentId) || new Date(inkBy.get(w.studentId).updatedAt) < new Date(w.updatedAt)) inkBy.set(w.studentId, w);
    }
    const ago = (d) => {
      const m = Math.round((now - new Date(d).getTime()) / 60000);
      return m < 1 ? 'gerade' : m < 60 ? `vor ${m} min` : `vor ${Math.round(m / 60)} h`;
    };
    const known = new Set(live.students.map((s) => s.id));
    const rows = [...live.students, ...runs.filter((r) => !known.has(r.studentId)).map((r) => ({ id: r.studentId, name: r.studentName }))];
    const finished = runs.filter((r) => r.finishedAt).length;
    const cell = (r, i) => {
      if (!r) return '<td></td>';
      if (i < r.done) return '<td class="cr-live-done" title="erledigt">✓</td>';
      if (i === r.done && !r.finishedAt) return '<td class="cr-live-now" title="gerade dran">▶</td>';
      return '<td></td>';
    };
    this._out.innerHTML = links.size ? `
      <div class="cr-works-bar">
        <label>Link <select class="cr-live-link">${[...links].map(([id, name]) => `<option value="${escapeAttr(id)}" ${id === this._liveLink ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>
        <span class="hint">${runs.length} von ${live.students.length} Schülern dabei · ${finished} fertig · frischt sich alle 5 s auf</span>
      </div>
      <div class="cr-live-wrap"><table class="cr-live">
        <thead><tr><th>Schüler</th>${steps.map((t, i) => `<th title="${escapeAttr(t)}">${i + 1}</th>`).join('')}<th>Stand</th></tr></thead>
        <tbody>${rows.map((s) => {
          const r = byStudent.get(s.id);
          const ink = inkBy.get(s.id);
          const state = !r ? '<span class="hint">noch nicht gestartet</span>'
            : r.finishedAt ? `✅ fertig <span class="hint">${escapeHtml(ago(r.finishedAt))}</span>`
              : `${r.done}/${r.steps.length} <span class="hint">${escapeHtml(ago(r.updatedAt))}</span>`;
          return `<tr class="${r ? '' : 'cr-live-absent'}"><td>${escapeHtml(s.name)}${ink ? ` <span title="schreibt mit dem Stift: ${escapeAttr(ink.moduleTitle)}">✍️</span>` : ''}</td>
            ${steps.map((_, i) => cell(r, i)).join('')}<td>${state}</td></tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="empty-state"><span class="empty-icon">📡</span>
        <p>In den letzten 12 Stunden hat niemand aus dieser Klasse einen Klassenlink gestartet. Sobald es losgeht, erscheint es hier.</p></div>`;
    this._out.querySelector('.cr-live-link')?.addEventListener('change', (e) => { this._liveLink = e.target.value; this._renderLive(); });
    this._liveTimer = setTimeout(() => this._renderLive(), 5000);
  }

  // ---- Schüler: je Schüler alle Durchläufe ----

  _renderStudents() {
    const { rows, extra } = this._rows();
    this._out.innerHTML = '';
    if (rows.length === 0 && extra.length === 0) {
      this._out.innerHTML = '<div class="empty-state"><p>Die Klasse hat noch keine Schüler und keine Ergebnisse.</p></div>';
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
    for (const row of rows) this._out.appendChild(block(row));
    if (extra.length) {
      const head = document.createElement('h3');
      head.className = 'cr-subhead';
      head.textContent = 'Nicht zugeordnet';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Durchläufe über einen Klassenlink, die keinem Schüler der Liste gehören – etwa von vor der Schülerliste oder eines entfernten Schülers.';
      this._out.append(head, hint);
      for (const row of extra) this._out.appendChild(block(row));
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
      this._out.innerHTML = '<div class="empty-state"><p>Über die Klassenlinks dieser Klasse gibt es noch keine Ergebnisse.</p></div>';
      return;
    }
    const latest = (t) => Math.max(...t.results.map((r) => new Date(r.timestamp).getTime()));
    const list = [...tests.entries()].sort(([, a], [, b]) => latest(b) - latest(a));
    this._out.innerHTML = '';
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
      this._out.appendChild(box);
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
    this._out.innerHTML = rows.length === 0
      ? '<div class="empty-state"><p>Die Klasse hat noch keine Schüler.</p></div>'
      : `<p class="hint">${escapeHtml(this._data.class.schoolYear || '')}: ${runs(results.length)} über ${testCount} Test(s), Ø ${pct(total)}.
           „Tests“ zählt die verschiedenen Klassenlinks, „aktive Wochen“ die Kalenderwochen mit mindestens einem Durchlauf.</p>
         <table class="class-students cr-table">
           <thead><tr><th>Schüler</th><th>Durchläufe</th><th>Tests</th><th>Aktive Wochen</th><th>Ø</th><th>Zuletzt</th></tr></thead>
           <tbody>${cells.join('')}</tbody>
         </table>`;
  }

  // ==================== Bereiche des Klassennotizbuchs ====================

  /** Daten des Klassennotizbuchs (Link, Zuweisungen, Nur für Lehrer) – einmal je Klasse. */
  async _classbook(force = false) {
    const classId = this._classId;
    if (!force && this._cb?.classId === classId) return this._cb;
    const res = await this.app.api.getClassbook(classId);
    if (failed(res)) throw new Error(res?.message || 'Klassennotizbuch nicht abrufbar');
    if (classId === this._classId) this._cb = res;
    return res;
  }

  /** Bereich laden und zeichnen; `tab` prüft, ob er inzwischen gewechselt wurde. */
  async _section(tab, draw) {
    const classId = this._classId;
    const out = this._out;
    out.innerHTML = '<p class="hint">Wird geladen …</p>';
    try {
      const cb = await this._classbook();
      if (classId !== this._classId || this._tab !== tab) return;
      await draw(cb, out);
    } catch (err) {
      if (classId === this._classId && this._tab === tab) out.innerHTML = `<p class="hint">Fehler: ${escapeHtml(err.message)}</p>`;
    }
  }

  _unitsHtml(topics) {
    return topics.map((t) => `<div class="cb-topic">
      <div class="cb-topic-title">📘 ${escapeHtml(t.title)}</div>
      <ul class="cb-units">${t.units.map((u) => `<li>${TYPE_ICON[u.type] || '🧩'} ${escapeHtml(u.title || 'Modul')}</li>`).join('')}</ul>
    </div>`).join('');
  }

  /** Eine Zuweisung (Klassenlink) mit Inhalt und Knöpfen. */
  _linkCard(link, buttons) {
    const n = link.topics.reduce((sum, t) => sum + t.units.length, 0);
    return `<details class="result-group cb-link ${link.active ? '' : 'cb-off'}" data-link="${escapeAttr(link.id)}">
      <summary><span class="result-group-title">🔗 ${escapeHtml(link.name)}${link.active ? '' : ' <small class="class-pending-note">deaktiviert</small>'}</span>
        <span class="result-group-meta">${link.topics.length} Lernthema/-themen · ${n} Modul${n === 1 ? '' : 'e'}
          ${link.practice.map((m) => `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[m] || m)}</span>`).join('')}</span></summary>
      <div class="cb-link-actions">${buttons}</div>
      ${this._unitsHtml(link.topics)}
    </details>`;
  }

  _bindActive(out) {
    out.querySelectorAll('[data-active]').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.closest('[data-link]').dataset.link;
      const res = await this.app.api.updateLink(id, { active: btn.dataset.active === 'on' });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      await this._classbook(true);
      this._render();
    }));
  }

  // ---- 📋 Inhaltsübersicht ----

  _renderContent() {
    this._section('content', (cb, out) => {
      const links = cb.links.filter((l) => l.practice.length);
      out.innerHTML = `
        <div class="cr-works-bar">
          <button type="button" class="btn btn-primary btn-sm" id="cbAssign">➕ Aus dem Notizbuch zuweisen</button>
          <span class="hint">Die Schüler finden alles über den <a href="#" id="cbToSettings">Klassenbuch-Link</a>. Inhalte bleiben Verweise:
            Änderungen im Notizbuch gelten sofort.</span>
        </div>
        ${links.length ? links.map((l) => this._linkCard(l, `
          <button type="button" class="btn btn-secondary btn-sm" data-live>📡 Live</button>
          <button type="button" class="btn btn-secondary btn-sm" data-overview>📊 Ergebnisse</button>
          ${l.active ? '<button type="button" class="btn btn-secondary btn-sm" data-active="off" title="Schüler sehen die Aufgabe nicht mehr; Ergebnisse bleiben">⏸ Ausblenden</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-active="on">▶ Wieder zeigen</button>'}`)).join('')
          : `<div class="empty-state"><span class="empty-icon">📋</span>
              <p>Noch nichts zugewiesen. Wähle aus deinem Notizbuch ein Lernthema, einen Abschnitt, Bereich oder ein Book –
                es erscheint dann bei den Schülern im Klassennotizbuch.</p></div>`}`;
      out.querySelector('#cbToSettings')?.addEventListener('click', (e) => { e.preventDefault(); this._switch('settings'); });
      out.querySelector('#cbAssign').addEventListener('click', () => this._assign());
      out.querySelectorAll('[data-live]').forEach((btn) => btn.addEventListener('click', () => {
        this._liveLink = btn.closest('[data-link]').dataset.link;
        this._switch('live');
      }));
      out.querySelectorAll('[data-overview]').forEach((btn) => btn.addEventListener('click', () => {
        this._overviewLink = btn.closest('[data-link]').dataset.link;
        this._overviewSub = 'modules';
        this._switch('overview');
      }));
      this._bindActive(out);
    });
  }

  _switch(tab) {
    this._tab = tab;
    savePref('lm_cr_tab', tab);
    this._render();
  }

  /** Lernthema oder Knoten aus dem Notizbuch als Klassenlink dieser Klasse. */
  async _assign() {
    const picked = await this._pickFromNotebook('➕ Der Klasse zuweisen',
      'Ein Lernthema oder einen ganzen Bereich wählen. Bei einem Bereich kommen später dazugelegte Lernthemen mit, sobald du ihn erneut zuweist.');
    if (!picked) return;
    const res = picked.type === 'node'
      ? await this.app.api.classLinkFromNotebookNode(picked.id, this._classId)
      : await this.app.api.classLinkFromTopic(picked.id, this._classId);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Zuweisen fehlgeschlagen'), 'error'); return; }
    if (res.notReleased?.length) this.app.showToast(`Nicht freigegeben, daher nicht dabei: ${res.notReleased.join(', ')}.`, 'info');
    else this.app.showToast(`„${picked.title}“ ist zugewiesen.`, 'success');
    await this._classbook(true);
    this._render();
  }

  /**
   * Auswahl aus dem Notizbuch (Books, Bereiche, Abschnitte, Lernthemen) –
   * `{ type: 'node'|'topic', id, title }` oder null.
   */
  async _pickFromNotebook(title, hint) {
    const tree = await this.app.api.getNotebooks();
    if (failed(tree)) { this.app.showToast('Fehler: ' + (tree?.message || 'Notizbuch nicht abrufbar'), 'error'); return null; }
    const topics = new Map((tree.topics || []).map((t) => [t.id, t]));
    const childNodes = new Map();
    for (const n of tree.nodes || []) {
      const k = n.parentId || '';
      if (!childNodes.has(k)) childNodes.set(k, []);
      childNodes.get(k).push(n);
    }
    const childTopics = new Map();
    for (const p of tree.placements || []) {
      const k = p.nodeId || '';
      if (!childTopics.has(k)) childTopics.set(k, []);
      childTopics.get(k).push(p);
    }
    const byOrder = (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    const rows = [];
    const walk = (parent, depth) => {
      for (const n of (childNodes.get(parent) || []).sort(byOrder)) {
        rows.push({ type: 'node', id: n.id, title: n.title, icon: NODE_ICON[n.kind] || '📂', depth });
        walk(n.id, depth + 1);
      }
      for (const p of (childTopics.get(parent) || []).sort(byOrder)) {
        const t = topics.get(p.topicId);
        if (t) rows.push({ type: 'topic', id: t.id, title: t.title, icon: '📘', depth });
      }
    };
    walk('', 0);
    const placed = new Set((tree.placements || []).map((p) => p.topicId));
    for (const t of tree.topics || []) if (!placed.has(t.id)) rows.push({ type: 'topic', id: t.id, title: t.title, icon: '📘', depth: 0 });
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `<div class="import-modules-card cb-picker" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3><p class="hint">${escapeHtml(hint)}</p>
        <input type="search" class="search-input cb-picker-search" placeholder="Suchen …" autocomplete="off">
        <ul class="cb-picker-list">${rows.map((r, i) => `<li data-i="${i}" style="padding-left:${0.4 + r.depth * 1.2}rem">
          <button type="button" class="cb-picker-row">${r.icon} ${escapeHtml(r.title)}</button></li>`).join('') || '<li class="hint">Dein Notizbuch ist leer.</li>'}</ul>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary cb-picker-cancel">Abbrechen</button></div>
      </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.cb-picker-cancel').addEventListener('click', () => done(null));
      overlay.querySelectorAll('[data-i]').forEach((li) => li.querySelector('button').addEventListener('click', () => done(rows[Number(li.dataset.i)])));
      const search = overlay.querySelector('.cb-picker-search');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        overlay.querySelectorAll('[data-i]').forEach((li) => { li.hidden = !!q && !rows[Number(li.dataset.i)].title.toLowerCase().includes(q); });
      });
      search.focus();
    });
  }

  // ---- 🔒 Nur für Lehrer ----

  _renderTeacher() {
    this._section('teacher', async (cb, out) => {
      const tree = await this.app.api.getNotebooks();
      if (failed(tree)) throw new Error(tree?.message || 'Notizbuch nicht abrufbar');
      const topics = new Map((tree.topics || []).map((t) => [t.id, t]));
      const nodes = new Map((tree.nodes || []).map((n) => [n.id, n]));
      // Lernthemen unter einem Knoten, auch in Unterordnern.
      const below = (id) => {
        const ids = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of tree.nodes || []) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
        }
        return (tree.placements || []).filter((p) => ids.has(p.nodeId)).map((p) => topics.get(p.topicId)).filter(Boolean);
      };
      const items = cb.teacherItems.map((it) => {
        if (it.type === 'topic') return topics.has(it.id) ? { ...it, title: topics.get(it.id).title, icon: '📘', topics: [topics.get(it.id)] } : null;
        const n = nodes.get(it.id);
        return n ? { ...it, title: n.title, icon: NODE_ICON[n.kind] || '📂', topics: below(n.id) } : null;
      }).filter(Boolean);
      out.innerHTML = `
        <div class="cr-works-bar">
          <button type="button" class="btn btn-primary btn-sm" id="cbTeacherAdd">➕ Aus dem Notizbuch</button>
          <span class="hint">Nur du siehst diesen Bereich – etwa Lösungen, Unterrichtsplanung oder Kopiervorlagen. Es sind Verweise auf dein Notizbuch; ein Klick zeigt die Vorschau, bearbeitet wird im 📓 Notizbuch.</span>
        </div>
        ${items.length ? items.map((it) => `
          <details class="result-group" open data-item="${escapeAttr(`${it.type}:${it.id}`)}">
            <summary><span class="result-group-title">${it.icon} ${escapeHtml(it.title)}</span>
              <span class="result-group-meta"><button type="button" class="btn btn-secondary btn-sm" data-remove title="Aus diesem Bereich nehmen (im Notizbuch bleibt es)">✕</button></span></summary>
            ${it.topics.map((t) => `<div class="cb-topic"><div class="cb-topic-title">📘 ${escapeHtml(t.title)}</div>
              <ul class="cb-units">${(t.modules || []).filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex).map((m) => `
                <li><button type="button" class="cb-unit" data-topic="${escapeAttr(t.id)}" data-module="${escapeAttr(m.id)}">${TYPE_ICON[m.type] || '🧩'} ${escapeHtml(m.title || 'Modul')}</button></li>`).join('')}</ul></div>`).join('')
              || '<p class="hint">Darin liegt (noch) kein Lernthema.</p>'}
          </details>`).join('')
          : `<div class="empty-state"><span class="empty-icon">🔒</span><p>Noch leer. Lege hier ab, was du für diese Klasse brauchst, die Schüler aber nicht sehen sollen.</p></div>`}`;
      const save = async (list) => {
        const res = await this.app.api.setClassbookTeacherItems(this._classId, list);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        await this._classbook(true);
        this._render();
      };
      out.querySelector('#cbTeacherAdd').addEventListener('click', async () => {
        const picked = await this._pickFromNotebook('🔒 Nur für Lehrer', 'Lernthema oder Bereich aus deinem Notizbuch – die Schüler sehen ihn nicht.');
        if (picked) await save([...cb.teacherItems, { type: picked.type, id: picked.id }]);
      });
      out.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.closest('[data-item]').dataset.item;
        save(cb.teacherItems.filter((it) => `${it.type}:${it.id}` !== key));
      }));
      out.querySelectorAll('[data-module]').forEach((btn) => btn.addEventListener('click', () => {
        const t = topics.get(btn.dataset.topic);
        const mod = (t?.modules || []).find((m) => m.id === btn.dataset.module);
        if (mod) this.app.modulesView.openFrom('teacher-class-results', t.id, mod, 'preview');
      }));
    });
  }

  // ---- 📝 Klassenarbeiten ----

  _renderExamsSection() {
    this._section('exams', async (cb, out) => {
      const links = cb.links.filter((l) => l.exam);
      out.innerHTML = `
        <p class="hint">Klassenarbeiten haben einen eigenen Link. Sobald du ihn mit <strong>📝 Link & QR</strong> erzeugt hast, steht die
          Klassenarbeit auch im Klassennotizbuch der Schüler (mit PIN) – bis du sie deaktivierst. Angelegt werden sie unter
          <strong>🔗 Schülerfreigaben</strong> (Modus „Klassenarbeit“, dann für diese Klasse).</p>
        ${links.length ? links.map((l) => this._linkCard(l, `
          <button type="button" class="btn btn-primary btn-sm" data-exam-share>📝 Link & QR</button>
          ${l.active ? '<button type="button" class="btn btn-secondary btn-sm" data-active="off">⏸ Deaktivieren</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-active="on">▶ Aktivieren</button>'}`)).join('')
          : '<div class="empty-state"><span class="empty-icon">📝</span><p>Für diese Klasse gibt es noch keine Klassenarbeit.</p></div>'}
        <div class="class-exams"></div>`;
      out.querySelectorAll('[data-exam-share]').forEach((btn) => btn.addEventListener('click', () => {
        const link = links.find((l) => l.id === btn.closest('[data-link]').dataset.link);
        this.app.linksView._openShareDialog(link, 'exam');
      }));
      this._bindActive(out);
      await this.app.classesView._renderExams({ id: this._classId }, out.querySelector('.class-exams'));
    });
  }

  // ---- 🏆 Quiz-Arena ----

  _renderContest() {
    this._section('contest', (cb, out) => {
      const links = cb.links.filter((l) => l.contest);
      out.innerHTML = `
        <p class="hint">Die Quiz-Arena leitest du über den Leitungs-Link (z. B. am Beamer); die Schüler kommen über das Klassennotizbuch
          oder den QR-Code im Wartebereich hinein.</p>
        ${links.length ? links.map((l) => this._linkCard(l, '<button type="button" class="btn btn-primary btn-sm" data-contest>🏆 Quiz-Arena öffnen</button>')).join('')
          : '<div class="empty-state"><span class="empty-icon">🏆</span><p>Keine Zuweisung dieser Klasse hat die Quiz-Arena eingeschaltet.</p></div>'}`;
      out.querySelectorAll('[data-contest]').forEach((btn) => btn.addEventListener('click', () => {
        this.app.linksView._openContestDialog({ id: btn.closest('[data-link]').dataset.link });
      }));
    });
  }

  // ---- ⚙ Klassenbuch-Link ----

  _renderSettings() {
    this._section('settings', (cb, out) => {
      const open = !!cb.firstLoginUntil;
      const until = open ? new Date(cb.firstLoginUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      const missing = cb.students.confirmed - cb.students.pinSeen;
      out.innerHTML = `
        <div class="cb-settings">
          <div class="cb-qr">${cb.qrSvg || ''}</div>
          <div>
            <h3>📒 Klassenbuch-Link ${escapeHtml(cb.className)}</h3>
            <p class="hint">Ein Link für das ganze Schuljahr: Schüler öffnen ihn, geben Namen und PIN ein und finden ihre Aufgaben,
              Ergebnisse und Blätter.</p>
            <div class="cb-url"><input type="text" readonly value="${escapeAttr(cb.url)}" class="search-input">
              <button type="button" class="btn btn-secondary btn-sm" id="cbCopy">📋 Kopieren</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cbRenew" title="Neuer Link – der alte gilt dann nicht mehr">🔄 Neu</button></div>
            <h4>🔑 Erstanmeldung</h4>
            <p>${cb.students.pinSeen} von ${cb.students.confirmed} Schülern haben ihre PIN.
              ${missing > 0 ? `<span class="cr-missing">${missing} noch nicht</span>` : ''}</p>
            ${open
              ? `<p class="cb-open">🔓 Offen bis ${escapeHtml(until)} Uhr: Wer seine PIN noch nie gesehen hat, bekommt sie beim Anmelden angezeigt.</p>
                 <button type="button" class="btn btn-secondary" id="cbFirstLogin" data-open="false">🔒 Jetzt schließen</button>`
              : `<p class="hint">Im Unterricht freischalten: Dann bekommt jeder, der seine PIN noch nicht kennt, sie beim ersten Anmelden angezeigt.
                   Am Ende des Tages schließt sich die Erstanmeldung von selbst. Wer fehlt, bekommt seine PIN von dir (Klassenliste).</p>
                 <button type="button" class="btn btn-primary" id="cbFirstLogin" data-open="true">🔓 Erstanmeldung freischalten</button>`}
            <p class="hint">${cb.strict ? '🔒 Strikte Anmeldung: Nur wer in der Klassenliste steht, kommt hinein.'
              : 'Offene Klasse: Unbekannte Namen kommen als unbestätigte Einträge dazu – sie sehen ihre Aufgaben, aber Ergebnisse und Blätter erst nach deiner Bestätigung.'}
              <a href="#" id="cbStudents">Zur Klassenliste (PINs)</a></p>
          </div>
        </div>`;
      out.querySelector('#cbCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(cb.url); this.app.showToast('Link kopiert.', 'success'); } catch (_) { out.querySelector('.cb-url input').select(); }
      });
      out.querySelector('#cbRenew').addEventListener('click', async () => {
        if (!(await this.app.appConfirm('Neuen Klassenbuch-Link erzeugen? Der bisherige Link und ausgeteilte QR-Codes gelten dann nicht mehr.'))) return;
        const res = await this.app.api.renewClassbookToken(this._classId);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        this._cb = res;
        this._render();
      });
      out.querySelector('#cbFirstLogin').addEventListener('click', async (e) => {
        const res = await this.app.api.setClassbookFirstLogin(this._classId, e.currentTarget.dataset.open === 'true');
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        await this._classbook(true);
        this._render();
      });
      out.querySelector('#cbStudents').addEventListener('click', (e) => {
        e.preventDefault();
        this.app.classesView._openId = this._classId;
        this.app.navigateToView('teacher-classes');
      });
    });
  }

  // ---- 📊 Ergebnisübersicht je Modul ----

  /** Je Zuweisung eine Tabelle: Schüler × Module, bester Anteil richtig, ✓ erledigt, ✍️ Blatt. */
  async _renderModules() {
    const classId = this._classId;
    const out = this._out;
    out.innerHTML = '<p class="hint">Wird geladen …</p>';
    const data = await this.app.api.getClassbookOverview(classId);
    if (classId !== this._classId || this._tab !== 'overview' || this._overviewSub !== 'modules') return;
    if (failed(data)) { out.innerHTML = `<p class="hint">Fehler: ${escapeHtml(data?.message || '?')}</p>`; return; }
    if (!data.links.length) {
      out.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Noch nichts zugewiesen – siehe 📋 Inhaltsübersicht.</p></div>';
      return;
    }
    const cell = (c) => {
      if (!c || (!c.done && !c.work)) return '<td></td>';
      const main = c.done ? (c.pct === null ? '<span class="cb-done">✓</span>' : `<span class="result-score ${pctClass(c.pct)}">${c.pct}</span>`) : '';
      return `<td>${main}${c.work ? '<span title="Blatt bearbeitet">✍️</span>' : ''}</td>`;
    };
    const students = data.students.filter((s) => !s.pending);
    out.innerHTML = `<p class="hint">Je Modul das beste Ergebnis in Prozent, ✓ erledigt (ohne Wertung), ✍️ Blatt mit dem Stift bearbeitet.
        Unbestätigte Einträge der Klassenliste fehlen.</p>
      ${data.links.map((l) => {
        const done = (s) => l.units.filter((u) => l.cells[s.id]?.[u.id]?.done || l.cells[s.id]?.[u.id]?.work).length;
        return `<details class="result-group" ${this._overviewLink ? (this._overviewLink === l.id ? 'open' : '') : 'open'}>
          <summary><span class="result-group-title">🔗 ${escapeHtml(l.name)}${l.active ? '' : ' <small class="class-pending-note">ausgeblendet</small>'}</span>
            <span class="result-group-meta">${l.units.length} Module · ${students.filter((s) => done(s) === l.units.length && l.units.length).length} von ${students.length} fertig</span></summary>
          <div class="cr-live-wrap"><table class="cr-live cb-matrix">
            <thead><tr><th>Schüler</th>${l.units.map((u, i) => `<th title="${escapeAttr(u.title)}">${i + 1}</th>`).join('')}<th>Erledigt</th></tr></thead>
            <tbody>${students.map((s) => `<tr class="${done(s) ? '' : 'cr-live-absent'}"><td>${escapeHtml(s.name)}</td>
              ${l.units.map((u) => cell(l.cells[s.id]?.[u.id])).join('')}<td>${done(s)}/${l.units.length}</td></tr>`).join('')}</tbody>
          </table></div>
          <ol class="cb-legend">${l.units.map((u) => `<li>${TYPE_ICON[u.type] || '🧩'} ${escapeHtml(u.title || 'Modul')}</li>`).join('')}</ol>
        </details>`;
      }).join('')}`;
    this._overviewLink = null;
  }
}
