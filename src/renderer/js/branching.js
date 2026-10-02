/**
 * Branching Scenario: Datenformat und Prüfung, gemeinsam für Player,
 * Quiz-Auswertung und Editor (branching-editor.js nutzt die Funktionen
 * über window, weil es ein klassisches Skript ist).
 *
 * Format:
 *   startScreen: { title, subtitle }
 *   allowBack:   Zurückgehen erlaubt
 *   steps: [{ id, title, content (HTML), kind: 'choice' | 'end',
 *             choices: [{ label, next (Schritt-id) }],   – bei 'choice'
 *             score (0–100), feedback }]                  – bei 'end'
 * Der erste Schritt ist der Start.
 *
 * Ältere Module hatten stepTitle/stepContent und Optionen als Text
 * ("Antwort -> 2", Schritt-Nummer ab 1). Sie werden hier übersetzt; ein
 * Schritt ohne Optionen war ein Ende.
 */
export function normalizeBranching(content) {
  const c = content || {};
  const raw = Array.isArray(c.steps) ? c.steps : [];
  const ids = raw.map((s, i) => String(s?.id || `s${i + 1}`));
  const steps = raw.map((s, i) => {
    const id = ids[i];
    if (s && (s.kind || s.choices)) {
      return {
        id,
        title: s.title || '',
        content: s.content || '',
        kind: s.kind === 'end' ? 'end' : 'choice',
        choices: (s.choices || []).map((ch) => ({ label: ch.label || '', next: ch.next || '' })),
        score: Math.max(0, Math.min(100, Number(s.score ?? 100))),
        feedback: s.feedback || '',
      };
    }
    // Altes Format
    const choices = String(s?.nextStepOptions || '').split('\n').map((line) => {
      const m = /^(.*?)\s*-+>\s*(\d+)\s*$/.exec(line.trim());
      if (!m) return null;
      const target = ids[Number(m[2]) - 1];
      return { label: m[1].trim(), next: target || '' };
    }).filter(Boolean);
    const plain = String(s?.stepContent || '');
    return {
      id,
      title: s?.stepTitle || '',
      content: plain ? plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : '',
      kind: choices.length ? 'choice' : 'end',
      choices,
      score: 100,
      feedback: '',
    };
  });
  return {
    startScreen: { title: c.startScreen?.title || '', subtitle: c.startScreen?.subtitle || '' },
    allowBack: !!c.allowBack,
    steps,
  };
}

/**
 * Hinweise zur Struktur – für den Editor, damit kein Schüler in einer
 * Sackgasse landet: Entscheidungen ohne Antworten oder ohne Ziel, nicht
 * erreichbare Schritte, Szenario ohne Ende.
 */
export function checkBranching(data) {
  const warnings = [];
  const steps = data.steps || [];
  if (!steps.length) return ['Noch keine Schritte.'];
  const byId = new Map(steps.map((s) => [s.id, s]));
  const num = (id) => steps.findIndex((s) => s.id === id) + 1;
  steps.forEach((s, i) => {
    if (s.kind === 'choice') {
      if (!s.choices.length) warnings.push(`Schritt ${i + 1} ist eine Entscheidung ohne Antworten.`);
      s.choices.forEach((ch, k) => {
        if (!ch.label.trim()) warnings.push(`Schritt ${i + 1}, Antwort ${k + 1}: Text fehlt.`);
        if (!byId.has(ch.next)) warnings.push(`Schritt ${i + 1}, Antwort ${k + 1}: Ziel fehlt.`);
      });
    }
  });
  // Erreichbarkeit ab dem Start
  const seen = new Set();
  const stack = [steps[0].id];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const ch of byId.get(id).choices || []) if (byId.get(id).kind === 'choice') stack.push(ch.next);
  }
  steps.forEach((s) => { if (!seen.has(s.id)) warnings.push(`Schritt ${num(s.id)} („${s.title || 'ohne Titel'}“) ist vom Start aus nicht erreichbar.`); });
  if (!steps.some((s) => s.kind === 'end' && seen.has(s.id))) warnings.push('Es gibt kein erreichbares Ende.');
  return warnings;
}

if (typeof window !== 'undefined') {
  window.normalizeBranching = normalizeBranching;
  window.checkBranching = checkBranching;
}
