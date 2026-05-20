import { escapeHtml } from '../utils.js';

// ==================== RESULTS VIEW ====================

export class ResultsView {
  constructor(app) {
    this.app = app;
    this._resultsStats  = document.getElementById('resultsStats');
    this._resultsList   = document.getElementById('resultsList');
    this._searchResults = document.getElementById('searchResults');
    this._btnDeleteAll  = document.getElementById('btnDeleteAllResults');
    this._btnExport     = document.getElementById('btnExportResults');

    this._bindEvents();
  }

  _bindEvents() {
    if (this._searchResults) this._searchResults.addEventListener('input', () => this.refresh());
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

  async refresh() {
    const results = await this.app.api.getQuizResults();
    const search = (this._searchResults ? this._searchResults.value : '').toLowerCase().trim();
    let filtered = results;
    if (search) filtered = filtered.filter((r) => (r.studentName || r.username || '').toLowerCase().includes(search));

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

    for (const r of filtered) {
      const card = document.createElement('div');
      card.className = 'result-card';
      const pctClass = r.percentage >= 70 ? 'good' : r.percentage >= 40 ? 'medium' : 'poor';
      card.innerHTML = `
        <div class="result-card-header">
          <div class="result-card-info">
            <strong>${escapeHtml(r.studentName || r.username || '—')}</strong>
            <span style="font-size:0.85em; color:var(--text-secondary); margin-left:5px;">
              ${r.systemUsername ? `[${escapeHtml(r.systemUsername)}]` : ''} ${r.ipAddress ? `(${escapeHtml(r.ipAddress)})` : ''}
            </span>
            <br>
            <span class="result-topic-name">${escapeHtml(r.topicTitle || '—')}</span>
            <span class="result-date">${new Date(r.timestamp).toLocaleString('de-DE')}</span>
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
      this._resultsList.appendChild(card);
    }
  }
}
