import { escapeHtml, escapeAttr, copyClassbookOneNote, copyQrSvgAsPng, copyShareSheetAsPng } from '../utils.js';
import { openTagDialog } from './tags.js';

// ==================== KLASSENNOTIZBUCH (LEHRKRAFT) ====================
//
// Je Klasse die Bereiche des Klassennotizbuchs (docs/klassennotizbuch.md):
// Inhaltsübersicht (die Klassenlinks als Zuweisungen, mit 🔒 für die Lehrkraft),
// Klassenarbeiten, Schülerdaten, Ergebnisübersicht, Quiz-Arena, Live und der
// Klassenbuch-Link. Früher hieß die Ansicht „Klassenergebnisse“ – deren
// Reiter leben in Schülerdaten und Ergebnisübersicht weiter.

const failed = (res) => !res || res.statusCode >= 400;
const MODE_LABELS = {
  app: '🧩 von der App gemeldet',
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

const TABS = ['content', 'exams', 'students', 'overview', 'contest', 'live', 'settings'];
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
   * Live: Wer arbeitet gerade woran? Vorgabe „Alle Zuweisungen“ – je Schüler
   * sein aktueller Durchlauf: Zuweisung, Lernmodul, Fortschritt. Mit einer
   * gewählten Zuweisung die Tabelle Schüler × Aufgaben. ✓ bearbeitet,
   * ⤼ übersprungen (Weiter ohne Eingabe), ▶ gerade dran; ✍️ wer in den letzten
   * Minuten mit dem Stift schreibt. Frischt sich alle 5 Sekunden auf, solange
   * der Reiter offen ist.
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
    if (this._liveLink !== '*' && !links.has(this._liveLink)) this._liveLink = '*';
    const all = this._liveLink === '*';
    const inkBy = new Map();
    for (const w of live.ink) {
      if (now - new Date(w.updatedAt).getTime() > 10 * 60 * 1000) continue;
      if (!inkBy.has(w.studentId) || new Date(inkBy.get(w.studentId).updatedAt) < new Date(w.updatedAt)) inkBy.set(w.studentId, w);
    }
    const ago = (d) => {
      const m = Math.round((now - new Date(d).getTime()) / 60000);
      return m < 1 ? 'gerade' : m < 60 ? `vor ${m} min` : `vor ${Math.round(m / 60)} h`;
    };
    // Stand einer Aufgabe: ✓ bearbeitet, ⤼ übersprungen, ▶ gerade dran.
    const stepState = (r, i) => {
      if (i === r.done && !r.finishedAt) return 'now';
      const st = r.states?.[i];
      if (st === 'd') return 'done';
      if (st === 's') return 'skip';
      if (st === 'p') return 'part';
      // Ältere Meldungen ohne Stand je Aufgabe: alles davor zählt als bearbeitet.
      return !r.states?.length && i < r.done ? 'done' : '';
    };
    // HTML-App: aktueller und bisher besuchte Abschnitte. Titel stammen aus dem Steckbrief, also escapen.
    const appLine = (r) => {
      const units = r.appUnits?.units || {};
      const active = r.appUnits?.active;
      const unit = units[active];
      const parts = [];
      if (unit) parts.push(`🧩 ${escapeHtml(unit.title || '')}${unit.total ? ` ${Number(unit.done) || 0}/${Number(unit.total)}` : ''}`);
      const seen = Object.entries(units).filter(([id, u]) => u.seen && id !== active).map(([, u]) => escapeHtml(u.title || ''));
      if (seen.length) parts.push(`besucht: ${seen.join(', ')}`);
      return parts.length ? `<br><span class="hint">${parts.join(' · ')}</span>` : '';
    };
    const CELL = { done: ['cr-live-done', 'bearbeitet', '✓'], skip: ['cr-live-skip', 'übersprungen (Weiter ohne Eingabe)', '⤼'],
      part: ['cr-live-part', 'teilweise – von den Quizzen im Dokument nur ein Teil bearbeitet', '◐'], now: ['cr-live-now', 'gerade dran', '▶'] };
    const cell = (r, i) => {
      const c = r && CELL[stepState(r, i)];
      return c ? `<td class="${c[0]}" title="${c[1]}">${c[2]}</td>` : '<td></td>';
    };
    const counts = (r) => {
      const n = r.steps.map((_, i) => stepState(r, i));
      return { done: n.filter((x) => x === 'done').length, skip: n.filter((x) => x === 'skip' || x === 'part').length };
    };
    const progress = (r) => {
      if (r.finishedAt) {
        const c = counts(r);
        return `✅ fertig${c.skip ? ` <span class="cr-live-skip-note">⤼ ${c.skip} übersprungen</span>` : ''} <span class="hint">${escapeHtml(ago(r.finishedAt))}</span>`;
      }
      const c = counts(r);
      return `${c.done}/${r.steps.length}${c.skip ? ` <span class="cr-live-skip-note">⤼ ${c.skip}</span>` : ''} <span class="hint">${escapeHtml(ago(r.updatedAt))}</span>`;
    };
    // Kleine Leiste je Aufgabe (Übersicht): Titel beim Darüberfahren.
    const strip = (r) => `<span class="cr-live-strip">${r.steps.map((t, i) => {
      const st = stepState(r, i);
      return `<i class="${st ? `cr-strip-${st}` : ''}" title="${escapeAttr(`${i + 1}. ${t}${{ skip: ' – übersprungen', part: ' – teilweise (Quizze im Dokument)', done: ' – bearbeitet', now: ' – gerade dran' }[st] || ''}`)}"></i>`;
    }).join('')}</span>`;
    const nameCell = (s) => `<td>${escapeHtml(s.name)}${inkBy.get(s.id) ? ` <span title="schreibt mit dem Stift: ${escapeAttr(inkBy.get(s.id).moduleTitle)}">✍️</span>` : ''}</td>`;
    const known = new Set(live.students.map((s) => s.id));
    const select = `<label>Zuweisung <select class="cr-live-link">
        <option value="*" ${all ? 'selected' : ''}>Alle – wer arbeitet woran?</option>
        ${[...links].map(([id, name]) => `<option value="${escapeAttr(id)}" ${id === this._liveLink ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>`;

    let body = '';
    if (all) {
      // Je Schüler der zuletzt gemeldete Durchlauf (der Server liefert die neuesten zuerst).
      const latest = new Map();
      for (const r of live.runs) if (!latest.has(r.studentId)) latest.set(r.studentId, r);
      const rows = [...live.students, ...[...latest.values()].filter((r) => !known.has(r.studentId)).map((r) => ({ id: r.studentId, name: r.studentName }))];
      const active = [...latest.values()].filter((r) => !r.finishedAt).length;
      body = `
        <div class="cr-works-bar">${select}
          <span class="hint">${latest.size} von ${live.students.length} Schülern dabei · ${active} arbeiten gerade · frischt sich alle 5 s auf</span></div>
        <div class="cr-live-wrap"><table class="cr-live cr-live-all">
          <thead><tr><th>Schüler</th><th>Zuweisung</th><th>Lernmodul gerade</th><th>Fortschritt</th><th>Stand</th></tr></thead>
          <tbody>${rows.map((s) => {
            const r = latest.get(s.id);
            if (!r) return `<tr class="cr-live-absent">${nameCell(s)}<td colspan="4"><span class="hint">noch nicht gestartet</span></td></tr>`;
            const current = `${r.finishedAt ? '<span class="hint">—</span>' : `<strong>${r.done + 1}.</strong> ${escapeHtml(r.steps[r.done] || '')}`}${appLine(r)}`;
            return `<tr>${nameCell(s)}<td>${escapeHtml(r.linkName || 'Zuweisung')}${(live.runs.filter((x) => x.studentId === s.id).length > 1) ? ' <span class="hint" title="hat heute auch andere Zuweisungen bearbeitet">+</span>' : ''}</td>
              <td>${current}</td><td>${strip(r)}</td><td>${progress(r)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="hint">✓ bearbeitet · ◐ teilweise (Quizze im Dokument) · ⤼ übersprungen (Weiter ohne Eingabe) · ▶ gerade dran. Eine Zuweisung oben wählen für alle Aufgaben im Einzelnen.</p>`;
    } else {
      const runs = live.runs.filter((r) => r.linkId === this._liveLink);
      const steps = runs.reduce((longest, r) => (r.steps.length > longest.length ? r.steps : longest), []);
      const byStudent = new Map(runs.map((r) => [r.studentId, r]));
      const rows = [...live.students, ...runs.filter((r) => !known.has(r.studentId)).map((r) => ({ id: r.studentId, name: r.studentName }))];
      const finished = runs.filter((r) => r.finishedAt).length;
      body = `
        <div class="cr-works-bar">${select}
          <span class="hint">${runs.length} von ${live.students.length} Schülern dabei · ${finished} fertig · frischt sich alle 5 s auf</span></div>
        <div class="cr-live-wrap"><table class="cr-live">
          <thead><tr><th>Schüler</th>${steps.map((t, i) => `<th title="${escapeAttr(t)}">${i + 1}</th>`).join('')}<th>Stand</th></tr></thead>
          <tbody>${rows.map((s) => {
            const r = byStudent.get(s.id);
            return `<tr class="${r ? '' : 'cr-live-absent'}">${nameCell(s)}
              ${steps.map((_, i) => cell(r, i)).join('')}<td>${r ? `${progress(r)}${appLine(r)}` : '<span class="hint">noch nicht gestartet</span>'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="hint">✓ bearbeitet · ◐ teilweise (Quizze im Dokument) · ⤼ übersprungen (Weiter ohne Eingabe) · ▶ gerade dran.</p>`;
    }
    this._out.innerHTML = links.size ? body : `<div class="empty-state"><span class="empty-icon">📡</span>
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

  /** Daten des Klassennotizbuchs (Link, Zuweisungen) – einmal je Klasse. */
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
    const mk = this._tab === 'content' ? this._cb?.marker : null;
    const marked = mk?.level === 'link' && mk.linkId === link.id;
    // Inhaltsübersicht: dieselbe Zeile wie im Lernnotizbuch.
    if (this._tab === 'content' && link.available) {
      const only = link.available.length === 1;
      const topicMark = only && mk?.level === 'topic' && mk.linkId === link.id;
      const modules = link.available.flatMap((t) => t.modules);
      const on = modules.filter((m) => m.enabled).length;
      return `<details class="result-group cb-link ${link.active ? '' : 'cb-off'}" data-link="${escapeAttr(link.id)}" ${open}>
        <summary class="${marked || topicMark ? 'cb-marked' : ''}"><span class="cb-twisty" aria-hidden="true"></span>
          <span class="nb-icon" aria-hidden="true">📘</span><span class="cb-row-title" title="${escapeAttr(link.name)}">${escapeHtml(link.name)}</span>
          ${marked || topicMark ? this._markBadge() : ''}
          <span class="nb-meta">${on === modules.length ? `${on} Modul${on === 1 ? '' : 'e'}` : `${on} von ${modules.length} Modulen`}${link.classTopicId ? ' · nur diese Klasse' : ''}</span>
          ${this._reachBadge(link)}
          ${this._groupSwitch(this._stateOf([link]), `data-switch-links="${escapeAttr(link.id)}"`, 'dieser Zuweisung')}${this._linkEye(link)}
          ${body !== null ? '<button type="button" class="nb-menu-btn cb-entry-menu" data-entry-menu title="Aktionen (auch Rechtsklick)" aria-label="Aktionen">⋯</button>' : ''}</summary>
        <div class="cb-link-actions">${buttons}</div>
        ${body ?? this._unitsHtml(link.topics)}
      </details>`;
    }
    return `<details class="result-group cb-link ${link.active ? '' : 'cb-off'}" data-link="${escapeAttr(link.id)}" ${open}>
      <summary class="${marked ? 'cb-marked' : ''}">${this._tab === 'content' && link.available ? this._groupSwitch(this._stateOf([link]), `data-switch-links="${escapeAttr(link.id)}"`, 'dieser Zuweisung') : ''}<span class="result-group-title">${link.classTopicId ? '📘' : '🔗'} ${escapeHtml(link.name)}${link.active ? '' : ' <small class="class-pending-note">deaktiviert</small>'}</span>
        ${marked ? this._markBadge() : ''}
        ${this._tab === 'content' && link.available ? this._linkEye(link) : ''}
        <span class="result-group-meta">${this._tab === 'content' && link.available ? this._reachBadge(link) : `${link.topics.length} Lernthema/-themen · ${n} Modul${n === 1 ? '' : 'e'}`}
          ${this._tab === 'contest'
            ? '<button type="button" class="btn btn-primary btn-sm" data-contest title="Wartebereich öffnen – die Schüler sehen im Klassennotizbuch dann nur noch die Quiz-Arena">🏆 Quiz-Arena starten</button>'
            : link.practice.map((m) => `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[m] || m)}</span>`).join('')}</span>
        ${body !== null && this._tab === 'content' ? '<button type="button" class="nb-menu-btn cb-entry-menu" data-entry-menu title="Aktionen (auch Rechtsklick)" aria-label="Aktionen">⋯</button>' : ''}</summary>
      <div class="cb-link-actions">${buttons}</div>
      ${body ?? this._unitsHtml(link.topics)}
    </details>`;
  }

  _bindActive(out) {
    out.querySelectorAll('[data-active]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.closest('[data-link]').dataset.link;
      const res = await this.app.api.updateLink(id, { active: btn.dataset.active === 'on' });
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      await this._classbook(true);
      this._render();
    }));
  }

  /** 👁 / 🙈 am Lernthema: nur für diese Klasse; auch Link und QR-Code sind dann gesperrt. */
  _linkEye(l) {
    return `<button type="button" class="cb-eye ${l.active ? '' : 'off'}" data-active="${l.active ? 'off' : 'on'}"
      title="${l.active ? 'Für diese Klasse sichtbar – klicken blendet das Lernthema aus und sperrt auch Link und QR-Code; Modulauswahl und Ergebnisse bleiben' : 'Für diese Klasse ausgeblendet, auch Link und QR-Code sind gesperrt – klicken zum Einblenden (alles wie vorher)'}"
      aria-label="${l.active ? 'Ausblenden' : 'Einblenden'}">${l.active ? '👁' : '🙈'}</button>`;
  }

  /** Was Schüler dieser Klasse tatsächlich erreichen – mit Grund, statt nur den eigenen Schalter. */
  _reachBadge(link) {
    const badge = (cls, text, title = text) => `<span class="cb-reach ${cls}" title="${escapeAttr(title)}">${escapeHtml(text)}</span>`;
    const no = (why) => badge('no', `🚫 nicht erreichbar: ${why}`);
    if (!link.active) return no('Lernthema ausgeblendet');
    if (this._cb?.studentHidden) return no('Klassennotizbuch ausgeblendet');
    if (link.veiled) return no('Bereich ausgeblendet');
    const on = (link.available || []).filter((t) => t.enabled);
    if (!on.length) return badge('off', '○ ausgeschaltet', 'Kein Modul ist für diese Klasse eingeschaltet');
    const blocked = on.filter((t) => t.notebookOff);
    if (blocked.length === on.length) return no('im Lernnotizbuch aus');
    const modules = on.filter((t) => !t.notebookOff).flatMap((t) => t.modules.filter((m) => m.enabled));
    const offMods = modules.filter((m) => m.notebookOff);
    if (modules.length && offMods.length === modules.length) return no('im Lernnotizbuch aus');
    if (blocked.length || offMods.length) {
      const names = [...blocked.map((t) => t.title), ...offMods.map((m) => m.title)];
      return badge('part', `⚠️ teilweise: ${names.length} im Lernnotizbuch aus`, names.join(', '));
    }
    return badge('ok', '✅ für Schüler erreichbar');
  }

  /** Schaltzustand mehrerer Zuweisungen: 'on' (alle Module an), 'off' (keins) oder 'part'. */
  _stateOf(links) {
    const mods = links.flatMap((l) => (l.available || []).flatMap((t) => t.modules));
    const on = mods.filter((m) => m.enabled).length;
    return !mods.length || !on ? 'off' : on === mods.length ? 'on' : 'part';
  }

  /** Schalter für eine Gruppe: ● alles an, ◐ teilweise, ○ alles aus – ein Klick schaltet alles darunter. */
  _groupSwitch(state, attrs, what) {
    const sym = { on: '●', part: '◐', off: '○' }[state];
    const title = { on: `Alles in ${what} ist für die Schüler an – klicken schaltet alles aus`,
      part: `Teilweise an – klicken schaltet alles in ${what} ein`,
      off: `Alles in ${what} ist aus – klicken schaltet alles ein` }[state];
    return `<button type="button" class="nb-status cb-group-switch ${state === 'off' ? '' : 'on'} ${state === 'part' ? 'part' : ''}" data-state="${state}" ${attrs}
      title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">${sym}</button>`;
  }

  /** Inhalt einer Zuweisung mit Schaltern: ● an (Schüler sehen es), ○ aus – auch Neues, das dazugekommen ist. */
  _availHtml(link) {
    const sw = (on, attrs, what) => `<button type="button" class="nb-status ${on ? 'on' : ''}" ${attrs}
      title="${on ? `Schüler sehen ${what} – klicken zum Ausschalten` : `Ausgeschaltet – klicken, damit die Schüler ${what} sehen`}">${on ? '●' : '○'}</button>`;
    const mk = this._cb?.marker;
    const topicMarked = (t) => mk?.level === 'topic' && mk.linkId === link.id && mk.topicId === t.topicId;
    return `${link.available.map((t) => `<div class="cb-topic ${t.enabled ? '' : 'cb-item-off'}" data-topic="${escapeAttr(t.topicId)}">
        ${link.available.length === 1 ? '' : `<div class="cb-topic-title ${topicMarked(t) ? 'cb-marked' : ''}"><span class="nb-icon" aria-hidden="true">📘</span> <span class="cb-row-title">${escapeHtml(t.title)}</span>${t.notebookOff ? ' <span class="cb-reach no">🚫 im Lernnotizbuch aus</span>' : ''} ${sw(t.enabled, 'data-toggle-topic', 'dieses Lernthema')}
          ${topicMarked(t) ? this._markBadge() : ''}
          <button type="button" class="nb-menu-btn" data-topic-menu title="Aktionen" aria-label="Aktionen">⋯</button></div>`}
        <ul class="cb-units">${t.modules.map((m) => {
          const marked = mk?.level === 'module' && mk.linkId === link.id && mk.moduleId === m.id;
          return `<li class="${m.enabled ? '' : 'cb-item-off'} ${marked ? 'cb-marked' : ''}">
          <button type="button" class="cb-unit" data-open-module="${escapeAttr(m.id)}" title="${link.classTopicId === t.topicId ? 'Bearbeiten' : 'Vorschau'}">${TYPE_ICON[m.type] || '🧩'} ${escapeHtml(m.title || 'Modul')}</button>
          <span class="nb-meta">${escapeHtml((typeof H5P_TYPES !== 'undefined' && H5P_TYPES[m.type]?.name) || '')}</span>
          ${m.notebookOff ? '<span class="cb-reach no">🚫 im Lernnotizbuch aus</span>' : ''}
          ${m.viaDoc ? '<span class="nb-status on cb-via-doc" title="In ein eingeschaltetes Dokument eingebettet – kommt mit ihm. Mit ○ am Dokument ist es aus.">●</span>'
            : sw(m.enabled, `data-toggle-module="${escapeAttr(m.id)}"`, 'dieses Modul')}
          ${m.hasSolutions ? `<button type="button" class="cb-mark ${m.solutionsOn ? 'on' : ''}" data-solution="${escapeAttr(m.id)}" data-on="${m.solutionsOn ? '1' : ''}"
            title="${m.solutionsOn ? 'Die Schüler dieser Klasse sehen die Lösungen – klicken zum Verbergen' : 'Lösungen für diese Klasse zeigen'}" aria-label="Lösungen">💡</button>` : ''}
          ${m.enabled ? `<button type="button" class="cb-mark ${marked ? 'on' : ''}" data-mark="${escapeAttr(m.id)}"
            title="${marked ? 'Hier ist die Klasse gerade – klicken zum Entfernen' : 'Merker: Hier ist die Klasse gerade. Bei den Schülern ist dieses Modul dann aufgeklappt und hat den Fokus.'}">📍</button>` : ''}
          ${(link.releasedModuleIds || []).includes(m.id) ? `<button type="button" class="btn btn-secondary btn-sm" data-release="${escapeAttr(m.id)}" data-on="1" title="Nur für diese Klasse freigegeben – klicken sperrt wieder">🔒 Wieder sperren</button>` : ''}
          <button type="button" class="nb-menu-btn" data-module-menu="${escapeAttr(m.id)}" title="Aktionen" aria-label="Aktionen">⋯</button></li>`;
        }).join('')}
        ${(t.lockedModules || []).filter((m) => !m.releasedHere).map((m) => `<li class="cb-item-off cb-locked" title="Schüler sehen das nicht, auch nicht über „Alles“">
          <span>🔒 <button type="button" class="cb-unit" data-open-module="${escapeAttr(m.id)}">${TYPE_ICON[m.type] || '📄'} ${escapeHtml(m.title)}</button>
            <span class="hint">nur für dich</span></span>
          ${t.mayRelease ? `<button type="button" class="btn btn-secondary btn-sm" data-release="${escapeAttr(m.id)}" title="Nur diese Klasse sieht es, etwa die Lösungen oder die Klassenarbeit zur Besprechung">🔓 Für diese Klasse freigeben</button>` : ''}
        </li>`).join('')}</ul>
      </div>`).join('')}
      ${link.notReleased?.length ? `<p class="hint">Im Notizbuch noch nicht für Schüler freigegeben, daher nicht wählbar: ${escapeHtml(link.notReleased.join(', '))}.</p>` : ''}`;
  }

  /** 📍 im Baum dort, wo der Merker steht (Bereich, Abschnitt, Zuweisung, Lernthema, ganz vorn). */
  _markBadge() {
    return '<button type="button" class="cb-mark on" data-unmark title="Hier ist die Klasse gerade – klicken zum Entfernen" aria-label="Merker entfernen">📍</button>';
  }

  /** 📍 Merker setzen – auf jeder Ebene (siehe setClassbookMarker), aus den ⋯-Menüs und dem Buch-Button. */
  _setMarker(anchor) {
    return this._call(this.app.api.setClassbookMarker(this._classId, anchor));
  }

  _bindMarker(out) {
    out.querySelectorAll('[data-mark], [data-unmark]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.preventDefault();
      const off = btn.hasAttribute('data-unmark') || btn.classList.contains('on');
      if (off) { void this._setMarker({}); return; }
      const linkId = btn.closest('[data-link]').dataset.link;
      const topicId = btn.closest('[data-topic]').dataset.topic;
      void this._setMarker({ level: 'module', linkId, topicId, moduleId: btn.dataset.mark });
    }));
  }

  /** Wo der Merker steht – auf jeder Ebene: Text für die Merker-Leiste, ggf. die Zuweisung zum Aufklappen. */
  _markerInfo(cb) {
    const mk = cb.marker;
    if (!mk) return null;
    if (mk.level === 'root') return { label: 'ganz vorn im Klassennotizbuch' };
    if (mk.level === 'node') {
      const node = cb.nodes.find((n) => n.id === mk.nodeId);
      return { label: node ? `${node.kind === 'section' ? 'Abschnitt' : 'Bereich'} „${node.title}“` : 'einem Bereich, der nicht mehr existiert' };
    }
    const link = cb.links.find((l) => l.id === mk.linkId);
    if (!link) return { label: 'einer Zuweisung, die nicht mehr existiert' };
    if (mk.level === 'link') return { label: link.name, linkId: link.id };
    const topic = link.available.find((t) => t.topicId === mk.topicId);
    if (mk.level === 'topic') return { label: topic ? `${link.name} → „${topic.title}“` : link.name, linkId: link.id };
    const mod = topic?.modules.find((m) => m.id === mk.moduleId);
    return mod
      ? { label: mod.title || 'Modul', hint: `(${link.name})${mod.enabled && link.active ? '' : ' – für die Schüler gerade ausgeschaltet'}`, linkId: link.id }
      : { label: 'einem Modul, das nicht mehr existiert' };
  }

  _bindToggles(out) {
    out.querySelectorAll('[data-switch-links]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = btn.dataset.switchLinks.split(',').filter(Boolean);
      const res = await this.app.api.setClassbookLinks(this._classId, ids, btn.dataset.state !== 'on');
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this._openLinks = new Set([...out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
      await this._classbook(true);
      this._render();
    }));
    out.querySelectorAll('[data-release]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const linkId = btn.closest('[data-link]').dataset.link;
      const res = await this.app.api.setClassbookRelease(this._classId, linkId, btn.dataset.release, !btn.dataset.on);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this.app.showToast(res.on ? 'Diese Klasse sieht es jetzt.' : 'Wieder gesperrt.', 'success');
      this._openLinks = new Set([...out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
      await this._classbook(true);
      this._render();
    }));
    out.querySelectorAll('[data-solution]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const linkId = btn.closest('[data-link]').dataset.link;
      const res = await this.app.api.setClassbookSolutions(this._classId, linkId, btn.dataset.solution, !btn.dataset.on);
      if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
      this.app.showToast(res.on ? 'Die Schüler dieser Klasse sehen jetzt die Lösungen.' : 'Lösungen wieder verborgen.', 'success');
      this._openLinks = new Set([...out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
      await this._classbook(true);
      this._render();
    }));
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
      const links = cb.links.filter((l) => (l.practice.length || l.classTopicId) && l.inTree !== false);
      const mk = this._markerInfo(cb);
      if (mk?.linkId) (this._openLinks ||= new Set()).add(mk.linkId);
      const live = cb.live || { online: 0, follow: false };
      out.innerHTML = `
        <div class="cb-live-bar">
          <span title="Schüler-Geräte, die das Klassennotizbuch gerade offen haben (App oder Browser)">📶 ${live.online} ${live.online === 1 ? 'Gerät' : 'Geräte'} verbunden</span>
          <button type="button" class="btn btn-sm ${live.follow ? 'btn-primary' : 'btn-secondary'}" data-follow="${live.follow ? 'off' : 'on'}"
            title="${live.follow ? 'Folgen ausschalten – die Schüler bewegen sich wieder selbst' : 'Folgen: Wo du 📍 setzt, öffnet sich das Modul auf allen Schüler-Geräten'}">👣 Folgen: ${live.follow ? 'an' : 'aus'}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-live-refresh title="Anzahl neu zählen">🔄</button>
          <span class="hint">${live.follow ? (cb.marker ? '📍 umsetzen = alle springen dorthin.' : 'Jetzt 📍 setzen (Modul, Lernthema, Zuweisung oder Bereich) – dorthin springen alle.') : '📡 im Menü ⋯ eines Moduls öffnet es bei allen.'}</span>
        </div>
        ${mk ? `<div class="cb-marker-bar">📍 Die Klasse ist gerade bei <strong>${escapeHtml(mk.label)}</strong>
            ${mk.hint ? `<span class="hint">${escapeHtml(mk.hint)}</span>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" data-unmark>Entfernen</button></div>`
          : '<p class="hint">📍 markiert, wo die Klasse gerade ist – auf jeder Ebene (Bereich, Zuweisung, Lernthema oder Modul). Bei den Schülern springt „Weiter“ von dort durch alle weiteren Module.</p>'}
        ${cb.studentHidden ? `<div class="cb-veiled-bar">🙈 <strong>Das ganze Klassennotizbuch ist für Schüler ausgeblendet</strong>
            <span class="hint">– sie sehen nur eine laufende Klassenarbeit bzw. die Quiz-Arena. Die Module bleiben, wie sie sind.</span>
            <button type="button" class="btn btn-primary btn-sm" data-veil-book="">👁 Wieder einblenden</button></div>` : ''}
        <div class="cr-works-bar">
          ${links.length ? `<span class="cb-all-switch">${this._groupSwitch(this._stateOf(links), `data-switch-links="${escapeAttr(links.map((l) => l.id).join(','))}"`, 'diesem Klassennotizbuch')} Alles</span>` : ''}
          <button type="button" class="btn btn-primary btn-sm" data-add="assign" title="Lernthema, Abschnitt, Bereich oder Book aus deinem Notizbuch – als Verweis">➕ Aus dem Notizbuch</button>
          <button type="button" class="btn btn-secondary btn-sm" data-arrange title="Einträge an ihren Platz wie im Notizbuch verschieben und sortieren. Inhalte, Links und An/Aus bleiben.">🌳 Wie im Notizbuch ordnen</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="topic" title="Lernthema nur für diese Klasse, z. B. Aufgaben oder Dokumente">➕ Lernthema</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="area">➕ Bereich</button>
          <button type="button" class="btn btn-secondary btn-sm" data-add="section">➕ Abschnitt</button>
          <button type="button" class="btn btn-secondary btn-sm" data-mark-root title="Schüler springen zum ersten Modul im ganzen Klassennotizbuch – „Weiter“ führt durch alle weiteren">📍 Ganz vorn</button>
          ${cb.studentHidden ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-veil-book="1" title="Schüler sehen das Klassennotizbuch vorübergehend nicht (außer Klassenarbeit und Quiz-Arena) – die Module bleiben ein- bzw. ausgeschaltet">🙈 Für Schüler ausblenden</button>'}
        </div>
        <p class="hint">Die Schüler sehen diesen Baum über den <a href="#" id="cbToSettings">Klassenbuch-Link</a>. Einträge verweisen aufs Notizbuch
          (Änderungen dort gelten sofort), außer mit „nur diese Klasse“. ● / ○ schaltet Lernthemen und Module ein und aus –
          was später dazukommt, ist zunächst aus. 👁 / 🙈 blendet ein Lernthema, einen Bereich oder Abschnitt für Schüler aus (auch Link und QR-Code sind dann gesperrt), ohne die Module
          zu schalten. Aktionen über ⋯.</p>
        <div class="cb-tree">${cb.marker?.level === 'root' ? `<div class="cb-book-mark cb-marked">${this._markBadge()} 📒 <strong>${escapeHtml(cb.className)}</strong> <span class="hint">ganz vorn im Klassennotizbuch</span></div>` : ''}${links.length || cb.nodes.length ? this._level(cb, links, null)
          : `<div class="empty-state"><span class="empty-icon">📋</span>
              <p>Noch leer. Weise aus deinem Notizbuch Lernthemen oder ganze Bereiche zu, lege eigene Lernthemen für diese Klasse an
                und ordne alles in Bereichen und Abschnitten.</p></div>`}</div>`;
      out.querySelector('#cbToSettings')?.addEventListener('click', (e) => { e.preventDefault(); this._switch('settings'); });
      out.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => this._add(btn.dataset.add, null)));
      out.querySelector('[data-arrange]')?.addEventListener('click', () => this._arrange());
      out.querySelector('[data-mark-root]')?.addEventListener('click', () => this._setMarker({ level: 'root' }));
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
      // Rechtsklick auf die Zeile eines Bereichs, Abschnitts oder Lernthemas: dasselbe Menü wie ⋯.
      out.querySelectorAll('details[data-node] > summary, details[data-link] > summary').forEach((sum) => sum.addEventListener('contextmenu', (e) => {
        const btn = sum.querySelector(':scope > [data-node-menu], :scope > [data-entry-menu]');
        if (!btn) return;
        e.preventDefault();
        btn.click();
      }));
      this._bindDrag(out, cb, links);
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
      // ⋯ oder Rechtsklick an Lernthema und Modul: Bearbeiten (auch das Original im Notizbuch), Vorschau, Tags.
      const itemMenu = (el, anchor) => {
        const link = cb.links.find((l) => l.id === el.closest('[data-link]').dataset.link);
        const topic = link?.available.find((t) => t.topicId === el.closest('[data-topic]').dataset.topic);
        if (!topic) return;
        const modId = el.closest('li')?.querySelector('[data-module-menu]')?.dataset.moduleMenu;
        const mod = modId && topic.modules.find((m) => m.id === modId);
        this._menu(mod ? this._moduleMenu(link, topic, mod) : this._topicMenu(link, topic), anchor);
      };
      out.querySelectorAll('[data-module-menu], [data-topic-menu]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        itemMenu(btn, btn);
      }));
      out.querySelectorAll('.cb-units > li, .cb-topic-title').forEach((row) => row.addEventListener('contextmenu', (e) => {
        if (!row.querySelector('[data-module-menu], [data-topic-menu]')) return;
        e.preventDefault();
        itemMenu(row, row.querySelector('[data-module-menu], [data-topic-menu]'));
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
      out.querySelectorAll('[data-veil-node]').forEach((btn) => btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // nicht auf- und zuklappen
        void this._setVeil({ type: 'node', id: btn.dataset.veilNode, hidden: !btn.dataset.hidden });
      }));
      out.querySelectorAll('[data-veil-book]').forEach((btn) => btn.addEventListener('click', () => {
        void this._setVeil({ type: 'book', hidden: !!btn.dataset.veilBook });
      }));
      out.querySelector('[data-follow]')?.addEventListener('click', async (e) => {
        const on = e.currentTarget.dataset.follow === 'on';
        const res = await this.app.api.setClassbookFollow(this._classId, on);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        const noMarker = on && !this._cb?.marker;
        this.app.showToast(!on ? '👣 Folgen aus.'
          : noMarker ? `👣 Folgen an (${res.reached} ${res.reached === 1 ? 'Gerät' : 'Geräte'}) – setze jetzt 📍 an das Modul, zu dem alle springen sollen.`
            : `👣 Folgen an – ${res.reached} ${res.reached === 1 ? 'Gerät springt' : 'Geräte springen'} zum 📍.`, noMarker ? 'info' : 'success');
        await this._classbook(true);
        this._render();
      });
      out.querySelector('[data-live-refresh]')?.addEventListener('click', async () => { await this._classbook(true); this._render(); });
      out.querySelector('.cb-marked')?.scrollIntoView({ block: 'center' });
    });
  }

  /**
   * Ziehen und Ablegen wie im Notizbuch: Bereiche, Abschnitte und Lernthemen
   * an der Kopfzeile fassen. Oberes/unteres Viertel einer Zeile: davor bzw.
   * dahinter, Mitte eines Bereichs/Abschnitts: hinein.
   */
  _bindDrag(out, cb, links) {
    let drag = null; // { type: 'node'|'entry', id }
    const parentOf = (type, id) => (type === 'node' ? cb.nodes.find((n) => n.id === id)?.parentId : links.find((l) => l.id === id)?.nodeId) ?? null;
    const siblings = (type, parentId) => (type === 'node'
      ? cb.nodes.filter((n) => (n.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
      : links.filter((l) => (l.nodeId ?? null) === parentId).sort((a, b) => a.order - b.order)).map((x) => x.id);
    const targetOf = (sum) => {
      const d = sum.parentElement;
      return d.dataset.node ? { type: 'node', id: d.dataset.node } : { type: 'entry', id: d.dataset.link };
    };
    const clear = () => out.querySelectorAll('.nb-drop-into, .nb-drop-before, .nb-drop-after').forEach((el) => el.classList.remove('nb-drop-into', 'nb-drop-before', 'nb-drop-after'));
    /** Wohin es fällt: { zone, parentId, index } – oder null, wenn es dort nicht hingehört. */
    const placeFor = (sum, e) => {
      const t = targetOf(sum);
      if (!drag || (t.type === drag.type && t.id === drag.id)) return null;
      const r = sum.getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      const zone = t.type === 'node' && f > 0.25 && f < 0.75 ? 'into' : f < 0.5 ? 'before' : 'after';
      const sectionAt = (id) => !!id && cb.nodes.find((n) => n.id === id)?.kind === 'section';
      if (zone === 'into') {
        // Ein Abschnitt enthält nur Lernthemen (in sich selbst prüft der Server).
        if (drag.type === 'node' && sectionAt(t.id)) return null;
        return { zone, parentId: t.id, index: null };
      }
      const parentId = parentOf(t.type, t.id);
      if (drag.type === 'node' && sectionAt(parentId)) return null;
      if (t.type !== drag.type) {
        // Bereiche stehen vor den Lernthemen: Ein Lernthema an einem Bereich kommt an den Anfang, ein Bereich an einem Lernthema ans Ende.
        return { zone, parentId, index: drag.type === 'entry' ? 0 : null };
      }
      const rest = siblings(t.type, parentId).filter((id) => id !== drag.id);
      const at = rest.indexOf(t.id);
      return { zone, parentId, index: zone === 'after' ? at + 1 : at };
    };
    out.querySelectorAll('details[data-node] > summary, details[data-link] > summary').forEach((sum) => {
      sum.draggable = true;
      sum.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        drag = targetOf(sum);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', drag.id);
        sum.classList.add('cb-dragging');
      });
      sum.addEventListener('dragend', () => { drag = null; sum.classList.remove('cb-dragging'); clear(); });
      sum.addEventListener('dragover', (e) => {
        const place = placeFor(sum, e);
        if (!place) return;
        e.preventDefault();
        e.stopPropagation();
        clear();
        sum.classList.add(`nb-drop-${place.zone}`);
      });
      sum.addEventListener('dragleave', () => sum.classList.remove('nb-drop-into', 'nb-drop-before', 'nb-drop-after'));
      sum.addEventListener('drop', async (e) => {
        const place = placeFor(sum, e);
        clear();
        if (!place) return;
        e.preventDefault();
        e.stopPropagation();
        const item = drag;
        drag = null;
        if (place.zone === 'into') this._closedNodes?.delete(place.parentId);
        await this._call(this.app.api.moveInClassbook(this._classId, { type: item.type, id: item.id, parentId: place.parentId, index: place.index }));
      });
    });
  }

  /** Eine Ebene des Baums: erst Bereiche/Abschnitte, dann die Lernthemen darin. */
  /** 👁 / 🙈 an einem Bereich oder Abschnitt: für Schüler ein- bzw. ausblenden, ohne die Module zu schalten. */
  _veilButton(n) {
    const what = n.kind === 'section' ? 'Abschnitt' : 'Bereich';
    return `<button type="button" class="cb-eye ${n.studentHidden ? 'off' : ''}" data-veil-node="${escapeAttr(n.id)}" data-hidden="${n.studentHidden ? '1' : ''}"
      title="${n.studentHidden ? `Für Schüler ausgeblendet – klicken zum Einblenden (alles wie vorher)` : `Für Schüler sichtbar – klicken blendet den ${what} mit allem darin aus; die Module bleiben, wie sie sind`}"
      aria-label="${n.studentHidden ? 'Einblenden' : 'Ausblenden'}">${n.studentHidden ? '🙈' : '👁'}</button>`;
  }

  async _setVeil(body) {
    const res = await this.app.api.setClassbookVisibility(this._classId, body);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this._openLinks = new Set([...this._out.querySelectorAll('details[data-link][open]')].map((d) => d.dataset.link));
    await this._classbook(true);
    this._render();
  }

  _level(cb, links, parentId) {
    const nodes = cb.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    const entries = links.filter((l) => l.nodeId === parentId).sort((a, b) => a.order - b.order);
    const count = (id) => links.filter((l) => l.nodeId === id).length + cb.nodes.filter((n) => n.parentId === id).reduce((s, n) => s + count(n.id), 0);
    const under = (id) => [...links.filter((l) => l.nodeId === id), ...cb.nodes.filter((n) => n.parentId === id).flatMap((n) => under(n.id))];
    const marked = (n) => cb.marker?.level === 'node' && cb.marker.nodeId === n.id;
    const kids = (id) => cb.nodes.filter((n) => n.parentId === id).length;
    const html = nodes.map((n) => `<details class="cb-node ${n.studentHidden ? 'cb-veiled' : ''}" data-node="${escapeAttr(n.id)}" ${this._closedNodes?.has(n.id) ? '' : 'open'}>
        <summary class="${marked(n) ? 'cb-marked' : ''}"><span class="cb-twisty" aria-hidden="true"></span>
          <span class="nb-icon" aria-hidden="true">${NODE_ICON[n.kind]}</span><span class="cb-node-title cb-row-title" title="${escapeAttr(n.title)}">${escapeHtml(n.title)}</span>
          ${marked(n) ? this._markBadge() : ''}
          <span class="nb-meta">${kids(n.id) ? `${kids(n.id)} Unterordner · ` : ''}${count(n.id)} Lernthem${count(n.id) === 1 ? 'a' : 'en'}</span>
          ${n.studentHidden ? '<span class="cb-veiled-badge" title="Schüler sehen diesen Bereich mit allem darin nicht, auch Link und QR-Code sind gesperrt – die Module bleiben ein- bzw. ausgeschaltet">🙈 für Schüler ausgeblendet</span>' : ''}
          ${under(n.id).length ? this._groupSwitch(this._stateOf(under(n.id)), `data-switch-links="${escapeAttr(under(n.id).map((l) => l.id).join(','))}"`, n.kind === 'section' ? 'diesem Abschnitt' : 'diesem Bereich') : ''}${this._veilButton(n)}
          <button type="button" class="nb-menu-btn" data-node-menu title="Aktionen" aria-label="Aktionen">⋯</button></summary>
        <div class="cb-node-body">${this._level(cb, links, n.id)}</div>
      </details>`).join('')
      + entries.map((l) => this._linkCard(l, `
          <button type="button" class="btn btn-secondary btn-sm" data-live>📡 Live</button>
          <button type="button" class="btn btn-secondary btn-sm" data-overview>📊 Ergebnisse</button>`, this._availHtml(l))).join('');
    return html || (parentId ? '<p class="hint cb-empty">Noch leer – über ⋯ füllen.</p>' : '');
  }

  _nodeMenu(cb, node) {
    const items = [];
    // Ein Link für alles darin – aus dem Notizbuch übernommene Bereiche haben ihren Quick-Link dort.
    if (node.sourceNodeId) {
      items.push({ label: '🔗 Quick-Link (Link & QR)', title: 'Ein Link und QR-Code für alle Lernthemen darin – für diese Klasse, Schüler starten gleich mit ihrem Namen',
        run: async () => {
          // Klassenlink des Notizbuch-Bereichs für diese Klasse (wie der Quick-Link mit vorgewählter Klasse).
          const res = await this.app.api.classLinkFromNotebookNode(node.sourceNodeId, this._classId);
          if (failed(res) || !res?.id) { this.app.showToast('Fehler: ' + (res?.message || 'Link nicht erzeugt'), 'error'); return; }
          await this.app.linksView._openShareDialog({ id: res.id, name: node.title }, 'practice');
        } });
    } else {
      items.push({ label: '🔗 Quick-Link (nur für Notizbuch-Bereiche)', title: 'Selbst angelegte Bereiche haben keinen eigenen Link – die Lernthemen darin schon (⋯ am Lernthema)', run: () => {
        this.app.showToast('Selbst angelegte Bereiche haben keinen eigenen Link – die Lernthemen darin schon (⋯ am Lernthema → 🔗 Quick-Link).', 'info');
      } });
    }
    items.push('-');
    if (node.kind === 'area') {
      items.push({ label: '➕ Neuer Bereich', run: () => this._add('area', node.id) });
      items.push({ label: '➕ Neuer Abschnitt', run: () => this._add('section', node.id) });
    }
    items.push({ label: '➕ Neues Lernthema hier', run: () => this._add('topic', node.id) });
    items.push({ label: '➕ Aus dem Notizbuch hierher', run: () => this._add('assign', node.id) });
    items.push('-');
    items.push({ label: '📍 Hier ist die Klasse gerade', title: 'Schüler springen zum ersten Modul darin – „Weiter“ führt durch alle weiteren', run: () => this._setMarker({ level: 'node', nodeId: node.id }) });
    items.push('-');
    items.push(node.studentHidden
      ? { label: '👁 Für Schüler einblenden', title: 'Alles darin ist wieder wie vorher zu sehen', run: () => this._setVeil({ type: 'node', id: node.id, hidden: false }) }
      : { label: '🙈 Für Schüler ausblenden', title: 'Schüler sehen den Bereich mit allem darin nicht – die Module bleiben ein- bzw. ausgeschaltet', run: () => this._setVeil({ type: 'node', id: node.id, hidden: true }) });
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

  /** Menü eines Moduls: Bearbeiten wirkt bei 🔗 auf das Original im Notizbuch. */
  _moduleMenu(link, topic, mod) {
    const open = (action) => this.app.modulesView.openFrom('teacher-class-results', topic.topicId, { id: mod.id }, action);
    const own = link.classTopicId === topic.topicId;
    const items = [{ label: '👁 Vorschau', run: () => open('preview') }];
    // Nur, was die Schüler öffnen dürfen.
    if (mod.enabled && link.active !== false) {
      items.push({ label: '📡 An Klasse senden', title: 'Öffnet das Modul sofort bei allen Schülern, die das Klassennotizbuch offen haben', run: async () => {
        const res = await this.app.api.sendToClassbook(this._classId, link.id, mod.id);
        if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
        this.app.showToast(res.reached ? `📡 An ${res.reached} ${res.reached === 1 ? 'Gerät' : 'Geräte'} gesendet.` : 'Gerade ist kein Schüler-Gerät verbunden.', res.reached ? 'success' : 'info');
      } });
    }
    if (topic.canEdit) {
      items.push({ label: '🔒 Nur Lehrkraft', title: 'Schüler sehen dieses Modul nicht, in keiner Klasse und über keinen Link. Gilt für das Original im Notizbuch.', run: () => this._call(this.app.api.setModuleStudentLock(topic.topicId, mod.id, { teacherOnly: true })) });
    }
    if (topic.canEdit) {
      items.unshift({ label: '✏️ Bearbeiten', title: own ? '' : 'Das Original im Notizbuch – die Änderung gilt überall, wo es zugewiesen ist', run: () => open('edit') });
      items.push({ label: '🏷 Tags…', title: own ? '' : 'Der Tag kommt an das Modul im Notizbuch', run: async () => {
        const ids = await openTagDialog(this.app, { title: mod.title || 'Modul', selected: mod.tagIds || [], inherited: topic.tagIds || [] });
        if (ids) await this._call(this.app.api.saveModule(topic.topicId, { id: mod.id, tagIds: ids }));
      } });
    }
    return items;
  }

  /** Menü eines Lernthemas einer Zuweisung. */
  _topicMenu(link, topic) {
    const own = link.classTopicId === topic.topicId;
    if (!topic.canEdit) return [{ label: '👁 Nur ansehen – erworbenes Lernthema', run: () => this.app.topicsView._openSharedTopicViewer({ id: topic.topicId, title: topic.title }) }];
    return [
      { label: '➕ Neues Modul', title: 'Neue Module sind hier zunächst aus – mit ● einschalten', run: () => this.app.modulesView.openFrom('teacher-class-results', topic.topicId, null) },
      { label: '📦 Module bearbeiten', title: own ? '' : 'Die Module des Originals im Notizbuch', run: () => this.app.modulesView.openTopicModules(topic.topicId) },
      { label: '📍 Hier ist die Klasse gerade', title: 'Schüler springen zum ersten Modul dieses Lernthemas – „Weiter“ führt durch alle weiteren', run: () => this._setMarker({ level: 'topic', linkId: link.id, topicId: topic.topicId }) },
      { label: topic.teacherOnly ? '✓ 🔒 Nur Lehrkraft aufheben' : '🔒 Nur Lehrkraft (ganzes Lernthema)', title: 'Schüler sehen es dann nicht, in keiner Klasse und über keinen Link', run: () => this._call(this.app.api.saveTopic({ id: topic.topicId, teacherOnly: !topic.teacherOnly }, true)) },
      { label: '🏷 Tags…', title: own ? '' : 'Der Tag kommt an das Lernthema im Notizbuch', run: async () => {
        // Geerbte Tags (Book, Bereich, Abschnitt im Notizbuch) bleiben.
        const tree = own ? null : await this.app.api.getNotebooks();
        const inherited = (tree?.placements || []).find((p) => p.topicId === topic.topicId)?.inheritedTagIds || [];
        const ids = await openTagDialog(this.app, { title: topic.title, selected: topic.tagIds || [], inherited });
        if (ids) await this._call(this.app.api.saveTopic({ id: topic.topicId, tagIds: [...new Set([...ids, ...inherited])] }, true));
      } },
    ];
  }

  _entryMenu(cb, link) {
    const own = !!link.classTopicId;
    const items = [];
    // Link und QR-Code dieser Zuweisung – für genau diese Klasse (ohne Klassenauswahl).
    items.push({ label: '🔗 Quick-Link (Link & QR)', title: 'Link und QR-Code für diese Klasse – die Schüler starten gleich mit ihrem Namen',
      run: () => this.app.linksView._openShareDialog({ id: link.id, name: link.name }, 'practice') });
    items.push('-');
    if (own) items.push({ label: '➕ Neues Modul', title: 'Neue Module sind zunächst aus – mit ● einschalten', run: () => this.app.modulesView.openFrom('teacher-class-results', link.classTopicId, null) });
    const clickIn = (sel) => () => document.querySelector(`[data-link="${link.id}"] ${sel}`)?.click();
    items.push({ label: '📡 Live', run: clickIn('[data-live]') });
    items.push({ label: '📊 Ergebnisse', run: clickIn('[data-overview]') });
    // Ein Lernthema: seine Zeile entfällt, deshalb stehen seine Aktionen hier.
    if (link.available?.length === 1) items.push('-', ...this._topicMenu(link, link.available[0]).filter((i) => i === '-' || !String(i.label).startsWith('📍')), '-');
    items.push(link.active
      ? { label: '🙈 Für Schüler ausblenden', title: 'Nur für diese Klasse; auch Link und QR-Code sind dann gesperrt. Modulauswahl und Ergebnisse bleiben', run: () => this._call(this.app.api.updateLink(link.id, { active: false })) }
      : { label: '👁 Für Schüler einblenden', title: 'Alles wieder wie vorher', run: () => this._call(this.app.api.updateLink(link.id, { active: true })) });
    items.push({ label: '📍 Hier ist die Klasse gerade', title: 'Schüler springen zum ersten Modul dieser Zuweisung – „Weiter“ führt durch alle weiteren', run: () => this._setMarker({ level: 'link', linkId: link.id }) });
    items.push('-');
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
      : cb.links.filter((l) => (l.practice.length || l.classTopicId) && l.inTree !== false && l.nodeId === parentId).sort((a, b) => a.order - b.order);
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

  /** 🌳 Einträge wieder wie im Notizbuch anordnen – eigene Ordnung geht dabei verloren. */
  async _arrange() {
    const sure = await this.app.appConfirm('Alle Einträge wieder wie im Notizbuch anordnen?\n\n'
      + 'Deine eigene Ordnung geht dabei verloren. Links, QR-Codes, Ergebnisse und An/Aus bleiben; es kommen keine neuen Themen dazu. '
      + 'Für Schüler ausgeblendete Bereiche bleiben, wie sie sind.');
    if (!sure) return;
    const res = await this.app.api.arrangeClassbook(this._classId);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Ordnen fehlgeschlagen'), 'error'); return; }
    this.app.showToast(res.moved ? `${res.moved} Eintr${res.moved === 1 ? 'ag' : 'äge'} verschoben, alles sortiert wie im Notizbuch.` : 'Sortiert wie im Notizbuch, nichts musste verschoben werden.', 'success');
    await this._classbook(true);
    this._render();
  }

  /** Lernthema oder Knoten aus dem Notizbuch als Klassenlink dieser Klasse. */
  async _assign(nodeId = null) {
    const picked = await this._pickFromNotebook('➕ Der Klasse zuweisen',
      'Ein Lernthema oder einen ganzen Bereich wählen. Was später dazukommt, erscheint hier ausgeschaltet – du schaltest es ein, wenn es so weit ist.');
    if (!picked) return;
    const res = await this.app.api.assignToClassbook(this._classId, picked.type, picked.id, nodeId);
    if (failed(res)) { this.app.showToast('Fehler: ' + (res?.message || 'Zuweisen fehlgeschlagen'), 'error'); return; }
    if (res.existed) this.app.showToast(`Nichts hinzugefügt: „${picked.title}“ ist schon zugewiesen${res.present?.length ? ` (${res.present.slice(0, 6).join(', ')})` : ''}.`, 'info');
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
      // Wie die Inhaltsübersicht nach Bereichen und Abschnitten; Zuweisungen ohne (vorhandenen) Bereich stehen dahinter.
      const known = new Set(cb.nodes.map((n) => n.id));
      const placed = links.map((l) => (l.nodeId && known.has(l.nodeId) ? l : { ...l, nodeId: null }));
      const card = (l) => this._linkCard(l, '<button type="button" class="btn btn-secondary btn-sm" data-contest-links>🔗 Leitungs-Link & QR-Code</button>');
      out.innerHTML = `
        <p class="hint">🏆 Quiz-Arena starten öffnet den Wartebereich (z. B. am Beamer). Solange er offen ist, sehen die Schüler im
          Klassennotizbuch nur die Quiz-Arena und kommen mit einem Klick hinein; sonst ist sie bei ihnen ausgeblendet. Ohne Anmeldung
          geht es über den QR-Code im Wartebereich.</p>
        ${links.length ? `<div class="cb-tree">${this._contestLevel(cb, placed, null, card)}</div>`
          : '<div class="empty-state"><span class="empty-icon">🏆</span><p>Keine Zuweisung dieser Klasse hat die Quiz-Arena eingeschaltet.</p></div>'}`;
      out.querySelectorAll('details[data-node]').forEach((d) => d.addEventListener('toggle', () => {
        (this._closedNodes ||= new Set())[d.open ? 'delete' : 'add'](d.dataset.node);
      }));
      // Starten: gleich den Wartebereich in einem neuen Tab (Fenster vorab öffnen, sonst blockt der Browser).
      out.querySelectorAll('[data-contest]').forEach((btn) => btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const win = window.open('', '_blank');
        const res = await this.app.api.contestShareLink(btn.closest('[data-link]').dataset.link).catch(() => null);
        if (!res?.hostUrl) {
          win?.close();
          this.app.showToast(res?.message || 'Die Quiz-Arena ließ sich nicht starten.', 'error');
          return;
        }
        if (win) win.location.href = res.hostUrl; else window.location.href = res.hostUrl;
      }));
      out.querySelectorAll('[data-contest-links]').forEach((btn) => btn.addEventListener('click', () => {
        this.app.linksView._openContestDialog({ id: btn.closest('[data-link]').dataset.link });
      }));
    });
  }

  /** Baum der Quiz-Arena: Bereiche und Abschnitte wie in der Inhaltsübersicht, nur Zweige mit Quiz-Arena, ohne Schalter. */
  _contestLevel(cb, links, parentId, card) {
    const under = (id) => links.filter((l) => l.nodeId === id).length
      + cb.nodes.filter((n) => n.parentId === id).reduce((s, n) => s + under(n.id), 0);
    const nodes = cb.nodes.filter((n) => n.parentId === parentId && under(n.id)).sort((a, b) => a.orderIndex - b.orderIndex);
    const entries = links.filter((l) => l.nodeId === parentId).sort((a, b) => a.order - b.order);
    return nodes.map((n) => `<details class="cb-node" data-node="${escapeAttr(n.id)}" ${this._closedNodes?.has(n.id) ? '' : 'open'}>
        <summary><span class="cb-node-title">${NODE_ICON[n.kind]} ${escapeHtml(n.title)}</span>
          <span class="hint">${under(n.id)} Lernthem${under(n.id) === 1 ? 'a' : 'en'}</span></summary>
        <div class="cb-node-body">${this._contestLevel(cb, links, n.id, card)}</div>
      </details>`).join('') + entries.map(card).join('');
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
              <button type="button" class="btn btn-secondary btn-sm" id="cbCopyQr" title="QR-Code als Bild in die Zwischenablage">🔳 QR-Code kopieren</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cbCopySheet" title="QR-Code mit Titel und Link als Bild – z. B. für OneNote">🖼 Als Bild kopieren</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cbCopyOneNote" title="Seite für OneNote: QR-Code als Bild, Link als Text und Klassencode">📓 OneNote-Seite kopieren</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cbRenew" title="Neuer Link und Klassencode – die alten gelten dann nicht mehr">🔄 Neu</button></div>
            ${cb.code ? `<p class="cb-code-line">Klassencode für die App: <strong class="cb-code">${escapeHtml(cb.code)}</strong>
              <span class="hint">– in der Schüler-App unter ➕ eintippen oder den QR-Code scannen</span></p>` : ''}
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
      out.querySelector('#cbCopyQr').addEventListener('click', async () => {
        const ok = await copyQrSvgAsPng(out.querySelector('.cb-qr svg'));
        this.app.showToast(ok ? 'QR-Code kopiert' : 'QR-Code kopieren klappt hier nicht – bitte den Link nutzen.', ok ? 'success' : 'error');
      });
      out.querySelector('#cbCopySheet').addEventListener('click', async () => {
        const ok = await copyShareSheetAsPng({
          title: `Klassennotizbuch ${cb.className}`, subtitle: 'Link öffnen, Namen und PIN eingeben', svg: out.querySelector('.cb-qr svg'), url: cb.url,
        });
        this.app.showToast(ok ? 'Als Bild kopiert – in OneNote einfügen mit Strg+V.' : 'Als Bild kopieren klappt hier nicht.', ok ? 'success' : 'error');
      });
      out.querySelector('#cbCopyOneNote').addEventListener('click', async () => {
        const ok = await copyClassbookOneNote({ className: cb.className, url: cb.url, code: cb.code, qrSvg: cb.qrSvg });
        this.app.showToast(ok ? 'OneNote-Seite kopiert – in OneNote auf einer neuen Seite mit Strg+V einfügen.' : 'Kopieren klappt hier nicht – bitte den Link kopieren.', ok ? 'success' : 'error');
      });
      out.querySelector('#cbRenew').addEventListener('click', async () => {
        if (!(await this.app.appConfirm('Neuen Klassenbuch-Link erzeugen? Der bisherige Link, der Klassencode und ausgeteilte QR-Codes gelten dann nicht mehr. Schüler-Apps mit diesem Klassennotizbuch müssen es neu hinzufügen.'))) return;
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
      if (!c || (!c.done && !c.work && !c.opened)) return '<td></td>';
      if (c.opened && !c.done && !c.work) return '<td><span title="Abschnitt geöffnet, noch nichts bearbeitet">👁</span></td>';
      const main = c.done ? (c.pct === null ? '<span class="cb-done">✓</span>' : `<span class="result-score ${pctClass(c.pct)}">${c.pct}</span>`) : '';
      return `<td>${main}${c.work ? '<span title="Blatt bearbeitet">✍️</span>' : ''}</td>`;
    };
    const students = data.students.filter((s) => !s.pending);
    out.innerHTML = `<p class="hint">Je Modul das beste Ergebnis in Prozent, ✓ erledigt (ohne Wertung), ✍️ Blatt mit dem Stift bearbeitet, 👁 Abschnitt einer HTML-App geöffnet (zählt nicht als erledigt).
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
