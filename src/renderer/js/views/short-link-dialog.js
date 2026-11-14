import { escapeHtml, escapeAttr, copyQrSvgAsPng, qrSvgToPngDataUrl } from '../utils.js';

// ==================== 🔗 KURZLINKS ====================
//
// Lange Adressen (z. B. LibreSpice: die ganze Schaltung steckt in der Adresse)
// bekommen einen Kurzlink /k/<code> mit QR-Code (src/short-links). Das Ziel
// lässt sich später ändern – ausgeteilte Kurzlinks und gedruckte QR-Codes
// bleiben gültig.
//
// `onInsert({ short, title, qrPng })`: aus dem Dokument-Editor (➕) – dann
// gibt es zusätzlich „Ins Dokument einfügen“.

const failed = (r) => !r || r.success === false || r.statusCode >= 400;

export function openShortLinkDialog(api, { onInsert = null } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card nb-dialog sl-dialog" style="max-width:680px">
    <h3>🔗 Kurzlink</h3>
    <p class="hint">Lange Adresse einfügen (z. B. eine LibreSpice-Schaltung) – daraus wird ein kurzer Link mit QR-Code.
      Das Ziel lässt sich später ändern, der Kurzlink bleibt.</p>
    <label class="sl-label">Lange Adresse
      <textarea class="sl-url" rows="3" spellcheck="false" placeholder="https://…"></textarea></label>
    <label class="sl-label">Bezeichnung <span class="hint">(optional, z. B. „Spannungsteiler“ – erscheint als Linktext)</span>
      <input type="text" class="sl-title" maxlength="200"></label>
    <div class="gn-actions"><button type="button" class="btn btn-primary sl-create">🔗 Kurzlink erzeugen</button></div>
    <p class="sl-status hint" aria-live="polite"></p>
    <div class="gn-link sl-result"></div>
    <details class="sl-mine"><summary>Meine Kurzlinks</summary><div class="sl-list"><p class="hint">Wird geladen …</p></div></details>
    <div class="confirm-actions"><button type="button" class="btn btn-secondary sl-close">Schließen</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const status = $('.sl-status');
  const result = $('.sl-result');
  const close = () => overlay.remove();
  $('.sl-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // Aus dem Menü: gleich die Liste zeigen; aus dem Editor zählt der neue Link.
  if (!onInsert) $('.sl-mine').open = true;
  setTimeout(() => $('.sl-url').focus(), 0);

  const showResult = (link) => {
    result.innerHTML = `<div class="gn-qr">${link.qr || ''}</div>
      <div class="gn-link-text">
        <strong>${escapeHtml(link.title || 'Kurzlink')}</strong>
        <div class="gn-url"><a href="${escapeAttr(link.short)}" target="_blank" rel="noopener">${escapeHtml(link.short)}</a></div>
        <div class="sl-buttons">
          <button type="button" class="btn btn-secondary btn-sm" data-copy>📋 Kurzlink kopieren</button>
          ${link.qr ? '<button type="button" class="btn btn-secondary btn-sm" data-copy-qr>🔳 QR-Code kopieren</button>' : ''}
          ${onInsert ? `<button type="button" class="btn btn-primary btn-sm" data-insert="link">↳ Als Link einfügen</button>
            ${link.qr ? '<button type="button" class="btn btn-primary btn-sm" data-insert="qr">↳ Mit QR-Code einfügen</button>' : ''}` : ''}
        </div>
      </div>`;
    result.querySelector('[data-copy]').addEventListener('click', (e) => copy(e.currentTarget, link.short));
    result.querySelector('[data-copy-qr]')?.addEventListener('click', async (e) => {
      const ok = await copyQrSvgAsPng(result.querySelector('.gn-qr svg'));
      e.currentTarget.textContent = ok ? '✅ QR-Code kopiert' : '❌ Kopieren ging nicht';
    });
    result.querySelectorAll('[data-insert]').forEach((btn) => btn.addEventListener('click', async () => {
      const qrPng = btn.dataset.insert === 'qr' ? await qrSvgToPngDataUrl(result.querySelector('.gn-qr svg')) : null;
      onInsert({ short: link.short, title: link.title || '', qrPng });
      close();
    }));
  };

  const copy = async (btn, text) => {
    try { await navigator.clipboard.writeText(text); btn.textContent = '✅ Kopiert'; } catch (_) { btn.textContent = '❌ Kopieren ging nicht'; }
  };

  const create = async () => {
    const url = $('.sl-url').value.trim();
    if (!url) { status.textContent = 'Bitte zuerst die lange Adresse einfügen.'; return; }
    $('.sl-create').disabled = true;
    status.textContent = '⏳ …';
    try {
      const res = await api.createShortLink(url, $('.sl-title').value.trim());
      if (failed(res)) throw new Error(res?.message || 'Das ging nicht.');
      status.textContent = res.existing ? 'Für diese Adresse gab es schon einen Kurzlink – hier ist er.' : `✅ Kurzlink erzeugt (${url.length} → ${res.short.length} Zeichen).`;
      showResult(res);
      void loadList();
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      $('.sl-create').disabled = false;
    }
  };
  $('.sl-create').addEventListener('click', create);
  $('.sl-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } });
  $('.sl-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } });

  const list = $('.sl-list');
  let links = [];
  const loadList = async () => {
    const res = await api.getShortLinks().catch(() => null);
    if (!Array.isArray(res)) { list.innerHTML = `<p class="hint">❌ ${escapeHtml(res?.message || 'Liste nicht erreichbar.')}</p>`; return; }
    links = res;
    if (!links.length) { list.innerHTML = '<p class="hint">Noch keine Kurzlinks.</p>'; return; }
    list.innerHTML = links.map((l) => `<div class="sl-row" data-id="${escapeAttr(l.id)}">
      <div class="sl-row-text">
        <strong>${escapeHtml(l.title || l.short.replace(/^https?:\/\//, ''))}</strong>
        <span class="gn-url">${escapeHtml(l.short)}</span>
        <span class="sl-target hint" title="${escapeAttr(l.url.slice(0, 500))}">→ ${escapeHtml(l.url.length > 90 ? `${l.url.slice(0, 90)}…` : l.url)}</span>
        <span class="hint">${l.hits ? `${l.hits}× aufgerufen` : 'noch nicht aufgerufen'}</span>
      </div>
      <div class="sl-row-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-act="show" title="QR-Code zeigen${onInsert ? ' und einfügen' : ''}">🔳</button>
        <button type="button" class="btn btn-secondary btn-sm" data-act="copy" title="Kurzlink kopieren">📋</button>
        <button type="button" class="btn btn-secondary btn-sm" data-act="edit" title="Ziel oder Bezeichnung ändern – der Kurzlink bleibt">✏️</button>
        <button type="button" class="btn btn-secondary btn-sm" data-act="delete" title="Löschen – ausgeteilte Links gehen dann ins Leere">🗑</button>
      </div>
    </div>`).join('');
  };
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const link = btn && links.find((l) => l.id === btn.closest('.sl-row')?.dataset.id);
    if (!link) return;
    const act = btn.dataset.act;
    if (act === 'copy') { await copy(btn, link.short); return; }
    if (act === 'show') {
      const res = await api.shortLinkQr(link.id);
      if (failed(res)) { status.textContent = `❌ ${res?.message || 'Das ging nicht.'}`; return; }
      status.textContent = '';
      showResult(res);
      result.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (act === 'edit') {
      const url = window.prompt('Neues Ziel (lange Adresse) – der Kurzlink bleibt gleich:', link.url);
      if (url === null) return;
      const title = window.prompt('Bezeichnung:', link.title || '');
      if (title === null) return;
      const res = await api.updateShortLink(link.id, { url, title });
      status.textContent = failed(res) ? `❌ ${res?.message || 'Das ging nicht.'}` : '✅ Geändert.';
      void loadList();
      return;
    }
    if (act === 'delete') {
      const ok = window.appConfirm ? await window.appConfirm(`Kurzlink ${link.short} löschen? Wer ihn noch hat, landet dann im Leeren.`)
        : window.confirm(`Kurzlink ${link.short} löschen?`);
      if (!ok) return;
      const res = await api.deleteShortLink(link.id);
      status.textContent = failed(res) ? `❌ ${res?.message || 'Das ging nicht.'}` : '🗑 Gelöscht.';
      if (!failed(res) && result.innerHTML.includes(link.short)) result.innerHTML = '';
      void loadList();
    }
  });
  void loadList();
}
