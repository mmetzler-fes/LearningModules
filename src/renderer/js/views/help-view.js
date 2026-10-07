import { escapeHtml, escapeAttr } from '../utils.js';
import { renderMarkdown } from '../markdown.js';

// ==================== HILFE ====================

/**
 * Seite "Hilfe": Themenübersicht aus docs/ (gruppiert, jedes Dokument mit
 * seinen Abschnitten als Links) und die Detailseite eines Dokuments.
 * Entwicklerteile blendet der Server aus.
 */
export class HelpView {
  constructor(app) {
    this.app = app;
    this.box = document.getElementById('helpPanel');
    this.overviewData = null;
    this.box?.addEventListener('click', (e) => this._onClick(e));
  }

  async refresh() {
    if (!this.box) return;
    await this.showOverview();
  }

  async showOverview() {
    if (!this.overviewData) {
      this.box.innerHTML = '<p class="hint">Wird geladen …</p>';
      const data = await this.app.api.getHelpOverview().catch(() => null);
      if (!data || !Array.isArray(data.groups)) {
        this.box.innerHTML = `<p class="login-error">${escapeHtml(data?.message || 'Hilfe nicht abrufbar.')}</p>`;
        return;
      }
      this.overviewData = data;
    }
    this.box.innerHTML = `
      <div class="help-overview">${this.overviewData.groups.map((g) => `
        <section class="help-group">
          <h3>${escapeHtml(g.icon)} ${escapeHtml(g.title)}</h3>
          <div class="help-docs">${g.docs.map((d) => `
            <div class="help-doc-card">
              <a href="#" class="help-doc-title" data-doc="${escapeAttr(d.name)}">${escapeHtml(d.title || d.name)}</a>
              ${d.sections.length ? `<ul class="help-doc-sections">${d.sections.map((s) => `
                <li><a href="#" data-doc="${escapeAttr(d.name)}" data-anchor="${escapeAttr(s.anchor)}">${escapeHtml(s.title)}</a></li>`).join('')}
              </ul>` : ''}
            </div>`).join('')}
          </div>
        </section>`).join('')}
      </div>`;
    window.scrollTo({ top: 0 });
  }

  async showPage(name, anchor) {
    this.box.innerHTML = '<p class="hint">Wird geladen …</p>';
    const page = await this.app.api.getHelpPage(name).catch(() => null);
    if (!page || !page.markdown) {
      this.box.innerHTML = `<p><a href="#" data-overview>← Zur Übersicht</a></p>
        <p class="login-error">${escapeHtml(page?.message || 'Diese Hilfeseite gibt es nicht.')}</p>`;
      return;
    }
    this.box.innerHTML = `
      <p class="help-back"><a href="#" data-overview>← Übersicht</a></p>
      <article class="help-article">${renderMarkdown(page.markdown)}</article>
      <p class="help-back"><a href="#" data-overview>← Übersicht</a></p>`;
    const target = anchor && this.box.querySelector(`#help-${CSS.escape(anchor)}`);
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }

  _onClick(e) {
    const a = e.target.closest('a');
    if (!a || !this.box.contains(a)) return;
    if (a.hasAttribute('data-overview')) {
      e.preventDefault();
      this.showOverview();
    } else if (a.dataset.doc) {
      e.preventDefault();
      this.showPage(a.dataset.doc, a.dataset.anchor);
    } else if (a.dataset.anchor) {
      e.preventDefault();
      this.box.querySelector(`#help-${CSS.escape(a.dataset.anchor)}`)?.scrollIntoView({ block: 'start' });
    }
  }
}
