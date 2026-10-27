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
