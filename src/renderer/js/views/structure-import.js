/**
 * 🧱 Struktur importieren (docs/planung.md#struktur-importieren): Books bzw.
 * Pläne, Bereiche und Abschnitte aus einer Tabelle, einer Ordnerstruktur oder
 * einer eingefügten Gliederung anlegen – ins Notizbuch oder in die Planung.
 * Nur Ordner, keine Inhalte; Gleichnamiges wird mitbenutzt. Vorher zeigt eine
 * Vorschau, was neu entsteht.
 */
import { escapeHtml, escapeAttr } from '../utils.js';
import { pathsFromRows, pathsFromOutline, pathsFromFolders, buildTree, limitDepth, countNodes } from '../structure-parse.js';

const ICON = { book: '📕', plan: '📋', folder: '📁', area: '📂', section: '📑' };
const key = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
const bad = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);

/** Ebene eines Knotens im Notizbuch (Book = 1). */
function nbDepth(nodes, id) {
  let d = 0;
  for (let n = nodes.find((x) => x.id === id); n && d < 20; n = n.parentId ? nodes.find((x) => x.id === n.parentId) : null) d++;
  return d;
}

/** Ebenen innerhalb eines Plans bis zu diesem Knoten (der Plan selbst = 0). */
function planDepth(nodes, id) {
  let d = 0;
  for (let n = nodes.find((x) => x.id === id); n && n.kind !== 'plan' && d < 20; n = n.parentId ? nodes.find((x) => x.id === n.parentId) : null) d++;
  return d;
}

/**
 * Ziel → wie die Ebenen heißen und wie viele es geben darf.
 * Notizbuch oben: Book, Bereich …; in einem Book/Bereich: Bereich …
 * Planung oben oder in einem Ordner: Plan, Bereich …; in einem Plan/Bereich: Bereich …
 */
function placement(target, data) {
  if (target.where === 'notebook') {
    if (!target.id) return { top: 'book', max: 8 };
    return { top: 'area', max: 8 - nbDepth(data.nb.nodes, target.id) };
  }
  const node = target.id ? data.plans.nodes.find((n) => n.id === target.id) : null;
  if (!node || node.kind === 'folder') return { top: 'plan', max: 8 };
  return { top: 'area', max: 7 - planDepth(data.plans.nodes, node.id) };
}

/** Baum mit den Arten des Ziels; `existing`: Kinder je Elternteil zum Mitbenutzen. */
function plan(tree, target, data) {
  const { top, max } = placement(target, data);
  const { tree: cut, dropped } = limitDepth(tree, Math.max(0, max));
  const nodes = target.where === 'notebook' ? data.nb.nodes : data.plans.nodes;
  const kidsOf = (parentId) => nodes.filter((n) => (n.parentId ?? null) === (parentId ?? null));
  const walk = (list, parentId, depth) => list.map((n) => {
    let kind = depth === 0 ? top : n.kind === 'section' ? 'section' : 'area';
    if (depth === 0 && top === 'area' && !n.children.length && n.kind === 'section') kind = 'section';
    if (kind === 'section' && n.children.length) kind = 'area';
    const found = parentId !== undefined ? kidsOf(parentId).find((x) => key(x.title) === key(n.title) && (x.kind === kind || (kind !== 'book' && kind !== 'plan' && (x.kind === 'area' || x.kind === 'section')))) : null;
    return { title: n.title, kind: found ? found.kind : kind, existingId: found?.id || null, children: walk(n.children, found ? found.id : undefined, depth + 1) };
  });
  return { list: walk(cut, target.id || null, 0), dropped };
}

const countNew = (list) => list.reduce((s, n) => s + (n.existingId ? 0 : 1) + countNew(n.children), 0);

function previewHtml(list) {
  const item = (n) => `<li>${ICON[n.kind] || '•'} ${escapeHtml(n.title)}${n.existingId ? ' <span class="hint">(vorhanden)</span>' : ''}${n.children.length ? `<ul>${n.children.map(item).join('')}</ul>` : ''}</li>`;
  return `<ul class="si-preview">${list.map(item).join('')}</ul>`;
}

/** Ziele zur Auswahl: oben, dann Books/Bereiche bzw. Ordner/Pläne/Bereiche (keine Abschnitte – die enthalten nur Lernthemen). */
function targetOptions(where, data) {
  const nodes = where === 'notebook' ? data.nb.nodes : data.plans.nodes.filter((n) => n.kind !== 'include');
  const out = [{ id: '', label: where === 'notebook' ? '⬆ ganz oben – Ebene 1 wird Book' : '⬆ ganz oben – Ebene 1 wird Plan' }];
  const walk = (parentId, depth) => {
    for (const n of nodes.filter((x) => (x.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (n.kind === 'section') continue;
      const hint = where === 'plans' && n.kind === 'folder' ? ' – Ebene 1 wird Plan' : ' – Ebene 1 wird Bereich';
      out.push({ id: n.id, label: `${'   '.repeat(depth + 1)}${ICON[n.kind] || '•'} ${n.title}${hint}` });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export async function openStructureImport(app, { where = 'notebook', onDone = null } = {}) {
  const [nb, plans] = await Promise.all([app.api.getNotebooks(), app.api.getPlans()]);
  if (bad(nb) || bad(plans)) { app.showToast((nb && nb.message) || (plans && plans.message) || 'Daten nicht abrufbar.', 'error'); return; }
  const data = { nb, plans };
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay pl-dialog';
  overlay.innerHTML = `<div class="import-modules-card si-card">
    <h3>🧱 Struktur importieren</h3>
    <p class="hint">Legt nur <strong>Ordner</strong> an – Books bzw. Pläne, Bereiche und Abschnitte –, keine Inhalte. Die Lernthemen kopierst
      oder verschiebst du danach in der Planung hinein. Gleichnamiges wird mitbenutzt, ein zweiter Import ergänzt nur.</p>
    <fieldset class="si-group"><legend>Quelle</legend>
      <label><input type="radio" name="siSrc" value="sheet" checked /> Tabelle (.ods, .xlsx, .csv)</label>
      <label><input type="radio" name="siSrc" value="folder" /> Ordner auf dem Rechner</label>
      <label><input type="radio" name="siSrc" value="outline" /> Gliederung einfügen</label>
    </fieldset>
    <div class="si-src" data-src="sheet"><input type="file" class="si-file" accept=".ods,.xlsx,.csv,.txt" />
      <p class="hint">Spalte <strong>A</strong> = Book bzw. Plan, <strong>B–H</strong> = Bereiche, <strong>I</strong> = Abschnitt. Leere Zellen vorne
        übernehmen den Wert aus der Zeile darüber; eine Kopfzeile (Book, Bereich, Abschnitt …) wird übersprungen.</p></div>
    <div class="si-src hidden" data-src="folder"><input type="file" class="si-dir" webkitdirectory directory multiple />
      <label class="share-flag"><input type="checkbox" class="si-root" /> <span>Den gewählten Ordner selbst als oberste Ebene</span></label>
      <p class="hint">Nur die Ordnernamen werden übernommen, keine Dateien. Unterste Ordner werden Abschnitte, die anderen Bereiche.
        Leere Ordner sieht der Browser nicht.</p></div>
    <div class="si-src hidden" data-src="outline"><textarea class="si-text" rows="8" placeholder="Mechatroniker&#10;  LF 1 Funktionen analysieren&#10;    Signale&#10;  LF 2 …&#10;&#10;oder mit # Überschriften und - Aufzählungen"></textarea>
      <p class="hint">Einrückung (Leerzeichen oder Tab), <code>#</code>-Überschriften oder Aufzählungen bestimmen die Ebene; Nummern wie „1.2“ fallen weg.
        Unterste Einträge werden Abschnitte.</p></div>
    <fieldset class="si-group"><legend>Ziel</legend>
      <label><input type="radio" name="siWhere" value="notebook" ${where === 'notebook' ? 'checked' : ''} /> 📓 Notizbuch</label>
      <label><input type="radio" name="siWhere" value="plans" ${where === 'plans' ? 'checked' : ''} /> 🗂 Planung (z. B. Lehrplan als Plan)</label>
      <select class="si-target"></select>
    </fieldset>
    <div class="si-out"><p class="hint">Vorschau erscheint, sobald eine Quelle gewählt ist.</p></div>
    <div class="confirm-actions"><button type="button" class="btn btn-primary si-go" disabled>📥 Anlegen</button><button type="button" class="btn btn-secondary si-cancel">Abbrechen</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  const close = () => overlay.remove();
  $('.si-cancel').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  let tree = [];
  let current = null;
  const target = () => ({ where: overlay.querySelector('[name=siWhere]:checked').value, id: $('.si-target').value || null });
  const fillTargets = () => {
    const t = target();
    $('.si-target').innerHTML = targetOptions(t.where, data).map((o) => `<option value="${escapeAttr(o.id)}">${escapeHtml(o.label)}</option>`).join('');
  };
  const render = () => {
    if (!tree.length) { $('.si-out').innerHTML = '<p class="hint">Vorschau erscheint, sobald eine Quelle gewählt ist.</p>'; $('.si-go').disabled = true; current = null; return; }
    current = plan(tree, target(), data);
    const fresh = countNew(current.list);
    $('.si-out').innerHTML = `<p><strong>${fresh} neu</strong>, ${countNodes(current.list) - fresh} vorhanden${current.dropped ? ` · <span class="nb-warn">⚠ ${current.dropped} zu tief, wird nicht angelegt</span>` : ''}</p>${previewHtml(current.list)}`;
    $('.si-go').disabled = !fresh;
  };
  const load = async () => {
    const src = overlay.querySelector('[name=siSrc]:checked').value;
    try {
      if (src === 'sheet') {
        const f = $('.si-file').files[0];
        if (!f) { tree = []; render(); return; }
        const { readTableRows } = await import('../odf/student-list.js');
        tree = buildTree(pathsFromRows(await readTableRows(f)));
      } else if (src === 'folder') {
        const files = [...$('.si-dir').files];
        tree = buildTree(pathsFromFolders(files.map((f) => f.webkitRelativePath || f.name), { includeRoot: $('.si-root').checked }));
      } else tree = buildTree(pathsFromOutline($('.si-text').value));
    } catch (err) {
      tree = [];
      $('.si-out').innerHTML = `<p class="login-error">❌ ${escapeHtml(err.message || String(err))}</p>`;
      $('.si-go').disabled = true;
      return;
    }
    render();
  };
  overlay.querySelectorAll('[name=siSrc]').forEach((r) => r.addEventListener('change', () => {
    overlay.querySelectorAll('.si-src').forEach((d) => d.classList.toggle('hidden', d.dataset.src !== r.value));
    void load();
  }));
  overlay.querySelectorAll('[name=siWhere]').forEach((r) => r.addEventListener('change', () => { fillTargets(); render(); }));
  $('.si-target').addEventListener('change', render);
  $('.si-file').addEventListener('change', load);
  $('.si-dir').addEventListener('change', load);
  $('.si-root').addEventListener('change', load);
  $('.si-text').addEventListener('input', load);
  fillTargets();

  $('.si-go').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('.si-go');
    btn.disabled = true;
    const t = target();
    let made = 0;
    const errors = [];
    const create = async (list, parentId) => {
      for (const n of list) {
        let id = n.existingId;
        if (!id) {
          btn.textContent = `⏳ ${made + 1} …`;
          const res = t.where === 'notebook'
            ? await app.api.createNotebookNode(n.kind, n.title, parentId)
            : await app.api.createPlanNode({ kind: n.kind, title: n.title, parentId });
          if (bad(res) || !res.id) { errors.push(`${n.title}: ${res?.message || 'nicht angelegt'}`); continue; }
          id = res.id;
          made++;
        }
        await create(n.children, id);
      }
    };
    await create(current.list, t.id);
    btn.textContent = '✅ Fertig';
    app.showToast(`${made} angelegt${errors.length ? ` · ${errors.length} Fehler: ${errors.slice(0, 3).join('; ')}` : ''}.`, errors.length ? 'error' : 'success');
    close();
    await onDone?.(t.where);
  });
}
