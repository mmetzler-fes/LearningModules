// ==================== DATEI ERNEUT ÜBERNEHMEN ====================
//
// Ein Dokument aus seiner Originaldatei neu importieren – mit dem aktuellen
// Import (Verbesserungen kommen so auch bei alten Blättern an). Originale werden
// nicht gespeichert (docs/anhang.md); die Lehrkraft wählt die Datei neu.
// Vorher: Warnung und Bestätigung, dann eine Sicherung als ausgeblendete Kopie
// direkt hinter dem Dokument. Danach der Import-Bericht mit Ampel.

import { escapeHtml, generateId } from '../utils.js';
import { DOCUMENT_EXTS, fileToSpec, askConvertOptions } from './attachment-convert.js';
import { showImportQuality } from './import-quality.js';

const failed = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [...DOCUMENT_EXTS, 'pdf'].map((e) => `.${e}`).join(',');
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Rückfrage mit Warnung – `true` nur bei „Ersetzen“. */
function confirmReplace(title, fileName, backupTitle) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card">
        <h3>📄 Datei erneut übernehmen</h3>
        <p>Der Inhalt von <strong>„${escapeHtml(title)}“</strong> wird durch <strong>${escapeHtml(fileName)}</strong> ersetzt.</p>
        <ul class="import-report-list">
          <li>⚠️ Was du seit dem Import im Editor geändert hast, ist danach im Dokument nicht mehr da.</li>
          <li>💾 Vorher wird eine Sicherung angelegt: <strong>„${escapeHtml(backupTitle)}“</strong>, ausgeblendet, direkt hinter dem Dokument. Schüler sehen sie nicht; löschen, wenn alles passt.</li>
          <li>✏️ Beschriftungen von Schülern bleiben zu ihrer Fassung erhalten, passen zum neuen Inhalt aber nicht unbedingt.</li>
        </ul>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary ri-no">Abbrechen</button>
          <button type="button" class="btn btn-danger ri-yes">Ersetzen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.ri-no').addEventListener('click', () => done(false));
    overlay.querySelector('.ri-yes').addEventListener('click', () => done(true));
    overlay.querySelector('.ri-no').focus();
  });
}

function busy(text) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card"><p>⏳ ${escapeHtml(text)}</p></div>`;
  document.body.appendChild(overlay);
  return () => overlay.remove();
}

const contentOf = (mod) => {
  let c = mod?.content || {};
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
  return c;
};

/** Dokument `mod` im Lernthema `topic` aus einer neu gewählten Datei übernehmen. */
export async function reimportDocument(app, topic, mod, { onDone = null } = {}) {
  const file = await pickFile();
  if (!file) return;
  const date = new Date().toLocaleDateString('de-DE');
  const title = mod.title || 'Dokument';
  const backupTitle = `${title} (Sicherung vom ${date})`;
  if (!(await confirmReplace(title, file.name, backupTitle))) return;
  let pdf = null;
  if (/\.pdf$/i.test(file.name)) {
    try {
      pdf = await askConvertOptions({ heading: '📄 PDF übernehmen', intro: `„${file.name}“ ersetzt den Inhalt von „${title}“.` });
    } catch (err) { app.showToast(err.message, 'error'); return; }
    if (!pdf) return;
  }
  const stop = busy(`„${file.name}“ wird übernommen …`);
  try {
    const { spec, warnings } = await fileToSpec(file, { pdf, topicId: topic.id });
    const modules = await app.api.getTopicModules(topic.id);
    const cur = Array.isArray(modules) ? modules.find((m) => m.id === mod.id) : null;
    if (!cur) throw new Error('Das Dokument wurde nicht gefunden.');
    const now = new Date().toISOString();
    // 1. Sicherung: ausgeblendete Kopie mit dem bisherigen Inhalt
    const backup = { ...cur, id: generateId(), title: backupTitle, moduleSelected: false, createdAt: now, updatedAt: now };
    const savedBackup = await app.api.saveModule(topic.id, backup);
    if (failed(savedBackup)) throw new Error(`Sicherung fehlgeschlagen – nichts ersetzt (${savedBackup?.message || 'Fehler'}).`);
    const backupId = savedBackup.id || backup.id;
    // direkt hinter das Dokument
    const order = (await app.api.getTopicModules(topic.id) || []).filter((m) => !m.parentId)
      .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)).map((m) => m.id).filter((id) => id !== backupId);
    order.splice(order.indexOf(cur.id) + 1, 0, backupId);
    await app.api.reorderModules(topic.id, order);
    // 2. Ersetzen – Art (Arbeitsblatt, Klassenarbeit …) und alles andere bleiben
    const saved = await app.api.saveModule(topic.id, { ...cur, content: { ...contentOf(cur), spec }, updatedAt: now });
    if (failed(saved)) throw new Error(`Ersetzen fehlgeschlagen (${saved?.message || 'Fehler'}) – die Sicherung „${backupTitle}“ liegt bereit.`);
    stop();
    await onDone?.();
    showImportQuality(app, [{ id: cur.id, title, spec, warnings }], {
      heading: '📋 Erneut übernommen',
      notes: [`Sicherung: „${backupTitle}“ (ausgeblendet, direkt hinter dem Dokument).`],
      onDone,
    });
  } catch (err) {
    stop();
    app.showToast(err.message, 'error');
    await onDone?.();
  }
}
