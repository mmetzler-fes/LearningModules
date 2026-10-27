import { escapeHtml, generateId } from '../utils.js';
import { isDocumentFile, fileToSpec, askConvertOptions } from './attachment-convert.js';
import { openDocViewer, openZlmFile } from './zlm-viewer.js';

// ==================== DATEIEN „ÖFFNEN MIT“ ====================
//
// Am PC (installierte App, Chrome/Edge) gibt der Explorer Dateien an
// LernModule: rechte Maustaste → „Öffnen mit“ (manifest.webmanifest,
// file_handlers; app.js: launchQueue). .zlm zeigt der Betrachter sofort.
// Writer, Word, PDF und Xournal++ (.xopp mit ihrem PDF) wandelt der Server um
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
      if (!pdf) {
        const ok = await app.appConfirm(`„${f.name}“ beschriftet das PDF „${xopp.pdfName || '…'}“ – es steckt nicht in der .xopp-Datei.\n\nJetzt das PDF auswählen?`);
        pdf = ok ? await chooseFile('.pdf,application/pdf') : null;
        if (!pdf) continue;
      }
      used.add(pdf);
    }
    jobs.push({ kind: 'xopp', file: f, xopp, pdf });
  }
  for (const f of files) {
    if (ext(f) === 'xopp' || used.has(f)) continue;
    if (isDocumentFile(f, true)) jobs.push({ kind: 'doc', file: f });
    else app.showToast(`${f.name}: Geöffnet werden .odt, .docx, .pdf, .xopp und .zlm.`, 'error');
  }
  if (!jobs.length) return;
  let pdfChoice = null;
  if (jobs.some((j) => (j.kind === 'doc' && ext(j.file) === 'pdf') || (j.kind === 'xopp' && j.xopp.needsPdf))) {
    try {
      pdfChoice = await askConvertOptions({ count: jobs.length, keepOption: false, heading: '📄 PDF öffnen', intro: 'Wie soll das PDF zum Dokument werden?' });
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

/** Ziel wählen und das Dokument dort anlegen; true, wenn es geklappt hat. */
async function fileIntoNotebook(app, doc) {
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
  const res = await app.api.saveModule(topicId, {
    id, type: 'document', title: doc.title || 'Dokument', description: '',
    content: { kind: 'arbeitsblatt', spec: doc.spec }, moduleSelected: true, createdAt: now, updatedAt: now,
  });
  if (!res?.success) throw new Error(res?.message || 'Speichern fehlgeschlagen');
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
 * Wohin im Notizbuch: ein eigenes Lernthema (das Dokument kommt dazu) oder
 * ein Ordner bzw. „Unsortiert“ (dort entsteht ein neues Lernthema).
 * `{ topicId }` oder `{ nodeId, newTitle }`, dazu `label` – oder null.
 */
async function pickPlace(app, title) {
  const tree = await app.api.getNotebooks();
  if (!tree || tree.statusCode >= 400) throw new Error(tree?.message || 'Notizbuch nicht abrufbar');
  const topics = new Map((tree.topics || []).filter((t) => t.isOwn !== false).map((t) => [t.id, t]));
  const kids = new Map();
  for (const n of tree.nodes || []) {
    const k = n.parentId || '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  }
  const placed = new Map();
  for (const p of tree.placements || []) {
    const k = p.nodeId || '';
    if (!placed.has(k)) placed.set(k, []);
    placed.get(k).push(p);
  }
  const byOrder = (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  const icon = { book: '📓', area: '📂', section: '📑' };
  const rows = [{ kind: 'node', id: null, label: 'Unsortiert', icon: '📥', depth: 0 }];
  const walk = (parent, depth) => {
    for (const n of (kids.get(parent) || []).sort(byOrder)) {
      rows.push({ kind: 'node', id: n.id, label: n.title, icon: icon[n.kind] || '📂', depth });
      walk(n.id, depth + 1);
    }
    for (const p of (placed.get(parent) || []).sort(byOrder)) {
      const t = topics.get(p.topicId);
      if (t) rows.push({ kind: 'topic', id: t.id, label: t.title, icon: '📘', depth });
    }
  };
  walk('', 0);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card cb-picker" role="dialog" aria-modal="true">
        <h3>📓 Im Notizbuch ablegen</h3>
        <p class="hint">Ein Lernthema wählen – das Dokument kommt dazu. Oder einen Ordner: Dort entsteht ein neues Lernthema mit diesem Namen:</p>
        <input type="text" class="search-input fo-title" maxlength="200" value="${escapeHtml(title || 'Dokument')}" aria-label="Name des neuen Lernthemas">
        <ul class="cb-picker-list">${rows.map((r, i) => `<li data-i="${i}" style="padding-left:${0.4 + r.depth * 1.2}rem">
          <button type="button" class="cb-picker-row">${r.icon} ${escapeHtml(r.label)}${r.kind === 'node' ? ' <span class="hint">– neues Lernthema hier</span>' : ''}</button></li>`).join('')}</ul>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary fo-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.fo-cancel').addEventListener('click', () => done(null));
    overlay.querySelectorAll('[data-i]').forEach((li) => li.querySelector('button').addEventListener('click', () => {
      const r = rows[Number(li.dataset.i)];
      const newTitle = overlay.querySelector('.fo-title').value.trim() || title || 'Dokument';
      done(r.kind === 'topic' ? { topicId: r.id, label: r.label } : { nodeId: r.id, newTitle, label: r.id ? `${r.label} › ${newTitle}` : newTitle });
    }));
  });
}
