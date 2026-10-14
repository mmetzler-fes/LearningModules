// Einfaches HTML (Überschriften, Absätze, Listen, Tabellen, fett/kursiv/Code,
// Links) als LibreOffice-Textdokument (.odt) – im Browser erzeugt, damit sich
// Vorlagen wie die Erlaubnis der Schulleitung am Rechner ausfüllen lassen.
//
// Ein paar Klassen aus den Druckvorlagen werden übersetzt:
//   table.fields  – Beschriftung links, Schreiblinie rechts
//   p.check       – Ankreuzfeld (☐) vor dem Text
//   div.sign      – nebeneinanderliegende Unterschriftslinien
//   p.sub/p.note  – grau bzw. klein
//   .annex        – beginnt auf einer neuen Seite

import { zipStore } from './sheet-templates.js';

const MIME = 'application/vnd.oasis.opendocument.text';
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
  + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
  + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
  + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
  + ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"'
  + ' xmlns:xlink="http://www.w3.org/1999/xlink"'
  + ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';

const LINE = '0.5pt solid #333333';

// Seite (A4) und benannte Absatzvorlagen – in LibreOffice als Vorlagen sichtbar.
const STYLES = '<?xml version="1.0" encoding="UTF-8"?>'
  + `<office:document-styles ${NS} office:version="1.2">`
  + '<office:font-face-decls><style:font-face style:name="Liberation Sans" svg:font-family="\'Liberation Sans\'" style:font-family-generic="swiss"/>'
  + '<style:font-face style:name="Liberation Mono" svg:font-family="\'Liberation Mono\'" style:font-family-generic="modern"/></office:font-face-decls>'
  + '<office:styles>'
  + '<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.15cm" fo:line-height="125%"/>'
  + '<style:text-properties style:font-name="Liberation Sans" fo:font-size="10.5pt" fo:language="de" fo:country="DE" fo:color="#111111"/></style:default-style>'
  + '<style:style style:name="Standard" style:family="paragraph" style:class="text"/>'
  + '<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="1" style:class="text">'
  + '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style>'
  + '<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="2" style:class="text">'
  + '<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.1cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style>'
  + '<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="3" style:class="text">'
  + '<style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.1cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>'
  + '<style:style style:name="Untertitel" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-bottom="0.35cm"/><style:text-properties fo:color="#555555"/></style:style>'
  + '<style:style style:name="Hinweis" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-top="0.4cm"/><style:text-properties fo:font-size="9pt" fo:color="#444444"/></style:style>'
  + '<style:style style:name="Ankreuzen" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-left="0.6cm" fo:text-indent="-0.6cm" fo:margin-bottom="0.1cm"/></style:style>'
  + '<style:style style:name="Tabelleninhalt" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-bottom="0cm"/></style:style>'
  + '<style:style style:name="Unterschrift" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-bottom="0cm"/><style:text-properties fo:font-size="9.5pt" fo:color="#444444"/></style:style>'
  + '<style:style style:name="Code" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:text-properties style:font-name="Liberation Mono" fo:font-size="9pt"/></style:style>'
  + '</office:styles>'
  + '<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"'
  + ' style:print-orientation="portrait" fo:margin-top="1.8cm" fo:margin-bottom="1.6cm" fo:margin-left="1.8cm" fo:margin-right="1.8cm"/></style:page-layout></office:automatic-styles>'
  + '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>'
  + '</office:document-styles>';

// Satzspiegel: 21 cm − 2 × 1,8 cm
const WIDTH = 17.4;

const AUTO_STYLES = ''
  + '<style:style style:name="T_b" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>'
  + '<style:style style:name="T_i" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>'
  + '<style:style style:name="T_code" style:family="text"><style:text-properties style:font-name="Liberation Mono" fo:font-size="9pt"/></style:style>'
  + '<text:list-style style:name="L_ul"><text:list-level-style-bullet text:level="1" text:bullet-char="•">'
  + '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.4cm" fo:margin-left="0.6cm"/></style:list-level-properties>'
  + '</text:list-level-style-bullet><text:list-level-style-bullet text:level="2" text:bullet-char="◦">'
  + '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.4cm" fo:margin-left="1.2cm"/></style:list-level-properties>'
  + '</text:list-level-style-bullet></text:list-style>'
  + '<text:list-style style:name="L_ol"><text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix=".">'
  + '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.5cm" fo:margin-left="0.7cm"/></style:list-level-properties>'
  + '</text:list-level-style-number><text:list-level-style-number text:level="2" style:num-format="a" style:num-suffix=")">'
  + '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.5cm" fo:margin-left="1.3cm"/></style:list-level-properties>'
  + '</text:list-level-style-number></text:list-style>'
  // Felder: Beschriftung | Schreiblinie
  + `<style:style style:name="Tab_fields" style:family="table"><style:table-properties style:width="${WIDTH}cm" table:align="left" fo:margin-top="0.2cm" fo:margin-bottom="0.4cm"/></style:style>`
  + `<style:style style:name="Tab_fields.A" style:family="table-column"><style:table-column-properties style:column-width="${(WIDTH * 0.34).toFixed(2)}cm"/></style:style>`
  + `<style:style style:name="Tab_fields.B" style:family="table-column"><style:table-column-properties style:column-width="${(WIDTH * 0.66).toFixed(2)}cm"/></style:style>`
  + '<style:style style:name="Tab_fields.R" style:family="table-row"><style:table-row-properties style:min-row-height="0.75cm"/></style:style>'
  + '<style:style style:name="Tab_fields.L" style:family="table-cell"><style:table-cell-properties style:vertical-align="bottom" fo:padding-bottom="0.05cm" fo:border="none"/></style:style>'
  + `<style:style style:name="Tab_fields.V" style:family="table-cell"><style:table-cell-properties style:vertical-align="bottom" fo:padding-bottom="0.05cm" fo:border-top="none" fo:border-left="none" fo:border-right="none" fo:border-bottom="${LINE}"/></style:style>`
  // Unterschriften: Linie | Abstand | Linie, mit Platz zum Schreiben darüber
  + `<style:style style:name="Tab_sign" style:family="table"><style:table-properties style:width="${WIDTH}cm" table:align="left" fo:margin-top="0.9cm" fo:margin-bottom="0cm"/></style:style>`
  + '<style:style style:name="Tab_sign.A" style:family="table-column"><style:table-column-properties style:column-width="7.9cm"/></style:style>'
  + '<style:style style:name="Tab_sign.B" style:family="table-column"><style:table-column-properties style:column-width="1.6cm"/></style:style>'
  + `<style:style style:name="Tab_sign.L" style:family="table-cell"><style:table-cell-properties fo:padding-top="0.08cm" fo:border-left="none" fo:border-right="none" fo:border-bottom="none" fo:border-top="${LINE}"/></style:style>`
  + '<style:style style:name="Tab_sign.G" style:family="table-cell"><style:table-cell-properties fo:border="none"/></style:style>'
  // Gewöhnliche Tabellen mit Gitter
  + `<style:style style:name="Tab_grid" style:family="table"><style:table-properties style:width="${WIDTH}cm" table:align="left" fo:margin-top="0.1cm" fo:margin-bottom="0.3cm"/></style:style>`
  + '<style:style style:name="Tab_grid.C" style:family="table-cell"><style:table-cell-properties fo:padding="0.08cm" fo:border="0.5pt solid #999999"/></style:style>';

/** Wandelt ein HTML-Dokument (String) in eine .odt-Datei (Blob). */
export function htmlToOdt(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const extra = [];         // dynamische Absatzstile (Seitenumbruch)
  let breakNext = false;    // nächster Absatz beginnt auf neuer Seite

  const breakStyle = (parent) => {
    if (!breakNext) return parent;
    breakNext = false;
    const name = `P_brk_${extra.length + 1}`;
    extra.push(`<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties fo:break-before="page"/></style:style>`);
    return name;
  };

  const inline = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += x(n.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') out += '<text:line-break/>';
      else if (tag === 'strong' || tag === 'b') out += `<text:span text:style-name="T_b">${inline(n)}</text:span>`;
      else if (tag === 'em' || tag === 'i') out += `<text:span text:style-name="T_i">${inline(n)}</text:span>`;
      else if (tag === 'code') out += `<text:span text:style-name="T_code">${inline(n)}</text:span>`;
      else if (tag === 'a' && /^https?:\/\//.test(n.getAttribute('href') || '')) {
        out += `<text:a xlink:type="simple" xlink:href="${x(n.getAttribute('href'))}">${inline(n)}</text:a>`;
      } else if (n.classList?.contains('box')) out += '☐ ';
      else out += inline(n);
    }
    return out;
  };
  const para = (style, content) => `<text:p text:style-name="${breakStyle(style)}">${content.replace(/^ +| +$/g, '')}</text:p>`;
  const cellText = (n, style = 'Tabelleninhalt') => para(style, inline(n));

  const list = (el, level = 1) => {
    const style = el.tagName.toLowerCase() === 'ol' ? 'L_ol' : 'L_ul';
    let out = level === 1 ? `<text:list text:style-name="${style}">` : '<text:list>';
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      // Text des Punkts in einen Absatz; Absätze und verschachtelte Listen darin je für sich
      const text = li.cloneNode(true);
      const blocks = [];
      for (const c of [...text.children]) if (/^(ul|ol|p)$/i.test(c.tagName)) { blocks.push(c); c.remove(); }
      const own = inline(text).trim();
      out += '<text:list-item>'
        + (own || !blocks.length ? para('Standard', own) : '')
        + blocks.map((c) => (/^p$/i.test(c.tagName)
          ? para(c.classList.contains('check') ? 'Ankreuzen' : 'Standard', inline(c))
          : list(c, level + 1))).join('')
        + '</text:list-item>';
    }
    return out + '</text:list>';
  };

  const fieldsTable = (el) => {
    let out = '<table:table table:style-name="Tab_fields"><table:table-column table:style-name="Tab_fields.A"/><table:table-column table:style-name="Tab_fields.B"/>';
    for (const tr of el.querySelectorAll('tr')) {
      const [th, td] = tr.children;
      out += '<table:table-row table:style-name="Tab_fields.R">'
        + `<table:table-cell table:style-name="Tab_fields.L" office:value-type="string">${cellText(th || tr)}</table:table-cell>`
        + `<table:table-cell table:style-name="Tab_fields.V" office:value-type="string">${td ? cellText(td) : para('Tabelleninhalt', '')}</table:table-cell>`
        + '</table:table-row>';
    }
    return out + '</table:table>';
  };

  const signTable = (el) => {
    const cells = [...el.children];
    let out = '<table:table table:style-name="Tab_sign">';
    cells.forEach((_, i) => {
      if (i) out += '<table:table-column table:style-name="Tab_sign.B"/>';
      out += '<table:table-column table:style-name="Tab_sign.A"/>';
    });
    out += '<table:table-row>';
    cells.forEach((c, i) => {
      if (i) out += `<table:table-cell table:style-name="Tab_sign.G" office:value-type="string">${para('Unterschrift', '')}</table:table-cell>`;
      out += `<table:table-cell table:style-name="Tab_sign.L" office:value-type="string">${cellText(c, 'Unterschrift')}</table:table-cell>`;
    });
    return out + '</table:table-row></table:table>';
  };

  const gridTable = (el) => {
    const rows = [...el.querySelectorAll('tr')];
    const cols = Math.max(1, ...rows.map((r) => r.children.length));
    // Spaltenbreite nach dem längsten Inhalt, aber keine Spalte schmaler als ein Wort
    const len = Array.from({ length: cols }, (_, i) => Math.min(60, Math.max(14, ...rows.map((r) => (r.children[i]?.textContent || '').trim().length))));
    const sum = len.reduce((a, b) => a + b, 0);
    const t = `Tab_grid${extra.length + 1}`;
    len.forEach((l, i) => extra.push(`<style:style style:name="${t}.${i}" style:family="table-column"><style:table-column-properties style:column-width="${(WIDTH * l / sum).toFixed(2)}cm"/></style:style>`));
    let out = `<table:table table:style-name="Tab_grid">${len.map((_, i) => `<table:table-column table:style-name="${t}.${i}"/>`).join('')}`;
    const row = (tr) => {
      let r = '<table:table-row>';
      for (let i = 0; i < cols; i++) {
        const c = tr.children[i];
        const content = c ? inline(c) : '';
        r += `<table:table-cell table:style-name="Tab_grid.C" office:value-type="string">${para('Tabelleninhalt', c?.tagName.toLowerCase() === 'th' ? `<text:span text:style-name="T_b">${content}</text:span>` : content)}</table:table-cell>`;
      }
      return r + '</table:table-row>';
    };
    // Kopfzeile (nur <th>) wiederholt sich auf Folgeseiten
    const head = rows[0] && [...rows[0].children].every((c) => c.tagName.toLowerCase() === 'th') ? rows.shift() : null;
    if (head) out += `<table:table-header-rows>${row(head)}</table:table-header-rows>`;
    out += rows.map(row).join('');
    return out + '</table:table>';
  };

  const block = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out += para('Standard', x(n.nodeValue.trim())); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      const cls = n.classList;
      if (/^(style|script|title|head|hr)$/.test(tag)) continue;
      if (cls.contains('annex')) breakNext = true;
      const h = /^h([1-6])$/.exec(tag);
      if (h) {
        const level = Math.min(3, Number(h[1]));
        out += `<text:h text:style-name="${breakStyle(`Heading_20_${level}`)}" text:outline-level="${level}">${inline(n).trim()}</text:h>`;
      } else if (tag === 'p') {
        const style = cls.contains('check') ? 'Ankreuzen' : cls.contains('sub') ? 'Untertitel' : cls.contains('note') ? 'Hinweis' : 'Standard';
        out += para(style, inline(n));
      } else if (tag === 'ul' || tag === 'ol') out += list(n);
      else if (tag === 'table') out += cls.contains('fields') ? fieldsTable(n) : gridTable(n);
      else if (cls.contains('sign')) out += signTable(n);
      else if (tag === 'pre') out += n.textContent.replace(/\n$/, '').split('\n').map((l) => para('Code', x(l))).join('');
      else if (tag === 'blockquote') out += para('Standard', `<text:span text:style-name="T_i">${inline(n)}</text:span>`);
      else out += block(n);
    }
    return out;
  };

  const body = block(doc.body);
  const content = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<office:document-content ${NS} office:version="1.2">`
    + `<office:automatic-styles>${AUTO_STYLES}${extra.join('')}</office:automatic-styles>`
    + `<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const title = doc.title || '';
  const meta = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">'
    + `<office:meta><dc:title>${x(title)}</dc:title><dc:language>de-DE</dc:language></office:meta></office:document-meta>`;
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
    + `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/>`
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    + '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
    + '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'
    + '</manifest:manifest>';
  // "mimetype" muss als erster Eintrag unkomprimiert vorne stehen.
  const zip = zipStore([
    { name: 'mimetype', data: MIME },
    { name: 'content.xml', data: content },
    { name: 'styles.xml', data: STYLES },
    { name: 'meta.xml', data: meta },
    { name: 'META-INF/manifest.xml', data: manifest },
  ]);
  return new Blob([zip], { type: MIME });
}
