import { escapeHtml } from '../utils.js';

// ==================== DOKUMENT ANSEHEN ====================
//
// Ein Dokument ohne Notizbuch ansehen – über allem, auch über der Anmeldung:
// Bilder, bedienbare Quizze, darüber die Stiftbeschriftung. Für .zlm-Dateien
// per Doppelklick (ohne Server) und für Dateien, die „Öffnen mit“ an die App
// gibt (views/file-open.js, dort mit „Im Notizbuch ablegen“).

/**
 * `{ title, subtitle, spec, kind, modules, stand, landscape, actions }` –
 * `modules`: eingebettete Quizze nach ID; `stand`: Beschriftung (Stand des
 * Stift-Editors); `actions`: weitere Knöpfe [{ label, title, primary, onClick(close) }].
 * Liefert ein Promise, das beim Schließen erfüllt wird.
 */
export async function openDocViewer(app, { title, subtitle = '', spec, kind = 'worksheet', modules = {}, stand = null, landscape = false, actions = [] }) {
  const [{ H5pRenderer }, { showInkView }] = await Promise.all([
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('../../lm-editor/src/ink/ink-view.js'),
  ]);
  document.querySelector('.zlm-viewer')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'zlm-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', title || 'Dokument');
  overlay.innerHTML = `
    <div class="zlm-viewer-bar">
      <span class="zlm-viewer-title">📄 <strong>${escapeHtml(title || 'Dokument')}</strong>
        <span class="hint">${escapeHtml(subtitle)}</span></span>
      <span class="zlm-viewer-actions">
        ${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="${i}" title="${escapeHtml(a.title || '')}">${escapeHtml(a.label)}</button>`).join('')}
        <button type="button" class="btn btn-secondary btn-sm zlm-viewer-close">✕ Schließen</button>
      </span>
    </div>
    <div class="zlm-viewer-body"><div class="zlm-viewer-doc module-description-content"></div></div>`;
  document.body.appendChild(overlay);
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); resolveClosed(); };
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input, textarea, [contenteditable="true"]')) close(); };
  overlay.querySelector('.zlm-viewer-close').addEventListener('click', close);
  overlay.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await actions[Number(b.dataset.action)].onClick(close); } catch (err) { app.showToast(`⚠️ ${err.message}`, 'error'); }
    b.disabled = false;
  }));
  document.addEventListener('keydown', onKey);

  // Ohne Gastgeber: keine Knöpfe für Stift und PDF; „Lösungen zeigen“ gibt es (kein Quiz-Durchlauf).
  const view = overlay.querySelector('.zlm-viewer-doc');
  const renderer = new H5pRenderer();
  view.appendChild(renderer.createTypePreview('document', { spec, kind }, {
    blockIds: true, embedModule: (id) => modules[id] || null, title,
  }));
  if (stand) await showInkView(view, stand, { landscape }).catch(() => false);
  return closed;
}

/** .zlm-Datei lesen und anzeigen (ohne Anmeldung und Server); ein Fehler kommt als Meldung. */
export async function openZlmFile(app, file) {
  const { readZlm, specForView, editorStateOf } = await import('../../lm-editor/src/zlm/zlm.js');
  let doc;
  try {
    doc = readZlm(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    app.showToast(`⚠️ ${file.name || 'Die Datei'} lässt sich nicht öffnen: ${err.message}`, 'error');
    return;
  }
  // Stiftbeschriftung der Datei (die der Lehrkraft, sonst die erste).
  const layer = doc.layers.teacher || Object.values(doc.layers)[0] || null;
  await openDocViewer(app, {
    title: doc.manifest.title, subtitle: `${file.name || ''} · nur ansehen`,
    spec: specForView(doc), kind: doc.manifest.kind, modules: doc.modules,
    stand: editorStateOf(layer), landscape: doc.spec.orientation === 'landscape',
  });
}
