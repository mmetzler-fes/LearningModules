import { LinksService } from './links.service';

/** Quizze, die ein Dokument aus einem anderen Lernthema einbettet: kommen mit dem Dokument (alle Schüler-Wege). */
describe('LinksService.resolveModules: Quiz aus einem anderen Lernthema', () => {
  const doc = { id: 'doc', topicId: 't', type: 'document', orderIndex: 0, content: { spec: { content: [{ type: 'quiz', module: 'qx' }] } } };
  const other = { id: 'other', topicId: 't', type: 'multipleChoice', orderIndex: 1, content: {} };
  const qx = { id: 'qx', topicId: 'tq', type: 'multipleChoice', orderIndex: 0, content: {} };
  const values = (where: any, key: string) => where[key]?._value as string[] | undefined;
  const service = (quiz: any = qx, homeOwner = 'me'): any => {
    const svc: any = Object.create(LinksService.prototype);
    const topics = [{ id: 't', ownerId: 'me', selected: true }, { id: 'tq', ownerId: homeOwner, selected: false }];
    svc.topicRepo = { find: async ({ where }: any) => topics.filter((t) => values(where, 'id')?.includes(t.id)) };
    svc.moduleRepo = {
      find: async ({ where }: any) => (values(where, 'topicId') ? [doc, other].filter((m) => values(where, 'topicId')!.includes(m.topicId))
        : values(where, 'id') ? [quiz].filter((m) => values(where, 'id')!.includes(m.id)) : []),
    };
    svc.groupsService = { asUser: async () => ({}) };
    svc.topicsService = { accessLevel: () => 'read', visibleModules: (_t: unknown, m: unknown) => m };
    return svc;
  };
  const link = (selection: any[]) => ({ ownerId: 'me', classId: 'k', selection });
  const ids = (r: any[]) => r.flatMap((x) => x.modules.map((m: any) => `${m.id}${m.embeddedOnly ? '*' : ''}`));

  it('kommt mit dem Dokument, auch wenn sein Lernthema nicht freigegeben ist', async () => {
    expect(ids(await service().resolveModules(link([{ topicId: 't', all: true }])))).toEqual(['doc', 'other', 'qx*']);
  });
  it('nicht ohne das Dokument', async () => {
    expect(ids(await service().resolveModules(link([{ topicId: 't', moduleIds: ['other'] }])))).toEqual(['other']);
  });
  it('nicht, wenn es ausgeschaltet ist oder einer anderen Lehrkraft gehört', async () => {
    expect(ids(await service({ ...qx, moduleSelected: false }).resolveModules(link([{ topicId: 't', all: true }])))).toEqual(['doc', 'other']);
    expect(ids(await service(qx, 'other').resolveModules(link([{ topicId: 't', all: true }])))).toEqual(['doc', 'other']);
  });
});
