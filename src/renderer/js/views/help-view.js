import { escapeHtml, escapeAttr } from '../utils.js';
import { renderMarkdown, sectionOf } from '../markdown.js';

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

/**
 * Hilfe an Ort und Stelle: Ein Element mit data-help="datei#anker" öffnet
 * den Abschnitt in einem Fenster über der Seite – auch über Dialogen, damit
 * dort nichts verloren geht. Von dort führt ein Link zur ganzen Seite.
 */
export async function openHelpPopup(app, ref) {
  const [name, anchor = ''] = String(ref || '').split('#');
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay help-popup-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card help-popup" role="dialog" aria-label="Hilfe">
      <div class="help-popup-body"><p class="hint">Wird geladen …</p></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary btn-full">📖 Ganze Hilfeseite</button>
        <button type="button" class="btn btn-primary btn-close">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.btn-close').addEventListener('click', close);
  overlay.querySelector('.btn-full').addEventListener('click', () => {
    close();
    // Offene Dialoge darunter schließen, die Hilfeseite ersetzt sie.
    document.querySelectorAll('.confirm-overlay').forEach((o) => (o.id ? o.classList.add('hidden') : o.remove()));
    app.navigateToView('teacher-help');
    app.helpView.showPage(name, anchor);
  });

  const body = overlay.querySelector('.help-popup-body');
  const page = await app.api.getHelpPage(name).catch(() => null);
  if (!page || !page.markdown) {
    body.innerHTML = `<p class="login-error">${escapeHtml(page?.message || 'Diese Hilfe ist nicht verfügbar.')}</p>`;
    return;
  }
  const md = (anchor && sectionOf(page.markdown, anchor)) || page.markdown;
  body.innerHTML = `<p class="hint help-popup-source">📖 ${escapeHtml(page.title || '')}</p>
    <article class="help-article help-article-compact">${renderMarkdown(md)}</article>`;
  // Verweise innerhalb des Fensters: andere Hilfeseiten im selben Fenster öffnen.
  body.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-doc], a[data-anchor]');
    if (!a) return;
    e.preventDefault();
    close();
    openHelpPopup(app, `${a.dataset.doc || name}#${a.dataset.anchor || ''}`);
  });
}

/** Ein kleines ❓, das auf einen Hilfeabschnitt verweist (für HTML-Schablonen). */
export function helpHint(ref, title = 'Hilfe zu diesem Bereich') {
  return `<button type="button" class="help-hint" data-help="${escapeAttr(ref)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">?</button>`;
}
