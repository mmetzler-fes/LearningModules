import { ImportService, normalizeImportedContent } from './import.service';
import { topicJson } from '../export/export.service';

/** Repos ohne Datenbank: save gibt zurück, was hineinkommt. */
function service() {
  const repo: any = { create: (x: any) => x, save: async (x: any) => x, findOne: async () => null };
  return new ImportService(repo, repo);
}

const user = { userId: 'u1' };
const topic = JSON.stringify({ topic: { title: 'SQL', modules: [{ title: '1', type: 'trueFalse', content: {}, orderIndex: 0 }] } }, null, 2);

describe('Import von KI-Antworten', () => {
  it('liest reines JSON', async () => {
    await expect(service().importTopicFromJson(topic, user)).resolves.toMatchObject({ success: true, topicTitle: 'SQL', importedCount: 1 });
  });

  it('entfernt den Markdown-Rahmen ```json … ```', async () => {
    await expect(service().importTopicFromJson('```json\n' + topic + '\n```\n', user)).resolves.toMatchObject({ importedCount: 1 });
  });

  it('ignoriert Text vor und nach dem JSON', async () => {
    const text = 'Hier ist Teil 1:\n```json\n' + topic + '\n```\nTeil 1 von 3 – schreibe »weiter« für den nächsten Teil.';
    await expect(service().importTopicFromJson(text, user)).resolves.toMatchObject({ importedCount: 1 });
    await expect(service().importTopicFromJson(topic + '\nTeil 1 von 3', user)).resolves.toMatchObject({ importedCount: 1 });
  });

  it('meldet eine abgeschnittene Antwort als unvollständig', async () => {
    const cut = topic.slice(0, topic.indexOf('"content"') + 12);
    await expect(service().importTopicFromJson(cut, user)).rejects.toThrow(/unvollständig/);
    await expect(service().importTopicFromJson('```json\n' + cut, user)).rejects.toThrow(/unvollständig/);
  });

  it('kaputtes, aber vollständiges JSON bleibt "ungültig"', async () => {
    await expect(service().importTopicFromJson('{"topic": {"title": "x",}}', user)).rejects.toThrow(/Ungültiges JSON/);
  });
});

describe('Reihenfolge, Memory, Kreuzworträtsel im JSON', () => {
  /** Repo, das sich merkt, was gespeichert wurde. */
  function capturing() {
    const saved: any[] = [];
    const repo: any = { create: (x: any) => x, save: async (x: any) => { if (Array.isArray(x)) saved.push(...x); return x; }, findOne: async () => null };
    return { svc: new ImportService(repo, repo), saved };
  }
  const modules: any[] = [
    { id: 'a', type: 'sorting', title: 'R', description: '', orderIndex: 0, moduleSelected: true,
      content: { taskDescription: '<p>x</p>', items: [{ text: 'Eins', imageUrl: '' }, { text: '', imageUrl: 'data:image/png;base64,AAAA' }], layout: 'horizontal' } },
    { id: 'b', type: 'memory', title: 'M', description: '', orderIndex: 1, moduleSelected: true,
      content: { pairs: [{ aText: 'Hund', aImage: '', bText: 'dog', bImage: '' }] } },
    { id: 'c', type: 'crossword', title: 'K', description: '', orderIndex: 2, moduleSelected: true,
      content: { words: [{ answer: 'Straße', clue: 'Weg', imageUrl: '' }], seed: 42 } },
  ];

  it('kommen über Export und Import unverändert zurück', async () => {
    const { svc, saved } = capturing();
    const json = JSON.stringify(topicJson({ title: 'T', description: '' }, modules));
    await svc.importTopicFromJson(json, user);
    expect(saved.map((m) => [m.type, m.content])).toEqual(modules.map((m) => [m.type, m.content]));
  });

  it('gleicht typische KI-Abweichungen an', () => {
    expect(normalizeImportedContent('sorting', { items: ['A', 'B'] }).items).toEqual([{ text: 'A', imageUrl: '' }, { text: 'B', imageUrl: '' }]);
    expect(normalizeImportedContent('memory', { pairs: [['Hund', 'dog'], { a: 'Katze', b: 'cat' }] }).pairs).toEqual([
      { aText: 'Hund', aImage: '', bText: 'dog', bImage: '' }, { aText: 'Katze', aImage: '', bText: 'cat', bImage: '' },
    ]);
    expect(normalizeImportedContent('crossword', { words: [{ word: 'Ohm', hint: 'Einheit R' }] })).toEqual({
      words: [{ word: 'Ohm', hint: 'Einheit R', answer: 'Ohm', clue: 'Einheit R', imageUrl: '' }], seed: 0,
    });
    // Drag and Drop: nur "pairs" gilt, "Text verbergen" nur mit Bild
    expect(normalizeImportedContent('dragAndDrop', {
      layout: 'Paare', dropZones: [{ label: 'A', hideText: true }], draggables: [{ text: 'a', imageUrl: 'nc:x/a.png', hideText: 'true' }],
    })).toEqual({
      layout: '', dropZones: [{ label: 'A', imageUrl: '', hideText: false }],
      draggables: [{ text: 'a', imageUrl: 'nc:x/a.png', hideText: true }],
    });
    expect(normalizeImportedContent('dragAndDrop', { layout: 'pairs' }).layout).toBe('pairs');
  });
});

describe('Bilder aus dem KI-Prompt (nc:<Ordner>/<Datei>)', () => {
  const mod = (content: any) => JSON.stringify({ topic: { title: 'T', modules: [{ title: '1', type: 'sorting', content }] } });
  function svc(nextcloud: any) {
    const saved: any[] = [];
    const repo: any = { create: (x: any) => x, save: async (x: any) => { if (Array.isArray(x)) saved.push(...x); return x; }, findOne: async () => null };
    return { s: new ImportService(repo, repo, nextcloud), saved };
  }
  const cloud = (ready: boolean) => ({
    isReady: async () => ready,
    resolveRefs: async (_u: string, refs: string[]) => new Map(refs.map((r) => [r, r === 'nc:Reisen/gate.jpg' ? 'https://c.de/s/T/download?files=gate.jpg' : null])),
  });

  it('macht daraus Lese-URLs der eigenen Nextcloud, Unbekanntes bleibt leer', async () => {
    const { s, saved } = svc(cloud(true));
    const res: any = await s.importTopicFromJson(mod({ items: [{ text: 'A', imageUrl: 'nc:Reisen/gate.jpg' }, { text: 'B', imageUrl: 'nc:Reisen/erfunden.jpg' }] }), user);
    expect(saved[0].content.items.map((i: any) => i.imageUrl)).toEqual(['https://c.de/s/T/download?files=gate.jpg', '']);
    expect(res.notes).toEqual(['Bilder nicht in deiner Nextcloud gefunden, Feld bleibt leer: Reisen/erfunden.jpg']);
  });

  it('ohne verbundene Nextcloud: Felder leer, Hinweis zum Verbinden', async () => {
    const { s, saved } = svc(cloud(false));
    const res: any = await s.importTopicFromJson(mod({ items: [{ text: 'A', imageUrl: 'nc:Reisen/gate.jpg' }, { text: 'B' }] }), user);
    expect(saved[0].content.items[0].imageUrl).toBe('');
    expect(res.notes[0]).toContain('verbinde deine Nextcloud');
  });

  it('lässt normale Inhalte in Ruhe', async () => {
    const { s, saved } = svc(cloud(true));
    const res: any = await s.importTopicFromJson(mod({ items: [{ text: 'nc: kein Verweis', imageUrl: 'https://x.de/a.png' }] }), user);
    expect(saved[0].content.items[0]).toEqual({ text: 'nc: kein Verweis', imageUrl: 'https://x.de/a.png' });
    expect(res.notes).toBeUndefined();
  });
});

describe('Import: Quizze im Dokument', () => {
  it('zeigen nach dem Import auf die neuen Modul-IDs', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { remapQuizBlocks } = require('./import.service');
    const map = new Map([['q1', 'neu1']]);
    const content = { kind: 'arbeitsblatt', spec: { content: [{ type: 'quiz', module: 'q1' }, { type: 'task', title: 'A', blocks: [{ type: 'quiz', module: 'q1' }, { type: 'quiz', module: 'fremd' }] }] } };
    const out = remapQuizBlocks(content, map);
    expect(out.spec.content[0].module).toBe('neu1');
    expect(out.spec.content[1].blocks[0].module).toBe('neu1');
    expect(out.spec.content[1].blocks[1].module).toBe('fremd');
    expect(JSON.parse(remapQuizBlocks(JSON.stringify(content), map)).spec.content[0].module).toBe('neu1');
  });
});

describe('Lehrerfortbildung (schulung/fortbildung)', () => {
  it('jedes Lernthema lässt sich importieren; eingebettete Quizze zeigen auf importierte Module', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('fs');
    const file = `${__dirname}/../../../../schulung/fortbildung/LearningModules-Fortbildung.zip`;
    if (!existsSync(file)) return; // erst mit node schulung/fortbildung/build.mjs
    const zip = new AdmZip(file);
    const topics = zip.getEntries().filter((e: any) => e.entryName !== 'notebook.json');
    expect(topics.length).toBeGreaterThan(10);
    for (const entry of topics) {
      const saved: any[] = [];
      const repo: any = { create: (x: any) => x, save: async (x: any) => { if (Array.isArray(x)) saved.push(...x); return x; }, findOne: async () => null };
      const res = await new ImportService(repo, repo).importTopicFromJson(entry.getData().toString('utf-8'), user);
      expect(res.notes || []).toEqual([]);
      const ids = new Set(saved.map((m) => m.id));
      for (const m of saved.filter((x) => x.type === 'document')) {
        const quiz: string[] = [];
        const walk = (bs: any[]) => (bs || []).forEach((b) => { if (b.type === 'quiz') quiz.push(b.module); walk(b.blocks); });
        walk(m.content.spec.content);
        for (const id of quiz) expect(ids.has(id)).toBe(true);
      }
    }
  });
});
