// ==================== DASHBOARD VIEW ====================

export class DashboardView {
  constructor(app) {
    this.app = app;
    this._statTopics  = document.getElementById('statTopics');
    this._statModules = document.getElementById('statModules');
    this._statActive  = document.getElementById('statActive');
    this._statResults = document.getElementById('statResults');
    this._typeGrid    = document.getElementById('typeGrid');
  }

  async refresh() {
    await this.app.loadTopics();
    const { state, api } = this.app;
    const { topics } = state;

    if (this._statTopics)  this._statTopics.textContent  = topics.length;
    const totalModules = topics.reduce((sum, t) => sum + (t.modules || []).length, 0);
    if (this._statModules) this._statModules.textContent = totalModules;
    if (this._statActive)  this._statActive.textContent  = topics.filter((t) => t.selected).length;
    const results = await api.getQuizResults();
    if (this._statResults) this._statResults.textContent = results.length;

    this.renderTypeGrid();
  }

  renderTypeGrid() {
    if (!this._typeGrid) return;
    this._typeGrid.innerHTML = '';
    const types = getH5pTypesArray();
    for (const t of types) {
      const card = document.createElement('div');
      card.className = 'type-card';
      card.innerHTML = `
        <div class="type-card-icon">${t.icon}</div>
        <div class="type-card-name">${t.name}</div>
        <div class="type-card-desc">${t.description}</div>`;
      this._typeGrid.appendChild(card);
    }
  }
}
