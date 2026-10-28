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

  it('Klassenbuch-Links: eine App mit Liste, startet mit dem Link', () => {
    const m = studentManifest('/?k=abc');
    expect(m.start_url).toBe('/?app=classbook&k=abc');
    expect(m.id).toBe('/?app=classbook');
    expect(studentManifest('/?k=xyz').id).toBe(m.id);
    expect(m.icons.every((i) => i.src.startsWith('/icons/'))).toBe(true);
  });

  it('Themen-Link: eigene App, startet am Link', () => {
    const m = studentManifest('/?l=tok');
    expect(m.start_url).toBe('/?l=tok');
    expect(m.id).toBe('/?l=tok');
  });
});
