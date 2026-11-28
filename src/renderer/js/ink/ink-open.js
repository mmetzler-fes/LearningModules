
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
 * `editable` (Lehrkraft, eigenes Lernthema): Der Stift-Editor bleibt ihre Ebene (Lehrerlösung); dazu
 * „✏️ Vorlage bearbeiten“ (Modul-Editor) und „→ In die Schülervorlage übernehmen“ für eine Auswahl,
 * `onSaved(modul)` danach (mit dem neuen Inhalt). `topicModules`: Module des Lernthemas.
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

/**
 * Schüler arbeiten nur im Stift-Editor (docs/arbeitsflaeche.md): Der Durchlauf (quiz.js) schaltet das ein.
 * Dann übernimmt der Stift-Editor das lebende Blatt aus dem Durchlauf, statt es neu zu zeichnen – Eingaben,
 * gezogene Wörter, „Prüfen“, Lernbegleitung und Auswertung bleiben dieselben.
 */
let liveDefault = false;
export function setStudentLiveInk(on) { liveDefault = !!on; }
export const studentLiveInk = () => liveDefault;

export async function openDocumentInk({ mode, mod, up = null, embedModule = null, store = null, title = null, sourceEl = null, editable = false, onSaved = null, topicModules = null, examMode = false, examRun = false, shuffleKey = null, live = liveDefault && mode === 'student' && !!sourceEl }) {
  const isDoc = (mod?.type || 'document') === 'document';
  if (live) {
    const { closeInkEditor } = await import('../../lm-editor/src/ink/ink-editor.js');
    await closeInkEditor(); // höchstens ein Editor – ein offener gibt sein Blatt erst zurück
  }
  // Beschriftung der Lehrkraft, die die Schüler unter ihrer eigenen sehen (nur zum Ansehen).
  let teacherLayer = null;
  if (!store && mode === 'student' && isDoc && up?.linkToken && up?.studentTicket) {
    const { serverWorkStore } = await import('./work-store.js');
    const opened = await serverWorkStore({ up, moduleId: mod.id });
    if (!opened) return null;
    store = opened.store;
    teacherLayer = opened.teacher?.layer || null;
  }
  // Eigenes Dokument der Lehrkraft: Die Beschriftung ist ihre 🔑 Lehrerlösung (gilt für alle Klassen).
  let solutionTitle = null;
  if (!store && mode === 'teacher') {
    store = await teacherStore(mod.id);
    if (store && !title) solutionTitle = `🔑 Lehrerlösung – ${mod.title || 'Dokument'}`;
  }
  // Arbeitsfläche der Lehrkraft: ein Dokument aus einem Lernthema bekommt einen Tab (Tafelbild, Lösung u. Ä. nicht).
  let wsTeacher = null;
  if (mode === 'teacher' && !title && mod?.id && mod.topicId) {
    const { workspace } = await import('../workspace.js');
    if (workspace.on && String(workspace.key).startsWith('t:')) {
      wsTeacher = workspace;
      workspace.mark({ id: `d|${mod.id}`, topicId: mod.topicId, moduleId: mod.id, own: !!editable, title: mod.title || 'Dokument', icon: '📄' });
    }
  }
  const [{ openInkEditor }, { H5pRenderer }, { captureForms, restoreForms }, { assignPathIds, pathId, ensureBlockIds }, { drawLayer }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-editor.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('./form-state.js'),
    import('../../lm-editor/src/doc/ids.js'),
    import('../../lm-editor/src/ink/ink-view.js'),
  ]);
  let lastForms = null;
  let content = mod.content || {};
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = {}; } }
  const fromSource = sourceEl ? captureForms(sourceEl) : null;
  // Klassenarbeit (Durchlauf oder Dokument der Art „Klassenarbeit“): für Schüler nie als Datei –
  // kein PDF-Hintergrund, kein Drucken, Teilen oder Bildschirmfoto (der Server lehnt das PDF ohnehin ab).
  const noExport = mode === 'student' && (examRun || content.kind === 'klassenarbeit');
  const loadPdf = !isDoc || noExport ? null : async (variant) => {
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
  // Vom Gastgeber nur HTML-Apps (eingebettete Quizze) und ausführbares Python: Im Blatt gibt es keine
  // Knöpfe (Stift, PDF) und keinen Weiter-Knopf. Ohne sie stand dort „HTML-Apps laufen nur in LearningModules“
  // bzw. Python war nur Code zum Lesen.
  const { lmHost } = await import('../lm-host.js');
  const renderer = new H5pRenderer({ host: { htmlApp: (args) => lmHost.htmlApp(args), pythonBlocks: (args) => lmHost.pythonBlocks(args) } });
  // Lebendes Blatt: Platzhalter im Durchlauf, ob Lösungen dort verborgen waren, Hülle eines Quiz ohne Dokument.
  let liveMark = null;
  let liveHide = false;
  let liveWrap = null;
  let nextWatch = null;

  /**
   * „Weiter“ auch neben „Überprüfen“ (Feedback: oben in der Leiste übersieht man ihn) – drückt den
   * Weiter-Knopf der Leiste (speichern, schließen, nächste Aufgabe). Nicht bei HTML-Apps: deren
   * Leiste bekommt keine weitere Zeile. Rendert das Quiz neu, kommt der Knopf wieder dazu.
   */
  function inlineNext(el) {
    const actions = runActions();
    const next = actions[actions.length - 1];
    if (!next) return;
    const isCheck = (b) => /Check$/.test(b.id || '') || /(^|\s)[a-z]+-check(\s|$)/.test(b.className || '');
    const add = () => {
      el.querySelectorAll('button').forEach((b) => {
        if (!isCheck(b) || b.closest('.lm-app-bar, .lm-app-title-actions')) return;
        if (b.nextElementSibling?.classList.contains('ink-inline-next')) return;
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-secondary btn-sm ink-inline-next';
        go.textContent = next.label;
        go.title = next.title || '';
        go.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Weiter ist immer der letzte Knopf des Gastgebers in der Leiste.
          [...document.querySelectorAll('.ink-overlay .ink-action')].pop()?.click();
        });
        b.after(go);
      });
    };
    add();
    nextWatch?.disconnect();
    nextWatch = new MutationObserver(() => { nextWatch.disconnect(); add(); nextWatch.observe(el, { childList: true, subtree: true }); });
    nextWatch.observe(el, { childList: true, subtree: true });
  }
  const { removeInkView } = live ? await import('../../lm-editor/src/ink/ink-view.js') : {};
  // Lehrkraft am eigenen Dokument: hoch oder quer nach der Vorlage (am Dokument oder am Ordner) –
  // das gespeicherte orientation kann veraltet sein, etwa nach einem Wechsel der Vorlage am Ordner.
  let landscape = content.spec?.orientation === 'landscape';
  let page = null; // Seite der Vorlage: Seitenumbrüche und „volle Breite“ wie im Druck
  if (mode === 'teacher' && isDoc && mod?.id && mod.topicId) {
    try {
      const res = await fetch('/api/worksheets/context', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ moduleId: mod.id, title: mod.title || '' }) });
      page = res.ok ? (await res.json())?.page || null : null;
      if (page?.width && page?.height) {
        landscape = page.width > page.height;
        if (content.spec) {
          if (landscape) content.spec.orientation = 'landscape';
          else delete content.spec.orientation;
        }
      }
    } catch (_) { /* dann wie gespeichert */ }
  }
  const paper = {
    landscape,
    page,
    // Eigene Bausteine (Text, Tabelle, Bild über ⊕) – nicht in Klassenarbeiten: Dort ändert niemand den Aufbau.
    ownBlocks: !(examMode || examRun || content.kind === 'klassenarbeit'),
    mount(el, { solutions }) {
      if (live) {
        if (!liveMark) {
          removeInkView?.(sourceEl); // die Ansicht der gespeicherten Beschriftung – der Editor zeichnet sie selbst
          liveMark = document.createComment('ink-live');
          sourceEl.replaceWith(liveMark);
          liveHide = !!sourceEl.querySelector('.docspec.ds-hide-solutions');
        }
        if (isDoc) el.appendChild(sourceEl);
        else {
          // Quiz ohne Dokument: als ein Baustein auf dem Blatt – Striche hängen an ihm, der Pfeil bedient es.
          if (!liveWrap) {
            liveWrap = document.createElement('div');
            liveWrap.className = 'docspec ink-quiz-sheet';
            liveWrap.innerHTML = '<div class="ds-b ds-quiz-live" data-bid="quiz" data-bpath="0"></div>';
          }
          liveWrap.firstElementChild.appendChild(sourceEl);
          el.appendChild(liveWrap);
        }
        sourceEl.querySelector('.docspec')?.classList.toggle('ds-hide-solutions', liveHide && !solutions);
        inlineNext(el);
      } else {
        el.appendChild(renderer.createTypePreview('document', content, {
          blockIds: true, quizMode: true, examMode, examRun, shuffleKey, noSolutionToggle: true, embedModule, upload: up, moduleId: mod.id, title: mod.title,
        }));
        if (solutions) el.querySelector('.docspec')?.classList.remove('ds-hide-solutions');
      }
      if (teacherLayer) drawLayer(el, teacherLayer, { className: 'ink-teacher-layer' });
    },
    // Lebendes Blatt zurück in den Durchlauf (vor jedem neuen Aufbau und beim Schließen).
    unmount() {
      if (!live || !liveMark) return;
      nextWatch?.disconnect();
      nextWatch = null;
      sourceEl.querySelectorAll('.ink-inline-next').forEach((x) => x.remove());
      // Auch Anfasser und ⊕ des Editors: Sie hängen an ihm und wirkten nach dem nächsten Öffnen ins Leere.
      sourceEl.querySelectorAll('.ink-teacher-layer, [data-inserted], .ink-karo-handle, .ink-insert-mark').forEach((x) => x.remove());
      if (liveHide) sourceEl.querySelector('.docspec')?.classList.add('ds-hide-solutions');
      liveMark.replaceWith(sourceEl);
      liveMark = null;
    },
    capture: (el) => (lastForms = captureForms(el)),
    // Gespeicherte Eingaben; ohne sie, was im Durchlauf schon eingetragen war.
    restore: (el, forms) => {
      restoreForms(el, forms && Object.keys(forms).length ? forms : fromSource);
    },
  };
  // Lehrkraft am eigenen Dokument: Der Stift-Editor ist ihre Ebene (Lehrerlösung) – Einfügen und Schreibfelder
  // bleiben darin wie bei den Schülern. Die Vorlage ändert der Modul-Editor; einzige Brücke: Auswahl
  // „→ In die Schülervorlage übernehmen“ (paper.toTemplate).
  if (mode === 'teacher' && editable && mod.topicId && isDoc) paper.toTemplate = (after, block) => insertBlocks(after, [block]);
  // Schüler im Durchlauf: das Blatt mit Beschriftung als PDF mit der Vorlage der Lehrkraft – auf dem
  // iPad gleich ins Teilen-Menü (GoodNotes), sonst im neuen Fenster (📤 neben 🖨).
  if (mode === 'student' && isDoc && !noExport && (up?.linkToken || up?.quickToken)) {
    const { canShareFiles } = await import('../share-file.js');
    paper.printWindow = !canShareFiles();
    paper.share = { title: 'An GoodNotes – das Blatt mit deiner Beschriftung als PDF teilen' };
    paper.printPdf = (data, { solutions, win }) => studentPdf(data, solutions, win);
  }
  // Lehrkraft: Drucken über den Renderer – mit Vorlage und, wenn gewünscht, Beschriftung.
  if (mode === 'teacher') {
    paper.printPdf = (data, { solutions, win }) => printPdf(data, solutions, win);
    // Kopfzeile der Vorlage als Vorschau – ob sie erscheint, ist eine Einstellung des Kontos.
    paper.head = {
      // Nie eingestellt: an – wie im Druck (print-dialog.js: templateHeadDefault).
      get: () => window.appSettings?.get().inkTemplateHead !== false,
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
  // Lernbegleitung: Die Lerneule sitzt im Stift-Editor links; beim Schließen holt sie die Lernbegleitung zurück.
  const side = live ? document.getElementById('companionPanel') : null;
  let navigating = false; // Weiter/Zurück im Durchlauf – nicht ✕
  const onClose = () => {
    if (side) window.dispatchEvent(new Event('resize'));
    if (live) {
      // ✕ (nicht Weiter/Zurück): Schüler gehen nach 🏠 Home – die Ansicht ohne Stift gibt es für sie nicht.
      if (!navigating) {
        import('../workspace.js').then(({ workspace }) => {
          if (workspace.on && String(workspace.key).startsWith('s:') && !workspace.busy) workspace.home();
        }).catch(() => {});
      }
      if (sourceEl && isDoc) void showSavedInk(sourceEl, { mode, up, moduleId: mod.id, landscape: paper.landscape });
      return;
    }
    // Lehrkraft: Stift-Editor zu = zurück in der App (Home); der Tab bleibt.
    if (wsTeacher && wsTeacher.active === `d|${mod.id}` && !wsTeacher.busy) wsTeacher.markHome();
    if (sourceEl && lastForms) restoreForms(sourceEl, lastForms);
    // Die neue Beschriftung gleich in der Ansicht zeigen.
    if (sourceEl) void showSavedInk(sourceEl, { mode, up, moduleId: mod.id, landscape: paper.landscape });
  };
  return openInkEditor({ title: title || solutionTitle || mod.title || 'Arbeitsblatt', key: `${mode}:${mod.id}`, loadPdf, solutions: isDoc && (mode === 'teacher' || JSON.stringify(content.spec || {}).includes('"type":"solution"')), laser: mode === 'teacher', paper, store, onClose, actions: [...runActions(), ...teacherActions()], side, noExport,
    // Quizze auf PC, Tablet und Handy als ganze Seite (⤢) – Dokumente wie bisher (Handy: ganze Breite).
    fit: isDoc ? null : 'page' });

  /**
   * PDF über den Renderer (wie „Drucken“ im Modul-Editor): das Dokument mit
   * Feldern, Einfügungen und Beschriftung aus dem Stift-Editor (ink-print.js).
   * Liefert die Hinweise des Renderers.
   */
  async function printPdf(data, solutions, win) {
    const [{ applyInkToSpec }, { fieldMaxCm }] = await Promise.all([import('../../lm-editor/src/ink/ink-print.js'), import('../../lm-editor/src/ink/ink-view.js')]);
    const spec = applyInkToSpec(content.spec || { content: [] }, data, { fullCm: fieldMaxCm(paper.landscape, paper.page) });
    const res = await fetch('/api/worksheets/render', {
      method: 'POST',
      headers: authHeaders(),
      // Kopfzeile wie in der Ansicht des Stift-Editors (Knopf neben 🖨, Vorgabe aus den Einstellungen).
      body: JSON.stringify({ spec, title: mod.title || '', output: solutions ? 'loesung_pdf' : 'pdf', moduleId: mod.id, kind: content.kind, quizzes: await quizPrintPref(),
        templateHead: window.appSettings?.get().inkTemplateHead !== false }),
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

  /** Schüler: PDF über den Server (POST /api/public/document/:id/ink-pdf) – teilen oder anzeigen. */
  async function studentPdf(data, solutions, win) {
    const res = await fetch(`/api/public/document/${encodeURIComponent(mod.id)}/ink-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkToken: up?.linkToken || undefined, quickToken: up?.quickToken || undefined, password: up?.password || undefined,
        studentTicket: up?.studentTicket || undefined, spec: content.spec || { content: [] }, ink: data, solutions: !!solutions,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const { deliverPdf, fileNameOf } = await import('../share-file.js');
    deliverPdf(await res.blob(), fileNameOf(res, mod.title || 'Arbeitsblatt'), win);
    return [];
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
      navigating = true;
      await close();
      document.getElementById(id)?.click();
      // Der Durchlauf öffnet den Stift-Editor wieder, wenn die Aufgabe stehen bleibt (quiz.js).
      if (live) setTimeout(() => window.dispatchEvent(new Event('lm-ink-step')), 450);
    };
    const out = [];
    if (prev && prev.style.display !== 'none' && !prev.disabled) {
      out.push({ label: '◀ Zurück', title: 'Speichern und zur vorigen Aufgabe', onClick: go('btnQuizPrev') });
    }
    // Ohne Pfeile und Emojis (✅ Quiz beenden) – Text in der Leiste und neben „Überprüfen“.
    const label = (next.textContent || 'Weiter').replace(/\s*[→▶]\s*$/, '').replace(/^\p{Extended_Pictographic}\S*\s*/u, '').trim() || 'Weiter';
    out.push({ label: `${label} ▶`, title: 'Speichern und weiter zur nächsten Aufgabe', onClick: go('btnQuizNext') });
    return out;
  }

  /**
   * Lehrkraft am eigenen Dokument: „📄 Als Lösungsblatt“ – die Lösung als eigenes Blatt (eigenes Lernthema
   * direkt dahinter, Titel „… – Lösung“): Lösungsblöcke offen, Labore mit der Lösung (solution-sheet.js).
   * So lässt sie sich per Quick-Link weitergeben (dort fallen Lösungsblöcke sonst weg).
   */
  function teacherActions() {
    if (mode !== 'teacher' || !editable || !mod.topicId || !isDoc) return [];
    return [{
      label: '✏️ Vorlage bearbeiten',
      title: 'Die Schülervorlage im Modul-Editor ändern – hier im Stift-Editor schreibst du deine Lehrerlösung',
      async onClick({ close }) {
        await close();
        const from = document.querySelector('.view.active')?.id?.replace(/^view-/, '') || 'teacher-notebooks';
        await window.app?.modulesView?.openFrom(from, mod.topicId, mod, 'edit');
      },
    }, {
      label: '📄 Als Lösungsblatt',
      title: 'Die Lösung als eigenes Blatt speichern (eigenes Lernthema direkt dahinter): Lösungsblöcke offen, Labore mit deiner Lösung – zum Weitergeben per Quick-Link',
      async onClick() {
        const title = `${mod.title || 'Dokument'} – Lösung`;
        if (!(await (window.appConfirm ? window.appConfirm(`„${title}“ als eigenes Blatt direkt hinter diesem Lernthema anlegen?`) : Promise.resolve(confirm(`„${title}“ anlegen?`))))) return;
        const { solutionSpec, labStatesFromForms } = await import('./solution-sheet.js');
        // Laborstände der Lehrerlösung
        const root = document.querySelector('.ink-overlay');
        const states = !root ? {} : labStatesFromForms(captureForms(root));
        const spec = solutionSpec(content.spec || { content: [] }, states);
        try {
          const res = await fetch(`/api/topics/${encodeURIComponent(mod.topicId)}/modules`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ type: 'document', title, content: { ...content, spec } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
          window.app?.showToast?.(`📄 „${title}“ liegt als eigenes Lernthema direkt dahinter – dort den Quick-Link erzeugen.`, 'success');
        } catch (err) {
          window.app?.showToast?.(`Lösungsblatt: ${err.message}`, 'error');
        }
      },
    }];
  }

  /** Baustein zu einer ID der Stift-Ebene (feste ID, „p:2.0“ oder pos2x0) – mit seiner Liste. */
  function blockRef(spec, bid) {
    // Erst die echte Kennung, die Position nur für Bausteine ohne Kennung: Nach dem Verschieben trägt
    // ein anderer Baustein die alte Position – z. B. „pos2“ – und würde sonst statt des gemeinten gefunden.
    const search = (match) => {
      let found = null;
      const go = (list, prefix) => {
        if (!Array.isArray(list) || found) return;
        list.forEach((b, i) => {
          if (found || !b || typeof b !== 'object') return;
          const path = prefix ? `${prefix}.${i}` : String(i);
          if (match(b, path)) found = { list, index: i, block: b };
          else go(b.blocks, path);
        });
      };
      go(spec?.content, '');
      return found;
    };
    return search((b) => b.id === bid)
      || search((b, path) => !b.id && (`p:${path}` === bid || pathId(path) === bid));
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

}

/**
 * Eigenes Blatt zu einem gelöschten Dokument (Schüler, Antwort von …/gone-work): die gespeicherte
 * Fassung ohne Lösungen. Gespeichert wird nichts.
 */
export async function openGoneWork(work) {
  return openDocumentInk({
    mode: 'student',
    mod: { id: work.moduleId, title: work.title, type: 'document', content: work.content },
    embedModule: (id) => (work.embedded || []).find((m) => m.id === id) || null,
    title: `${work.title} (nur zum Ansehen)`,
    store: { label: 'nicht (nur Ansicht)', load: async () => work.data, save: async () => true },
  });
}

/**
 * PDF über den Renderer (Lehrkraft): das Dokument `mod` mit der Beschriftung `data`
 * (Tafelbild oder Lehrerlösung), wie „Drucken“ im Stift-Editor. `win`: vorher geöffnetes Fenster.
 */
export async function printWithInk(mod, data, win = null) {
  let content = mod.content || {};
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch (_) { content = {}; } }
  const { applyInkToSpec } = await import('../../lm-editor/src/ink/ink-print.js');
  const spec = data ? applyInkToSpec(content.spec || { content: [] }, data) : (content.spec || { content: [] });
  const res = await fetch('/api/worksheets/render', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ spec, title: mod.title || '', output: 'pdf', moduleId: mod.id, kind: content.kind, quizzes: await quizPrintPref() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body.message || `HTTP ${res.status}`) + (Array.isArray(body.errors) ? ` ${body.errors.join(' · ')}` : ''));
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url; else window.open(url, '_blank');
}

/** Quizze im Ausdruck wie zuletzt im Druckdialog gewählt (Vorgabe: mit Druckfassung). */
async function quizPrintPref() {
  const { printPrefs } = await import('../views/print-dialog.js');
  return printPrefs().quizzes;
}

/**
 * ✍️ Tafelbild der Lehrkraft für Schüler (Antwort von …/boards/:moduleId): das Dokument mit
 * ihrer Beschriftung, nur zum Ansehen. Gespeichert wird nichts – das eigene Blatt bleibt unberührt.
 */
export async function openBoardView(board, label = '✍️ Tafelbild') {
  return openDocumentInk({
    mode: 'student',
    mod: { id: board.moduleId, title: board.title, type: 'document', content: board.content },
    embedModule: (id) => (board.embedded || []).find((m) => m.id === id) || null,
    title: `${label} – ${board.title} (nur zum Ansehen)`,
    store: { label: 'nicht (nur Ansicht)', load: async () => board.data, save: async () => true },
  });
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
