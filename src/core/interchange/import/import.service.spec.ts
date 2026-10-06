import { ImportService } from './import.service';

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
