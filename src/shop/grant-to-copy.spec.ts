import { ForbiddenException } from '@nestjs/common';
import { ShopService } from './shop.service';

/** ✏️ Bearbeiten an einem genutzten Dokument: Nutzung → eigene Kopie (nur wenn Kopieren erlaubt). */
describe('ShopService.grantToCopy', () => {
  const user = { userId: 'u1' };
  const make = (offer: any, copiesBefore: string[], copiesAfter: string[]) => {
    const svc: any = Object.create(ShopService.prototype);
    const grants = new Map<string, any>([['g1', { id: 'g1', userId: 'u1', offerId: 'o1', onlyForeign: false }]]);
    svc.grantRepo = {
      findOne: async ({ where }: any) => grants.get(where.id) || null,
      remove: async (g: any) => { grants.delete(g.id); },
      create: (x: any) => x,
      save: async (g: any) => { grants.set(g.id, g); },
    };
    svc.offerRepo = { findOne: async () => offer };
    let calls = 0;
    svc.topicRepo = { find: async () => (calls++ === 0 ? copiesBefore : copiesAfter).map((id) => ({ id })) };
    svc.acquire = jest.fn(async () => ({ success: true, mode: 'copy', topicId: 'first' }));
    return { svc, grants };
  };

  it('legt die Kopie an, ersetzt die Nutzung und nennt die neue Kopie des Lernthemas', async () => {
    const { svc, grants } = make({ id: 'o1', allowCopy: true }, ['alt'], ['alt', 'neu']);
    const res = await svc.grantToCopy('g1', user, 't1');
    expect(svc.acquire).toHaveBeenCalledWith('o1', 'copy', user);
    expect(res.topicId).toBe('neu');
    expect(grants.has('g1')).toBe(false);
  });

  it('nur zum Verwenden: keine Kopie, die Nutzung bleibt', async () => {
    const { svc, grants } = make({ id: 'o1', allowCopy: false }, [], []);
    await expect(svc.grantToCopy('g1', user, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.acquire).not.toHaveBeenCalled();
    expect(grants.has('g1')).toBe(true);
  });

  it('scheitert das Kopieren, kommt die Nutzung zurück', async () => {
    const { svc, grants } = make({ id: 'o1', allowCopy: true }, [], []);
    svc.acquire = jest.fn(async () => { throw new Error('weg'); });
    await expect(svc.grantToCopy('g1', user, 't1')).rejects.toThrow('weg');
    expect(grants.has('g1')).toBe(true);
  });
});
