import AdmZip from 'adm-zip';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GithubBackupService } from './github-backup.service';

/** ⬇ .zlm am Dokument (GET /api/github-backup/zlm) – nur eigene Dokumente, mit eingebetteten Quizzen. */
describe('GithubBackupService.documentZlm', () => {
  const doc = {
    id: 'doc1', type: 'document', title: 'Ohm: Gesetz?', topicId: 't1', creatorId: 'u1',
    content: { kind: 'arbeitsblatt', spec: { content: [{ type: 'text', text: 'Hallo' }, { type: 'quiz', module: 'q1' }] } },
  };
  const quiz = { id: 'q1', type: 'multipleChoice', title: 'Kurzquiz', topicId: 't1', creatorId: 'u1', content: { questions: [] } };
  const other = { id: 'x1', type: 'trueFalse', title: 'Fremd', topicId: 't1', creatorId: 'u1', content: {} };
  const service = (mod: any) => {
    const repo = (value: any) => ({ findOne: async () => value });
    return new (GithubBackupService as any)(
      repo(null), repo(mod), repo({ id: 't1', modules: [doc, quiz, other] }), repo(null), repo(null), repo(null), repo(null), repo(null),
      {}, {}, {},
    ) as GithubBackupService;
  };

  it('liefert eine .zlm mit dem Dokument und seinem Quiz – nicht mit anderen Modulen', async () => {
    const res = await service(doc).documentZlm({ userId: 'u1' }, 'doc1');
    expect(res.fileName).toBe('Ohm Gesetz.zlm'); // „:“ und „?“ sind in Dateinamen nicht erlaubt
    const zip = new AdmZip(Buffer.from(res.data, 'base64'));
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names[0]).toBe('mimetype');
    expect(names).toEqual(expect.arrayContaining(['manifest.json', 'document.json', 'modules/q1.json']));
    expect(names).not.toContain('modules/x1.json');
    expect(JSON.parse(zip.readAsText('document.json')).spec.content[1]).toEqual(expect.objectContaining({ type: 'quiz', module: 'q1' }));
  });

  it('fremde Dokumente nicht; ein eigenes Quiz kommt als .zlm der Art module', async () => {
    await expect(service(doc).documentZlm({ userId: 'u2' }, 'doc1')).rejects.toBeInstanceOf(ForbiddenException);
    const q = await service(quiz).documentZlm({ userId: 'u1' }, 'q1');
    expect(q.fileName).toBe('Kurzquiz.zlm');
    expect(Buffer.from(q.data, 'base64').toString('latin1')).toContain('"kind": "module"');
    await expect(service(quiz).documentZlm({ userId: 'u2' }, 'q1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service(null).documentZlm({ userId: 'u1' }, 'weg')).rejects.toBeInstanceOf(NotFoundException);
  });
});
