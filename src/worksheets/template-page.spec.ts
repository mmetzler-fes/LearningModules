import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PAGE, templatePage } from './template-page';

function ott(styles: string): string {
  const zip = new AdmZip();
  zip.addFile('styles.xml', Buffer.from(styles, 'utf8'));
  return zip.toBuffer().toString('base64');
}

describe('templatePage', () => {
  it('liest die Grundvorlage des Renderers – wie DEFAULT_PAGE', () => {
    const file = path.join(__dirname, '../../worksheet-renderer/templates/Grundvorlage.ott');
    const page = templatePage(fs.readFileSync(file).toString('base64'));
    expect(page).not.toBeNull();
    expect(page!.width).toBeCloseTo(DEFAULT_PAGE.width, 1);
    expect(page!.height).toBeCloseTo(DEFAULT_PAGE.height, 2);
    expect(page!.margin.top).toBeCloseTo(DEFAULT_PAGE.margin.top, 2);
    expect(page!.margin.left).toBeCloseTo(DEFAULT_PAGE.margin.left, 2);
    expect(page!.header).toBeCloseTo(DEFAULT_PAGE.header, 2);
    expect(page!.footer).toBe(0);
  });

  it('A4 quer, Ränder in mm, ohne Kopfzeile auf der Masterseite', () => {
    const page = templatePage(ott(
      '<office:document-styles><office:automatic-styles>'
      + '<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="297mm" fo:page-height="210mm" fo:margin-top="15mm" fo:margin-bottom="10mm" fo:margin-left="20mm" fo:margin-right="20mm"/>'
      + '<style:header-style><style:header-footer-properties fo:min-height="1cm"/></style:header-style></style:page-layout>'
      + '</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>',
    ));
    expect(page).toEqual({ width: 29.7, height: 21, margin: { top: 1.5, bottom: 1, left: 2, right: 2 }, header: 0, footer: 0 });
  });

  it('kaputte oder leere Datei → null', () => {
    expect(templatePage(null)).toBeNull();
    expect(templatePage(Buffer.from('kein zip').toString('base64'))).toBeNull();
  });
});
