import { backupFileName, planNextcloudBackup, BackupFile } from './nextcloud-backup.service';

const file = (topicId: string, hash: string, title = 'Thema'): BackupFile => ({ topicId, hash, file: backupFileName(topicId, title), content: '{}' });

describe('Nextcloud-Backup', () => {
  it('benennt Dateien nach Titel und Kennungsanfang', () => {
    expect(backupFileName('0f3a9c12-aaaa-bbbb', 'Englisch: Reisen')).toBe('Englisch Reisen (0f3a9c12).json');
    expect(backupFileName('12345678-x', '')).toBe('Ohne Titel (12345678).json');
  });

  it('lädt nur Neues, Geändertes und in der Nextcloud Fehlendes hoch', () => {
    const files = [file('a1111111', 'h1'), file('b2222222', 'h2-neu'), file('c3333333', 'h3'), file('d4444444', 'h4')];
    const previous = {
      a1111111: { file: files[0].file, hash: 'h1' }, // unverändert
      b2222222: { file: files[1].file, hash: 'h2' }, // geändert
      c3333333: { file: files[2].file, hash: 'h3' }, // in der Nextcloud gelöscht
    };
    const present = new Set([files[0].file, files[1].file]);
    const plan = planNextcloudBackup(files, previous, present);
    expect(plan.upload.map((f) => f.topicId)).toEqual(['b2222222', 'c3333333', 'd4444444']);
    expect(plan).toMatchObject({ created: 1, updated: 2, unchanged: 1 });
  });

  it('schreibt nach einer Umbenennung unter dem neuen Namen', () => {
    const renamed = file('a1111111', 'h1', 'Neuer Titel');
    const plan = planNextcloudBackup([renamed], { a1111111: { file: backupFileName('a1111111', 'Alt'), hash: 'h1' } }, new Set([backupFileName('a1111111', 'Alt')]));
    expect(plan.upload).toHaveLength(1);
  });
});
