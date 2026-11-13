import { escapeHtml } from '../utils.js';
import { downloadBlob } from '../api.js';
import { writeOneSection } from '../onenote-write.js';
import { zipStore } from '../odf/sheet-templates.js';
import { planRun } from '../../lm-editor/src/doc/doc-quiz.js';

// ==================== FÜR ONENOTE AUSGEBEN ====================
//
// Der umgekehrte Weg zu onenote-import.js: Lernthemen werden OneNote-Seiten,
// damit Kolleginnen und Kollegen mit OneNote sie in ihr Notizbuch ziehen
// können. Je Dokument eine Seite „Lernthema – Dokument“ mit Link und QR-Code
// zur Live-Fassung, dem Stand und dem Ausdruck als Seitenbilder (darauf lässt
// sich mit dem Stift schreiben). Quizze, die in keinem Dokument stecken,
// stehen gemeinsam auf „Lernthema – Quiz“.
//
// Aufbau wie beim Import: Abschnitt → .one-Datei, Bereich/Book → Ordner im
// ZIP. Lernnotizbuch: anonyme Quick-Links; Klassennotizbuch: Links ins
// Klassennotizbuch (Name und PIN), ohne Klassenarbeiten. Siehe docs/onenote-export.md.

const PAGE_SCALE = 2; // 144 dpi – gut zum Beschreiben, noch handliche Dateien
const JPEG_QUALITY = 0.82;

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || ''}` });
const fileSafe = (s) => String(s || 'Ohne Titel').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Ohne Titel';
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-–—.]+/g, '');
const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** „Lernthema – Dokument“; heißen beide (fast) gleich, nur einmal. */
export function pageTitle(topicTitle, docTitle) {
  if (!docTitle) return topicTitle;
  if (!topicTitle || norm(topicTitle) === norm(docTitle)) return docTitle;
  return `${topicTitle} – ${docTitle}`;
}

const contentOf = (mod) => {
  let c = mod.content || {};
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
  return c;
};

// ---------- Bilder: QR-Codes und Seiten ----------

async function canvasBytes(canvas, type, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** QR-Codes für mehrere Adressen über den Server (SVG) → PNG. */
async function qrPngs(urls) {
  if (!urls.length) return [];
  const res = await fetch('/api/links/qr', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ urls }) });
  const { svgs = [] } = res.ok ? await res.json() : {};
  const out = [];
  for (const svg of svgs) {
    if (!svg) { out.push(null); continue; }
    try {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const size = 360;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);
      out.push({ data: await canvasBytes(c, 'image/png'), width: size, height: size });
    } catch (_) { out.push(null); }
  }
  return out;
}

let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('../../lm-editor/src/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../lm-editor/src/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

/** Dokument über den Renderer als PDF, dann jede Seite als JPEG. */
async function documentPages(mod) {
  const content = contentOf(mod);
  const res = await fetch('/api/worksheets/render', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ spec: content.spec || { content: [] }, title: mod.title || '', output: 'pdf', moduleId: mod.id, kind: content.kind }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body.message || `HTTP ${res.status}`) + (Array.isArray(body.errors) ? ` ${body.errors.join(' · ')}` : ''));
  }
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: PAGE_SCALE });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push({ data: await canvasBytes(c, 'image/jpeg', JPEG_QUALITY), width: c.width, height: c.height, widthIn: base.width / 72 });
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

// ---------- Seiten eines Lernthemas ----------

/**
 * `modules`: sichtbare Module des Lernthemas (oberste Ebene, sortiert).
 * `linkFor(moduleId)` → Adresse. Ergebnis: Seiten für writeOneSection.
 */
async function topicPages(topicTitle, modules, linkFor, { images, onStep, warnings }) {
  const { steps } = planRun(modules);
  const docs = modules.filter((m) => m.type === 'document');
  const others = steps.filter((m) => m.type !== 'document');
  const allQuizzes = others.length ? linkFor(others.map((m) => m.id).join(',')) : null;
  const qrs = await qrPngs([...docs.map((m) => linkFor(m.id)), ...(allQuizzes ? [allQuizzes] : [])]);
  const qrOf = new Map(docs.map((m, i) => [m.id, qrs[i]]));
  const qrAll = allQuizzes ? qrs[docs.length] : null;
  const stand = `Stand ${today()} – die aktuelle Fassung gibt es über den Link.`;
  const pages = [];
  for (const doc of docs) {
    onStep(`${topicTitle}: ${doc.title}`);
    const blocks = [{ type: 'text', runs: [{ text: 'Live-Fassung: ' }, { text: doc.title || 'öffnen', href: linkFor(doc.id) }] }];
    const qr = qrOf.get(doc.id);
    if (qr) blocks.push({ type: 'image', ...qr, widthIn: 1.3, name: 'QR-Code.png', alt: `QR-Code: ${doc.title}` });
    blocks.push({ type: 'text', runs: [{ text: stand }] });
    if (images) {
      try {
        const shots = await documentPages(doc);
        shots.forEach((p, i) => blocks.push({ type: 'image', free: true, ext: '.jpeg', ...p, name: `${fileSafe(doc.title)} – Seite ${i + 1}.jpeg`, alt: `${doc.title}, Seite ${i + 1}` }));
      } catch (e) {
        warnings.push(`${doc.title}: kein Ausdruck (${e.message})`);
        blocks.push({ type: 'text', runs: [{ text: `Der Ausdruck ließ sich nicht erzeugen (${e.message}) – bitte den Link nutzen.` }] });
      }
    }
    pages.push({ title: pageTitle(topicTitle, doc.title), blocks });
  }
  // Quizze außerhalb von Dokumenten: ein Link für alle, mit „Weiter“ von Quiz zu Quiz;
  // die Titel stehen nur als Text darunter.
  if (others.length) {
    const blocks = [{ type: 'text', runs: [{ text: others.length === 1 ? 'Quiz: ' : `Alle ${others.length} Quizze nacheinander: ` }, { text: 'öffnen', href: allQuizzes }] }];
    if (qrAll) blocks.push({ type: 'image', ...qrAll, widthIn: 1.3, name: 'QR-Code.png', alt: `QR-Code: ${topicTitle} – Quiz` });
    others.forEach((m, i) => blocks.push({ type: 'text', runs: [{ text: `${i + 1}. ${m.title || 'Quiz'}` }] }));
    pages.push({ title: `${topicTitle} – Quiz`, blocks });
  }
  return pages;
}

// ---------- Ablauf und Dialog ----------

/**
 * Plan: `{ name, sections: [{ path: ['Ordner', …], name, topics: [{ title, load() → { modules, linkFor } }] }] }`.
 * Eine Datei ohne Ordner wird direkt als .one geladen, sonst ein ZIP.
 */
async function build(plan, { images, onProgress }) {
  const warnings = [];
  const total = plan.sections.reduce((n, s) => n + s.topics.length, 0);
  let done = 0;
  const files = [];
  const built = [];
  for (const section of plan.sections) {
    const pages = [];
    for (const topic of section.topics) {
      onProgress(done, total, topic.title);
      try {
        const { modules, linkFor } = await topic.load();
        pages.push(...await topicPages(topic.title, modules, linkFor, { images, warnings, onStep: (t) => onProgress(done, total, t) }));
      } catch (e) {
        warnings.push(`${topic.title}: ${e.message}`);
      }
      done++;
    }
    if (pages.length) built.push({ section, pages });
  }
  // Bleibt nur ein Abschnitt ohne Ordner übrig, heißt er wie das Ausgegebene
  // (z. B. Bereich „Javascript“ mit dem einzigen Abschnitt „Einleitung“).
  const single = built.length === 1 && !built[0].section.path.length;
  for (const { section, pages } of built) {
    const name = single ? plan.name : section.name;
    files.push({ name: [...section.path, `${fileSafe(name)}.one`].join('/'), data: writeOneSection({ name, pages }) });
  }
  onProgress(total, total, 'Fertig.');
  return { files, warnings };
}

function openDialog(app, { title, hint, plan }) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const topics = plan.sections.reduce((n, s) => n + s.topics.length, 0);
  overlay.innerHTML = `
    <div class="import-modules-card onenote-card" role="dialog" aria-modal="true" aria-labelledby="oneNoteExportTitle">
      <h3 id="oneNoteExportTitle">🟪 ${escapeHtml(title)}</h3>
      <p class="import-modules-hint">${hint}</p>
      <p class="hint">${plan.sections.length} Abschnitt${plan.sections.length === 1 ? '' : 'e'} · ${topics} Lernthem${topics === 1 ? 'a' : 'en'}.
        Je Dokument eine Seite mit Link, QR-Code und Ausdruck; Quizze außerhalb von Dokumenten gemeinsam auf einer Seite „… – Quiz“ mit einem Link für alle.</p>
      <label><input type="checkbox" class="one-images" checked> 🖼 Ausdruck als Seitenbilder mitnehmen (darauf lässt sich in OneNote schreiben – dauert je Dokument einige Sekunden)</label>
      <details class="hint" style="margin-top:8px;"><summary>So kommt es nach OneNote</summary>
        <ol style="margin:6px 0 0 18px;">
          <li>Die Datei landet als normaler Browser-Download im Download-Ordner (meist „Downloads“) – auf dem Server wird nichts abgelegt.</li>
          <li>Bei einem ZIP: entpacken. Jede .one-Datei ist ein Abschnitt, Ordner entsprechen Abschnittsgruppen.</li>
          <li>In <strong>OneNote für Windows</strong> (2016 bzw. Microsoft 365, nicht „OneNote für Windows 10“) die .one-Datei per Doppelklick öffnen – sie erscheint unter „Geöffnete Abschnitte“.</li>
          <li>Den Abschnitt mit der Maus ins eigene Notizbuch ziehen (Verschieben/Kopieren im Menü geht nur mit Zugang zum Schulnetz).</li>
          <li>Den geöffneten Abschnitt schließen (Rechtsklick → „Diesen Abschnitt schließen“) und die Datei löschen.</li>
        </ol></details>
      <div class="onenote-progress" hidden><progress max="1" value="0"></progress><span class="hint"></span></div>
      <div class="onenote-status" aria-live="polite"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary btn-run" ${topics ? '' : 'disabled'}>⬇️ Erstellen</button>
        <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const progress = overlay.querySelector('.onenote-progress');
  const bar = progress.querySelector('progress');
  const barText = progress.querySelector('span');
  const status = overlay.querySelector('.onenote-status');
  const btnRun = overlay.querySelector('.btn-run');
  const btnCancel = overlay.querySelector('.btn-cancel');
  let running = false;
  const close = () => {
    overlay.remove();
    if (running) app.showToast('Die OneNote-Ausgabe läuft weiter – bitte diesen Tab offen lassen.', 'info');
  };
  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !running) close(); });
  btnRun.addEventListener('click', async () => {
    running = true;
    btnRun.disabled = true;
    overlay.querySelector('.one-images').disabled = true;
    progress.hidden = false;
    try {
      const { files, warnings } = await build(plan, {
        images: overlay.querySelector('.one-images').checked,
        onProgress: (d, t, text) => { bar.max = t || 1; bar.value = d; barText.textContent = text; },
      });
      running = false;
      if (!files.length) {
        status.className = 'onenote-status is-error';
        status.textContent = '❌ Nichts zum Ausgeben – keine sichtbaren Dokumente oder Quizze.';
        return;
      }
      const single = files.length === 1 && !files[0].name.includes('/');
      const fileName = single ? files[0].name : `${fileSafe(plan.name)} (OneNote).zip`;
      if (single) downloadBlob(new Blob([files[0].data], { type: 'application/onenote' }), fileName);
      else downloadBlob(new Blob([zipStore(files.map((f) => ({ name: `${fileSafe(plan.name)}/${f.name}`, data: f.data })))], { type: 'application/zip' }), fileName);
      status.className = `onenote-status ${warnings.length ? '' : 'is-ok'}`;
      status.innerHTML = `✅ ${files.length} Abschnitt${files.length === 1 ? '' : 'e'} erstellt und als <strong>${escapeHtml(fileName)}</strong> heruntergeladen`
        + ' – zu finden im Download-Ordner des Browsers (meist „Downloads“), sofern der Browser nicht nach dem Speicherort gefragt hat.'
        + (warnings.length ? `<br>Hinweise: ${warnings.map(escapeHtml).join(' · ')}` : '');
      btnCancel.textContent = 'Schließen';
    } catch (e) {
      running = false;
      status.className = 'onenote-status is-error';
      status.textContent = `❌ ${e.message}`;
      btnRun.disabled = false;
    }
  });
}

// ---------- Lernnotizbuch: anonyme Quick-Links ----------

async function quickLinkUrl(api, topicId) {
  let res = await api.getQuickLink('topic', topicId).catch(() => null);
  if (!res?.exists) res = await api.saveQuickLink('topic', topicId, []).catch(() => null);
  if (!res?.url) throw new Error(res?.message || 'Quick-Link nicht verfügbar');
  return res.url;
}

/** Sichtbare Module eines eigenen Lernthemas: oberste Ebene, eingeschaltet, nicht 🔒. */
async function visibleModules(api, topicId) {
  const all = await api.getTopicModules(topicId);
  return (Array.isArray(all) ? all : [])
    .filter((m) => !m.parentId && m.moduleSelected !== false && !m.teacherOnly)
    .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
}

const notebookTopic = (api, topic) => ({
  title: topic.title,
  load: async () => {
    const url = await quickLinkUrl(api, topic.id);
    return { modules: await visibleModules(api, topic.id), linkFor: (id) => `${url}&mod=${encodeURIComponent(id)}` };
  },
});

/** Aus dem Lernnotizbuch: `{ nodeId }` (Book, Bereich, Abschnitt) oder `{ topicId }`. */
export async function openOneNoteExport(app, { nodeId = null, topicId = null } = {}) {
  const tree = await app.api.getNotebooks().catch(() => null);
  if (!tree?.nodes) { app.showToast('Lernnotizbuch nicht abrufbar.', 'error'); return; }
  const topicById = new Map((tree.topics || []).map((t) => [t.id, t]));
  const topicsIn = (id) => (tree.placements || []).filter((p) => p.nodeId === id)
    .sort((a, b) => a.orderIndex - b.orderIndex).map((p) => topicById.get(p.topicId)).filter(Boolean);
  const children = (id) => tree.nodes.filter((n) => n.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex);
  let plan;
  if (topicId) {
    const topic = topicById.get(topicId);
    if (!topic) { app.showToast('Nur eigene Lernthemen lassen sich ausgeben.', 'error'); return; }
    plan = { name: topic.title, sections: [{ path: [], name: topic.title, topics: [notebookTopic(app.api, topic)] }] };
  } else {
    const root = tree.nodes.find((n) => n.id === nodeId);
    if (!root) return;
    const sections = [];
    const walk = (node, path) => {
      const direct = topicsIn(node.id);
      if (node.kind === 'section') { sections.push({ path, name: node.title, topics: direct.map((t) => notebookTopic(app.api, t)) }); return; }
      if (direct.length) sections.push({ path, name: node.title, topics: direct.map((t) => notebookTopic(app.api, t)) });
      for (const c of children(node.id)) walk(c, c.kind === 'section' ? path : [...path, fileSafe(c.title)]);
    };
    walk(root, []);
    plan = { name: root.title, sections };
  }
  openDialog(app, {
    title: `Für OneNote ausgeben – ${plan.name}`,
    hint: 'Die Links sind <strong>anonyme Quick-Links</strong>: Schüler öffnen ohne Namen, es wird nichts gespeichert. Für Ergebnisse die Ausgabe im Klassennotizbuch nutzen. Gesperrte (🔒) und ausgeschaltete Module bleiben weg.',
    plan,
  });
}

// ---------- Klassennotizbuch: Links mit Name und PIN ----------

/** Aus dem Klassennotizbuch einer Klasse – ohne Klassenarbeiten und Ausgeblendetes. */
export async function openClassbookOneNoteExport(app, classId) {
  const cb = await app.api.getClassbook(classId).catch(() => null);
  if (!cb?.url) { app.showToast('Klassennotizbuch nicht abrufbar.', 'error'); return; }
  const hiddenNodes = new Set();
  const nodes = cb.nodes || [];
  const isHidden = (id) => {
    for (let n = nodes.find((x) => x.id === id); n; n = nodes.find((x) => x.id === n.parentId)) if (n.studentHidden) return true;
    return false;
  };
  nodes.forEach((n) => { if (isHidden(n.id)) hiddenNodes.add(n.id); });
  const links = (cb.links || []).filter((l) => l.inTree !== false && !l.veiled && l.examModuleIds === undefined && !(l.nodeId && hiddenNodes.has(l.nodeId)));
  const fullModules = new Map();
  const topicEntries = (l) => (l.topics || []).map((t) => ({
    title: t.title,
    load: async () => {
      if (!fullModules.has(t.id)) fullModules.set(t.id, await app.api.getTopicModules(t.id).catch(() => []));
      const byId = new Map((fullModules.get(t.id) || []).map((m) => [m.id, m]));
      const modules = (t.units || []).map((u) => byId.get(u.id)).filter(Boolean);
      return { modules, linkFor: (id) => `${cb.url}&cl=${encodeURIComponent(l.id)}&mod=${encodeURIComponent(id)}` };
    },
  }));
  const linksIn = (nodeId) => links.filter((l) => (l.nodeId || null) === nodeId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const children = (id) => nodes.filter((n) => (n.parentId || null) === id && !hiddenNodes.has(n.id)).sort((a, b) => a.orderIndex - b.orderIndex);
  const sections = [];
  const walk = (parentId, name, path) => {
    const direct = linksIn(parentId).flatMap(topicEntries);
    if (direct.length) sections.push({ path, name, topics: direct });
    for (const c of children(parentId)) {
      if (c.kind === 'section') sections.push({ path, name: c.title, topics: linksIn(c.id).flatMap(topicEntries) });
      else walk(c.id, c.title, [...path, fileSafe(c.title)]);
    }
  };
  walk(null, cb.className, []);
  openDialog(app, {
    title: `Für OneNote ausgeben – Klasse ${cb.className}`,
    hint: 'Die Links führen ins <strong>Klassennotizbuch</strong>: Schüler melden sich mit Name und PIN an, Ergebnisse landen in der Klasse. Klassenarbeiten und für Schüler Ausgeblendetes bleiben weg.',
    plan: { name: `Klasse ${cb.className}`, sections: sections.filter((s) => s.topics.length) },
  });
}
