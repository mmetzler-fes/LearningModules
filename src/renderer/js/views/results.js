import { escapeHtml, escapeAttr } from '../utils.js';

/** Kurzbeschriftung der Abfragemodi in der Ergebnisliste. */
const MODE_LABELS = { quiz: '🧠 Quiz', exam: '📝 Klassenarbeit', learn: '💡 Lernen' };

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
  }

  async _exportResults() {
    const results = await this.app.api.getQuizResults();
    if (!results || results.length === 0) {
      this.app.showToast('Keine Ergebnisse zum Exportieren vorhanden.', 'info');
      return;
    }
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz_ergebnisse_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.app.showToast('Ergebnisse erfolgreich exportiert.', 'success');
  }

  /**
   * Füllt die Link-Auswahl aus den tatsächlich vorhandenen Ergebnissen.
   * Gelöschte Links bleiben damit auswählbar, solange ihre Ergebnisse noch
   * da sind – der Name steht ja im Ergebnis selbst.
   */
  _renderLinkOptions(results) {
    if (!this._filterLink) return;
    const names = [...new Set(results.map((r) => r.linkName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    const current = this._filterLink.value;
    const hasWithout = results.some((r) => !r.linkName);

    this._filterLink.innerHTML = `
      <option value="">Alle Links</option>
      ${names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('')}
      ${hasWithout ? '<option value="__none__">Ohne Link</option>' : ''}`;
    if ([...this._filterLink.options].some((o) => o.value === current)) this._filterLink.value = current;
  }

  async refresh() {
    const results = await this.app.api.getQuizResults();
    const search = (this._searchResults ? this._searchResults.value : '').toLowerCase().trim();
    const linkFilter = this._filterLink ? this._filterLink.value : '';

    this._renderLinkOptions(results);

    let filtered = results;
    if (search) filtered = filtered.filter((r) => (r.studentName || r.username || '').toLowerCase().includes(search));
    if (linkFilter) {
      // '__none__' fasst alles zusammen, was ohne Themen-Link entstanden ist.
      filtered = linkFilter === '__none__'
        ? filtered.filter((r) => !r.linkName)
        : filtered.filter((r) => r.linkName === linkFilter);
    }

    const uniqueStudents = new Set(results.map((r) => r.studentName || r.username || r.id)).size;
    const avgScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length)
      : 0;

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

  /** "1 Durchlauf" statt "1 Durchläufe". */
  _runCount(n) {
    return n === 1 ? '1 Durchlauf' : `${n} Durchläufe`;
  }

  /** Mittelwert der Erfolgsquote, auf ganze Prozent gerundet. */
  _avg(list) {
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, r) => sum + (r.percentage || 0), 0) / list.length);
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
    const NO_LINK = '__none__';

    for (const [linkName, linkResults] of this._groupBy(results, (r) => r.linkName || NO_LINK, NO_LINK)) {
      const students = this._groupBy(linkResults, (r) => r.studentName || r.username || '—', null);
      const title = linkName === NO_LINK ? '📄 Ohne Link' : `🔗 ${escapeHtml(linkName)}`;

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
        const best = Math.max(...runs.map((r) => r.percentage || 0));

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

  /** Ein einzelner Durchlauf. Der Linkname steht jetzt in der Gruppe darüber. */
  _renderResultCard(r) {
    const card = document.createElement('div');
    card.className = 'result-card';
    const pctClass = r.percentage >= 70 ? 'good' : r.percentage >= 40 ? 'medium' : 'poor';
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-card-info">
          <span class="result-topic-name">${escapeHtml(r.topicTitle || '—')}</span>
          <span>
            ${r.mode ? `<span class="result-mode-badge">${escapeHtml(MODE_LABELS[r.mode] || r.mode)}</span>` : ''}
            <span class="result-date">${new Date(r.timestamp).toLocaleString('de-DE')}</span>
          </span>
          ${r.systemUsername || r.ipAddress ? `
            <span class="result-card-origin">
              ${r.systemUsername ? `[${escapeHtml(r.systemUsername)}]` : ''}
              ${r.ipAddress ? `(${escapeHtml(r.ipAddress)})` : ''}
            </span>` : ''}
        </div>
        <div class="result-score ${pctClass}">${r.score}/${r.totalQuestions} (${r.percentage}%)</div>
        <button class="btn btn-danger btn-sm btn-delete-result" data-result-id="${r.id}">🗑</button>
      </div>
      ${r.details && r.details.length > 0 ? `
        <details class="result-details">
          <summary>Details anzeigen</summary>
          <div class="result-detail-list">
            ${r.details.map((d) => `
              <div class="result-detail-item ${d.isCorrect ? 'correct' : 'wrong'}">
                <span class="result-detail-icon">${d.isCorrect ? '✅' : '❌'}</span>
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
      this.refresh();
    });
    return card;
  }
}
