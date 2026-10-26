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
  _linkCard(link, buttons, body = null) {
    const n = link.topics.reduce((sum, t) => sum + t.units.length, 0);
    const open = this._openLinks?.has(link.id) ? 'open' : '';
    return `<details class="result-group cb-link ${link.active ? '' : 'cb-off'}" data-link="${escapeAttr(link.id)}" ${open}>
      <summary><span class="result-group-title">${link.classTopicId ? '📘' : '🔗'} ${escapeHtml(link.name)}${link.active ? '' : ' <small class="class-pending-note">deaktiviert</small>'}</span>
        <span class="result-group-meta">${link.topics.length} Lernthema/-themen · ${n} Modul${n === 1 ? '' : 'e'}
          ${link.practice.map((m) => `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[m] || m)}</span>`).join('')}</span></summary>
      <div class="cb-link-actions">${buttons}${body !== null && this._tab === 'content' ? '<button type="button" class="nb-menu-btn" data-entry-menu title="Aktionen" aria-label="Aktionen">⋯</button>' : ''}</div>
      ${body ?? this._unitsHtml(link.topics)}
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

  /** Inhalt einer Zuweisung mit Schaltern: ● an (Schüler sehen es), ○ aus – auch Neues, das dazugekommen ist. */
  _availHtml(link) {
    const sw = (on, attrs, what) => `<button type="button" class="nb-status ${on ? 'on' : ''}" ${attrs}
      title="${on ? `Schüler sehen ${what} – klicken zum Ausschalten` : `Ausgeschaltet – klicken, damit die Schüler ${what} sehen`}">${on ? '●' : '○'}</button>`;
    return `${link.available.map((t) => `<div class="cb-topic ${t.enabled ? '' : 'cb-item-off'}" data-topic="${escapeAttr(t.topicId)}">
        <div class="cb-topic-title">${sw(t.enabled, 'data-toggle-topic', 'dieses Lernthema')} 📘 ${escapeHtml(t.title)}</div>
        <ul class="cb-units">${t.modules.map((m) => {
          const marked = this._cb?.marker?.linkId === link.id && this._cb.marker.moduleId === m.id;
          return `<li class="${m.enabled ? '' : 'cb-item-off'} ${marked ? 'cb-marked' : ''}">
          <span>${sw(m.enabled, `data-toggle-module="${escapeAttr(m.id)}"`, 'dieses Modul')}
            <button type="button" class="cb-unit" data-open-module="${escapeAttr(m.id)}" title="${link.classTopicId === t.topicId ? 'Bearbeiten' : 'Vorschau'}">${TYPE_ICON[m.type] || '🧩'} ${escapeHtml(m.title || 'Modul')}</button></span>
          ${m.enabled ? `<button type="button" class="cb-mark ${marked ? 'on' : ''}" data-mark="${escapeAttr(m.id)}"
            title="${marked ? 'Hier ist die Klasse gerade – klicken zum Entfernen' : 'Merker: Hier ist die Klasse gerade. Bei den Schülern ist dieses Modul dann aufgeklappt und hat den Fokus.'}">📍</button>` : ''}</li>`;
        }).join('')}</ul>
      </div>`).join('')}
      ${link.notReleased?.length ? `<p class="hint">Im Notizbuch noch nicht für Schüler freigegeben, daher nicht wählbar: ${escapeHtml(link.notReleased.join(', '))}.</p>` : ''}`;
  }

  _bindMarker(out) {
    out.querySelectorAll('[data-mark], [data-unmark]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const off = btn.hasAttribute('data-unmark') || btn.classList.contains('on');
      const res = await this.app.api.setClassbookMarker(this._classId, off ? {} : { linkId: btn.closest('[data-link]').dataset.link, moduleId: btn.dataset.mark });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this._openLinks = new Set([...out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
      await this._classbook(true);
      this._render();
    }));
  }

  /** Wo der Merker steht: Titel von Zuweisung und Modul – oder null. */
  _markerInfo(cb) {
    const mk = cb.marker;
    const link = mk && cb.links.find((l) => l.id === mk.linkId);
    const mod = link?.available.flatMap((t) => t.modules).find((m) => m.id === mk.moduleId);
    return mod ? { link, mod } : null;
  }

  _bindToggles(out) {
    out.querySelectorAll('[data-toggle-topic], [data-toggle-module]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const linkId = btn.closest('[data-link]').dataset.link;
      const topicId = btn.closest('[data-topic]').dataset.topic;
      const res = await this.app.api.setClassbookItem(this._classId, linkId, {
        topicId, moduleId: btn.dataset.toggleModule || undefined, enabled: !btn.classList.contains('on'),
      });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this._openLinks = new Set([...out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
      await this._classbook(true);
      this._render();
    }));
  }

  // ---- 📋 Inhaltsübersicht ----

  _renderContent() {
    this._section('content', (cb, out) => {
      // Zuweisungen mit Übungsmodus und klasseneigene Lernthemen (auch noch ohne Module).
      const links = cb.links.filter((l) => l.practice.length || l.classTopicId);
      const mk = this._markerInfo(cb);
      if (mk) (this._openLinks ||= new Set()).add(mk.link.id);
      out.innerHTML = `
        ${mk ? `<div class="cb-marker-bar">📍 Die Klasse ist gerade bei <strong>${escapeHtml(mk.mod.title || 'Modul')}</strong>
            <span class="hint">(${escapeHtml(mk.link.name)})${mk.mod.enabled && mk.link.active ? '' : ' – für die Schüler gerade ausgeschaltet'}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-unmark>Entfernen</button></div>`
          : '<p class="hint">📍 an einem Modul merkt, wo die Klasse gerade ist – bei den Schülern ist es dann aufgeklappt und hat den Fokus.</p>'}
        <div class="cr-works-bar">
          <button type="button" class="btn btn-primary btn-sm" data-add="assign" title="Lernthema, Abschnitt, Bereich oder Book aus deinem Notizbuch – als Verweis">➕ Aus dem Notizbuch</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="topic" title="Lernthema nur für diese Klasse, z. B. Aufgaben oder Dokumente">➕ Lernthema</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="area">➕ Bereich</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="section">➕ Abschnitt</button>
        </div>
        <p class="hint">Die Schüler sehen diesen Baum über den <a href="#" id="cbToSettings">Klassenbuch-Link</a>. 🔗 verweist aufs Notizbuch
          (Änderungen dort gelten sofort), 📘 gehört nur dieser Klasse. ● / ○ schaltet Lernthemen und Module ein und aus –
          was später dazukommt, ist zunächst aus. Aktionen über ⋯.</p>
        <div class="cb-tree">${links.length || cb.nodes.length ? this._level(cb, links, null)
          : `<div class="empty-state"><span class="empty-icon">📋</span>
              <p>Noch leer. Weise aus deinem Notizbuch Lernthemen oder ganze Bereiche zu, lege eigene Lernthemen für diese Klasse an
                und ordne alles in Bereichen und Abschnitten.</p></div>`}</div>`;
      out.querySelector('#cbToSettings')?.addEventListener('click', (e) => { e.preventDefault(); this._switch('settings'); });
      out.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => this._add(btn.dataset.add, null)));
      out.querySelectorAll('[data-node-menu]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const node = cb.nodes.find((n) => n.id === btn.closest('[data-node]').dataset.node);
        this._menu(this._nodeMenu(cb, node), btn);
      }));
      out.querySelectorAll('[data-entry-menu]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const link = cb.links.find((l) => l.id === btn.closest('[data-link]').dataset.link);
        this._menu(this._entryMenu(cb, link), btn);
      }));
      out.querySelectorAll('details[data-node]').forEach((d) => d.addEventListener('toggle', () => {
        (this._closedNodes ||= new Set())[d.open ? 'delete' : 'add'](d.dataset.node);
      }));
      out.querySelectorAll('[data-open-module]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        const link = cb.links.find((l) => l.id === btn.closest('[data-link]').dataset.link);
        const topicId = btn.closest('[data-topic]').dataset.topic;
        const own = link?.classTopicId === topicId;
        this.app.modulesView.openFrom('teacher-class-results', topicId, { id: btn.dataset.openModule }, own ? 'edit' : 'preview');
      }));
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
      this._bindToggles(out);
      this._bindMarker(out);
      out.querySelector('.cb-marked')?.scrollIntoView({ block: 'center' });
    });
  }

  /** Eine Ebene des Baums: erst Bereiche/Abschnitte, dann die Lernthemen darin. */
  _level(cb, links, parentId) {
    const nodes = cb.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const entries = links.filter((l) => l.nodeId === parentId).sort((a, b) => a.order - b.order);
    const count = (id) => links.filter((l) => l.nodeId === id).length + cb.nodes.filter((n) => n.parentId === id).reduce((s, n) => s + count(n.id), 0);
    const html = nodes.map((n) => `<details class="cb-node" data-node="${escapeAttr(n.id)}" ${this._closedNodes?.has(n.id) ? '' : 'open'}>
        <summary><span class="cb-node-title">${NODE_ICON[n.kind]} ${escapeHtml(n.title)}</span>
          <span class="hint">${count(n.id)} Lernthem${count(n.id) === 1 ? 'a' : 'en'}</span>
          <button type="button" class="nb-menu-btn" data-node-menu title="Aktionen" aria-label="Aktionen">⋯</button></summary>
        <div class="cb-node-body">${this._level(cb, links, n.id)}</div>
      </details>`).join('')
      + entries.map((l) => this._linkCard(l, `
          <button type="button" class="btn btn-secondary btn-sm" data-live>📡 Live</button>
          <button type="button" class="btn btn-secondary btn-sm" data-overview>📊 Ergebnisse</button>
          ${l.active ? '<button type="button" class="btn btn-secondary btn-sm" data-active="off" title="Schüler sehen das Lernthema nicht mehr; Ergebnisse bleiben">⏸ Ausblenden</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-active="on">▶ Wieder zeigen</button>'}`, this._availHtml(l))).join('');
    return html || (parentId ? '<p class="hint cb-empty">Noch leer – über ⋯ füllen.</p>' : '');
  }

  _nodeMenu(cb, node) {
    const items = [];
    if (node.kind === 'area') {
      items.push({ label: '➕ Neuer Bereich', run: () => this._add('area', node.id) });
      items.push({ label: '➕ Neuer Abschnitt', run: () => this._add('section', node.id) });
    }
    items.push({ label: '➕ Neues Lernthema hier', run: () => this._add('topic', node.id) });
    items.push({ label: '➕ Aus dem Notizbuch hierher', run: () => this._add('assign', node.id) });
    items.push('-');
    items.push({ label: '↑ Nach oben', run: () => this._step('node', node, -1, cb) });
    items.push({ label: '↓ Nach unten', run: () => this._step('node', node, +1, cb) });
    items.push({ label: '↔️ Verschieben nach…', run: () => this._moveDialog(cb, 'node', node) });
    items.push({ label: '✏️ Umbenennen', run: async () => {
      const title = await this._askText('✏️ Umbenennen', node.title);
      if (title) await this._call(this.app.api.renameClassbookNode(this._classId, node.id, title));
    } });
    items.push('-');
    items.push({ label: '🗑 Löschen', danger: true, title: 'Was darin liegt, rückt eine Ebene höher', run: async () => {
      if (!(await this.app.appConfirm(`„${node.title}“ löschen? Was darin liegt, rückt eine Ebene höher – es geht nichts verloren.`))) return;
      await this._call(this.app.api.deleteClassbookNode(this._classId, node.id));
    } });
    return items;
  }

  _entryMenu(cb, link) {
    const own = !!link.classTopicId;
    const items = [];
    if (own) items.push({ label: '➕ Neues Modul', title: 'Neue Module sind zunächst aus – mit ● einschalten', run: () => this.app.modulesView.openFrom('teacher-class-results', link.classTopicId, null) });
    items.push({ label: '↑ Nach oben', run: () => this._step('entry', link, -1, cb) });
    items.push({ label: '↓ Nach unten', run: () => this._step('entry', link, +1, cb) });
    items.push({ label: '↔️ Verschieben nach…', run: () => this._moveDialog(cb, 'entry', link) });
    items.push({ label: '✏️ Umbenennen', run: async () => {
      const title = await this._askText('✏️ Umbenennen', link.name);
      if (title) await this._call(this.app.api.renameClassbookEntry(this._classId, link.id, title));
    } });
    items.push('-');
    items.push(own
      ? { label: '🗑 Lernthema löschen', danger: true, run: async () => {
        if (!(await this.app.appConfirm(`„${link.name}“ samt seinen Modulen löschen? Es gehört nur zu dieser Klasse. Ergebnisse der Schüler bleiben.`))) return;
        await this._call(this.app.api.deleteClassbookEntry(this._classId, link.id));
      } }
      : { label: '🗑 Zuweisung entfernen', danger: true, title: 'Im Notizbuch bleibt alles; Ergebnisse der Schüler bleiben', run: async () => {
        if (!(await this.app.appConfirm(`„${link.name}“ aus dem Klassennotizbuch nehmen? Im Notizbuch bleibt es, Ergebnisse der Schüler bleiben.`))) return;
        await this._call(this.app.api.deleteClassbookEntry(this._classId, link.id));
      } });
    return items;
  }

  /** Aufruf, Fehler melden, neu zeichnen. */
  async _call(promise) {
    const res = await promise;
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return null; }
    this._openLinks = new Set([...this._content.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
    await this._classbook(true);
    this._render();
    return res;
  }

  /** Neuer Bereich/Abschnitt, klasseneigenes Lernthema oder Zuweisung – oben oder in `nodeId`. */
  async _add(what, nodeId) {
    if (what === 'assign') { await this._assign(nodeId); return; }
    if (what === 'topic') {
      const title = await this._askText('➕ Lernthema nur für diese Klasse', '', 'Titel, z. B. „Projektwoche“');
      if (!title) return;
      const res = await this._call(this.app.api.createClassbookTopic(this._classId, title, nodeId));
      if (res && await this.app.appConfirm(`„${title}“ ist angelegt. Gleich ein erstes Modul anlegen?`)) {
        this.app.modulesView.openFrom('teacher-class-results', res.topicId, null);
      }
      return;
    }
    const title = await this._askText(what === 'area' ? '➕ Neuer Bereich' : '➕ Neuer Abschnitt', '', what === 'area' ? 'z. B. „1. Halbjahr“' : 'z. B. „Elektrischer Strom“');
    if (title) await this._call(this.app.api.createClassbookNode(this._classId, what, title, nodeId));
  }

  /** Eine Stelle nach oben/unten unter demselben Elternteil. */
  async _step(type, item, dir, cb) {
    const parentId = type === 'node' ? item.parentId : item.nodeId;
    const siblings = type === 'node'
      ? cb.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
      : cb.links.filter((l) => (l.practice.length || l.classTopicId) && l.nodeId === parentId).sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((s) => s.id === item.id);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= siblings.length) return;
    await this._call(this.app.api.moveInClassbook(this._classId, { type, id: item.id, parentId, index: to }));
  }

  /** Ziel wählen: oben oder ein Bereich/Abschnitt (Bereiche nicht in Abschnitte oder sich selbst). */
  async _moveDialog(cb, type, item) {
    const inside = (id, anc) => { for (let n = cb.nodes.find((x) => x.id === id); n; n = cb.nodes.find((x) => x.id === n.parentId)) if (n.id === anc) return true; return false; };
    const rows = [{ id: null, label: `📒 ${cb.className} (oberste Ebene)`, depth: 0 }];
    const walk = (parentId, depth) => {
      for (const n of cb.nodes.filter((x) => x.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)) {
        const blocked = type === 'node' && (n.kind === 'section' || inside(n.id, item.id));
        rows.push({ id: n.id, label: `${NODE_ICON[n.kind]} ${n.title}`, depth, blocked });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 1);
    const picked = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `<div class="import-modules-card cb-picker" role="dialog" aria-modal="true">
        <h3>↔️ Verschieben – ${escapeHtml(type === 'node' ? item.title : item.name)}</h3>
        <ul class="cb-picker-list">${rows.map((r, i) => `<li style="padding-left:${0.4 + r.depth * 1.2}rem">
          <button type="button" class="cb-picker-row" data-i="${i}" ${r.blocked ? 'disabled' : ''}>${escapeHtml(r.label)}</button></li>`).join('')}</ul>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary cb-picker-cancel">Abbrechen</button></div></div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.cb-picker-cancel').addEventListener('click', () => done(undefined));
      overlay.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => done(rows[Number(b.dataset.i)])));
    });
    if (!picked) return;
    await this._call(this.app.api.moveInClassbook(this._classId, { type, id: item.id, parentId: picked.id, index: null }));
  }

  _menu(items, anchor) {
    document.querySelector('.nb-menu.cb-popup')?.remove();
    const menu = document.createElement('div');
    menu.className = 'nb-menu cb-popup';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      if (item === '-') { menu.appendChild(Object.assign(document.createElement('hr'), { className: 'nb-menu-sep' })); continue; }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.className = item.danger ? 'nb-menu-item danger' : 'nb-menu-item';
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        Promise.resolve(item.run()).catch((err) => this.app.showToast('Fehler: ' + err.message, 'error'));
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const a = anchor.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(a.right - r.width, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${a.bottom + r.height > window.innerHeight - 8 ? Math.max(8, a.top - r.height) : a.bottom}px`;
    menu.querySelector('button')?.focus();
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.remove(); });
  }

  /** Kleiner Eingabedialog – Text oder null. */
  _askText(title, value = '', placeholder = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay cb-ask';
      overlay.innerHTML = `<form class="import-modules-card" role="dialog" aria-modal="true" style="max-width:480px">
        <h3>${escapeHtml(title)}</h3>
        <input type="text" class="search-input" style="width:100%" maxlength="200" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" required>
        <div class="confirm-actions"><button type="submit" class="btn btn-primary">OK</button>
          <button type="button" class="btn btn-secondary" data-cancel>Abbrechen</button></div></form>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('input');
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      input.focus();
      input.select();
    });
  }

  _switch(tab) {
    this._tab = tab;
    savePref('lm_cr_tab', tab);
    this._render();
  }

  /** Lernthema oder Knoten aus dem Notizbuch als Klassenlink dieser Klasse. */
  async _assign(nodeId = null) {
    const picked = await this._pickFromNotebook('➕ Der Klasse zuweisen',
      'Ein Lernthema oder einen ganzen Bereich wählen. Was später dazukommt, erscheint hier ausgeschaltet – du schaltest es ein, wenn es so weit ist.');
    if (!picked) return;
    const res = await this.app.api.assignToClassbook(this._classId, picked.type, picked.id, nodeId);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Zuweisen fehlgeschlagen'), 'error'); return; }
    if (res.existed) this.app.showToast(`„${picked.title}“ ist schon zugewiesen – Neues steht ausgeschaltet bereit.`, 'info');
    else if (res.notReleased?.length) this.app.showToast(`Nicht freigegeben, daher nicht dabei: ${res.notReleased.join(', ')}.`, 'info');
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
