import { escapeHtml } from '../utils.js';
import { renderDocSpecHtml } from '../../lm-editor/src/doc/docspec.js';

// ==================== SICHERUNG: VERGLEICHEN VOR DEM ENTSCHEIDEN ====================
//
// „In der Nextcloud geändert“: Bevor die Lehrkraft übernimmt oder verwirft,
// sieht sie beide Fassungen nebeneinander – links der Stand der App, rechts
// die Datei aus der Nextcloud. Was sich unterscheidet, ist markiert
// (Bausteine der obersten Ebene, bei Quiz/HTML-App die Zeilen des Inhalts).

/**
 * Längste gemeinsame Teilfolge zweier Listen von Schlüsseln.
 * Liefert je Seite die Indizes, die in der anderen Liste kein Gegenstück haben.
 */
export function diffKeys(a, b) {
  const n = a.length;
  const m = b.length;
  // Gleicher Anfang und gleiches Ende vorab – die Tabelle bleibt klein.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const L = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const onlyA = [];
  const onlyB = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) onlyA.push(start + i++); else onlyB.push(start + j++);
  }
  while (i < A.length) onlyA.push(start + i++);
  while (j < B.length) onlyB.push(start + j++);
  return { onlyA, onlyB };
}

const blockKey = (b) => JSON.stringify(b ?? null);

/** Blatt einer Fassung: gerendertes Dokument, abweichende Bausteine mit `cls` markiert. */
function docSide(spec, marked, cls) {
  const box = document.createElement('div');
  box.className = 'worksheet-content nb-cmp-doc';
  box.innerHTML = renderDocSpecHtml(spec || { content: [] }, { showSolutions: true, showPageBreaks: true, blockIds: true });
  const set = new Set(marked);
  box.querySelectorAll('.ds-b[data-bpath]').forEach((el) => {
    const path = el.dataset.bpath;
    if (!path.includes('.') && set.has(Number(path))) el.classList.add(cls);
  });
  return box;
}

/** Inhalt eines Quiz/einer HTML-App als Zeilen (lesbares JSON), abweichende Zeilen markiert. */
function linesSide(lines, marked, cls) {
  const set = new Set(marked);
  const pre = document.createElement('pre');
  pre.className = 'nb-cmp-json';
  pre.innerHTML = lines.map((l, i) => `<span${set.has(i) ? ` class="${cls}"` : ''}>${escapeHtml(l) || ' '}</span>`).join('\n');
  return pre;
}

const moduleLines = (m) => JSON.stringify({ titel: m?.title ?? '', beschreibung: m?.description ?? '', inhalt: m?.content ?? null }, null, 2).split('\n');

/**
 * Vergleich öffnen. `file`: Eintrag aus getSicherungChanged; `onDecide(act)`
 * führt „take“ bzw. „discard“ aus (wie die Knöpfe in der Liste).
 */
export async function openSicherungCompare(app, file, { onDecide } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay nb-cmp-overlay';
  overlay.innerHTML = `<div class="import-modules-card nb-cmp-card"><h3>🔍 ${escapeHtml(file.title || 'Vergleichen')}</h3><p class="hint">Lade beide Fassungen …</p></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const res = await app.api.compareSicherung(file.key).catch((e) => ({ success: false, message: e?.message }));
  const card = overlay.querySelector('.nb-cmp-card');
  if (!res || res.success === false || res.statusCode || !res.app) {
    card.innerHTML = `<h3>🔍 ${escapeHtml(file.title || 'Vergleichen')}</h3><p class="ds-error">${escapeHtml(res?.message || 'Die Fassungen ließen sich nicht laden.')}</p>
      <div class="confirm-actions"><button type="button" class="btn btn-secondary nb-cmp-close">Schließen</button></div>`;
    card.querySelector('.nb-cmp-close').addEventListener('click', close);
    return;
  }

  let left;
  let right;
  let summary;
  if (res.kind === 'document') {
    const a = (res.app.spec?.content || []).map(blockKey);
    const b = (res.cloud.spec?.content || []).map(blockKey);
    const { onlyA, onlyB } = diffKeys(a, b);
    left = docSide(res.app.spec, onlyA, 'nb-cmp-old');
    right = docSide(res.cloud.spec, onlyB, 'nb-cmp-new');
    summary = onlyA.length || onlyB.length
      ? `${onlyB.length} Baustein${onlyB.length === 1 ? '' : 'e'} neu oder geändert, ${onlyA.length} entfällt bzw. ${onlyA.length === 1 ? 'wird' : 'werden'} ersetzt.`
      : 'Der Text des Dokuments ist in beiden Fassungen gleich.';
  } else {
    const a = moduleLines(res.app.module);
    const b = moduleLines(res.cloud.module);
    const { onlyA, onlyB } = diffKeys(a, b);
    left = linesSide(a, onlyA, 'nb-cmp-old');
    right = linesSide(b, onlyB, 'nb-cmp-new');
    summary = onlyA.length || onlyB.length ? `${onlyB.length} Zeile${onlyB.length === 1 ? '' : 'n'} im Inhalt neu oder geändert.` : 'Titel und Inhalt sind in beiden Fassungen gleich.';
  }
  const notes = [];
  if (res.app.title !== res.cloud.title) notes.push(`Titel: „${escapeHtml(res.app.title)}“ → „${escapeHtml(res.cloud.title)}“`);
  if (res.modules?.length) {
    notes.push(`${res.kind === 'document' ? 'Quizze' : 'Untermodule'} in der Datei: ${res.modules.map((m) => `„${escapeHtml(m.title || m.id)}“ (${m.change})`).join(', ')}`);
  }
  if (res.ink) notes.push('Die Datei enthält eine Beschriftung (Stift) – Übernehmen ersetzt die Beschriftung in der App.');

  card.innerHTML = `<h3>🔍 ${escapeHtml(file.title || res.app.title)}</h3>
    <p class="hint"><code>${escapeHtml(file.path || '')}</code></p>
    <p><strong>${summary}</strong></p>
    ${notes.length ? `<ul class="nb-cmp-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <div class="nb-cmp-grid">
      <div class="nb-cmp-col"><div class="nb-cmp-head">Bisher – Stand der App <span class="nb-cmp-swatch nb-cmp-old">entfällt</span></div><div class="nb-cmp-body" data-side="app"></div></div>
      <div class="nb-cmp-col"><div class="nb-cmp-head">Neu – Datei aus der Nextcloud <span class="nb-cmp-swatch nb-cmp-new">neu/geändert</span></div><div class="nb-cmp-body" data-side="cloud"></div></div>
    </div>
    <div class="confirm-actions">
      ${onDecide ? `<button type="button" class="btn btn-primary" data-act="take" title="Die Datei aus der Nextcloud wird zum Stand in der App. Der bisherige Stand der App kommt nach _Gesichert.">⬇ Neue Fassung übernehmen</button>
      <button type="button" class="btn btn-secondary" data-act="discard" title="Die Datei aus der Nextcloud kommt nach _Gesichert, die App schreibt ihre Fassung.">✖ Verwerfen (App behalten)</button>` : ''}
      <button type="button" class="btn btn-secondary nb-cmp-close">Schließen</button>
    </div>`;
  const bodyA = card.querySelector('[data-side="app"]');
  const bodyB = card.querySelector('[data-side="cloud"]');
  bodyA.appendChild(left);
  bodyB.appendChild(right);
  // Gemeinsam blättern: Beide Seiten bleiben an derselben Stelle (anteilig).
  let syncing = false;
  const sync = (from, to) => from.addEventListener('scroll', () => {
    if (syncing) { syncing = false; return; }
    const max = from.scrollHeight - from.clientHeight;
    syncing = true;
    to.scrollTop = max > 0 ? (from.scrollTop / max) * (to.scrollHeight - to.clientHeight) : 0;
  });
  sync(bodyA, bodyB);
  sync(bodyB, bodyA);
  // Zur ersten Abweichung springen.
  const first = right.querySelector('.nb-cmp-new') || left.querySelector('.nb-cmp-old');
  if (first) requestAnimationFrame(() => first.scrollIntoView({ block: 'center' }));

  card.querySelector('.nb-cmp-close').addEventListener('click', close);
  card.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    if (await onDecide(btn.dataset.act)) close();
  }));
}
