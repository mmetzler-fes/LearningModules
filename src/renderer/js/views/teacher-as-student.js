// ==================== ALS LEHRKRAFT TEILNEHMEN ====================
//
// Ist im Browser eine Lehrkraft angemeldet (z. B. in einer Fortbildung), steht auf der Eingabeseite eines
// Klassenlinks schon ihr Name, wenn sie damit hineinkommt. Abschicken bleibt ihr Schritt: Allein durch
// das Öffnen entsteht kein Eintrag in der Schülerliste. Sonst gilt alles wie bei jedem Schüler.

/**
 * Ohne „Angemeldet bleiben“ liegt die Anmeldung nur im Tab, in dem sie
 * geschah (sessionStorage) – ein Schülerlink im neuen Tab sieht sie nicht.
 * Dann die offenen Tabs der App fragen (app.js antwortet). Nur für den
 * Namen; diese Seite meldet sich damit nicht an und speichert nichts.
 */
function tokenFromOtherTab(wait = 500) {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new BroadcastChannel('lm-auth');
    const done = (v) => { clearTimeout(timer); ch.close(); resolve(v); };
    const timer = setTimeout(() => done(null), wait);
    ch.onmessage = (e) => { if (e.data?.type === 'token' && e.data.token) done(e.data.token); };
    ch.postMessage({ type: 'who' });
  });
}

/**
 * Namen in `input` eintragen, wenn eine Lehrkraft angemeldet ist und damit in die Klasse kommt; sonst ein Hinweis.
 * `onFilled(relation)`: was danach geschieht (z. B. den Fokus setzen).
 */
export async function offerTeacherName(input, classId, onFilled) {
  if (!input || !classId || input.parentElement?.querySelector('.as-teacher-hint')) return;
  const token = (() => { try { return sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token'); } catch (_) { return null; } })()
    || await tokenFromOtherTab();
  if (!token) return;
  let me = null;
  let found = null;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const res = await fetch('/api/auth/me', { headers, cache: 'no-store' });
    me = res.ok ? await res.json() : null;
    if (!me || (me.role !== 'teacher' && me.role !== 'admin')) return;
    const answer = await fetch(`/api/classes/${encodeURIComponent(classId)}/participant`, { headers, cache: 'no-store' });
    found = answer.ok ? await answer.json() : null;
  } catch (_) { return; }
  if (!found) return;
  const hint = document.createElement('small');
  hint.className = 'hint as-teacher-hint';
  const show = (text) => {
    hint.textContent = text;
    input.parentElement.appendChild(hint);
  };
  if (found.relation === 'owner') {
    show('Das ist deine eigene Klasse. Zum Ausprobieren nimm deinen 🧪 Testschüler, sonst stehst du selbst in der Schülerliste.');
    return;
  }
  if (found.relation === 'closed') {
    show('Du bist als Lehrkraft angemeldet, stehst aber nicht in der Liste dieser Klasse. Die Lehrkraft der Klasse kann dich eintragen.');
    return;
  }
  const name = String(found.name || '').trim();
  if (!name || name.includes('@') || input.value.trim()) return; // ohne Klarnamen nichts eintragen, Getipptes bleibt
  input.value = name;
  show(found.relation === 'open'
    ? 'Dein Name als angemeldete Lehrkraft. Die Lehrkraft der Klasse bestätigt dich danach.'
    : 'Dein Name als angemeldete Lehrkraft.');
  onFilled?.(found.relation);
}
