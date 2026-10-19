import { loadBrowserModule } from './browser-module';

interface ImageWords {
  wordSlug(w: string): string;
  parseImageWords(t: string): Array<{ word: string; slug: string; file: string }>;
  buildImagePrompt(words: any[], style?: string, language?: string): string;
  matchImageFiles(words: any[], names: string[]): { assigned: number[]; unused: number[] };
}
const iw = loadBrowserModule<ImageWords>('image-words.js');

describe('Bilder zu Wörtern (src/renderer/js/image-words.js)', () => {
  it('macht aus Wörtern eindeutige Dateinamen', () => {
    expect(iw.wordSlug('Möhre')).toBe('moehre');
    expect(iw.wordSlug('Eis am Stiel')).toBe('eis-am-stiel');
    expect(iw.wordSlug('Café')).toBe('cafe');
    expect(iw.parseImageWords('Hund\nKatze, Hund\n\n').map((w) => w.file)).toEqual(['hund.png', 'katze.png', 'hund-2.png']);
  });

  it('gibt der Bild-KI Stil und Dateinamen vor', () => {
    const p = iw.buildImagePrompt(iw.parseImageWords('dog\ncat'), 'Aquarell', 'Englisch');
    expect(p).toContain('Stil – für alle Bilder gleich: Aquarell.');
    expect(p).toContain('Kein Text');
    expect(p).toContain('1. dog → dog.png');
    expect(p).toContain('Begriffe (Englisch)');
  });

  it('ordnet heruntergeladene Dateien zu – auch mit Zusätzen im Namen', () => {
    const words = iw.parseImageWords('Hund\nKatze\nPferd');
    const names = ['katze.webp', 'ChatGPT Image Hund (1).png', 'irgendwas.png'];
    const m = iw.matchImageFiles(words, names);
    expect(m.assigned).toEqual([1, 0, -1]);
    expect(m.unused).toEqual([2]);
  });
});
