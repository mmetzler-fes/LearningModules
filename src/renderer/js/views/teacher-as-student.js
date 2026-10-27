import { escapeHtml } from '../utils.js';

// ==================== ALS LEHRKRAFT TEILNEHMEN ====================
//
// Ist im Browser eine Lehrkraft angemeldet (z. B. in einer Fortbildung),
// bietet die Eingabeseite eines Schülerlinks „👤 Als ‹Name› teilnehmen“ an:
// Der Name des Kontos kommt ins Namensfeld. Sonst gilt alles wie bei jedem
// Schüler – offene Klasse: unbestätigter Eintrag, strikte: nur mit dem Namen
// in der Liste. Die Anmeldung als Lehrkraft bleibt dabei bestehen.

/**
 * Knopf über `input` einfügen, wenn eine Lehrkraft angemeldet ist.
 * `onPick(name)`: was danach geschieht (z. B. Formular absenden).
 */
export async function offerTeacherName(input, onPick) {
  if (!input || input.parentElement?.querySelector('.as-teacher-btn')) return;
  const token = (() => { try { return sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token'); } catch (_) { return null; } })();
  if (!token) return;
  let me = null;
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    me = res.ok ? await res.json() : null;
  } catch (_) { return; }
  if (!me || (me.role !== 'teacher' && me.role !== 'admin')) return;
  const name = String(me.displayName || '').trim();
  if (!name || name.includes('@')) return; // ohne Klarnamen nicht anbieten
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary btn-full as-teacher-btn';
  btn.innerHTML = `👤 Als <strong>${escapeHtml(name)}</strong> teilnehmen`;
  btn.title = 'Du bist als Lehrkraft angemeldet – mit diesem Namen wie ein Schüler teilnehmen (die Lehrer-Anmeldung bleibt)';
  btn.addEventListener('click', () => {
    input.value = name;
    onPick(name);
  });
  input.parentElement.insertBefore(btn, input.parentElement.firstChild);
}
