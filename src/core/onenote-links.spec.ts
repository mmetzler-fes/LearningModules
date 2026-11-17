import { loadBrowserModule } from './browser-module';

/** Quiz-Verweise im Ausdruck finden (src/renderer/js/onenote-links.js) */
interface Links {
  quizIdOf(url: string): string | null;
  quizLinkSpots(annots: any[], pageHeight: number): Array<{ url: string; id: string; qr: any; text: any }>;
}
const l = loadBrowserModule<Links>('onenote-links.js');

describe('OneNote: Quiz-Links im Ausdruck', () => {
  it('liest die Quiz-Kennung aus der Adresse', () => {
    expect(l.quizIdOf('https://lm.test/?l=abc&mod=q-1')).toBe('q-1');
    expect(l.quizIdOf('https://lm.test/?l=abc')).toBeNull();
  });

  it('trennt QR-Code und Adresse, fasst umbrochene Adresszeilen zusammen, rechnet in Zoll von oben', () => {
    const url = 'https://lm.test/?l=abc&mod=q-1';
    const spots = l.quizLinkSpots([
      { subtype: 'Link', url: 'https://lm.test/?l=abc&mod=q-2', rect: [72, 100, 360, 112] }, // weiter unten
      { subtype: 'Link', url, rect: [72, 600, 171, 699] }, // QR-Code 99 × 99 pt
      { subtype: 'Link', url, rect: [180, 640, 500, 652] }, // Adresse, Zeile 1
      { subtype: 'Link', url, rect: [180, 628, 300, 640] }, // Adresse, Zeile 2
      { subtype: 'Link', url: 'https://example.org/', rect: [0, 0, 10, 10] }, // kein Quiz
      { subtype: 'Widget', rect: [0, 0, 10, 10] },
    ], 792);
    expect(spots.map((s) => s.id)).toEqual(['q-1', 'q-2']);
    expect(spots[0].qr).toEqual({ x: 1, y: (792 - 699) / 72, w: 99 / 72, h: 99 / 72 });
    expect(spots[0].text).toEqual({ x: 2.5, y: (792 - 652) / 72, w: 320 / 72, h: 24 / 72 });
    expect(spots[1].qr).toBeNull();
  });
});
