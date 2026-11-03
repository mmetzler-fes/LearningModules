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
    expect(ok).toMatchObject({ title: 'T', count: 1, ncRefs: 0, problems: [], warnings: [], types: [{ type: 'trueFalse', n: 1, name: 'Wahr/Falsch' }] });
    const withImages = j.summarizeImport({ modules: [{ title: 'a', type: 'sorting', content: { items: [{ imageUrl: 'nc:Reisen/a.jpg' }, { imageUrl: 'nc: kein' }] } }] }, names);
    expect(withImages.ncRefs).toBe(1);

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

describe('Dokument als Markdown (src/renderer/js/json-text.js)', () => {
  const md = loadBrowserModule<any>('json-text.js');
  const text = '---\ntitle: T\n---\n\n# A\n';
  const toDoc = () => ({ spec: { title: 'T', description: 'D', kind: 'klassenarbeit', slug: 's_1', content: [{ type: 'section', text: 'A' }] }, warnings: ['w'] });

  it('Rahmen und Text drumherum fallen weg, auch bei zu kurzem Rahmen', () => {
    expect(md.unwrapMarkdown(`Hier:\n\`\`\`\`markdown\n${text}\n\`\`\`\`\nBlatt 1 von 2`)).toBe(text);
    expect(md.unwrapMarkdown('```markdown\n# A\n```python\nx\n```\nb\n```\nEnde')).toBe('# A\n```python\nx\n```\nb');
    expect(md.unwrapMarkdown('```markdown\n# abgeschnitten')).toBe('# abgeschnitten');
    expect(md.unwrapMarkdown(`Gern:\n${text}`)).toBe(text);
    expect(md.unwrapMarkdown(text)).toBe(text);
  });

  it('erkennt Markdown, aber kein Thema als JSON und kein XML', () => {
    expect(md.looksLikeDocMarkdown(text)).toBe(true);
    expect(md.looksLikeDocMarkdown('````markdown\nnur Text\n````')).toBe(true);
    expect(md.looksLikeDocMarkdown('# A\n\nText')).toBe(true);
    expect(md.looksLikeDocMarkdown('::: {.karo lines=2}\n:::')).toBe(true);
    expect(md.looksLikeDocMarkdown('{"topic":{"title":"T","modules":[]}}')).toBe(false);
    expect(md.looksLikeDocMarkdown('```json\n{"topic":{"title":"T"}}\n```')).toBe(false);
    expect(md.looksLikeDocMarkdown('{\n# kaputtes JSON')).toBe(false);
    expect(md.looksLikeDocMarkdown('<?xml version="1.0"?><quiz>')).toBe(false);
    expect(md.looksLikeDocMarkdown('einfach nur Text')).toBe(false);
    expect(md.looksLikeDocMarkdown('')).toBe(false);
  });

  it('wird ein Thema: Dokument und Quiz-Module dahinter', () => {
    let seen = '';
    const r = md.markdownToTopic(`${text}\n\`\`\`lm-quiz\n{"title":"Q","type":"multipleChoice","content":{"a":1}}\n\`\`\`\n`, (b: string) => { seen = b; return toDoc(); });
    expect(seen).not.toContain('lm-quiz');
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['w']);
    const { title, description, modules } = r.data.topic;
    expect([title, description]).toEqual(['T', 'D']);
    expect(modules[0]).toMatchObject({ title: 'T', type: 'document', orderIndex: 0, content: { kind: 'klassenarbeit', slug: 's_1' } });
    expect(Object.keys(modules[0].content.spec)).toEqual(['content']);
    expect(modules[1]).toMatchObject({ title: 'Q', type: 'multipleChoice', orderIndex: 1, content: { a: 1 } });
    expect(j.summarizeImport(r.data, { document: 'D', multipleChoice: 'M' }).problems).toEqual([]);
  });

  it('kaputter lm-quiz-Block wird gemeldet; Titel notfalls aus der ersten Überschrift', () => {
    const bad = md.markdownToTopic('# A\n\n```lm-quiz\n{kaputt\n```\n', toDoc);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('lm-quiz');
    const named = md.markdownToTopic('# A', () => ({ spec: { content: [{ type: 'section', text: 'A' }] } }));
    expect(named.data.topic.title).toBe('A');
    expect(named.data.topic.modules[0].content.kind).toBe('arbeitsblatt');
  });
});
