import { studentManifest, studentStartUrl } from './student-manifest';

describe('Manifest für Schüler', () => {
  it('nimmt nur Klassenbuch-, Themen- und Quick-Links', () => {
    expect(studentStartUrl('/?k=abc_D-1')).toBe('/?k=abc_D-1');
    expect(studentStartUrl('/?l=tok.klasse')).toBe('/?l=tok.klasse');
    expect(studentStartUrl('/?q=x')).toBe('/?q=x');
    expect(studentStartUrl('/')).toBeNull();
    expect(studentStartUrl('https://boese.example/?k=a')).toBeNull();
    expect(studentStartUrl('/?k=a&x=<script>')).toBeNull();
    expect(studentStartUrl(undefined)).toBeNull();
  });

  it('startet am Link, eigene App je Link, Symbole absolut', () => {
    const m = studentManifest('/?k=abc', 'TG11-1');
    expect(m.start_url).toBe('/?k=abc');
    expect(m.id).toBe('/?k=abc');
    expect(m.short_name).toBe('TG11-1');
    expect(m.icons.every((i) => i.src.startsWith('/icons/'))).toBe(true);
  });
});
