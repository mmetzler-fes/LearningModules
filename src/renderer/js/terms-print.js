import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { downloadBlob } from './api.js';
import { htmlToOdt } from './odf/odt-from-html.js';

// ==================== ERLAUBNIS DER SCHULLEITUNG ====================
//
// Druckvorlage für den Admin: Die Schulleitung erlaubt mit Unterschrift den
// Einsatz auf diesem Server, die Nutzungsbedingungen hängen als Anlage an.
// Gespeichert wird nichts – das Blatt bleibt zur Absicherung beim Admin.
// Siehe docs/nutzungsbedingungen.md.

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 18mm 16mm; }
  body { font: 10.5pt/1.4 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; margin: 9pt 0 3pt; }
  .sub { color: #555; margin: 0 0 10pt; }
  .fields { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; }
  .fields th { text-align: left; font-weight: 600; width: 34%; padding: 4pt 8pt 3pt 0; vertical-align: bottom; }
  .fields td { border-bottom: 1px solid #333; padding: 5pt 0 2pt; }
  .check { margin: 4pt 0; }
  .box { display: inline-block; width: 10pt; height: 10pt; border: 1px solid #333; margin-right: 6pt; vertical-align: -1pt; }
  .sign { display: flex; gap: 24pt; margin-top: 22pt; }
  p { margin: 0 0 5pt; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 3pt; font-size: 9.5pt; color: #444; }
  .note { font-size: 9pt; color: #444; margin-top: 12pt; }
  .annex { break-before: page; }
  .annex h1 { font-size: 15pt; }
  .annex h2 { font-size: 12pt; }
  .annex li { margin: 2pt 0; }
  a { color: inherit; }
  .help-table { border-collapse: collapse; } .help-table td, .help-table th { border: 1px solid #999; padding: 2pt 4pt; }
  @media screen { body { max-width: 180mm; margin: 12mm auto; padding: 0 8mm; } }
`;

/** Das Blatt als HTML – ohne DOM, damit es sich auch prüfen lässt. */
export function permissionSheetHtml({ terms, server = {}, schoolName = '' }) {
  const line = (v) => (v ? escapeHtml(v) : '&nbsp;');
  const check = (text) => `<p class="check"><span class="box"></span>${text}</p>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Erlaubnis der Schulleitung – LearningModules</title><style>${PRINT_CSS}</style></head><body>
<h1>Erlaubnis der Schulleitung</h1>
<p class="sub">zum Einsatz von LearningModules im Unterricht</p>

<table class="fields">
  <tr><th>Schule</th><td>${line(schoolName)}</td></tr>
  <tr><th>Server (Adresse)</th><td>${line(server.url)}</td></tr>
  <tr><th>Name des Servers</th><td>${line(server.name && server.name !== 'LearningModules' ? server.name : '')}</td></tr>
  <tr><th>Betreiber des Servers (Person oder Stelle)</th><td>&nbsp;</td></tr>
  <tr><th>Hosting-Anbieter / Rechenzentrum</th><td>&nbsp;</td></tr>
  <tr><th>Ansprechperson / Admin</th><td>&nbsp;</td></tr>
</table>

<h2>Erklärung</h2>
<p>Die Schulleitung erlaubt den Lehrkräften der oben genannten Schule, LearningModules auf dem oben
genannten Server im Unterricht einzusetzen. Sie hat die Nutzungsbedingungen (Fassung ${escapeHtml(String(terms.version))},
siehe Anlage) zur Kenntnis genommen.</p>
<p>Wird der Server nicht von der Schule oder ihrem Träger betrieben, ist die Schulleitung damit
einverstanden, dass ihn der oben genannte Betreiber für die Schule betreibt.</p>
<p>Jede Lehrkraft bestätigt die Nutzungsbedingungen zusätzlich selbst bei der ersten Anmeldung.</p>

<h2>Datenschutz</h2>
<p>Auf dem Server liegen Konten der Lehrkräfte sowie Namen und Ergebnisse von Schülern, solange die
Löschregel sie nicht entfernt hat.</p>
${check('Der oder die Datenschutzbeauftragte der Schule ist informiert.')}
<p>Auftragsverarbeitung (Art. 28 DSGVO) – Zutreffendes ankreuzen:</p>
${check('Den Server betreibt die Schule oder ihr Träger selbst; ein Vertrag mit einem Betreiber ist nicht nötig.')}
${check('Den Server betreibt eine andere Person oder Stelle; ein Vertrag zur Auftragsverarbeitung zwischen Schule und Betreiber liegt vor.')}
${check('Mit dem Hosting-Anbieter besteht ein Vertrag zur Auftragsverarbeitung (über den Betreiber oder die Schule); die Schule ist mit diesem Anbieter einverstanden.')}
${check('Anders geregelt: ________________________')}

<h2>Vernetzung mit anderen Servern</h2>
${check('erlaubt – es gehen nur geteilte Angebote und Namen von Lehrkräften hinaus, nie Schülerdaten')}
${check('nicht erlaubt')}
<p>Vertrauensnetzwerk – verbundene Server reichen Angebote an ihre Partner weiter, auch an Server, die
die Schule nicht selbst ausgewählt hat. Weitergereicht wird nur, wofür eine Lehrkraft beim Anbieten
eingewilligt und eine Lizenz gewählt hat; wer über das Netz kopiert, erscheint beim Ursprung nur als
„Lehrkraft @ Server“. Teilnehmen dürfen nur Server in der EU.</p>
${check('Teilnahme am Vertrauensnetzwerk erlaubt; der Server steht in der EU, und Betreiber und Hosting-Anbieter übermitteln keine Daten in Länder außerhalb der EU.')}
${check('Teilnahme am Vertrauensnetzwerk nicht erlaubt')}

<div class="sign">
  <div>Ort, Datum</div>
  <div>Unterschrift Schulleitung, Stempel</div>
</div>
<div class="sign">
  <div>Ort, Datum</div>
  <div>Unterschrift Betreiber / Admin (Kenntnisnahme)</div>
</div>

<p class="note">Das Original bleibt bei der Schule, eine Kopie beim Betreiber des Servers.
Ändern sich die Nutzungsbedingungen wesentlich (neue Fassung), sollte die Erlaubnis erneuert werden.
Diese Vorlage ersetzt keine rechtliche Prüfung.</p>

<section class="annex">
<p class="sub">Anlage – Nutzungsbedingungen, wie sie jede Lehrkraft bei der ersten Anmeldung bestätigt</p>
${renderMarkdown(terms.markdown)}
</section>
</body></html>`;
}

/** Bedingungen und Serverangaben fürs Blatt laden. */
async function loadSheet(schoolName) {
  const [terms, info] = await Promise.all([
    fetch('/api/auth/terms', { cache: 'no-store' }).then((r) => r.json()),
    fetch('/api/federation/info', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
  ]);
  if (!terms?.markdown) throw new Error(terms?.message || 'Nutzungsbedingungen nicht lesbar');
  const server = { name: info?.name, url: info?.url || location.origin };
  return permissionSheetHtml({ terms, server, schoolName });
}

/** Öffnet das Blatt in einem neuen Fenster und den Druckdialog. */
export async function printPermissionSheet(app, { schoolName = '' } = {}) {
  // Erst das Fenster, dann laden – sonst blockt der Browser das Popup.
  const win = window.open('', '_blank');
  if (!win) { app.showToast('Das Druckfenster wurde blockiert – bitte Popups für diese Seite erlauben.', 'error'); return; }
  win.document.write('<p style="font-family:sans-serif">Wird vorbereitet…</p>');
  try {
    const html = await loadSheet(schoolName);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  } catch (err) {
    win.close();
    app.showToast('Fehler: ' + err.message, 'error');
  }
}

/** Dasselbe Blatt als .odt – zum Ausfüllen am Rechner vor dem Druck. */
export async function downloadPermissionOdt(app, { schoolName = '' } = {}) {
  try {
    const odt = htmlToOdt(await loadSheet(schoolName));
    downloadBlob(odt, 'erlaubnis-schulleitung-learningmodules.odt');
  } catch (err) {
    app.showToast('Fehler: ' + err.message, 'error');
  }
}
