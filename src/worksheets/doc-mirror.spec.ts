import { DesiredDoc, MirrorArt, MirrorNc, MirrorRecord, mirrorDocs } from './doc-mirror';

/** Nextcloud im Speicher: Pfad → Datei bzw. Ordner. */
class FakeNc implements MirrorNc {
  files = new Map<string, { data?: Buffer; etag: string; folder: boolean }>();
  private n = 0;
  key = (p: string[]) => p.join('/');
  async stat(p: string[]) {
    const f = this.files.get(this.key(p));
    return f ? { isFolder: f.folder, size: f.data?.length || 0, etag: f.etag } : null;
  }
  async put(p: string[], data: Buffer) {
    const etag = `e${++this.n}`;
    this.files.set(this.key(p), { data, etag, folder: false });
    return etag;
  }
  async move(from: string[], to: string[]) {
    if (this.files.has(this.key(to))) throw new Error('Ziel existiert');
    const prefix = this.key(from);
    for (const [k, v] of [...this.files]) {
      if (k === prefix || k.startsWith(`${prefix}/`)) {
        this.files.delete(k);
        this.files.set(this.key(to) + k.slice(prefix.length), v);
      }
    }
  }
  async ensureFolder(p: string[]) {
    for (let i = 1; i <= p.length; i++) if (!this.files.has(this.key(p.slice(0, i)))) this.files.set(this.key(p.slice(0, i)), { etag: 'd', folder: true });
  }
  async list(p: string[]) {
    const prefix = `${this.key(p)}/`;
    return [...this.files].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(([k, v]) => ({ name: k.slice(prefix.length), isFolder: v.folder }));
  }
  async remove(p: string[]) {
    const prefix = this.key(p);
    for (const k of [...this.files.keys()]) if (k === prefix || k.startsWith(`${prefix}/`)) this.files.delete(k);
  }
  names() {
    return [...this.files].filter(([, v]) => !v.folder).map(([k]) => k).sort();
  }
}

const ROOT = ['Arbeitsblätter'];
function doc(over: Partial<DesiredDoc> = {}): DesiredDoc & { renders: number } {
  const d: any = {
    moduleId: 'm1', folder: ['Arduino', '01 Grundlagen'], base: '01 Erste LED', formats: ['odt', 'pdf'] as MirrorArt[],
    hash: 'h1', handMaintained: false, yaml: 'titel: Erste LED\n', renders: 0,
    ...over,
  };
  d.render = async (arts: MirrorArt[]) => { d.renders++; return Object.fromEntries(arts.map((a) => [a, Buffer.from(`${a}:${d.hash}`)])); };
  return d;
}
async function run(nc: FakeNc, docs: DesiredDoc[], records = new Map<string, MirrorRecord>(), now = new Date('2026-10-21T10:00:00Z')) {
  return mirrorDocs(nc, ROOT, docs, records, { storeKey: 'own:1', now });
}

describe('mirrorDocs', () => {
  it('schreibt die gewünschten Formate und die Spec, merkt sich die ETags', async () => {
    const nc = new FakeNc();
    const r = await run(nc, [doc()]);
    expect(nc.names()).toEqual([
      'Arbeitsblätter/Arduino/01 Grundlagen/01 Erste LED.odt',
      'Arbeitsblätter/Arduino/01 Grundlagen/01 Erste LED.pdf',
      'Arbeitsblätter/Arduino/01 Grundlagen/_Quellen/01 Erste LED.yaml',
    ]);
    expect(r.records.get('m1')).toMatchObject({ hash: 'h1', status: 'ok' });
    expect(r.records.get('m1')!.files.map((f) => f.etag)).toEqual(['e1', 'e2', 'e3']);
    expect(r.report).toMatchObject({ written: 3, moved: 0, saved: 0 });
  });

  it('ohne Änderung wird nichts gedruckt oder geschrieben', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    const d = doc();
    const second = await run(nc, [d], first.records);
    expect(d.renders).toBe(0);
    expect(second.report.written).toBe(0);
  });

  it('Umnummerieren und Verschieben: Dateien ziehen um, leere Ordner verschwinden', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    const d = doc({ folder: ['Arduino', '02 Sensoren'], base: '03 Erste LED' });
    const r = await run(nc, [d], first.records);
    expect(d.renders).toBe(0);
    expect(r.report.moved).toBe(3);
    expect(nc.names()).toEqual([
      'Arbeitsblätter/Arduino/02 Sensoren/03 Erste LED.odt',
      'Arbeitsblätter/Arduino/02 Sensoren/03 Erste LED.pdf',
      'Arbeitsblätter/Arduino/02 Sensoren/_Quellen/03 Erste LED.yaml',
    ]);
    expect(nc.files.has('Arbeitsblätter/Arduino/01 Grundlagen')).toBe(false);
    expect(nc.files.has('Arbeitsblätter/Arduino')).toBe(true);
  });

  it('von Hand geänderte Datei wird vor dem Überschreiben gesichert', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    await nc.put([...ROOT, 'Arduino', '01 Grundlagen', '01 Erste LED.odt'], Buffer.from('von Hand'));
    const r = await run(nc, [doc({ hash: 'h2' })], first.records);
    expect(r.report.saved).toBe(1);
    expect(nc.files.get('Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED.odt')!.data!.toString()).toBe('von Hand');
    expect(nc.files.get('Arbeitsblätter/Arduino/01 Grundlagen/01 Erste LED.odt')!.data!.toString()).toBe('odt:h2');
  });

  it('fremde Datei am Zielnamen wird gesichert, nicht überschrieben', async () => {
    const nc = new FakeNc();
    await nc.ensureFolder([...ROOT, 'Arduino', '01 Grundlagen']);
    await nc.put([...ROOT, 'Arduino', '01 Grundlagen', '01 Erste LED.pdf'], Buffer.from('fremd'));
    const r = await run(nc, [doc()]);
    expect(r.report.saved).toBe(1);
    expect(nc.files.get('Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED.pdf')!.data!.toString()).toBe('fremd');
  });

  it('zweimal am selben Tag gesichert: Nummer anhängen', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    await nc.put([...ROOT, 'Arduino', '01 Grundlagen', '01 Erste LED.odt'], Buffer.from('Hand 1'));
    const second = await run(nc, [doc({ hash: 'h2' })], first.records);
    await nc.put([...ROOT, 'Arduino', '01 Grundlagen', '01 Erste LED.odt'], Buffer.from('Hand 2'));
    await run(nc, [doc({ hash: 'h3' })], second.records);
    expect(nc.files.get('Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED (2).odt')!.data!.toString()).toBe('Hand 2');
  });

  it('„von Hand gepflegt“: nicht neu schreiben, aber mit umziehen', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    const d = doc({ hash: 'h2', handMaintained: true, base: '02 Erste LED' });
    const r = await run(nc, [d], first.records);
    expect(d.renders).toBe(0);
    expect(r.report.moved).toBe(3);
    expect(nc.files.get('Arbeitsblätter/Arduino/01 Grundlagen/02 Erste LED.odt')!.data!.toString()).toBe('odt:h1');
  });

  it('gelöschtes Dokument: Dateien nach _Gesichert, Eintrag fällt weg', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    const r = await run(nc, [], first.records);
    expect(r.removed).toEqual(['m1']);
    expect(nc.names()).toEqual([
      'Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED.odt',
      'Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED.pdf',
      'Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/_Quellen/01 Erste LED.yaml',
    ]);
  });

  it('Format abgewählt: Datei wird gesichert', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    await run(nc, [doc({ formats: ['odt'] })], first.records);
    expect(nc.names()).toContain('Arbeitsblätter/_Gesichert/2026-10-21/Arduino/01 Grundlagen/01 Erste LED.pdf');
    expect(nc.names()).not.toContain('Arbeitsblätter/Arduino/01 Grundlagen/01 Erste LED.pdf');
  });

  it('fehlende Datei (in der Nextcloud gelöscht) wird neu geschrieben', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    await nc.remove([...ROOT, 'Arduino', '01 Grundlagen', '01 Erste LED.pdf']);
    const d = doc({ base: '05 Erste LED' });
    await run(nc, [d], first.records);
    expect(d.renders).toBe(1);
    expect(nc.names()).toContain('Arbeitsblätter/Arduino/01 Grundlagen/05 Erste LED.pdf');
  });

  it('Fehler beim Druck: Status am Dokument, die anderen laufen weiter', async () => {
    const nc = new FakeNc();
    const bad = doc({ moduleId: 'm2', base: '02 Kaputt' });
    bad.render = async () => { throw new Error('Renderer nicht erreichbar'); };
    const r = await run(nc, [bad, doc()]);
    expect(r.records.get('m2')).toMatchObject({ status: 'error', error: 'Renderer nicht erreichbar' });
    expect(r.records.get('m1')!.status).toBe('ok');
  });

  it('alte Sicherungen nach 180 Tagen weg, neuere bleiben', async () => {
    const nc = new FakeNc();
    await nc.ensureFolder([...ROOT, '_Gesichert', '2026-01-01']);
    await nc.ensureFolder([...ROOT, '_Gesichert', '2026-09-01']);
    await run(nc, []);
    expect(nc.files.has('Arbeitsblätter/_Gesichert/2026-01-01')).toBe(false);
    expect(nc.files.has('Arbeitsblätter/_Gesichert/2026-09-01')).toBe(true);
  });

  it('andere Ablage (Schulwechsel): alles neu, die alte bleibt unberührt', async () => {
    const nc = new FakeNc();
    const first = await run(nc, [doc()]);
    const d = doc();
    const r = await mirrorDocs(nc, ['Arbeitsblätter', 'Schule'], [d], first.records, { storeKey: 'school:9' });
    expect(d.renders).toBe(1);
    expect(r.records.get('m1')!.storeKey).toBe('school:9');
    expect(nc.names()).toContain('Arbeitsblätter/Arduino/01 Grundlagen/01 Erste LED.odt');
  });
});
