import { escapeHtml, escapeAttr, generateId } from '../utils.js';
import { isDocumentFile, fileToSpec, askConvertOptions } from './attachment-convert.js';
import { openDocViewer, openZlmFile } from './zlm-viewer.js';

// ==================== DATEIEN „ÖFFNEN MIT“ ====================
//
// Am PC (installierte App, Chrome/Edge) gibt der Explorer Dateien an
// LernModule: rechte Maustaste → „Öffnen mit“ (manifest.webmanifest,
// file_handlers; app.js: launchQueue). .zlm zeigt der Betrachter sofort.
// Writer, Word, Folien (.odp, .odg, .pptx), PDF und Xournal++ (.xopp mit ihrem PDF – fehlt es, sucht
// xopp-folder.js im Ordner der .xopp) wandelt der Server um
// – dafür braucht es die Anmeldung; bis dahin warten die Dateien. Angezeigt
// wird das Dokument (bei .xopp mit der Handschrift), „📓 Im Notizbuch
// ablegen“ macht daraus ein Modul „Dokument“ in einem Lernthema.

let pending = [];
const ext = (f) => (/\.([a-z0-9]+)$/i.exec(f?.name || '')?.[1] || '').toLowerCase();
const base = (name) => String(name || '').replace(/\.[^.]+$/, '').toLowerCase();

/** Dateien vom Explorer annehmen. Ohne Anmeldung als Lehrkraft warten sie (takePendingFiles). */
export async function handleOpenedFiles(app, files) {
  for (const f of files.filter((x) => ext(x) === 'zlm')) await openZlmFile(app, f);
  const rest = files.filter((x) => ext(x) !== 'zlm');
  if (!rest.length) return;
  const user = app.state.currentUser;
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    pending.push(...rest);
    app.showToast(`Bitte anmelden – danach öffnet sich ${rest.length === 1 ? `„${rest[0].name}“` : `${rest.length} Dateien`}.`, 'info');
    return;
  }
  await openConverted(app, rest);
}

/** Wie handleOpenedFiles, wartet aber auch mit einer .zlm auf die Anmeldung: Ablegen geht erst dann. */
export async function openWhenSignedIn(app, file) {
  const user = app.state.currentUser;
  if (user?.role === 'teacher' || user?.role === 'admin') { await handleOpenedFiles(app, [file]); return; }
  pending.push(file);
  app.showToast(`Bitte anmelden – danach öffnet sich „${file.name}“.`, 'info');
}

/** Nach der Anmeldung: die wartenden Dateien. */
export function takePendingFiles() {
  const files = pending;
  pending = [];
  return files;
}

/** Datei wählen (z. B. das PDF zur .xopp) – im Klick, sonst blockt der Browser. */
function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Umwandeln und nacheinander anzeigen. */
async function openConverted(app, files) {
  if (!(app.state.currentUser?.features || []).includes('worksheets')) {
    app.showToast('Dokumente sind für dein Konto nicht freigeschaltet (Administration → Benutzer: „Arbeitsblätter“).', 'error');
    return;
  }
  const { readXoppFile, xoppToDocument } = await import('../xopp-import.js');
  const { pdfFromKnownFolder, pickPdfNear, canReadFolder } = await import('../xopp-folder.js');
  // .xopp mit ihrem PDF paaren: über den Namen in der .xopp, sonst gleicher Name.
  const pdfs = files.filter((f) => ext(f) === 'pdf');
  const used = new Set();
  const jobs = [];
  for (const f of files.filter((x) => ext(x) === 'xopp')) {
    let xopp;
    try { xopp = await readXoppFile(f); } catch (err) { app.showToast(`${f.name}: ${err.message}`, 'error'); continue; }
    let pdf = null;
    if (xopp.needsPdf) {
      const want = String(xopp.pdfName || '').toLowerCase();
      pdf = pdfs.find((p) => !used.has(p) && p.name.toLowerCase() === want)
        || pdfs.find((p) => !used.has(p) && base(p.name) === base(want))
        || pdfs.find((p) => !used.has(p) && base(f.name).startsWith(base(p.name)))
        || null;
      // Sonst im Ordner der .xopp (xopp-folder.js) – ohne Dialog, wenn er schon freigegeben ist.
      if (!pdf) pdf = await pdfFromKnownFolder(f, xopp);
      if (!pdf) {
        const ok = await app.appConfirm(canReadFolder(f)
          ? `„${f.name}“ beschriftet das PDF „${xopp.pdfName || '…'}“ – es steckt nicht in der .xopp-Datei.\n\nIm Ordner der .xopp danach suchen? (Der Browser fragt einmal, ob die App den Ordner lesen darf.)`
          : `„${f.name}“ beschriftet das PDF „${xopp.pdfName || '…'}“ – es steckt nicht in der .xopp-Datei.\n\nJetzt das PDF auswählen?`);
        pdf = ok ? await pickPdfNear(f, xopp, { confirm: (m) => app.appConfirm(m), fallback: chooseFile }) : null;
        if (!pdf) continue;
      }
      used.add(pdf);
    }
    jobs.push({ kind: 'xopp', file: f, xopp, pdf });
  }
  for (const f of files) {
    if (ext(f) === 'xopp' || used.has(f)) continue;
    if (isDocumentFile(f, true)) jobs.push({ kind: 'doc', file: f });
    else app.showToast(`${f.name}: Geöffnet werden .odt, .docx, .odp, .odg, .pptx, .pdf, .xopp und .zlm.`, 'error');
  }
  if (!jobs.length) return;
  let pdfChoice = null;
  if (jobs.some((j) => (j.kind === 'doc' && ext(j.file) === 'pdf') || (j.kind === 'xopp' && j.xopp.needsPdf))) {
    try {
      pdfChoice = await askConvertOptions({ count: jobs.length, heading: '📄 PDF öffnen', intro: 'Wie soll das PDF zum Dokument werden?' });
    } catch (err) { app.showToast(err.message, 'error'); return; }
    if (!pdfChoice) return;
  }
  for (const job of jobs) {
    const busy = `${job.file.name} wird umgewandelt …`;
    app.showToast(busy, 'info');
    let doc;
    try {
      doc = job.kind === 'xopp'
        ? await xoppToDocument(job.xopp, { name: job.file.name, pdfFile: job.pdf, pdf: pdfChoice })
        : { ...(await fileToSpec(job.file, { pdf: pdfChoice })), stand: null, count: 0 };
    } catch (err) {
      app.showToast(`${job.file.name}: ${err.message}`, 'error');
      continue;
    }
    if (doc.warnings?.length) app.showToast(doc.warnings.slice(0, 3).join(' · '), 'info');
    await openDocViewer(app, {
      title: doc.title,
      subtitle: `${job.file.name}${job.pdf ? ` + ${job.pdf.name}` : ''}${doc.count ? ` · ✍️ ${doc.count} Striche` : ''} · noch nicht gespeichert`,
      spec: doc.spec, stand: doc.stand, landscape: doc.spec?.orientation === 'landscape',
      actions: [{
        label: '📓 Im Notizbuch ablegen…', primary: true,
        title: 'Als Modul „Dokument“ in ein Lernthema – die Handschrift wird deine Beschriftung (nur für dich)',
        onClick: async (close) => { if (await fileIntoNotebook(app, doc)) close(); },
      }],
    });
  }
}

/**
 * Ziel wählen und das Dokument dort anlegen; true, wenn es geklappt hat.
 * `doc`: `{ title, spec, stand, kind?, modules? }` – `modules` sind die eingebetteten
 * Quizze einer .zlm; sie bekommen neue IDs (die alten können schon woanders liegen).
 */
export async function fileIntoNotebook(app, doc) {
  const place = await pickPlace(app, doc.title);
  if (!place) return false;
  let topicId = place.topicId;
  if (!topicId) {
    const topic = await app.api.saveTopic({ title: place.newTitle, description: '' });
    if (!topic?.id) throw new Error(topic?.message || 'Lernthema konnte nicht angelegt werden.');
    topicId = topic.id;
    if (place.nodeId) await app.api.moveInNotebook('topic', topicId, place.nodeId, null);
  }
  const id = generateId();
  const now = new Date().toISOString();
  const modules = Array.isArray(doc.modules) ? doc.modules : [];
  const newId = new Map(modules.map((m) => [String(m.id), generateId()]));
  const relink = (v) => {
    if (Array.isArray(v)) return v.map(relink);
    if (!v || typeof v !== 'object') return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x)]));
    if (out.type === 'quiz' && newId.has(String(out.module))) out.module = newId.get(String(out.module));
    return out;
  };
  const res = await app.api.saveModule(topicId, {
    id, type: 'document', title: doc.title || 'Dokument', description: '',
    content: { kind: doc.kind || 'arbeitsblatt', spec: relink(doc.spec) }, moduleSelected: true, createdAt: now, updatedAt: now,
  });
  if (!res?.success) throw new Error(res?.message || 'Speichern fehlgeschlagen');
  // Eingebettete Quizze: erst die obersten, dann ihre Untermodule.
  const ordered = [...modules.filter((m) => !m.parentId), ...modules.filter((m) => m.parentId)];
  let missing = 0;
  for (const m of ordered) {
    const saved = await app.api.saveModule(topicId, {
      id: newId.get(String(m.id)), type: m.type, title: m.title || '', description: m.description || '', content: m.content,
      ...(m.parentId && newId.has(String(m.parentId)) ? { parentId: newId.get(String(m.parentId)) } : {}),
      moduleSelected: true, createdAt: now, updatedAt: now,
    }).catch(() => null);
    if (!saved?.success) missing++;
  }
  if (missing) app.showToast(`${missing} eingebettete${missing === 1 ? 's Quiz' : ' Quizze'} ließ${missing === 1 ? '' : 'en'} sich nicht anlegen.`, 'error');
  if (doc.stand) {
    const { saveTeacherInk } = await import('../xopp-import.js');
    if (!(await saveTeacherInk(id, doc.stand))) app.showToast('Die Handschrift ließ sich nicht speichern.', 'error');
  }
  await app.loadTopics?.();
  app.showToast(`„${doc.title}“ liegt jetzt in „${place.label}“.`, 'success');
  if (await app.appConfirm(`„${doc.title}“ ist abgelegt.\n\nGleich bearbeiten?`)) {
    await app.modulesView.openFrom('teacher-notebooks', topicId, { id });
  }
  return true;
}

/**
 * .zlm der Art „module“ (Quiz, Übung oder HTML-App ohne Dokument) in ein
 * Lernthema: alle Module mit neuen IDs, die Datei einer HTML-App wird
 * hochgeladen (und dabei geprüft). true, wenn es geklappt hat.
 */
export async function fileModuleIntoNotebook(app, doc) {
  const main = doc.modules?.[doc.manifest.module];
  if (!main) throw new Error('Die Datei enthält kein Lernmodul.');
  const place = await pickPlace(app, doc.manifest.title);
  if (!place) return false;
  let topicId = place.topicId;
  if (!topicId) {
    const topic = await app.api.saveTopic({ title: place.newTitle, description: '' });
    if (!topic?.id) throw new Error(topic?.message || 'Lernthema konnte nicht angelegt werden.');
    topicId = topic.id;
    if (place.nodeId) await app.api.moveInNotebook('topic', topicId, place.nodeId, null);
  }
  const all = Object.entries(doc.modules || {}).map(([key, m]) => ({ ...m, id: String(m?.id ?? key) }));
  const newId = new Map(all.map((m) => [m.id, generateId()]));
  const now = new Date().toISOString();
  const contentOf = async (m) => {
    const file = m.content?.app?.file;
    if (m.type !== 'htmlApp' || typeof file !== 'string' || !file.startsWith('media/')) return m.content;
    const bytes = doc.media?.[file.slice(6)];
    if (!bytes) throw new Error('Die Datei der HTML-App fehlt in der .zlm.');
    const up = await app.api.uploadHtmlApp(new TextDecoder().decode(bytes));
    if (!up?.fileId) throw new Error(up?.message || 'Die HTML-App ließ sich nicht hochladen.');
    const { file: _f, ...rest } = m.content.app;
    return { ...m.content, app: { ...rest, fileId: up.fileId, manifest: up.manifest ?? null, size: up.size } };
  };
  const ordered = [...all.filter((m) => !m.parentId), ...all.filter((m) => m.parentId)];
  for (const m of ordered) {
    const res = await app.api.saveModule(topicId, {
      id: newId.get(m.id), type: m.type, title: m.title || '', description: m.description || '', content: await contentOf(m),
      ...(m.parentId && newId.has(String(m.parentId)) ? { parentId: newId.get(String(m.parentId)) } : {}),
      moduleSelected: true, createdAt: now, updatedAt: now,
    });
    if (!res?.success) throw new Error(res?.message || `„${m.title || m.id}“ ließ sich nicht speichern.`);
  }
  await app.loadTopics?.();
  app.showToast(`„${doc.manifest.title}“ liegt jetzt in „${place.label}“.`, 'success');
  return true;
}

/**
 * Wohin im Notizbuch: ein eigenes Lernthema (das Dokument kommt dazu) oder
 * ein Ordner bzw. „Unsortiert“ (dort entsteht ein neues Lernthema).
 * `{ topicId }` oder `{ nodeId, newTitle }`, dazu `label` – oder null.
 */
/**
 * Wohin im Notizbuch: ein eigenes Lernthema (das Dokument kommt dazu) oder
 * ein Ordner bzw. „Unsortiert“ (dort entsteht ein neues Lernthema).
 * `{ topicId }` oder `{ nodeId, newTitle }`, dazu `label` – oder null.
 *
 * Der Baum sieht aus wie im Lernnotizbuch: gleiche Reihenfolge, Namen und
 * Nummern, aufgeklappt ist, was dort offen ist (bzw. der Ordner, in den man
 * hineingewechselt ist). Die Suche zeigt nur Treffer und ihre Ordner.
 */
async function pickPlace(app, title) {
  const tree = await app.api.getNotebooks();
  if (!tree || tree.statusCode >= 400) throw new Error(tree?.message || 'Notizbuch nicht abrufbar');
  const nodes = new Map((tree.nodes || []).map((n) => [n.id, n]));
  const topics = new Map((tree.topics || []).filter((t) => t.isOwn !== false).map((t) => [t.id, t]));
  const byOrder = (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  const kids = new Map();
  for (const n of [...nodes.values()].sort(byOrder)) {
    const k = n.parentId || '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  }
  const placed = new Map();
  for (const p of [...(tree.placements || [])].sort(byOrder)) {
    const t = topics.get(p.topicId);
    if (!t) continue;
    const k = p.nodeId || '';
    if (!placed.has(k)) placed.set(k, []);
    placed.get(k).push(t);
  }
  const nums = tree.nodeNumbers || {};
  const icon = { book: '📓', area: '📂', section: '📑' };
  const pathOf = (id) => {
    const out = [];
    for (let n = nodes.get(id); n && out.length < 20; n = nodes.get(n.parentId)) out.unshift(n.title);
    return out.join(' › ');
  };

  // Aufgeklappt wie im Lernnotizbuch (notebooks.js: lm_nb_open, lm_nb_focus).
  const open = new Set();
  let focus = null;
  try {
    for (const k of JSON.parse(localStorage.getItem('lm_nb_open') || '[]')) if (String(k).startsWith('n:')) open.add(String(k).slice(2));
    focus = localStorage.getItem('lm_nb_focus') || null;
  } catch (_) { /* ohne Speicher: alles zu */ }
  if (!nodes.has(focus)) focus = null;
  for (let n = nodes.get(focus); n; n = nodes.get(n.parentId)) open.add(n.id);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card cb-picker fo-picker" role="dialog" aria-modal="true">
        <h3>📓 Im Notizbuch ablegen</h3>
        <p class="hint">Ein Lernthema 📘 wählen – das Dokument kommt dazu. Oder bei einem Ordner <strong>＋ Neues Lernthema</strong>: Dort entsteht ein Lernthema mit diesem Namen:</p>
        <input type="text" class="search-input fo-title" maxlength="200" value="${escapeHtml(title || 'Dokument')}" aria-label="Name des neuen Lernthemas">
        <input type="search" class="search-input fo-search" placeholder="🔍 Ordner oder Lernthema suchen …" aria-label="Im Notizbuch suchen">
        <div class="fo-tree" role="tree"></div>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary fo-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const list = overlay.querySelector('.fo-tree');
    const search = overlay.querySelector('.fo-search');
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.fo-cancel').addEventListener('click', () => done(null));
    const newTitle = () => overlay.querySelector('.fo-title').value.trim() || title || 'Dokument';

    // Suche: Treffer im Titel; ein Ordner bleibt, wenn er selbst oder etwas darin passt.
    const hits = (text, q) => text.toLowerCase().includes(q);
    const nodeMatch = new Map();
    const matches = (id, q) => {
      if (nodeMatch.has(id)) return nodeMatch.get(id);
      const n = nodes.get(id);
      const yes = hits(n.title, q) || (placed.get(id) || []).some((t) => hits(t.title, q))
        || (kids.get(id) || []).some((k) => matches(k.id, q));
      nodeMatch.set(id, yes);
      return yes;
    };

    const render = () => {
      const q = search.value.trim().toLowerCase();
      nodeMatch.clear();
      const rows = [];
      const topicRow = (t, depth) => rows.push(`<div class="fo-row" style="--depth:${depth}">
          <span class="nb-twisty-space"></span>
          <button type="button" class="fo-pick fo-topic" data-topic="${escapeAttr(t.id)}" title="Das Dokument kommt in dieses Lernthema">📘 ${escapeHtml(t.title)}</button></div>`);
      const walk = (parent, depth) => {
        for (const n of kids.get(parent) || []) {
          if (q && !matches(n.id, q)) continue;
          const isOpen = q ? true : open.has(n.id);
          const empty = !(kids.get(n.id) || []).length && !(placed.get(n.id) || []).length;
          rows.push(`<div class="fo-row fo-node${n.id === focus ? ' fo-focus' : ''}" style="--depth:${depth}">
              ${empty ? '<span class="nb-twisty-space"></span>' : `<button type="button" class="nb-twisty" data-toggle="${escapeAttr(n.id)}" aria-expanded="${isOpen}" title="${isOpen ? 'Zuklappen' : 'Aufklappen'}">${isOpen ? '▾' : '▸'}</button>`}
              <span class="fo-label" data-toggle="${escapeAttr(n.id)}">${icon[n.kind] || '📂'} ${nums[n.id] ? `<span class="nb-num">${escapeHtml(nums[n.id])}</span>` : ''}${escapeHtml(n.title)}</span>
              <button type="button" class="btn btn-secondary btn-sm fo-pick" data-node="${escapeAttr(n.id)}" title="Hier ein neues Lernthema anlegen – das Dokument kommt hinein">＋ Neues Lernthema</button></div>`);
          if (!isOpen) continue;
          walk(n.id, depth + 1);
          for (const t of placed.get(n.id) || []) if (!q || hits(t.title, q) || hits(n.title, q)) topicRow(t, depth + 1);
        }
      };
      const unsorted = (placed.get('') || []).filter((t) => !q || hits(t.title, q));
      if (!q || unsorted.length || hits('unsortiert', q)) {
        const isOpen = q ? true : open.has('');
        rows.push(`<div class="fo-row fo-node" style="--depth:0">
            ${unsorted.length ? `<button type="button" class="nb-twisty" data-toggle="" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'}</button>` : '<span class="nb-twisty-space"></span>'}
            <span class="fo-label" data-toggle="">📥 Unsortiert</span>
            <button type="button" class="btn btn-secondary btn-sm fo-pick" data-node="" title="Neues Lernthema unter „Unsortiert“">＋ Neues Lernthema</button></div>`);
        if (isOpen) for (const t of unsorted) topicRow(t, 1);
      }
      walk('', 0);
      list.innerHTML = rows.join('') || '<p class="hint fo-empty">Nichts gefunden.</p>';
      list.querySelector('.fo-focus')?.scrollIntoView({ block: 'center' });
    };

    list.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle && !search.value.trim()) {
        const id = toggle.dataset.toggle;
        if (open.has(id)) open.delete(id); else open.add(id);
        render();
        return;
      }
      const pick = e.target.closest('.fo-pick');
      if (!pick) return;
      if (pick.dataset.topic) {
        const t = topics.get(pick.dataset.topic);
        done({ topicId: t.id, label: t.title });
      } else {
        const id = pick.dataset.node || null;
        const name = newTitle();
        done({ nodeId: id, newTitle: name, label: id ? `${pathOf(id)} › ${name}` : name });
      }
    });
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 150); });
    render();
    search.focus();
  });
}
