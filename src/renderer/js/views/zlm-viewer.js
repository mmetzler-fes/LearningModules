import { escapeHtml } from '../utils.js';

// ==================== .zlm ANSEHEN ====================
//
// Doppelklick auf eine .zlm-Datei am PC, wenn LernModule als App installiert
// ist (manifest.webmanifest: file_handlers, app.js: launchQueue). Nur zum
// Ansehen – ohne Anmeldung und ohne Server: das Dokument mit Bildern und
// bedienbaren Quizzen, darüber die Stiftbeschriftung aus der Datei.

/** Die Datei lesen und anzeigen; ein Fehler kommt als Meldung. */
export async function openZlmFile(app, file) {
  const [{ readZlm, specForView, editorStateOf }, { H5pRenderer }, { showInkView }] = await Promise.all([
    import('../../lm-editor/src/zlm/zlm.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('../../lm-editor/src/ink/ink-view.js'),
  ]);
  let doc;
  try {
    doc = readZlm(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    app.showToast(`⚠️ ${file.name || 'Die Datei'} lässt sich nicht öffnen: ${err.message}`, 'error');
    return;
  }
  document.querySelector('.zlm-viewer')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'zlm-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', doc.manifest.title || file.name);
  overlay.innerHTML = `
    <div class="zlm-viewer-bar">
      <span class="zlm-viewer-title">📄 <strong>${escapeHtml(doc.manifest.title || 'Dokument')}</strong>
        <span class="hint">${escapeHtml(file.name || '')} · nur ansehen</span></span>
      <button type="button" class="btn btn-secondary btn-sm zlm-viewer-close">✕ Schließen</button>
    </div>
    <div class="zlm-viewer-body"><div class="zlm-viewer-doc module-description-content"></div></div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input, textarea, [contenteditable="true"]')) close(); };
  overlay.querySelector('.zlm-viewer-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  // Ohne Gastgeber: keine Knöpfe für Stift und PDF; „Lösungen zeigen“ gibt es (kein Quiz-Durchlauf).
  const view = overlay.querySelector('.zlm-viewer-doc');
  const renderer = new H5pRenderer();
  view.appendChild(renderer.createTypePreview('document', { spec: specForView(doc), kind: doc.manifest.kind }, {
    blockIds: true, embedModule: (id) => doc.modules[id] || null, moduleId: doc.manifest.id, title: doc.manifest.title,
  }));
  // Stiftbeschriftung der Datei (die der Lehrkraft, sonst die erste).
  const layer = doc.layers.teacher || Object.values(doc.layers)[0] || null;
  const stand = editorStateOf(layer);
  if (stand) await showInkView(view, stand, { landscape: doc.spec.orientation === 'landscape' }).catch(() => false);
}
