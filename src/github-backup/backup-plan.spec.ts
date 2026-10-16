import { gitBlobSha, parseRepo, parseTokenExpiry } from './github-api';
import { INDEX_PATH, parseIndex, pickModules, planBackup, renderIndex, slug, topicIdOf, topicPath, BackupTopic } from './backup-plan';

const topic = (id: string, title: string, content = `{"id":"${id}"}\n`): BackupTopic => ({ id, title, content, modules: 1 });
const blob = (path: string, content: string) => ({ path, sha: gitBlobSha(content), type: 'blob' });

describe('gitBlobSha', () => {
  it('stimmt mit git hash-object überein', () => {
    expect(gitBlobSha('{"a":1}\n')).toBe('0187f3b09d66cef7911083ad49f890f5a6589589');
  });

  it('rechnet in Bytes, nicht in Zeichen', () => {
    expect(gitBlobSha('ä')).toBe(gitBlobSha(Buffer.from('ä', 'utf-8')));
    expect(gitBlobSha('ä')).not.toBe(gitBlobSha('a'));
  });
});

describe('parseRepo', () => {
  it('nimmt Kurzform und kopierte Adressen', () => {
    expect(parseRepo('lehrer/backup')).toBe('lehrer/backup');
    expect(parseRepo('https://github.com/lehrer/backup.git')).toBe('lehrer/backup');
    expect(parseRepo(' https://github.com/lehrer/lm-backup/ ')).toBe('lehrer/lm-backup');
  });

  it('weist anderes ab', () => {
    expect(parseRepo('backup')).toBeNull();
    expect(parseRepo('a/b/c')).toBeNull();
    expect(parseRepo('../etc')).toBeNull();
  });
});

describe('parseTokenExpiry', () => {
  it('liest UTC und Offset', () => {
    expect(parseTokenExpiry('2026-11-30 12:00:00 UTC')?.toISOString()).toBe('2026-11-30T12:00:00.000Z');
    expect(parseTokenExpiry('2026-11-30 12:00:00 +0100')?.toISOString()).toBe('2026-11-30T11:00:00.000Z');
    expect(parseTokenExpiry(null)).toBeNull();
    expect(parseTokenExpiry('bald')).toBeNull();
  });
});

describe('Dateinamen', () => {
  it('macht lesbare, sichere Namen', () => {
    expect(slug('Brüche & Größen: Übung 1')).toBe('Brueche-Groessen-Uebung-1');
    expect(slug('???')).toBe('thema');
    expect(topicPath({ id: 'abc', title: 'Mathe' })).toBe('themen/Mathe--abc.json');
  });

  it('erkennt die Thema-ID am letzten "--"', () => {
    expect(topicIdOf('themen/Mathe--abc.json')).toBe('abc');
    expect(topicIdOf('themen/Mein--Titel--abc.json')).toBe('abc');
    expect(topicIdOf('themen/umbenannt-von-Hand--abc.json')).toBe('abc');
    expect(topicIdOf(INDEX_PATH)).toBeNull();
    expect(topicIdOf('README.md')).toBeNull();
    expect(topicIdOf('themen/ohne-id.json')).toBeNull();
    expect(topicIdOf('themen/unter/ordner--abc.json')).toBeNull();
  });
});

describe('planBackup', () => {
  it('legt beim ersten Mal alles an, samt Index', () => {
    const plan = planBackup([], [topic('t1', 'Mathe'), topic('t2', 'Deutsch')], []);
    expect(plan.created).toEqual(['Mathe', 'Deutsch']);
    expect(plan.files.map((f) => f.path)).toEqual(['themen/Mathe--t1.json', 'themen/Deutsch--t2.json', INDEX_PATH]);
  });

  it('schreibt nichts, wenn sich nichts geändert hat', () => {
    const topics = [topic('t1', 'Mathe')];
    const first = planBackup([], topics, []);
    const tree = first.files.map((f) => blob(f.path, f.content));
    const second = planBackup(tree, topics, parseIndex(first.files.find((f) => f.path === INDEX_PATH)!.content));
    expect(second.files).toEqual([]);
    expect(second.unchanged).toBe(1);
  });

  it('lädt nur geänderte Themen hoch', () => {
    const tree = [blob('themen/Mathe--t1.json', 'alt'), blob('themen/Deutsch--t2.json', 'gleich')];
    const plan = planBackup(tree, [topic('t1', 'Mathe', 'neu'), topic('t2', 'Deutsch', 'gleich')], []);
    expect(plan.updated).toEqual(['Mathe']);
    expect(plan.unchanged).toBe(1);
    expect(plan.files.filter((f) => f.path !== INDEX_PATH).map((f) => f.path)).toEqual(['themen/Mathe--t1.json']);
  });

  it('behält beim Umbenennen den Pfad und führt den neuen Titel im Index', () => {
    const tree = [blob('themen/Mathe--t1.json', 'alt')];
    const plan = planBackup(tree, [topic('t1', 'Mathematik 7', 'neu')], [{ datei: 'themen/Mathe--t1.json', id: 't1', titel: 'Mathe', module: 1 }]);
    expect(plan.files.map((f) => f.path)).toEqual(['themen/Mathe--t1.json', INDEX_PATH]);
    const index = parseIndex(plan.files[1].content);
    expect(index).toEqual([{ datei: 'themen/Mathe--t1.json', id: 't1', titel: 'Mathematik 7', module: 1 }]);
  });

  it('schreibt in eine auf GitHub umbenannte Datei weiter', () => {
    const tree = [blob('themen/meine-Datei--t1.json', 'alt')];
    const plan = planBackup(tree, [topic('t1', 'Mathe', 'neu')], []);
    expect(plan.files[0].path).toBe('themen/meine-Datei--t1.json');
    expect(plan.created).toEqual([]);
  });

  it('lässt Dateien gelöschter Themen stehen und behält ihren Titel im Index', () => {
    const oldIndex = [{ datei: 'themen/Alt--t9.json', id: 't9', titel: 'Altes Thema', module: 3 }];
    const tree = [blob('themen/Alt--t9.json', 'x'), blob(INDEX_PATH, renderIndex(oldIndex))];
    const plan = planBackup(tree, [], oldIndex);
    expect(plan.files).toEqual([]);
  });

  it('nimmt auf GitHub gelöschte Dateien aus dem Index', () => {
    const oldIndex = [{ datei: 'themen/Weg--t9.json', id: 't9', titel: 'Weg', module: 1 }];
    const tree = [blob(INDEX_PATH, renderIndex(oldIndex))];
    const plan = planBackup(tree, [], oldIndex);
    expect(parseIndex(plan.files[0].content)).toEqual([]);
  });

  it('übersteht einen kaputten Index', () => {
    expect(parseIndex('kein json')).toEqual([]);
    expect(parseIndex('{"themen": 5}')).toEqual([]);
  });
});

describe('pickModules', () => {
  const modules = [
    { id: 'a', parentId: null },
    { id: 'a1', parentId: 'a' },
    { id: 'b', parentId: null },
    { id: 'b1', parentId: 'b' },
  ];

  it('nimmt gewählte Module samt Untermodulen', () => {
    expect(pickModules(modules, ['a']).map((m) => m.id)).toEqual(['a', 'a1']);
  });

  it('ignoriert einzeln gewählte Untermodule', () => {
    expect(pickModules(modules, ['b1'])).toEqual([]);
  });
});
