import { pdfToSpec } from './views/attachment-convert.js';
import { readXopp, layerFromXopp } from '../lm-editor/src/import/xopp.js';
import { ensureBlockIds } from '../lm-editor/src/doc/ids.js';

// ==================== .xopp → DOKUMENT ====================
//
// Xournal++: Das PDF dahinter läuft durch den gewohnten PDF-Import
// (bearbeitbar), die Beschriftung wird ein Stand des Stift-Editors für die
// Lehrkraft – je Seite eine Gruppe, ungefähr an der Stelle im PDF (`_pos` der
// Bausteine aus dem Import). Für den Dokument-Editor (Übernehmen) und das
// Öffnen per Doppelklick (views/file-open.js).

/** .xopp lesen – `{ pages, pdfName, warnings }`, dazu `needsPdf`. */
export async function readXoppFile(file) {
  const xopp = readXopp(new Uint8Array(await file.arrayBuffer()));
  return { ...xopp, needsPdf: xopp.pages.some((p) => p.pdfPage !== null) };
}

const stripPositions = (v) => {
  if (Array.isArray(v)) v.forEach(stripPositions);
  else if (v && typeof v === 'object') { delete v._pos; Object.values(v).forEach(stripPositions); }
};

/**
 * Dokument aus einer gelesenen .xopp (`xopp`, siehe readXoppFile) und ihrem
 * PDF (`pdfFile`, `pdf`: Art der Umwandlung wie askConvertOptions). Liefert
 * `{ spec, title, warnings, stand, count }` – `stand` ist die Beschriftung
 * (null, wenn keine), `count` die Zahl der Striche und Textfelder.
 */
export async function xoppToDocument(xopp, { name = 'Xournal', pdfFile = null, pdf = null } = {}) {
  let spec;
  let title = name.replace(/\.xopp$/i, '');
  const warnings = [...xopp.warnings];
  if (xopp.needsPdf) {
    if (!pdfFile) throw new Error(`Zur .xopp gehört das PDF „${xopp.pdfName || '…'}“ – bitte mit auswählen.`);
    if (!pdf) throw new Error('Für das PDF fehlt die Art der Umwandlung.');
    const r = await pdfToSpec(pdfFile, pdfFile.name, { ...pdf, positions: true });
    spec = r.spec;
    title = r.title || title;
    warnings.push(...r.warnings);
  } else {
    // Ohne PDF (Karo-, Linienpapier): je Seite ein unsichtbares Schreibfeld in Seitenhöhe.
    spec = { content: xopp.pages.map((p, i) => {
      p.pdfPage = 1000 + i;
      return { type: 'karo', pattern: 'frei', lines: Math.max(1, Math.min(60, Math.round(p.h / 14.17))), _pos: [1000 + i, 0] };
    }) };
  }
  // Feste IDs – daran hängt die Beschriftung; `_pos` nur für sie, nicht ins Dokument.
  ensureBlockIds(spec);
  const anchors = (spec.content || []).filter((b) => Array.isArray(b?._pos) && b.id).map((b) => ({ bid: b.id, page: b._pos[0], top: b._pos[1] }));
  stripPositions(spec);
  if (xopp.needsPdf && !anchors.length) warnings.push('Die Lage im PDF war nicht bekannt (KI-Erkennung) – die Beschriftung steht oben auf dem Blatt; bitte im Stift-Editor verschieben.');
  const count = xopp.pages.reduce((n, p) => n + p.items.length, 0);
  const stand = count ? { v: 1, bg: 'paper', pages: [{ items: [] }], layer: layerFromXopp(xopp, anchors) } : null;
  return { spec, title, warnings, stand, count };
}

/** Beschriftung als die der Lehrkraft zum Dokument `moduleId` speichern (src/work/teacher-ink.service.ts). */
export async function saveTeacherInk(moduleId, stand) {
  const token = sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || '';
  const res = await fetch(`/api/teacher-ink/${encodeURIComponent(moduleId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: stand }),
  }).catch(() => null);
  return !!res?.ok;
}
