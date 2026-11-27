// ==================== LÖSUNG ALS EIGENES BLATT ====================
//
// Aus einem Arbeitsblatt ein Lösungsblatt machen (Stift-Editor, Lehrerlösung → „📄 Als Lösungsblatt“):
// Lösungsblöcke werden geöffnet (ihr Inhalt steht im Blatt), Labore zeigen die Lösung. So sieht man die
// Lösung auch über einen Quick-Link – dort werden Lösungsblöcke sonst entfernt.
//
// Labor im Blatt:
//   1. Hat die Lehrkraft es in ihrer Lehrerlösung bearbeitet (labStates[id] mit anderer Kette als die
//      Vorgabe), gilt dieser Stand.
//   2. Sonst: Folgt ein Lösungsblock mit einem Labor derselben Art, ersetzt dessen Kette das Schülerlabor –
//      Anlage, Zuordnungstabelle und INIT aber aus dem Schülerlabor (das pflegt die Lehrkraft meist zuletzt).
//   3. Sonst bleibt es, wie es ist.
// Ohne import (src/core/browser-module.ts lädt die Datei auch in Tests).

const clone = (v) => JSON.parse(JSON.stringify(v));

function firstLab(blocks, kind) {
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'lab' && b.lab === kind) return b;
    const inner = firstLab(b.blocks, kind);
    if (inner) return inner;
  }
  return null;
}

/** Zuordnungstabelle: die des Schülerlabors, ergänzt um Einträge, die nur die Lösung hat. */
function mergeIo(student, solution) {
  const out = clone(student || []);
  const names = new Set(out.map((x) => String(x?.name ?? '').trim()));
  for (const r of solution || []) if (!names.has(String(r?.name ?? '').trim())) out.push(clone(r));
  return out;
}

/**
 * Lösungsblatt-Inhalt aus `spec`. `labStates`: Block-ID → Laborstand aus der Lehrerlösung (z. B. aus den
 * gespeicherten Eingaben des Stift-Editors). Liefert eine neue DocSpec (die alte bleibt unverändert).
 */
export function solutionSpec(spec, labStates = {}) {
  const merge = new Map(); // ID des Labors im Lösungsblock → Schülerlabor davor
  const changed = (b, st) => st && JSON.stringify(st.steps || []) !== JSON.stringify(b.preset?.steps || []);
  const walk = (list) => {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((b, i) => {
      if (!b || typeof b !== 'object') { out.push(b); return; }
      if (b.type === 'solution') { out.push(...walk(b.blocks)); return; }
      if (b.type === 'lab') {
        const st = labStates[b.id];
        if (changed(b, st)) { out.push({ ...clone(b), preset: clone(st) }); return; }
        const next = list[i + 1];
        const sol = next && next.type === 'solution' ? firstLab(next.blocks, b.lab) : null;
        if (sol) { merge.set(sol.id ?? sol, b); return; }
        const twin = merge.get(b.id ?? b);
        if (twin && b.lab === 'sps') {
          const s = twin.preset || {};
          const p = b.preset || {};
          out.push({ ...clone(b), preset: { ...clone(p), io: mergeIo(s.io, p.io), ...(s.plant ? { plant: clone(s.plant) } : {}), ...(s.init ? { init: s.init } : {}) } });
          return;
        }
        out.push(clone(b));
        return;
      }
      out.push(Array.isArray(b.blocks) ? { ...clone(b), blocks: walk(b.blocks) } : clone(b));
    });
    return out;
  };
  return { ...clone(spec || {}), content: walk(spec?.content) };
}

/** Block-ID → Laborstand aus gespeicherten Eingaben (Schlüssel „lab:<Modul>:<Block-ID>“). */
export function labStatesFromForms(forms) {
  const out = {};
  for (const [k, v] of Object.entries(forms || {})) {
    if (!k.startsWith('lab:') || !v || typeof v !== 'object') continue;
    out[k.slice(k.lastIndexOf(':') + 1)] = v;
  }
  return out;
}
