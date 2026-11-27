import { PlantLibraryService } from './plant-library.service';
import { repo } from '../work/test-repo';

describe('PlantLibraryService (Bibliothek der Anlagen)', () => {
  const make = () => {
    const rows = repo([]);
    const users = repo([{ id: 't1', role: 'teacher', displayName: 'Frau M' }, { id: 't2', role: 'teacher', displayName: 'Herr K' }]);
    return { svc: new PlantLibraryService(rows as any, users as any), rows };
  };
  const data = { plant: { v: 2, w: 10, h: 8, items: [{ id: 'a', type: 'lamp', x: 1, y: 1, out: 'H1' }] }, io: [{ kind: 'out', name: 'H1' }] };

  it('eigene ablegen, ändern, teilen; andere sehen nur Geteiltes und dürfen es nicht ändern', async () => {
    const { svc } = make();
    const { id } = await svc.save({ userId: 't1' }, { title: 'Lampe', data });
    expect(await svc.list({ userId: 't2' })).toEqual([]);
    await svc.save({ userId: 't1' }, { id, title: 'Lampe H1', data });
    await svc.share({ userId: 't1' }, id, true);
    const seen = await svc.list({ userId: 't2' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ title: 'Lampe H1', own: false, owner: 'Frau M', shared: true });
    await expect(svc.save({ userId: 't2' }, { id, title: 'x', data })).rejects.toThrow(/eigene/);
    await expect(svc.remove({ userId: 't2' }, id)).rejects.toThrow(/eigene/);
    await svc.remove({ userId: 't1' }, id);
    expect(await svc.list({ userId: 't1' })).toEqual([]);
  });

  it('prüft Namen und Inhalt; nur Lehrkräfte', async () => {
    const { svc } = make();
    await expect(svc.save({ userId: 't1' }, { title: ' ', data })).rejects.toThrow(/Namen/);
    await expect(svc.save({ userId: 't1' }, { title: 'x', data: { io: [] } })).rejects.toThrow(/plant/);
    await expect(svc.list({ userId: 'niemand' })).rejects.toThrow(/Lehrkräfte/);
  });
});
