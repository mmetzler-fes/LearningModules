// ==================== STIFT-EDITOR ÖFFNEN ====================
//
// Ein Dokument im Stift-Editor öffnen – aus der Ansicht des Dokuments
// (h5p-renderer.js) und aus der Kopfzeile der Notebook-Vorschau. Das PDF
// holen Schüler über ihren Link (nur das Blatt), Lehrkräfte über den
// Renderer (dazu das Lösungsblatt).

/**
 * `mode`: 'teacher' | 'student'; `mod`: { id, title, content: { spec, kind } };
 * `up`: Zugang der Schüler ({ linkToken | quickToken, password, studentTicket }).
 */
export async function openDocumentInk({ mode, mod, up = null }) {
  const { openInkEditor } = await import('./ink-editor.js');
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
  return openInkEditor({ title: mod.title || 'Arbeitsblatt', key: `${mode}:${mod.id}`, loadPdf, solutions: mode === 'teacher' });
}
