import { loadBrowserModule } from '../../browser-module';

interface JsonText {
  extractJson(text: string): any;
  summarizeImport(data: any, typeNames?: Record<string, string>): any;
  looksLikeXml(text: string): boolean;
  lineColumn(text: string, pos: number): { line: number; column: number };
}
const j = loadBrowserModule<JsonText>('json-text.js');

describe('Importtext prüfen (src/renderer/js/json-text.js)', () => {
  const topic = '{\n  "topic": {\n    "title": "T",\n    "modules": [{ "title": "1", "type": "trueFalse", "content": {} }]\n  }\n}';

  it('liest JSON auch mit Markdown-Rahmen und Text drumherum', () => {
    expect(j.extractJson(topic).data.topic.title).toBe('T');
    expect(j.extractJson('Hier:\n```json\n' + topic + '\n```\nTeil 1 von 2').ok).toBe(true);
    expect(j.extractJson(topic + '\nTeil 1 von 2').ok).toBe(true);
  });

  it('nennt Zeile und Spalte im eingefügten Text – auch hinter dem Rahmen', () => {
    // Komma fehlt nach "T" (Zeile 3 des JSON, im Text Zeile 5 wegen zweier Zeilen davor)
    const broken = topic.replace('"T",', '"T"');
    const r = j.extractJson('Hier ist es:\n```json\n' + broken + '\n```');
    expect(r.ok).toBe(false);
    expect(r.truncated).toBe(false);
    expect(r.line).toBe(6);
    expect(r.excerpt).toContain('"modules"');
  });

  it('erkennt eine abgeschnittene Antwort', () => {
    const r = j.extractJson('```json\n' + topic.slice(0, 60));
    expect(r).toMatchObject({ ok: false, truncated: true });
  });

  it('prüft den Aufbau: Probleme verhindern den Import, Warnungen nicht', () => {
    const names = { trueFalse: 'Wahr/Falsch', sorting: 'Reihenfolge' };
    const ok = j.summarizeImport(j.extractJson(topic).data, names);
    expect(ok).toMatchObject({ title: 'T', count: 1, problems: [], warnings: [], types: [{ type: 'trueFalse', n: 1, name: 'Wahr/Falsch' }] });

    const odd = j.summarizeImport({ modules: [{ type: 'quatsch', content: {} }, { title: 'x' }, 'nein'] }, names);
    expect(odd.problems).toEqual(['Modul 2 („x“): "type" fehlt.', 'Modul 3: ist kein Objekt.']);
    expect(odd.warnings[0]).toContain('unbekannter Typ "quatsch"');

    expect(j.summarizeImport({ topic: { title: 'leer', modules: [] } }, names).problems[0]).toContain('Keine Module');
  });

  it('erkennt Moodle-XML', () => {
    expect(j.looksLikeXml('<?xml version="1.0"?>\n<quiz>')).toBe(true);
    expect(j.looksLikeXml('  <quiz>')).toBe(true);
    expect(j.looksLikeXml(topic)).toBe(false);
  });
});
