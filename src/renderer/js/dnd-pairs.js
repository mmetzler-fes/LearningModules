// Drag and Drop als Paare: Der Editor zeigt eine Liste A ↔ B, gespeichert
// wird wie immer als Zonen (A, fest) und ziehbare Elemente (B). So bleiben
// Auswertung, H5P-, Moodle- und JSON-Export unverändert.
//
// Die Datei darf nichts importieren: Der Server lädt sie für die Tests
// (browser-module.ts), der Editor über window.dndPairs (app.js).

const blank = (s) => !String(s || '').trim();
const hasSide = (s) => !!s && (!blank(s.text) || !!s.imageUrl);
const side = (text = '', imageUrl = '', hideText = false) => ({ text: String(text || ''), imageUrl: String(imageUrl || ''), hideText: !!(hideText && imageUrl) });

/** Name, den es in `used` noch nicht gibt: „Bild 3“, sonst „Bild 3 (2)“ … */
function uniqueName(base, used) {
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
  used.add(name);
  return name;
}

/**
 * Paare → Zonen und ziehbare Elemente. Eine Zeile ohne linke Karte ist ein
 * Ablenker. Seiten nur mit Bild bekommen einen Namen („Bild 3“) für die
 * Auswertung; er bleibt verborgen.
 */
export function contentFromPairs(pairs) {
  const rows = (pairs || []).filter((p) => p && (hasSide(p.a) || hasSide(p.b)));
  const labels = new Set();
  const autoTexts = new Set(rows.map((p) => String(p.b?.text || '').trim()).filter(Boolean));
  const dropZones = [];
  const draggables = [];
  rows.forEach((p, i) => {
    const a = side(p.a?.text, p.a?.imageUrl, p.a?.hideText);
    const b = side(p.b?.text, p.b?.imageUrl, p.b?.hideText);
    const bText = !blank(b.text) ? b.text.trim() : b.imageUrl ? uniqueName(`Bild ${i + 1}`, autoTexts) : '';
    const bHidden = b.imageUrl ? (b.hideText || blank(b.text)) : false;
    if (!hasSide(a)) {
      if (bText) draggables.push({ text: bText, correctZone: '', multiple: false, imageUrl: b.imageUrl, hideText: bHidden });
      return;
    }
    const label = uniqueName(!blank(a.text) ? a.text.trim() : `Karte ${i + 1}`, labels);
    dropZones.push({
      label, correctDraggable: bText, group: '',
      x: 5, y: Math.min(90, 5 + dropZones.length * 10), width: 40, height: 8,
      imageUrl: a.imageUrl, hideText: a.imageUrl ? (a.hideText || blank(a.text)) : false,
    });
    if (bText) draggables.push({ text: bText, correctZone: label, multiple: false, imageUrl: b.imageUrl, hideText: bHidden });
  });
  return { dropZones, draggables };
}

/**
 * Zonen und ziehbare Elemente → Paare. Was Paare nicht abbilden können
 * (mehrere richtige Elemente je Zone, Ablagegruppen, mehrfach verwendbare
 * Elemente), steht in `problems`.
 */
export function pairsFromContent(content) {
  const zones = ((content && content.dropZones) || []).filter((z) => z && z.label);
  const drags = ((content && content.draggables) || []).filter((d) => d && !blank(d.text));
  const used = new Set();
  const problems = [];
  const pairs = [];
  for (const z of zones) {
    // Dieselbe Regel wie dndExpectedMappings in answer-eval.js
    const targeted = [...new Set(drags.filter((d) => d.correctZone === z.label).map((d) => d.text))];
    const own = z.correctDraggable || '';
    const right = !own ? targeted : targeted.includes(own) ? targeted : [own];
    if (right.length > 1) problems.push(`„${z.label}“ hat ${right.length} richtige Elemente – als Paar bleibt nur „${right[0]}“, die anderen werden Ablenker.`);
    let b = side();
    if (right.length) {
      const k = drags.findIndex((d, i) => !used.has(i) && d.text === right[0]);
      if (k >= 0) { used.add(k); b = side(drags[k].text, drags[k].imageUrl, drags[k].hideText); } else b = side(right[0]);
    }
    pairs.push({ a: side(z.label, z.imageUrl, z.hideText), b });
  }
  if (zones.some((z) => z.group)) problems.push('Ablagegruppen (vertauschbare Zonen) gibt es bei Paaren nicht – jede Zeile hat ihre feste Karte.');
  if (drags.some((d) => d.multiple)) problems.push('„Mehrfach nutzbar“ entfällt: Bei Paaren liegt jedes Element einmal in der Ablage.');
  drags.forEach((d, i) => {
    if (used.has(i)) return;
    // Mehrfach nutzbar und schon in einem Paar: kein eigener Ablenker.
    if (d.multiple && pairs.some((p) => p.b.text === d.text)) return;
    pairs.push({ a: side(), b: side(d.text, d.imageUrl, d.hideText) });
  });
  return { pairs, problems };
}
