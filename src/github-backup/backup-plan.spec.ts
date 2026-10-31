import { gitBlobSha, parseRepo, parseTokenExpiry } from './github-api';
import { INDEX_PATH, fileName, parseDocIndex, parseIndex, pickModules, planBackup, renderIndex, slug, topicIdOf, topicPath, BackupTopic } from './backup-plan';

const topic = (id: string, title: string, content = `{"id":"${id}"}\n`): BackupTopic => ({ id, title, content, modules: 1 });
const blob = (path: string, content: string | Buffer) => ({ path, sha: gitBlobSha(content), type: 'blob' });

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
    const second = planBackup(tree, topics, parseIndex(String(first.files.find((f) => f.path === INDEX_PATH)!.content)));
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
    const index = parseIndex(String(plan.files[1].content));
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
    expect(parseIndex(String(plan.files[0].content))).toEqual([]);
  });

  it('übersteht einen kaputten Index', () => {
    expect(parseIndex('kein json')).toEqual([]);
    expect(parseIndex('{"themen": 5}')).toEqual([]);
  });
});

describe('planBackup: Dokumente als .zlm im Notizbuch', () => {
  const doc = (id: string, title: string, bytes = `zlm-${id}`) => ({ id, title, bytes: Buffer.from(bytes) });
  const withDocs = (folder: string[] | undefined, docs: ReturnType<typeof doc>[]): BackupTopic => ({ ...topic('t1', 'Brüche'), folder, documents: docs });
  /** Baum und Index nach einem Lauf, als wäre er auf GitHub angekommen. */
  const after = (tree: ReturnType<typeof blob>[], plan: ReturnType<typeof planBackup>) => {
    const map = new Map(tree.map((e) => [e.path, e]));
    for (const f of plan.files) map.set(f.path, blob(f.path, f.content));
    for (const p of plan.remove) map.delete(p);
    const index = String(map.has(INDEX_PATH) ? plan.files.find((f) => f.path === INDEX_PATH)?.content ?? '' : '');
    return { tree: [...map.values()], index };
  };

  it('legt die .zlm im Ordner des Themas ab, mit lesbarem Namen, und führt sie im Index', () => {
    const plan = planBackup([], [withDocs(['Mathe', 'Klasse 7', 'Brüche'], [doc('d1', 'Arbeitsblatt: Kürzen')])], []);
    const zlm = plan.files.find((f) => f.path.endsWith('.zlm'))!;
    expect(zlm.path).toBe('Notizbuch/Mathe/Klasse 7/Brüche/Arbeitsblatt- Kürzen.zlm');
    expect(Buffer.isBuffer(zlm.content)).toBe(true);
    expect(plan.created).toContain('Brüche: Arbeitsblatt: Kürzen.zlm');
    const index = String(plan.files.find((f) => f.path === INDEX_PATH)!.content);
    expect(parseDocIndex(index)).toEqual([{ datei: zlm.path, id: 'd1', titel: 'Arbeitsblatt: Kürzen', thema: 'Brüche' }]);
    expect(parseIndex(index)).toHaveLength(1);
  });

  it('nimmt „Unsortiert“ ohne Platz im Notizbuch und zählt gleiche Namen hoch', () => {
    const plan = planBackup([], [withDocs(undefined, [doc('d1', 'AB'), doc('d2', 'AB')])], []);
    expect(plan.files.filter((f) => f.path.endsWith('.zlm')).map((f) => f.path)).toEqual([
      'Notizbuch/Unsortiert/Brüche/AB.zlm',
      'Notizbuch/Unsortiert/Brüche/AB (2).zlm',
    ]);
  });

  it('schreibt nichts, wenn sich nichts geändert hat', () => {
    const topics = [withDocs(['Mathe', 'Brüche'], [doc('d1', 'AB')])];
    const first = after([], planBackup([], topics, []));
    const second = planBackup(first.tree, topics, parseIndex(first.index), parseDocIndex(first.index));
    expect(second.files).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.unchanged).toBe(2);
  });

  it('zieht beim Verschieben und Umbenennen mit und löscht den alten Ort', () => {
    const first = after([], planBackup([], [withDocs(['Mathe', 'Brüche'], [doc('d1', 'AB')])], []));
    const plan = planBackup(first.tree, [withDocs(['Mathe', 'Klasse 6', 'Brüche'], [doc('d1', 'AB neu')])], parseIndex(first.index), parseDocIndex(first.index));
    expect(plan.files.map((f) => f.path)).toContain('Notizbuch/Mathe/Klasse 6/Brüche/AB neu.zlm');
    expect(plan.remove).toEqual(['Notizbuch/Mathe/Brüche/AB.zlm']);
    expect(plan.updated).toEqual(['Brüche: AB neu.zlm']);
  });

  it('lässt die .zlm gelöschter Dokumente liegen', () => {
    const first = after([], planBackup([], [withDocs(['Mathe', 'Brüche'], [doc('d1', 'AB'), doc('d2', 'Test')])], []));
    const plan = planBackup(first.tree, [withDocs(['Mathe', 'Brüche'], [doc('d1', 'AB')])], parseIndex(first.index), parseDocIndex(first.index));
    expect(plan.remove).toEqual([]);
    expect(plan.files).toEqual([]);
  });
});

describe('fileName', () => {
  it('behält Umlaute und Leerzeichen, ersetzt, was Windows nicht mag', () => {
    expect(fileName('Brüche: Kürzen / Erweitern?')).toBe('Brüche- Kürzen - Erweitern-');
    expect(fileName('  ..versteckt.  ')).toBe('versteckt');
    expect(fileName('')).toBe('_');
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
