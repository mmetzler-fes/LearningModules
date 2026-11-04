import { loadBrowserModule } from '../../browser-module';

interface JsonText {
  extractJson(text: string): any;
  summarizeImport(data: any, typeNames?: Record<string, string>): any;
  looksLikeXml(text: string): boolean;
  lineColumn(text: string, pos: number): { line: number; column: number };
}
const j = loadBrowserModule<JsonText>('json-text.js');

describe('Importtext prüfen (src/renderer/js/json-text.js)', () => {
  const topic = '{\n  "topic": {\n    "title": "T",\n    "modules": [{ "title": "1", "type": "trueFalse", "content": { "questions": [{ "question": "q", "correctAnswer": "true" }] } }]\n  }\n}';

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

describe('KI-Antworten: Reparatur, Fließtext, Inhalt', () => {
  const k = loadBrowserModule<any>('json-text.js');
  const wrap = (q: string) => `{"topic":{"title":"T","modules":[{"title":"a","type":"multipleChoice","content":{"question":"${q}"}}]}}`;
  const question = (r: any) => r.data.topic.modules[0].content.question;

  it('LaTeX mit einfachem Backslash wird nicht still zu Steuerzeichen', () => {
    const r = k.extractJson(wrap('$\\frac{U}{R}$ \\text{V} \\neq \\sigma \\rightarrow'));
    expect(r.ok).toBe(true);
    expect(question(r)).toBe('$\\frac{U}{R}$ \\text{V} \\neq \\sigma \\rightarrow');
    expect(r.repairs.length).toBe(1);
  });

  it('echte Escapes und korrektes JSON bleiben unverändert', () => {
    const r = k.extractJson(wrap('Zeile1\\nZeile2\\tEnde \\\\frac \\"zitat\\" \\u00e4'));
    expect(question(r)).toBe('Zeile1\nZeile2\tEnde \\frac "zitat" ä');
    expect(r.repairs).toEqual([]);
  });

  it.each([
    ['Komma am Ende', '{"topic":{"title":"x","modules":[{"title":"a","type":"t","content":{},},]}}'],
    ['Kommentar', '{"topic":{"title":"x", // Titel\n"modules":[]}}'],
    ['typografische Begrenzer', '{“topic”:{“title”:“x”,“modules”:[]}}'],
    ['Zeilenumbruch im Text', '{"topic":{"title":"x\ny","modules":[]}}'],
    ['Anführungszeichen im Text', '{"topic":{"title":"Der "Kondensator" speichert","modules":[]}}'],
  ])('repariert: %s', (_n, text) => {
    const r = k.extractJson(text);
    expect(r.ok).toBe(true);
    expect(r.repairs.length).toBeGreaterThan(0);
    expect(r.data.topic.title).toBeTruthy();
  });

  it('zwei Codeblöcke werden zusammengeführt, ein abgeschnittener zweiter fällt auf', () => {
    const m = (t: string) => `{"topic":{"title":"${t}","modules":[{"title":"${t}","type":"memory","content":{}}]}}`;
    const r = k.extractJson('```json\n' + m('A') + '\n```\nTeil 2:\n```json\n' + m('B') + '\n```');
    expect(r.data.topic.title).toBe('A');
    expect(r.data.topic.modules.map((x: any) => x.title)).toEqual(['A', 'B']);
    expect(r.parts).toBe(2);
    const cut = k.extractJson('```json\n' + m('A') + '\n```\n```json\n' + m('B').slice(0, 30));
    expect(cut.ok).toBe(false);
    expect(cut.truncated).toBe(true);
  });

  it('Fließtext wird als solcher erkannt, auch mit { aus einer Formel', () => {
    const r = k.extractJson('Dokument 1: Grundlagen$\\underline{\\text{Projekt}}$ Frage: Was? A) x (Richtig)');
    expect(r.ok).toBe(false);
    expect(r.prose).toBe(true);
    expect(k.buildFixPrompt(r)).toContain('genau ein Codeblock');
  });

  it('JSON hinter einem Text mit Formel wird gefunden', () => {
    expect(k.extractJson('Formel $x_{1}$ und hier:\n' + wrap('q')).ok).toBe(true);
  });

  it('Inhalt je Typ: Hinweise, aber kein Hindernis', () => {
    const s = k.summarizeImport({ topic: { title: 'T', modules: [
      { title: 'a', type: 'multipleChoice', content: { question: 'q', answers: [{ text: 'x', correct: false }, { text: 'y', correct: false }] } },
      { title: 'b', type: 'fillInTheBlanks', content: { questions: [{ text: 'ohne Lücke' }] } },
    ] } }, { multipleChoice: 'MC', fillInTheBlanks: 'L' });
    expect(s.problems).toEqual([]);
    expect(s.warnings.join()).toContain('keine richtige Antwort');
    expect(s.warnings.join()).toContain('Sternchen');
  });

  it('die Beispiele im Prompt gelten als vollständig', () => {
    const ai = loadBrowserModule<any>('ai-prompt.js');
    for (const [type, c] of Object.entries(ai.AI_PROMPT_EXAMPLES)) expect([type, k.contentIssues(type, c)]).toEqual([type, []]);
  });

  describe('Dokument mit Quiz-Blöcken', () => {
    const q = '{"title":"Q","type":"multipleChoice","content":{"question":"\\frac{a}{b}"}}';
    const doc = '---\ntitle: "B"\n---\n\n# Start\n';
    const toDoc = () => ({ spec: { title: 'B', content: [] }, warnings: [] });
    const F = '```'; const F4 = '````';
    it.each([
      ['im Rahmen', `${F4}markdown\n${doc}\n${F}lm-quiz\n${q}\n${F}\n${F4}`],
      ['nach dem Rahmen', `${F4}markdown\n${doc}${F4}\n\n${F}lm-quiz\n${q}\n${F}`],
      ['als json-Block', `${F4}markdown\n${doc}\n${F}json\n${q}\n${F}\n${F4}`],
      ['eingerückt', `${F4}markdown\n${doc}\n  ${F}lm-quiz\n  ${q}\n  ${F}\n${F4}`],
    ])('Quiz geht nicht verloren: %s', (_n, text) => {
      const r = k.markdownToTopic(text, toDoc);
      expect(r.data.topic.modules.map((m: any) => m.type)).toEqual(['document', 'multipleChoice']);
      expect(r.data.topic.modules[1].content.question).toBe('\\frac{a}{b}');
    });
    it('Code-Beispiel als json bleibt im Dokument', () => {
      let seen = '';
      const r = k.markdownToTopic(`${F4}markdown\n${doc}\n${F}json\n{"a":1}\n${F}\n${F4}`, (b: string) => { seen = b; return toDoc(); });
      expect(r.data.topic.modules.length).toBe(1);
      expect(seen).toContain('{"a":1}');
    });
    it('nie geschlossener Rahmen wird gemeldet', () => {
      expect(k.markdownToTopic(`${F4}markdown\n${doc}`, toDoc).warnings.join()).toContain('abgeschnitten');
    });
  });
});
