import AdmZip from 'adm-zip';
import { odtToHtml, usableTitle } from './odt';

/** Kleinstes Writer-Dokument mit dem gegebenen Inhalt von office:text. */
function odt(body: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'));
  zip.addFile('content.xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><office:text>'
    + body + '</office:text></office:body></office:document-content>'));
  return zip.toBuffer();
}

const shape = (name: string, anchor = 'paragraph') =>
  `<draw:g text:anchor-type="${anchor}" draw:name="${name}"><draw:rect svg:width="2cm" svg:height="1cm" svg:x="0cm" svg:y="0cm"/></draw:g>`;

describe('.odt-Import: Zeichnungen von LibreOffice', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

  it('setzt das SVG von LibreOffice ein, statt die Zeichnung nachzubauen', () => {
    const drawings = new Map([['lmdraw-1', { svg, widthMm: 50.8 }]]);
    const r = odtToHtml(odt(`<text:p>Vorher${shape('lmdraw-1')}nachher</text:p>`), 'x.odt', { drawings });
    expect(r.stats).toMatchObject({ exported: 1, drawings: 0 });
    expect(r.html).toContain(`src="data:image/svg+xml;base64,${svg.toString('base64')}"`);
    expect(r.html).toContain('width="192"'); // 50,8 mm = 2 Zoll = 192 px
    expect(r.html).toContain('ws-img-center');
  });

  it('wie ein Buchstabe verankert bleibt im Text; ohne Export wird nachgebaut', () => {
    const drawings = new Map([['lmdraw-1', { svg, widthMm: 0 }]]);
    const inline = odtToHtml(odt(`<text:p>A${shape('lmdraw-1', 'as-char')}B</text:p>`), 'x.odt', { drawings });
    expect(inline.html).toMatch(/<p>A<img [^>]*>B<\/p>/);
    const own = odtToHtml(odt(`<text:p>A${shape('Form1')}</text:p>`), 'x.odt', { drawings });
    expect(own.stats).toMatchObject({ exported: 0, drawings: 1 });
  });

  it('ein langer Absatz mit Überschriften-Vorlage bleibt Text', () => {
    const long = 'Das Tor einer Hofeinfahrt wird über den Taster geöffnet. '.repeat(5);
    const r = odtToHtml(odt(`<text:h text:outline-level="1">Projekt</text:h><text:h text:outline-level="2">${long}</text:h>`), 'x.odt');
    expect(r.html).toMatch(/^<h2>Projekt<\/h2><p>/);
  });
});

describe('.odt-Import: Titel', () => {
  it('Titel aus den Metadaten nur, wenn er nach einem Titel aussieht', () => {
    expect(usableTitle('1')).toBe(false);
    expect(usableTitle('Unbenannt 1')).toBe(false);
    expect(usableTitle('AB')).toBe(false);
    expect(usableTitle('Projekt Torsteuerung')).toBe(true);
    expect(usableTitle('Ohm')).toBe(true);
  });
});

describe('.odt-Import: Abbildungen nebeneinander', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const withPictures = (body: string) => {
    const zip = new AdmZip(odt(body));
    for (const n of ['a', 'b', 'c']) zip.addFile(`Pictures/${n}.png`, png);
    return zip.toBuffer();
  };
  const frame = (pic: string, x: string, y = '0.3cm', h = '5cm') =>
    `<draw:frame text:anchor-type="paragraph" draw:name="${pic}" svg:x="${x}" svg:y="${y}" svg:width="5cm" svg:height="${h}"><draw:image xlink:href="Pictures/${pic}.png"/></draw:frame>`;

  it('je Absatz ein Bild, nebeneinander gerückt, Unterschriften mit Tabs → Tabelle ohne Linien', () => {
    const body = `<text:p>Vorher</text:p><text:p>${frame('a', '0cm')}</text:p><text:p>${frame('b', '6cm')}</text:p><text:p/><text:p/>`
      + `<text:p>${frame('c', '12cm')}</text:p><text:p/><text:p/>`
      + '<text:p><text:tab/>Abbildung 1<text:tab/><text:tab/>Abbildung 2<text:tab/>Abbildung 3</text:p><text:p>Nachher</text:p>';
    const r = odtToHtml(withPictures(body), 'x.odt');
    expect(r.html).toMatch(/<p>Vorher<\/p><table class="ws-table-plain"><tbody><tr>(<td><img [^>]*alt="[abc]"[^>]*><\/td>){3}<\/tr>/);
    expect(r.html).toContain('<tr><td>Abbildung 1</td><td>Abbildung 2</td><td>Abbildung 3</td></tr></tbody></table><p>Nachher</p>');
  });

  it('untereinander stehende Bilder bleiben einzeln', () => {
    const body = `<text:p>${frame('a', '0cm', '0cm', '1cm')}</text:p>${'<text:p/>'.repeat(4)}<text:p>${frame('b', '0cm', '0cm', '1cm')}</text:p>`;
    const r = odtToHtml(withPictures(body), 'x.odt');
    expect(r.html).not.toContain('ws-table-plain');
    expect((r.html.match(/<img /g) || []).length).toBe(2);
  });
});

describe('.odt-Import: Tabellen mit Spaltenbreiten und Zeilenhöhen', () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    + 'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  const doc = (styles: string, body: string) => {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'));
    zip.addFile('content.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}>`
      + `<office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`));
    return zip.toBuffer();
  };
  const styles = '<style:style style:name="T.A" style:family="table-column"><style:table-column-properties style:column-width="4.053cm"/></style:style>'
    + '<style:style style:name="T.B" style:family="table-column"><style:table-column-properties style:column-width="60mm"/></style:style>'
    + '<style:style style:name="T.2" style:family="table-row"><style:table-row-properties style:min-row-height="1.5cm"/></style:style>';
  const cell = (inner: string) => `<table:table-cell>${inner}</table:table-cell>`;

  it('übernimmt Breiten, feste Höhen und Platz aus leeren Absätzen', () => {
    const body = '<table:table><table:table-column table:style-name="T.A" table:number-columns-repeated="2"/><table:table-column table:style-name="T.B"/>'
      + `<table:table-row>${cell('<text:p>a</text:p>').repeat(3)}</table:table-row>`
      + `<table:table-row table:style-name="T.2">${cell('<text:p>b</text:p>').repeat(3)}</table:table-row>`
      + `<table:table-row>${cell('<text:p>Plan</text:p>')}${cell('<text:p/><text:p/><text:p/><text:p/>')}${cell('<text:p/>')}</table:table-row>`
      + '</table:table>';
    const { html } = odtToHtml(doc(styles, body), 'x.odt');
    expect(html).toContain('<colgroup><col style="width:4.1cm"><col style="width:4.1cm"><col style="width:6cm"></colgroup>');
    expect(html).toContain('<tr style="height:1.5cm">');
    expect(html).toContain('<tr style="height:2.2cm">');
    expect(html).toMatch(/<tbody><tr><td>/);
  });

  it('ohne Breite an jeder Spalte kein <colgroup>', () => {
    const body = `<table:table><table:table-column table:style-name="T.A"/><table:table-column/><table:table-row>${cell('<text:p>a</text:p>').repeat(2)}</table:table-row></table:table>`;
    expect(odtToHtml(doc(styles, body), 'x.odt').html).not.toContain('colgroup');
  });
});

describe('.odt-Import: zusammengefasste Zeichnungen', () => {
  it('Teile (lmdraw-<n>-teil<k>) fallen weg, die Zeichnung steht einmal da', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>');
    const drawings = new Map([['lmdraw-1', { svg, widthMm: 5 }]]);
    const line = (name: string) => `<draw:line text:anchor-type="paragraph" draw:name="${name}" svg:x1="0cm" svg:y1="0cm" svg:x2="0cm" svg:y2="1cm"/>`;
    const r = odtToHtml(odt(`<text:p>${line('lmdraw-1')}Schließer</text:p><text:p>${line('lmdraw-1-teil1')}</text:p><text:p>${line('lmdraw-1-teil2')}</text:p>`), 'x.odt', { drawings });
    expect(r.stats).toMatchObject({ exported: 1, drawings: 0 });
    expect(r.html.match(/<img /g)).toHaveLength(1);
    expect(r.html).toContain('Schließer');
  });
});

describe('.odt-Import: Gliederung als Liste und Rahmen ohne Rand', () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    + 'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const doc = (styles: string, body: string) => {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'));
    zip.addFile('content.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}>`
      + `<office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`));
    return zip.toBuffer();
  };
  const styles = '<text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/>'
    + '<text:list-level-style-number text:level="2" style:num-format="1"/><text:list-level-style-number text:level="3" style:num-format="1"/></text:list-style>'
    + '<style:style style:name="fr1" style:family="graphic"><style:graphic-properties fo:border="none"/></style:style>'
    + '<style:style style:name="fr2" style:family="graphic"><style:graphic-properties fo:border="0.06pt solid #000000"/></style:style>';
  const frame = (style: string, inner: string) => `<draw:frame draw:style-name="${style}" text:anchor-type="paragraph" svg:x="11cm" svg:width="4cm"><draw:text-box>${inner}</draw:text-box></draw:frame>`;
  const table = '<table:table><table:table-row><table:table-cell><text:p>C</text:p></table:table-cell><table:table-cell><text:p>X</text:p></table:table-cell></table:table-row></table:table>';

  it('nummerierte Überschriften: Abschnitt, Aufgabe, Teilaufgabe – ohne Liste; der Rahmen ohne Rand liefert nur die Tabelle', () => {
    const body = '<text:list text:style-name="L1"><text:list-item><text:h text:outline-level="1">Aufgaben</text:h>'
      + '<text:list><text:list-item><text:h text:outline-level="2">Stromlaufplan</text:h>'
      + `<text:list><text:list-item><text:h text:outline-level="3">Funktionsgleichung:${frame('fr1', table)}</text:h></text:list-item></text:list>`
      + '</text:list-item></text:list></text:list-item></text:list>';
    const { html } = odtToHtml(doc(styles, body), 'x.odt');
    expect(html).not.toContain('<li>');
    expect(html).toContain('<h2 data-ds="section">Aufgaben</h2>');
    expect(html).toContain('<h3 data-ds="task">Stromlaufplan</h3>');
    expect(html).toMatch(/<h4 data-ds="subtask">Funktionsgleichung:<\/h4><table>/);
    expect(html).not.toContain('ws-box');
  });

  it('Rahmen mit Rand bleibt ein Kasten, Listen ohne Überschriften bleiben Listen', () => {
    const body = `<text:p>Text${frame('fr2', '<text:p>Merke</text:p>')}</text:p>`
      + '<text:list text:style-name="L1"><text:list-item><text:p>eins</text:p></text:list-item><text:list-item><text:p>zwei</text:p></text:list-item></text:list>';
    const { html } = odtToHtml(doc(styles, body), 'x.odt');
    expect(html).toContain('<div class="ws-box"><p>Merke</p></div>');
    expect(html).toContain('<ol><li><p>eins</p></li><li><p>zwei</p></li></ol>');
  });
});
