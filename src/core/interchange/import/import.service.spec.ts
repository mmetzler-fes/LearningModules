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
  });
});
