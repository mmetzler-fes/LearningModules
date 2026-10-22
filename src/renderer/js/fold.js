// ==================== AUFKLAPPBARE BEREICHE ====================
//
// Einstellungsseiten (.settings-panel > .settings-group mit <h3> vorn) zeigen
// zunächst nur die Überschriften: Ein Klick klappt den Bereich auf, ein
// zweiter wieder zu. Was offen ist, merkt sich der Browser. Gilt auch für
// Bereiche, die erst später gezeichnet werden (Kategorien, Vernetzung …).

const KEY = 'lm_open_sections';
const GROUP = '.settings-panel > .settings-group';

function load() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (_) { return new Set(); }
}
function save(open) {
  try { localStorage.setItem(KEY, JSON.stringify([...open])); } catch (_) { /* Speicher gesperrt: nur für diese Sitzung */ }
}

/** Fester Name eines Bereichs: Seite + Überschrift, ohne Stand und Zahlen (die wechseln). */
function idOf(group, h3) {
  const copy = h3.cloneNode(true);
  copy.querySelectorAll('.fold-state, .help-hint').forEach((el) => el.remove());
  const title = copy.textContent.replace(/\(\d+\)|\d+/g, '').replace(/\s+/g, ' ').trim();
  return `${group.closest('.view')?.id || ''}|${title}`;
}

function enhance(group) {
  const h3 = group.firstElementChild;
  if (!h3 || h3.tagName !== 'H3' || group.classList.contains('foldable')) return;
  // Ein einzelner Bereich auf der Seite bleibt offen – da gibt es nichts zu ordnen.
  if (group.parentElement.querySelectorAll(':scope > .settings-group').length < 2) return;
  const id = idOf(group, h3);
  const set = (open) => {
    group.classList.toggle('folded', !open);
    h3.setAttribute('aria-expanded', String(open));
  };
  group.classList.add('foldable');
  h3.setAttribute('role', 'button');
  h3.tabIndex = 0;
  set(load().has(id));
  const toggle = () => {
    const open = group.classList.contains('folded');
    set(open);
    const all = load();
    if (open) all.add(id); else all.delete(id);
    save(all);
  };
  // Hilfe-Knopf und Links in der Überschrift tun weiter, was sie tun.
  h3.addEventListener('click', (e) => { if (!e.target.closest('.help-hint, a, button, input')) toggle(); });
  h3.addEventListener('keydown', (e) => {
    if (e.target === h3 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); }
  });
}

/** Einmal beim Start: vorhandene Bereiche einrichten und neu gezeichnete beobachten. */
export function initFolding() {
  document.querySelectorAll(GROUP).forEach(enhance);
  new MutationObserver((changes) => {
    for (const c of changes) {
      for (const n of c.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(GROUP)) enhance(n);
        n.querySelectorAll(GROUP).forEach(enhance);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/** Kurzer Stand neben der Überschrift des Bereichs, in dem `el` liegt – auch eingeklappt sichtbar. */
export function setFoldState(el, text) {
  const h3 = el?.closest('.settings-group')?.firstElementChild;
  if (!h3 || h3.tagName !== 'H3') return;
  let state = h3.querySelector('.fold-state');
  if (!state) {
    state = document.createElement('span');
    state.className = 'fold-state';
    h3.appendChild(state);
  }
  state.textContent = text || '';
}
