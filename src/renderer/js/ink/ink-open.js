// ==================== STIFT-EDITOR ÖFFNEN ====================
//
// Ein Dokument im Stift-Editor (lm-editor) öffnen – aus der Ansicht des
// Dokuments (lm-host.js) und aus der Kopfzeile der Notebook-Vorschau.
// Hintergrund ist das Dokument selbst auf einem A4-Blatt, mit den
// eingebetteten Quizzen (`embedModule`). Wahlweise das PDF: Schüler holen es
// über ihren Link (nur das Blatt), Lehrkräfte über den Renderer (dazu das
// Lösungsblatt).

/**
 * `mode`: 'teacher' | 'student'; `mod`: { id, title, content: { spec, kind } };
 * `up`: Zugang der Schüler ({ linkToken | quickToken, password, studentTicket });
 * `embedModule(id)`: Modul eines eingebetteten Quiz (wie im Durchlauf).
 */
export async function openDocumentInk({ mode, mod, up = null, embedModule = null }) {
  const [{ openInkEditor }, { H5pRenderer }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-editor.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
  ]);
  let content = mod.content || {};
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = {}; } }
  const loadPdf = async (variant) => {
    const res = mode === 'student'
      ? await fetch(`/api/public/document/${encodeURIComponent(mod.id)}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkToken: up?.linkToken || undefined, quickToken: up?.quickToken || undefined, password: up?.password || undefined, studentTicket: up?.studentTicket || undefined }),
      })
      : await fetch('/api/worksheets/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || ''}` },
        body: JSON.stringify({ spec: content.spec || { content: [] }, title: mod.title || '', output: variant === 'loesung' ? 'loesung_pdf' : 'pdf', moduleId: mod.id, kind: content.kind }),
      });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
    return res.arrayBuffer();
  };
  // Ohne Gastgeber: Im Blatt gibt es keine Knöpfe (Stift, PDF) und keinen Weiter-Knopf.
  const renderer = new H5pRenderer();
  const paper = {
    landscape: content.spec?.orientation === 'landscape',
    mount(el, { solutions }) {
      el.appendChild(renderer.createTypePreview('document', content, {
        blockIds: true, quizMode: true, embedModule, upload: up, moduleId: mod.id, title: mod.title,
      }));
      if (solutions) el.querySelector('.docspec')?.classList.remove('ds-hide-solutions');
    },
  };
  return openInkEditor({ title: mod.title || 'Arbeitsblatt', key: `${mode}:${mod.id}`, loadPdf, solutions: mode === 'teacher', paper });
}
