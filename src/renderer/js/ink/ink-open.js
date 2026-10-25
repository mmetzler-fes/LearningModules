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
 * `embedModule(id)`: Modul eines eingebetteten Quiz (wie im Durchlauf);
 * `store`, `title`: anderswo speichern als auf dem Gerät (siehe openInkEditor).
 * Schüler mit Schülerausweis (Klassenlink) speichern bei der Lehrkraft
 * (work-store.js); sonst bleibt die Beschriftung auf dem Gerät.
 * `sourceEl`: die Ansicht des Dokuments im Durchlauf – Quiz-Eingaben kommen
 * von dort mit ins Stift-Fenster und beim Schließen wieder zurück, damit
 * „Weiter“ sie auswertet.
 */
export async function openDocumentInk({ mode, mod, up = null, embedModule = null, store = null, title = null, sourceEl = null }) {
  if (!store && mode === 'student' && up?.linkToken && up?.studentTicket) {
    const { serverWorkStore } = await import('./work-store.js');
    const opened = await serverWorkStore({ up, moduleId: mod.id });
    if (!opened) return null;
    store = opened.store;
  }
  const [{ openInkEditor }, { H5pRenderer }, { captureForms, restoreForms }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-editor.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('./form-state.js'),
  ]);
  const fromSource = sourceEl ? captureForms(sourceEl) : null;
  let lastForms = null;
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
    capture: (el) => (lastForms = captureForms(el)),
    // Gespeicherte Eingaben; ohne sie, was im Durchlauf schon eingetragen war.
    restore: (el, forms) => restoreForms(el, forms && Object.keys(forms).length ? forms : fromSource),
  };
  const onClose = () => { if (sourceEl && lastForms) restoreForms(sourceEl, lastForms); };
  return openInkEditor({ title: title || mod.title || 'Arbeitsblatt', key: `${mode}:${mod.id}`, loadPdf, solutions: mode === 'teacher', paper, store, onClose });
}

/**
 * Bearbeitung eines Schülers ansehen (Lehrkraft): das Dokument mit seiner
 * Beschriftung. Geändert wird dabei nichts – der Stand gehört dem Schüler.
 * `work`: Eintrag aus GET /api/work/:id; `api`: die Api der App.
 */
export async function openStudentWork(api, work) {
  // Das Blatt so, wie der Schüler es vor sich hatte (Fassung beim Speichern);
  // ältere Bearbeitungen ohne Fassung zeigen das aktuelle Dokument.
  let mod = null;
  let modules = [];
  if (work.version?.content) {
    mod = { id: work.moduleId, title: work.version.title, type: 'document', content: work.version.content };
    modules = work.version.embedded || [];
  } else {
    modules = work.topicId ? await api.getTopicModules(work.topicId) : [];
    mod = Array.isArray(modules) ? modules.find((m) => m.id === work.moduleId) : null;
  }
  if (!mod) throw new Error('Das Dokument gibt es nicht mehr.');
  return openDocumentInk({
    mode: 'teacher',
    mod,
    embedModule: (id) => modules.find((m) => m.id === id) || null,
    title: `${work.studentName} – ${mod.title || work.moduleTitle}`,
    store: { label: 'nicht (nur Ansicht)', load: async () => work.data, save: async () => true },
  });
}
