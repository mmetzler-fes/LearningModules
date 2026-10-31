import { pickQuiz } from '../quiz-picker.js';
import { pickPdfBlocks } from '../views/attachment-convert.js';

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
 * `editable` (Lehrkraft, eigenes Lernthema): ⊕ und Schreibfelder ändern das
 * Dokument selbst, `onSaved(modul)` danach (mit dem neuen Inhalt); `topicModules`: Module des Lernthemas
 * für „Quiz einfügen“.
 */
/**
 * Gespeicherte Beschriftung über die Ansicht `el` eines Dokuments legen (nur
 * zum Ansehen, lm-editor/src/ink/ink-view.js). Schüler mit Ausweis: der
 * Stand bei der Lehrkraft (ohne PIN-Abfrage – fehlt sie, bleibt es ohne);
 * sonst der auf diesem Gerät.
 */
export async function showSavedInk(el, { mode, up = null, moduleId, landscape = false }) {
  const [{ showInkView, hasPaperInk, mergeStands }, { savedInk }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-view.js'),
    import('../../lm-editor/src/ink/ink-editor.js'),
  ]);
  let stand = null;
  if (mode === 'student' && up?.linkToken && up?.studentTicket) {
    const { peekWork } = await import('./work-store.js');
    const res = await peekWork({ up, moduleId });
    stand = mergeStands(res?.data || null, res?.teacher || null);
  } else if (mode === 'teacher') {
    // Eigenes Dokument: die Beschriftung auf dem Server – sonst die auf diesem Gerät.
    const remote = await teacherInkGet(moduleId);
    stand = (remote?.own && remote.data) || await savedInk(`${mode}:${moduleId}`);
  } else {
    stand = await savedInk(`${mode}:${moduleId}`);
  }
  if (!hasPaperInk(stand)) return false;
  // Erst messen, wenn die Ansicht auf der Seite steht.
  for (let i = 0; i < 50 && !el.isConnected; i++) await new Promise((r) => setTimeout(r, 100));
  if (!el.isConnected) return false;
  return showInkView(el, stand, { landscape });
}

// ---- Beschriftung der Lehrkraft auf dem Server (src/work/teacher-ink.service.ts) ----

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || ''}` });

/** `{ data, visibility, own }` – oder null (nicht angemeldet, Fehler). */
export async function teacherInkGet(moduleId) {
  try {
    const res = await fetch(`/api/teacher-ink/${encodeURIComponent(moduleId)}`, { headers: authHeaders(), cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}

/** `{ data?, visibility? }` speichern – `{ success, visibility }` oder null. */
export async function teacherInkPut(moduleId, body) {
  try {
    const res = await fetch(`/api/teacher-ink/${encodeURIComponent(moduleId)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}

/**
 * Speicher für die Beschriftung der Lehrkraft auf ihrem eigenen Dokument:
 * auf dem Server, auf allen Geräten. Was bisher nur auf diesem Gerät lag,
 * kommt beim ersten Öffnen mit. Fremde Dokumente: null (dann wie bisher im Browser).
 */
async function teacherStore(moduleId) {
  const remote = await teacherInkGet(moduleId);
  if (!remote?.own) return null;
  let initial = remote.data || null;
  if (!initial) {
    const { savedInk } = await import('../../lm-editor/src/ink/ink-editor.js');
    initial = await savedInk(`teacher:${moduleId}`);
  }
  return {
    label: 'auf dem Server',
    load: async () => initial,
    async save(data) { return (await teacherInkPut(moduleId, { data }))?.success === true; },
  };
}

export async function openDocumentInk({ mode, mod, up = null, embedModule = null, store = null, title = null, sourceEl = null, editable = false, onSaved = null, topicModules = null }) {
  // Beschriftung der Lehrkraft, die die Schüler unter ihrer eigenen sehen (nur zum Ansehen).
  let teacherLayer = null;
  if (!store && mode === 'student' && up?.linkToken && up?.studentTicket) {
    const { serverWorkStore } = await import('./work-store.js');
    const opened = await serverWorkStore({ up, moduleId: mod.id });
    if (!opened) return null;
    store = opened.store;
    teacherLayer = opened.teacher?.layer || null;
  }
  if (!store && mode === 'teacher') store = await teacherStore(mod.id);
  const [{ openInkEditor }, { H5pRenderer }, { captureForms, restoreForms }, { assignPathIds, pathId, ensureBlockIds }, { drawLayer }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-editor.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('./form-state.js'),
    import('../../lm-editor/src/doc/ids.js'),
    import('../../lm-editor/src/ink/ink-view.js'),
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
      if (teacherLayer) drawLayer(el, teacherLayer, { className: 'ink-teacher-layer' });
      if (solutions) el.querySelector('.docspec')?.classList.remove('ds-hide-solutions');
    },
    capture: (el) => (lastForms = captureForms(el)),
    // Gespeicherte Eingaben; ohne sie, was im Durchlauf schon eingetragen war.
    restore: (el, forms) => restoreForms(el, forms && Object.keys(forms).length ? forms : fromSource),
  };
  // Lehrkraft am eigenen Dokument: Einfügen und Schreibfelder gehen ins Dokument.
  if (mode === 'teacher' && editable && mod.topicId) Object.assign(paper, documentEditing());
  // Lehrkraft: Drucken über den Renderer – mit Vorlage und, wenn gewünscht, Beschriftung.
  if (mode === 'teacher') {
    paper.printPdf = (data, { solutions, win }) => printPdf(data, solutions, win);
    // Kopfzeile der Vorlage als Vorschau – ob sie erscheint, ist eine Einstellung des Kontos.
    paper.head = {
      get: () => !!window.appSettings?.get().inkTemplateHead,
      set: (on) => window.appSettings?.set({ inkTemplateHead: !!on }),
    };
    // Dazu ein Blatt ohne Inhalt, mit der Kopfzeile dieses Dokuments.
    paper.headerPdf = async () => {
      const res = await fetch('/api/worksheets/render', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ spec: { ...(content.spec || {}), content: [] }, title: mod.title || '', output: 'pdf', moduleId: mod.id, kind: content.kind }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
      return res.arrayBuffer();
    };
  }
  const onClose = () => {
    if (sourceEl && lastForms) restoreForms(sourceEl, lastForms);
    // Die neue Beschriftung gleich in der Ansicht zeigen.
    if (sourceEl) void showSavedInk(sourceEl, { mode, up, moduleId: mod.id, landscape: paper.landscape });
  };
  return openInkEditor({ title: title || mod.title || 'Arbeitsblatt', key: `${mode}:${mod.id}`, loadPdf, solutions: mode === 'teacher', paper, store, onClose, actions: runActions() });

  /**
   * PDF über den Renderer (wie „Drucken“ im Modul-Editor): das Dokument mit
   * Feldern, Einfügungen und Beschriftung aus dem Stift-Editor (ink-print.js).
   * Liefert die Hinweise des Renderers.
   */
  async function printPdf(data, solutions, win) {
    const { applyInkToSpec } = await import('../../lm-editor/src/ink/ink-print.js');
    const spec = applyInkToSpec(content.spec || { content: [] }, data);
    const res = await fetch('/api/worksheets/render', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ spec, title: mod.title || '', output: solutions ? 'loesung_pdf' : 'pdf', moduleId: mod.id, kind: content.kind }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body.message || `HTTP ${res.status}`) + (Array.isArray(body.errors) ? ` ${body.errors.join(' · ')}` : ''));
    }
    let warnings = [];
    try { warnings = JSON.parse(decodeURIComponent(res.headers.get('X-Worksheet-Warnings') || '[]')); } catch (_) { /* ohne Hinweise */ }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.open(url, '_blank');
    return warnings;
  }

  /**
   * Im Durchlauf (Schüler): Zurück und Weiter gleich im Stift-Editor – speichern,
   * schließen, dann der Knopf des Durchlaufs (quiz.js). Weiter heißt wie dort
   * (Weiter, Abschließen, Prüfen …); Zurück nur, wo der Durchlauf es zulässt.
   */
  function runActions() {
    const next = document.getElementById('btnQuizNext');
    if (mode !== 'student' || !sourceEl || !next || next.style.display === 'none') return [];
    const prev = document.getElementById('btnQuizPrev');
    const go = (id) => async ({ close }) => {
      await close();
      document.getElementById(id)?.click();
    };
    const out = [];
    if (prev && prev.style.display !== 'none' && !prev.disabled) {
      out.push({ label: '◀ Zurück', title: 'Speichern und zur vorigen Aufgabe', onClick: go('btnQuizPrev') });
    }
    const label = (next.textContent || 'Weiter').replace(/\s*[→▶]\s*$/, '').trim() || 'Weiter';
    out.push({ label: `${label} ▶`, title: 'Speichern und weiter zur nächsten Aufgabe', onClick: go('btnQuizNext') });
    return out;
  }

  /** Baustein zu einer ID der Stift-Ebene (feste ID, „p:2.0“ oder pos2x0) – mit seiner Liste. */
  function blockRef(spec, bid) {
    let found = null;
    const go = (list, prefix) => {
      if (!Array.isArray(list) || found) return;
      list.forEach((b, i) => {
        if (found || !b || typeof b !== 'object') return;
        const path = prefix ? `${prefix}.${i}` : String(i);
        if (b.id === bid || `p:${path}` === bid || pathId(path) === bid) found = { list, index: i, block: b };
        else go(b.blocks, path);
      });
    };
    go(spec?.content, '');
    return found;
  }

  async function saveDocument() {
    const token = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || '';
    const res = await fetch(`/api/topics/${encodeURIComponent(mod.topicId)}/modules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...mod, content, updatedAt: new Date().toISOString() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.message || `Speichern fehlgeschlagen (${res.status})`);
    onSaved?.({ ...mod, content });
  }

  // Neue Bausteine bekommen feste IDs; alle anderen vorher ihre jetzige
  // Position (pos…) – so bleiben Striche der Schüler an ihrem Baustein.
  function specNow() {
    const spec = content.spec && typeof content.spec === 'object' ? structuredClone(content.spec) : { content: [] };
    if (!Array.isArray(spec.content)) spec.content = [];
    return spec;
  }

  async function insertBlocks(after, blocks) {
    const spec = specNow();
    assignPathIds(spec);
    // Mitgebrachte IDs (z. B. aus dem PDF) könnten schon vergeben sein.
    const fresh = JSON.parse(JSON.stringify(blocks, (k, v) => (k === 'id' ? undefined : v)));
    const ref = after ? blockRef(spec, after) : null;
    if (!after) spec.content.unshift(...fresh);
    else if (ref) ref.list.splice(ref.index + 1, 0, ...fresh);
    else spec.content.push(...fresh);
    ensureBlockIds(spec);
    content = { ...content, spec };
    await saveDocument();
  }

  function documentEditing() {
    return {
      insertBlock: (after, block) => insertBlocks(after, [block]),
      // Weitere Einträge im ⊕-Menü; Abbruch im Dialog gibt false (nichts gespeichert).
      insertItems: () => [
        { label: '🧩 Quiz aus dem Lernthema', run: async (after) => {
          const block = await pickQuiz(topicModules || [], mod.id);
          if (!block) return false;
          return insertBlocks(after, [block]);
        } },
        // Die Dateiauswahl muss noch im Antippen aufgehen (iPad) – daher kein await davor.
        { label: '📄 PDF an dieser Stelle', run: async (after) => {
          const res = await pickPdfBlocks();
          if (!res) return false;
          return insertBlocks(after, res.blocks);
        } },
      ],
      async setField(bid, field) {
        const spec = specNow();
        const ref = blockRef(spec, bid);
        if (!ref || ref.block.type !== 'karo') throw new Error('Schreibfeld nicht gefunden.');
        ref.block.lines = field.lines;
        if (field.width) ref.block.width = `${field.width}cm`; else delete ref.block.width;
        if (field.pattern && field.pattern !== 'karo') ref.block.pattern = field.pattern; else delete ref.block.pattern;
        content = { ...content, spec };
        await saveDocument();
      },
    };
  }
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
