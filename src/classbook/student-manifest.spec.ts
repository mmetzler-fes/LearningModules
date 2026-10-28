import { studentManifest, studentStartUrl } from './student-manifest';

describe('Manifest für Schüler', () => {
  it('nimmt nur Klassenbuch-, Themen- und Quick-Links', () => {
    expect(studentStartUrl('/?k=abc_D-1')).toBe('/?k=abc_D-1');
    expect(studentStartUrl('/?l=tok.klasse')).toBe('/?l=tok.klasse');
    expect(studentStartUrl('/?q=x')).toBe('/?q=x');
    expect(studentStartUrl('/')).toBe('/');
    expect(studentStartUrl(undefined)).toBe('/');
    expect(studentStartUrl('/admin')).toBeNull();
    expect(studentStartUrl('https://boese.example/?k=a')).toBeNull();
    expect(studentStartUrl('/?k=a&x=<script>')).toBeNull();
  });

  it('Klassenbuch-Links: eine App mit Liste, startet mit dem Link', () => {
    const m = studentManifest('/?k=abc');
    expect(m.start_url).toBe('/schueler/?app=classbook&k=abc');
    expect(m.id).toBe('/schueler/?app=classbook');
    expect(m.scope).toBe('/schueler/');
    expect(studentManifest('/?k=xyz').id).toBe(m.id);
    expect(m.icons.every((i) => i.src.startsWith('/icons/'))).toBe(true);
  });

  it('Schüler-Startseite (PC): dieselbe App, eigener Name, startet bei der Liste', () => {
    const m = studentManifest('/');
    expect(m.id).toBe(studentManifest('/?k=abc').id);
    expect(m.start_url).toBe('/schueler/?app=classbook');
    expect(m.name).toBe('LearningModules_Schüler');
  });

  it('Themen-Link: eigene App, startet am Link', () => {
    const m = studentManifest('/?l=tok');
    expect(m.start_url).toBe('/schueler/?l=tok');
    expect(m.id).toBe('/schueler/?l=tok');
  });
});
