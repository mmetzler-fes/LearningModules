import { escapeHtml } from '../utils.js';

// ==================== BLATT EINES SCHÜLERS: ZWEI FASSUNGEN ====================
//
// Ohne WLAN (docs/offline-sync.md) kann ein Schüler auf zwei Geräten
// unabhängig am selben Blatt arbeiten. Der Server behält dann den neueren
// Stand und legt den anderen als zweite Fassung ab. Hier sieht die
// Lehrkraft beide nebeneinander – wie beim Vergleich der Sicherung
// (sicherung-compare.js) – und entscheidet, welche gilt.

const fmt = (d) => (d ? new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');

/** Nachgereicht: Zwischen Schreiben (Uhr des Geräts) und Ankunft liegen mehr als 2 Minuten. */
export function isLate(w) {
  if (!w?.clientAt || !w.updatedAt) return false;
  return new Date(w.updatedAt) - new Date(w.clientAt) > 2 * 60 * 1000;
}

/** Hinweise in einer Zeile der Liste: ⏱ nachgereicht, ⇄ zwei Fassungen. */
export function workBadges(w) {
  const out = [];
  if (isLate(w)) {
    out.push(`<span class="work-late" title="Ohne WLAN geschrieben: auf dem Gerät ${escapeHtml(fmt(w.clientAt))}, beim Server angekommen ${escapeHtml(fmt(w.updatedAt))}">⏱ nachgereicht (geschrieben ${escapeHtml(fmt(w.clientAt))})</span>`);
  }
  if (w?.previousAt) {
    out.push('<button type="button" class="btn btn-secondary btn-sm btn-work-compare" title="Der Schüler hat auf zwei Geräten unabhängig gearbeitet – beide Fassungen vergleichen">⇄ 2 Fassungen</button>');
  }
  return out.join(' ');
}

/** Knöpfe „⇄ 2 Fassungen“ unter `root` anbinden (Zeilen mit data-id). `reload()` nach einer Entscheidung. */
export function bindWorkCompare(root, app, reload) {
  root.querySelectorAll('.btn-work-compare').forEach((btn) => btn.addEventListener('click', () => {
    void openWorkCompare(app, btn.closest('[data-id]').dataset.id, { onDone: reload });
  }));
}

/** Bausteine, deren Beschriftung sich unterscheidet (Schlüssel der Ebene: Block-ID). */
function changedBlocks(a, b) {
  const blocksA = a?.layer?.blocks || {};
  const blocksB = b?.layer?.blocks || {};
  const ids = new Set([...Object.keys(blocksA), ...Object.keys(blocksB)]);
  return [...ids].filter((id) => JSON.stringify(blocksA[id] ?? null) !== JSON.stringify(blocksB[id] ?? null));
}

async function side(work, stand, changed, cls) {
  const [{ H5pRenderer }, { showInkView }] = await Promise.all([
    import('../../lm-editor/src/modules/h5p-renderer.js'),
    import('../../lm-editor/src/ink/ink-view.js'),
  ]);
  const view = document.createElement('div');
  view.className = 'module-description-content';
  const content = work.version?.content || null;
  if (!content) {
    view.innerHTML = '<p class="hint">Die Fassung des Blatts ist nicht mehr vorhanden.</p>';
    return view;
  }
  const embedded = work.version.embedded || [];
  const renderer = new H5pRenderer({});
  view.appendChild(renderer.createTypePreview('document', content, {
    blockIds: true, embedModule: (id) => embedded.find((m) => m.id === id) || null, title: work.moduleTitle, moduleId: work.moduleId,
  }));
  const set = new Set(changed);
  view.querySelectorAll('[data-bid]').forEach((el) => { if (set.has(el.dataset.bid)) el.classList.add(cls); });
  return { view, stand, landscape: content.spec?.orientation === 'landscape', showInkView };
}

/** Vergleich öffnen: links der gültige Stand, rechts die zweite Fassung. */
export async function openWorkCompare(app, id, { onDone } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay nb-cmp-overlay';
  overlay.innerHTML = '<div class="import-modules-card nb-cmp-card"><h3>⇄ Zwei Fassungen</h3><p class="hint">Lade beide Fassungen …</p></div>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = overlay.querySelector('.nb-cmp-card');

  const work = await app.api.getWork(id).catch((e) => ({ message: e?.message }));
  if (!work || work.statusCode || !work.id || !work.previousData) {
    card.innerHTML = `<h3>⇄ Zwei Fassungen</h3><p class="ds-error">${escapeHtml(work?.message || 'Es gibt keine zweite Fassung (mehr).')}</p>
      <div class="confirm-actions"><button type="button" class="btn btn-secondary nb-cmp-close">Schließen</button></div>`;
    card.querySelector('.nb-cmp-close').addEventListener('click', close);
    return;
  }
  const cur = work.data;
  const prev = work.previousData;
  const changed = changedBlocks(cur, prev);
  const formsDiffer = JSON.stringify(cur?.forms ?? null) !== JSON.stringify(prev?.forms ?? null);
  const insertsDiffer = JSON.stringify(cur?.layer?.inserts ?? []) !== JSON.stringify(prev?.layer?.inserts ?? []);
  const notes = [];
  if (formsDiffer) notes.push('Die Eingaben in den Quizzen unterscheiden sich (hier nicht markiert – zum Ansehen die Fassung übernehmen oder das Blatt öffnen).');
  if (insertsDiffer) notes.push('Selbst Eingefügtes (Schreibfelder, eigene Textblöcke, Tabellen, Bilder) unterscheidet sich.');
  const summary = changed.length
    ? `${changed.length} Baustein${changed.length === 1 ? '' : 'e'} mit unterschiedlicher Beschriftung.`
    : 'Die Beschriftung ist in beiden Fassungen gleich.';

  card.innerHTML = `<h3>⇄ ${escapeHtml(work.studentName)} – ${escapeHtml(work.moduleTitle || 'Dokument')}</h3>
    <p class="hint">Der Schüler hat auf zwei Geräten unabhängig gearbeitet (ohne WLAN). Gültig ist der neuere Stand; der andere ist hier aufbewahrt.</p>
    <p><strong>${summary}</strong></p>
    ${notes.length ? `<ul class="nb-cmp-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
    <div class="nb-cmp-grid">
      <div class="nb-cmp-col"><div class="nb-cmp-head">Gültig – geschrieben ${escapeHtml(fmt(cur?.updatedAt))} <span class="nb-cmp-swatch nb-cmp-old">abweichend</span></div><div class="nb-cmp-body" data-side="cur"></div></div>
      <div class="nb-cmp-col"><div class="nb-cmp-head">Zweite Fassung – geschrieben ${escapeHtml(fmt(prev?.updatedAt))} <span class="nb-cmp-swatch nb-cmp-new">abweichend</span></div><div class="nb-cmp-body" data-side="prev"></div></div>
    </div>
    <div class="confirm-actions">
      <button type="button" class="btn btn-primary" data-act="take" title="Die zweite Fassung wird zum gültigen Stand; der bisherige bleibt als zweite Fassung aufbewahrt.">⇄ Zweite Fassung übernehmen</button>
      <button type="button" class="btn btn-secondary" data-act="discard" title="Die zweite Fassung wird gelöscht, der gültige Stand bleibt.">✖ Zweite Fassung verwerfen</button>
      <button type="button" class="btn btn-secondary nb-cmp-close">Schließen</button>
    </div>`;
  const bodyA = card.querySelector('[data-side="cur"]');
  const bodyB = card.querySelector('[data-side="prev"]');
  const [a, b] = await Promise.all([side(work, cur, changed, 'nb-cmp-old'), side(work, prev, changed, 'nb-cmp-new')]);
  for (const [box, s] of [[bodyA, a], [bodyB, b]]) {
    if (s instanceof HTMLElement) { box.appendChild(s); continue; }
    box.appendChild(s.view);
    await s.showInkView(s.view, s.stand, { landscape: s.landscape }).catch(() => false);
  }
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
  const first = bodyB.querySelector('.nb-cmp-new') || bodyA.querySelector('.nb-cmp-old');
  if (first) requestAnimationFrame(() => first.scrollIntoView({ block: 'center' }));

  card.querySelector('.nb-cmp-close').addEventListener('click', close);
  card.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    if (act === 'discard' && !(await app.appConfirm('Die zweite Fassung endgültig löschen?'))) return;
    btn.disabled = true;
    const res = await app.api.decideWorkPrevious(id, act).catch((e) => ({ message: e?.message }));
    if (!res?.success) {
      app.showToast(`Fehler: ${res?.message || 'unbekannt'}`, 'error');
      btn.disabled = false;
      return;
    }
    app.showToast(act === 'take' ? 'Die zweite Fassung gilt jetzt.' : 'Die zweite Fassung ist gelöscht.', 'success');
    close();
    onDone?.();
  }));
}
