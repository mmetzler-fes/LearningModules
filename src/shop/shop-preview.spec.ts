import { ShopService } from './shop.service';

describe('Shop: Modul ansehen ohne Übernehmen', () => {
  function service(offer: any, covered: any[], visible = true) {
    const svc: any = Object.create(ShopService.prototype);
    svc.offerRepo = { findOne: async () => offer };
    svc.visibleTo = () => visible;
    svc.coverage = async () => covered;
    return svc as ShopService;
  }
  const doc = { id: 'd', type: 'document', title: 'Blatt', parentId: null, orderIndex: 0, content: { kind: 'arbeitsblatt', spec: { content: [{ type: 'quiz', module: 'q' }] } } };
  const quiz = { id: 'q', type: 'multipleChoice', title: 'Quiz', parentId: null, orderIndex: 1, content: {} };
  const sub = { id: 's', type: 'trueFalse', title: 'Teil', parentId: 'q', orderIndex: 0, content: {} };
  const rec = { id: 'r', type: 'audioRecorder', title: 'Aufnahme', parentId: null, orderIndex: 2, content: { prompt: 'Sprich', uploadUrl: 'https://nc/x', uploadPassword: 'geheim' } };
  const covered = [{ topic: { id: 't' }, roots: [doc, quiz, rec], modules: [doc, quiz, sub, rec] }];

  it('Dokument mit seinen Quizzen (samt Untermodulen)', async () => {
    const res = await service({ id: 'o', active: true }, covered).previewModule({ userId: 'u' }, 'o', 'd');
    expect(res.module.id).toBe('d');
    expect(res.embedded.map((m: any) => m.id)).toEqual(['q']);
    expect(res.embedded[0].subModules.map((m: any) => m.id)).toEqual(['s']);
  });

  it('Audio Recorder ohne Ablage-Link und Passwort', async () => {
    const res = await service({ id: 'o', active: true }, covered).previewModule({ userId: 'u' }, 'o', 'r');
    expect(res.module.content).toEqual({ prompt: 'Sprich' });
  });

  it('nur Module des Angebots, nur sichtbare und aktive Angebote', async () => {
    await expect(service({ id: 'o', active: true }, covered).previewModule({ userId: 'u' }, 'o', 'fremd')).rejects.toThrow(/gehört nicht/);
    await expect(service({ id: 'o', active: true }, covered, false).previewModule({ userId: 'u' }, 'o', 'd')).rejects.toThrow(/nicht gefunden/);
    await expect(service({ id: 'o', active: false }, covered).previewModule({ userId: 'u' }, 'o', 'd')).rejects.toThrow(/nicht gefunden/);
  });
});
