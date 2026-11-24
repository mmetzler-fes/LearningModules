import AdmZip from 'adm-zip';
import { OrientationSyncService } from './orientation-sync.service';

function ott(widthMm: number, heightMm: number): string {
  const zip = new AdmZip();
  zip.addFile('styles.xml', Buffer.from(
    '<office:document-styles><office:automatic-styles>'
    + `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${widthMm}mm" fo:page-height="${heightMm}mm" fo:margin-top="15mm" fo:margin-bottom="10mm" fo:margin-left="20mm" fo:margin-right="20mm"/></style:page-layout>`
    + '</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>', 'utf8'));
  return zip.toBuffer().toString('base64');
}

describe('OrientationSyncService', () => {
  const QUER = { id: 'quer', data: ott(297, 210) };
  const HOCH = { id: 'hoch', data: ott(210, 297) };

  function setup(mods: any[], templateOf: (nodeId: string | null, preferred: string | null) => any) {
    const updates: Record<string, any> = {};
    const moduleRepo = {
      find: jest.fn(async () => mods),
      update: jest.fn(async (id: string, patch: any) => { updates[id] = patch.content; }),
    };
    const nodeRepo = { find: jest.fn(async () => []) };
    const docs = new Map(mods.map((m) => [m.id, { nodeId: m.nodeId, kind: 'arbeitsblatt' }]));
    const numbering = { numberingFor: jest.fn(async () => ({ docs })) };
    const templates = { resolver: () => async (nodeId: string | null, _kind: string, preferred?: string | null) => templateOf(nodeId, preferred ?? null) };
    const svc = new OrientationSyncService(moduleRepo as any, nodeRepo as any, numbering as any, templates as any);
    return { svc, updates };
  }

  it('Ordner auf A4 quer: Dokumente darin werden quer, eigene Vorlage am Dokument geht vor', async () => {
    const mods = [
      { id: 'a', nodeId: 'ordner', content: { spec: { content: [] } } },
      { id: 'b', nodeId: 'ordner', content: { templateId: 'hoch', spec: { orientation: 'landscape', content: [] } } },
      { id: 'c', nodeId: 'ordner', content: { spec: { orientation: 'landscape', content: [] } } },
    ];
    const { svc, updates } = setup(mods, (_n, preferred) => (preferred === 'hoch' ? HOCH : QUER));
    expect(await svc.sync('u')).toBe(2);
    expect(updates.a.spec.orientation).toBe('landscape');
    expect(updates.b.spec.orientation).toBeUndefined();
    expect(updates.b.templateId).toBe('hoch');
    expect(updates.c).toBeUndefined(); // schon richtig
  });

  it('ohne gültige Vorlage bleibt orientation, wie es ist', async () => {
    const mods = [{ id: 'a', nodeId: null, content: { spec: { orientation: 'landscape', content: [] } } }];
    const { svc, updates } = setup(mods, () => null);
    expect(await svc.sync('u')).toBe(0);
    expect(updates.a).toBeUndefined();
  });
});
