import { escapeHtml, escapeAttr } from '../utils.js';

/** Kurzbeschriftung der Abfragemodi in der Ergebnisliste. */
const MODE_LABELS = {
  quiz: '🧠 Quiz', exam: '📝 Klassenarbeit', learn: '💡 Lernen', companion: '🦉 Lernbegleitung', contest: '🏆 Quiz-Arena',
};

/** Gruppenschluessel fuer Durchlaeufe ohne Link bzw. Praefix fuer Quick-Links. */
const NO_LINK = '__none__';
const QUICK_PREFIX = 'quick::';

/** Eigene Ergebnisse (optional nur einzelne Schuljahre) als Datei speichern. */
export async function downloadResultsExport(app, years) {
  const data = await app.api.exportResults(years);
  if (!data || data.statusCode >= 400) { app.showToast('Fehler: ' + (data?.message || '?'), 'error'); return; }
  if (!data.results.length) { app.showToast('Keine Ergebnisse zum Exportieren vorhanden.', 'info'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ergebnisse_${years?.length ? years.join('_') : 'alle'}_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  app.showToast(`${data.results.length} Ergebnis(se) exportiert.`, 'success');
}

/**
 * Hinweis auf die Löschregel: Welche eigenen Schuljahre sind abgelaufen und
 * wann werden sie gelöscht? Mit Export-Knopf für genau diese Jahre.
 */
export async function renderRetentionNotice(app, container) {
  if (!container) return;
  container.innerHTML = '';
  const info = await app.api.getRetention();
  if (!info || info.statusCode >= 400 || !info.years?.length || !(info.classes || info.results)) return;
  const when = new Date(info.deleteAfter);
  const past = when <= new Date();
  const box = document.createElement('div');
  box.className = 'class-notice warning';
  box.innerHTML = `
    <div><strong>🗓 Löschregel:</strong> Aufbewahrt werden ${escapeHtml(info.keepFrom)} bis ${escapeHtml(info.current)}.
      Deine Daten aus ${escapeHtml(info.years.join(', '))} (${info.classes} Klasse(n), ${info.results} Ergebnis(se))
      werden ${past ? 'in Kürze' : `am ${when.toLocaleDateString('de-DE')}`} gelöscht. Vorher exportieren, wer sie behalten will.</div>
    <button class="btn btn-secondary btn-sm">⬇️ Diese Jahre exportieren</button>`;
  box.querySelector('button').addEventListener('click', () => downloadResultsExport(app, info.years));
  container.appendChild(box);
}

// ==================== RESULTS VIEW ====================

export class ResultsView {
  constructor(app) {
    this.app = app;
    this._resultsStats  = document.getElementById('resultsStats');
    this._resultsList   = document.getElementById('resultsList');
    this._searchResults = document.getElementById('searchResults');
    this._filterLink    = document.getElementById('filterResultsLink');
    this._btnDeleteAll  = document.getElementById('btnDeleteAllResults');
    this._btnExport     = document.getElementById('btnExportResults');

    // Welche Gruppen offen sind, ueberlebt ein refresh() - sonst klappt beim
    // Loeschen eines Durchlaufs die ganze Liste wieder zu.
    this._openGroups = new Set();

    this._bindEvents();
  }

  _bindEvents() {
    if (this._searchResults) this._searchResults.addEventListener('input', () => this.refresh());
    if (this._filterLink) this._filterLink.addEventListener('change', () => this.refresh());
    if (this._btnDeleteAll) {
      this._btnDeleteAll.addEventListener('click', async () => {
        if (!(await this.app.appConfirm(t('results.delete.all.confirm')))) return;
        await this.app.api.deleteAllQuizResults();
        this.app.showToast(t('results.all.deleted'), 'info');
        this.refresh();
      });
    }
    if (this._btnExport) {
      this._btnExport.addEventListener('click', () => this._exportResults());
    }
    const fileInput = document.getElementById('resultsImportFile');
    document.getElementById('btnImportResults')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) this._importResults(file);
    });
  }

  async _exportResults() {
    await downloadResultsExport(this.app);
  }

  /** Ergebnis-Datei einlesen (Export dieser oder einer anderen LearningModules-Installation). */
  async _importResults(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      this.app.showToast('Die Datei ist kein gültiges JSON.', 'error');
      return;
    }
    const res = await this.app.api.importResults(data);
    if (!res || res.statusCode >= 400) { this.app.showToast('Fehler: ' + (res?.message || '?'), 'error'); return; }
    this.app.showToast(`${res.imported} Ergebnis(se) eingelesen${res.skipped ? `, ${res.skipped} schon vorhanden` : ''}.`
      + (res.expired ? ` ${res.expired} davon stammen aus abgelaufenen Schuljahren – die Löschregel entfernt sie wieder.` : ''), res.expired ? 'info' : 'success');
    this.refresh();
  }

  /**
   * Füllt die Link-Auswahl aus den tatsächlich vorhandenen Ergebnissen.
   * Gelöschte Links bleiben damit auswählbar, solange ihre Ergebnisse noch
   * da sind – der Name steht ja im Ergebnis selbst.
   */
  _renderLinkOptions(results) {
    if (!this._filterLink) return;
    const keys = [...new Set(results.map((r) => this._linkKey(r)).filter((k) => k !== NO_LINK))]
      .sort((a, b) => this._linkLabel(a).localeCompare(this._linkLabel(b), 'de'));
    const current = this._filterLink.value;
    const hasWithout = results.some((r) => this._linkKey(r) === NO_LINK);

    this._filterLink.innerHTML = `
      <option value="">Alle Links</option>
      ${keys.map((k) => `<option value="${escapeAttr(k)}">${escapeHtml(this._linkLabel(k))}</option>`).join('')}
      ${hasWithout ? `<option value="${NO_LINK}">Ohne Link</option>` : ''}`;
    if ([...this._filterLink.options].some((o) => o.value === current)) this._filterLink.value = current;
  }

  async refresh() {
    renderRetentionNotice(this.app, document.getElementById('resultsNotices'));
    const results = await this.app.api.getQuizResults();
    const search = (this._searchResults ? this._searchResults.value : '').toLowerCase().trim();
    const linkFilter = this._filterLink ? this._filterLink.value : '';

    this._renderLinkOptions(results);

    let filtered = results;
    if (search) filtered = filtered.filter((r) => (r.studentName || r.username || '').toLowerCase().includes(search));
    if (linkFilter) {
      // NO_LINK fasst alles zusammen, was ohne Link entstanden ist.
      filtered = filtered.filter((r) => this._linkKey(r) === linkFilter);
    }

    const uniqueStudents = new Set(results.map((r) => r.studentName || r.username || r.id)).size;
    const avgScore = this._avg(results);

    if (this._resultsStats) {
      this._resultsStats.innerHTML = `
        <div class="stats-grid" style="margin-bottom:20px;">
          <div class="stat-card">
            <div class="stat-number">${results.length}</div>
            <div class="stat-label">Quiz-Durchläufe</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${uniqueStudents}</div>
            <div class="stat-label">Verschiedene Schüler</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${avgScore}%</div>
            <div class="stat-label">Ø Erfolgsquote</div>
          </div>
        </div>`;
    }

    this._resultsList.innerHTML = '';
    if (filtered.length === 0) {
      this._resultsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Noch keine Ergebnisse vorhanden.</p></div>';
      return;
    }

    // Bei einer Suche sind es wenige Treffer - die sollen gleich sichtbar
    // sein, statt dass man sich durch zugeklappte Gruppen arbeiten muss.
    this._renderGroups(filtered, { expandAll: !!search });
  }

  // ---- Gruppierte Darstellung: Link > Schüler > Durchläufe ----

  /**
   * Gruppenschluessel eines Durchlaufs. Quick-Links bekommen ein Praefix,
   * damit ein Themen-Link, der zufaellig wie ein Thema heisst, eine eigene
   * Gruppe bleibt.
   */
  _linkKey(r) {
    if (!r.linkName) return NO_LINK;
    const key = r.linkKind === 'quick' ? QUICK_PREFIX + r.linkName : r.linkName;
    // Klassenlinks derselben Freigabe sind je Klasse eine eigene Gruppe.
    return r.className ? `${key} · 🏫 ${r.className}` : key;
  }

  /** Lesbare Beschriftung zu einem Gruppenschluessel (ohne Symbol). */
  _linkLabel(key) {
    if (key === NO_LINK) return 'Ohne Link';
    return key.startsWith(QUICK_PREFIX) ? `${key.slice(QUICK_PREFIX.length)} (Quick-Link)` : key;
  }

  /** "1 Durchlauf" statt "1 Durchläufe". */
  _runCount(n) {
    return n === 1 ? '1 Durchlauf' : `${n} Durchläufe`;
  }

  /**
   * Mittelwert der Erfolgsquote, auf ganze Prozent gerundet. Durchläufe ohne
   * bewertbare Aufgaben bleiben draussen – sie stehen mit 0 % in den Daten
   * und zögen den Schnitt sonst grundlos nach unten.
   */
  _avg(list) {
    const graded = list.filter((r) => r.totalQuestions);
    if (graded.length === 0) return 0;
    return Math.round(graded.reduce((sum, r) => sum + (r.percentage || 0), 0) / graded.length);
  }

  /**
   * Gruppiert eine Liste nach einem Schlüssel und liefert die Gruppen
   * alphabetisch sortiert. Der Platzhalter für "kein Wert" kommt ans Ende,
   * denn er ist ein Sammelbecken und keine echte Gruppe.
   */
  _groupBy(list, keyOf, emptyKey) {
    const groups = new Map();
    for (const item of list) {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === emptyKey) return 1;
      if (b === emptyKey) return -1;
      return a.localeCompare(b, 'de');
    });
  }

  /**
   * Ein aufklappbarer Block. Der Zustand wird unter `key` gemerkt, damit ein
   * refresh() - etwa nach dem Löschen - die Ansicht nicht wieder zuklappt.
   */
  _makeGroup(key, className, summaryHtml, forceOpen) {
    const box = document.createElement('details');
    box.className = className;
    box.open = forceOpen || this._openGroups.has(key);
    const summary = document.createElement('summary');
    summary.innerHTML = summaryHtml;
    box.appendChild(summary);
    box.addEventListener('toggle', () => {
      if (box.open) this._openGroups.add(key);
      else this._openGroups.delete(key);
    });
    return box;
  }

  _renderGroups(results, { expandAll }) {
    // Nach sichtbarer Beschriftung sortieren, sonst stuenden alle Quick-Links
    // wegen ihres Praefixes gesammelt unter "q". "Ohne Link" bleibt am Ende.
    const linkGroups = this._groupBy(results, (r) => this._linkKey(r), NO_LINK)
      .sort(([a], [b]) => (a === NO_LINK) - (b === NO_LINK) || this._linkLabel(a).localeCompare(this._linkLabel(b), 'de'));
    for (const [linkName, linkResults] of linkGroups) {
      const students = this._groupBy(linkResults, (r) => r.studentName || r.username || '—', null);
      // Quick-Link: unter dem Titel des Themas, zu dem er erzeugt wurde
      const title = linkName === NO_LINK
        ? '📄 Ohne Link'
        : linkName.startsWith(QUICK_PREFIX)
          ? `📚 ${escapeHtml(linkName.slice(QUICK_PREFIX.length))} <span class="result-mode-badge">⚡ Quick-Link</span>`
          : `🔗 ${escapeHtml(linkName)}`;

      const linkBox = this._makeGroup(
        'link::' + linkName,
        'result-group result-group-link',
        `<span class="result-group-title">${title}</span>
         <span class="result-group-meta">${students.length} Schüler · ${this._runCount(linkResults.length)} · Ø ${this._avg(linkResults)}%</span>`,
        expandAll,
      );

      for (const [studentName, runs] of students) {
        // Neueste zuerst: Der letzte Versuch ist der, nach dem gefragt wird.
        runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const gradedRuns = runs.filter((r) => r.totalQuestions);
        const best = gradedRuns.length > 0 ? Math.max(...gradedRuns.map((r) => r.percentage || 0)) : 0;

        const studentBox = this._makeGroup(
          `student::${linkName}::${studentName}`,
          'result-group result-group-student',
          `<span class="result-group-title">${escapeHtml(studentName)}</span>
           <span class="result-group-meta">${this._runCount(runs.length)} · Ø ${this._avg(runs)}%${runs.length > 1 ? ` · bester ${best}%` : ''}</span>`,
          expandAll,
        );

        for (const r of runs) studentBox.appendChild(this._renderResultCard(r));
        linkBox.appendChild(studentBox);
      }

      this._resultsList.appendChild(linkBox);
    }
  }

  /**
   * Ein einzelner Durchlauf. Der Linkname steht jetzt in der Gruppe darüber.
   * `onDeleted`: was nach dem Löschen neu gezeichnet wird (Klassenergebnisse nutzen die Karte mit).
   */
  _renderResultCard(r, onDeleted = () => this.refresh()) {
    const card = document.createElement('div');
    card.className = 'result-card';
    // Ein Durchlauf ohne bewertbare Aufgaben (nur Informationen) ist keine
    // Null, sondern keine Note. Sonst stünde da rot "0/0 (0%)".
    const nothingGraded = !r.totalQuestions;
    const pctClass = nothingGraded ? '' : r.percentage >= 70 ? 'good' : r.percentage >= 40 ? 'medium' : 'poor';
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-card-info">
          <span class="result-topic-name">${escapeHtml(r.topicTitle || '—')}</span>
          <span>
            ${r.mode ? `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[r.mode] || r.mode)}</span>` : ''}
            ${r.rank ? `<span class="result-mode-badge">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '🏅'} Platz ${r.rank}${r.playerCount ? ` von ${r.playerCount}` : ''}</span>` : ''}
            <span class="result-date">${new Date(r.timestamp).toLocaleString('de-DE')}</span>
          </span>
          ${r.systemUsername || r.ipAddress ? `
            <span class="result-card-origin">
              ${r.systemUsername ? `[${escapeHtml(r.systemUsername)}]` : ''}
              ${r.ipAddress ? `(${escapeHtml(r.ipAddress)})` : ''}
            </span>` : ''}
        </div>
        <div class="result-score ${pctClass}">${nothingGraded ? 'nur gelesen' : `${r.score}/${r.totalQuestions} (${r.percentage}%)`}</div>
        <button class="btn btn-danger btn-sm btn-delete-result" data-result-id="${r.id}">🗑</button>
      </div>
      ${r.details && r.details.length > 0 ? `
        <details class="result-details">
          <summary>Details anzeigen</summary>
          <div class="result-detail-list">
            ${r.details.map((d) => `
              <div class="result-detail-item ${d.informational ? '' : d.isCorrect ? 'correct' : 'wrong'}">
                <span class="result-detail-icon">${d.informational ? 'ℹ️' : d.isCorrect ? '✅' : '❌'}</span>
                <div>
                  <strong>${escapeHtml(d.moduleName || d.moduleTitle || '')}</strong>
                  ${d.userAnswer !== undefined ? `<br>Antwort: ${escapeHtml(String(d.userAnswer))}` : ''}
                  ${d.score ? `<br>Auswertung: ${escapeHtml(String(d.score))}` : ''}
                  ${d.correctAnswer !== undefined ? `<br>Korrekt: ${escapeHtml(String(d.correctAnswer))}` : ''}
                </div>
              </div>`).join('')}
          </div>
        </details>` : ''}`;

    card.querySelector('.btn-delete-result').addEventListener('click', async () => {
      await this.app.api.deleteQuizResult(r.id);
      this.app.showToast(t('results.deleted'), 'info');
      onDeleted();
    });
    return card;
  }
}
