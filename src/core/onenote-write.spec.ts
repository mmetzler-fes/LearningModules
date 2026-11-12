import { loadBrowserModule } from './browser-module';

/** OneNote-Abschnitt schreiben (src/renderer/js/onenote-write.js), gegengelesen mit onenote.js */
interface Writer {
  writeOneSection(section: any, now?: Date): Uint8Array;
  md5(bytes: Uint8Array): Uint8Array;
  crc32(bytes: Uint8Array): number;
  unreferenced(objects: any[], rootIds: any[]): string[];
}
interface Reader {
  readOneSection(bytes: Uint8Array): { pages: Array<{ title: string; level: number; files: any[]; images: any[] }> };
}
const w = loadBrowserModule<Writer>('onenote-write.js');
const one = loadBrowserModule<Reader>('onenote.js');

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utf16 = (s: string) => Buffer.from(s, 'utf16le');
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4]);
const pdf = ascii('%PDF-1.4 test');

describe('OneNote schreiben', () => {
  it('MD5 und CRC32 nach Lehrbuch', () => {
    expect(hex(w.md5(ascii('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(w.md5(new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(w.md5(ascii('a'.repeat(100))))).toBe('36a92cc94a9e0fa21f625f8bfb007adf');
    expect(w.crc32(ascii('123456789'))).toBe(0xcbf43926);
  });

  it('Seiten, Titel, Anhang und Bilder kommen beim Lesen wieder heraus', () => {
    const bytes = w.writeOneSection({
      name: 'Motoren',
      pages: [
        { title: 'Gleichstrommotor – Aufbau', blocks: [
          { type: 'text', runs: [{ text: 'Live-Fassung: ' }, { text: 'öffnen', href: 'https://lm.example/?l=abc&mod=1' }] },
          { type: 'image', data: png, width: 100, height: 100, widthIn: 1.3, name: 'QR-Code.png' },
          { type: 'text', runs: [{ text: 'Stand 13.11.2026' }] },
          { type: 'image', free: true, data: png, width: 794, height: 1123, widthIn: 8, name: 'Seite 1.png' },
          { type: 'image', free: true, data: png, width: 794, height: 1123, widthIn: 8, name: 'Seite 2.png' },
          { type: 'file', name: 'Aufbau.pdf', data: pdf, icon: png },
        ] },
        { title: 'Gleichstrommotor – Quiz', level: 1, blocks: [{ type: 'text', runs: [{ text: 'Quiz: ' }, { text: 'Aufbau', href: 'https://lm.example/?l=abc&mod=2' }] }] },
      ],
    });
    expect([...bytes.subarray(0, 4)]).toEqual([0xe4, 0x52, 0x5c, 0x7b]);
    const { pages } = one.readOneSection(bytes);
    expect(pages.map((p) => p.title)).toEqual(['Gleichstrommotor – Aufbau', 'Gleichstrommotor – Quiz']);
    expect(pages[0].files.map((f) => f.name)).toEqual(['Aufbau.pdf']);
    expect(Buffer.from(pages[0].files[0].data()).toString('latin1')).toBe('%PDF-1.4 test');
    expect(pages[0].images.map((i) => i.name).sort()).toEqual(['QR-Code.png', 'Seite 1.png', 'Seite 2.png']);
    expect(pages[1].files).toEqual([]);
  });

  it('Ein Link am Zeilenende bekommt danach Text mit „Link aus“ (sonst stürzt OneNote beim Tippen ab)', () => {
    const bytes = Buffer.from(w.writeOneSection({ name: 'T', pages: [{ title: 'L', blocks: [{ type: 'text', runs: [{ text: 'A ' }, { text: 'Ziel', href: 'https://x/' }] }] }] }));
    expect(bytes.includes(utf16('A ﷟HYPERLINK "https://x/"Ziel \0'))).toBe(true);
  });

  it('Ohne Link keine Link-Formate (unbenutzte Objekte bringen OneNote durcheinander)', () => {
    const plain = Buffer.from(w.writeOneSection({ name: 'T', pages: [{ title: 'P', blocks: [{ type: 'text', runs: [{ text: 'nur Text' }] }] }] }));
    const linked = Buffer.from(w.writeOneSection({ name: 'T', pages: [{ title: 'P', blocks: [{ type: 'text', runs: [{ text: 'x', href: 'https://x/' }] }] }] }));
    expect(linked.length).toBeGreaterThan(plain.length);
    expect(plain.includes(utf16('HYPERLINK'))).toBe(false);
  });

  it('Findet unverwiesene Objekte', () => {
    const id = (n: number) => ({ g: new Uint8Array(16), n });
    const objects = [
      { id: id(1), jcid: 1, props: [{ id: 0x1c20, t: 9, v: [id(2)] }] },
      { id: id(2), jcid: 2, props: [] },
      { id: id(3), jcid: 3, props: [] },
    ];
    expect(w.unreferenced(objects, [id(1)])).toEqual(['3']);
  });
});
