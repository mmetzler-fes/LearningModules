import { AiBridgeService } from './ai-bridge.service';
import { repo } from '../work/test-repo';

describe('AiBridgeService (15-Minuten-KI-Token, Scope & Undo)', () => {
  const userId = 'teacher-1';
  const user = { userId };

  let nbNodes: any[];
  let nbPlacements: any[];
  let topics: any[];
  let modules: any[];
  let planNodes: any[];
  let planEntries: any[];
  let versions: any[];
  let service: AiBridgeService;

  beforeEach(() => {
    nbNodes = [
      { id: 'book-et', ownerId: userId, kind: 'book', title: 'Elektrotechnik', parentId: null, orderIndex: 0 },
      { id: 'sec-et-1', ownerId: userId, kind: 'section', title: 'Grundlagen', parentId: 'book-et', orderIndex: 0 },
      { id: 'book-other', ownerId: userId, kind: 'book', title: 'Geheim', parentId: null, orderIndex: 1 },
    ];
    topics = [
      { id: 'top-ohm', ownerId: userId, title: 'Ohmsches Gesetz', description: 'U, R, I', modules: [] },
      { id: 'top-secret', ownerId: userId, title: 'Geheimthema', description: '', modules: [] },
    ];
    nbPlacements = [
      { ownerId: userId, topicId: 'top-ohm', nodeId: 'sec-et-1', orderIndex: 0 },
      { ownerId: userId, topicId: 'top-secret', nodeId: 'book-other', orderIndex: 0 },
    ];
    modules = [
      {
        id: 'mod-doc-1',
        topicId: 'top-ohm',
        type: 'document',
        title: 'AB 1: Alt',
        orderIndex: 0,
        content: { kind: 'arbeitsblatt', spec: { content: [{ type: 'text', text: 'Alter Inhalt' }] } },
      },
    ];
    planNodes = [
      { id: 'plan-bfe', ownerId: userId, kind: 'plan', title: '2BFE', parentId: null, orderIndex: 0 },
      { id: 'plan-secret', ownerId: userId, kind: 'plan', title: 'Andere Klasse', parentId: null, orderIndex: 1 },
    ];
    planEntries = [];
    versions = [];

    const nbNodeRepo: any = {
      findOne: jest.fn(async ({ where }: any) => nbNodes.find((n) => n.id === where.id && n.ownerId === where.ownerId) || null),
    };
    const nbPlaceRepo: any = {
      findOne: jest.fn(async ({ where }: any) => nbPlacements.find((p) => p.ownerId === where.ownerId && p.topicId === where.topicId) || null),
      delete: jest.fn(async ({ ownerId, topicId }: any) => {
        nbPlacements = nbPlacements.filter((p) => !(p.ownerId === ownerId && p.topicId === topicId));
      }),
    };
    const topicRepo: any = {
      findOne: jest.fn(async ({ where }: any) => topics.find((t) => t.id === where.id && (!where.ownerId || t.ownerId === where.ownerId)) || null),
    };
    const moduleRepo: any = {
      find: jest.fn(async ({ where }: any) => modules.filter((m) => m.topicId === where.topicId)),
      findOne: jest.fn(async ({ where }: any) => modules.find((m) => m.id === where.id) || null),
      delete: jest.fn(async ({ id }: any) => {
        modules = modules.filter((m) => m.id !== id);
      }),
      update: jest.fn(async ({ id }: any, patch: any) => {
        const m = modules.find((x) => x.id === id);
        if (m) Object.assign(m, patch);
      }),
    };
    const planNodeRepo: any = {
      find: jest.fn(async ({ where }: any) => planNodes.filter((n) => n.ownerId === where.ownerId)),
      findOne: jest.fn(async ({ where }: any) => planNodes.find((n) => n.id === where.id && n.ownerId === where.ownerId) || null),
    };
    const planEntryRepo: any = {
      find: jest.fn(async ({ where }: any) => planEntries.filter((e) => e.ownerId === where.ownerId)),
      findOne: jest.fn(async ({ where }: any) => planEntries.find((e) => e.id === where.id && e.ownerId === where.ownerId) || null),
      delete: jest.fn(async ({ id }: any) => {
        planEntries = planEntries.filter((e) => e.id !== id);
      }),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        planEntries.push(x);
        return x;
      }),
    };
    const versionRepo: any = {
      findOne: jest.fn(async ({ where }: any) => versions.find((v) => v.id === where.id) || null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        versions.push(x);
        return x;
      }),
    };

    const notebooksService: any = {
      tree: jest.fn(async () => ({
        nodes: nbNodes,
        placements: nbPlacements,
        topics: topics.map((t) => ({ ...t, modules: modules.filter((m) => m.topicId === t.id) })),
      })),
      createNode: jest.fn(async (_u: any, body: any) => {
        const id = `nb-${nbNodes.length + 1}`;
        nbNodes.push({ id, ownerId: userId, kind: body.kind, title: body.title, parentId: body.parentId || null, orderIndex: nbNodes.length });
        return { id };
      }),
      updateNode: jest.fn(async (id: string, _u: any, body: any) => {
        const n = nbNodes.find((x) => x.id === id);
        if (n && body.title) n.title = body.title;
        return { success: true };
      }),
      deleteNode: jest.fn(async (id: string) => {
        nbNodes = nbNodes.filter((n) => n.id !== id);
        return { success: true };
      }),
      move: jest.fn(async (_u: any, body: any) => {
        const p = nbPlacements.find((x) => x.topicId === body.id);
        if (p) {
          p.nodeId = body.parentId;
          if (body.index != null) p.orderIndex = body.index;
        } else {
          nbPlacements.push({ ownerId: userId, topicId: body.id, nodeId: body.parentId, orderIndex: body.index ?? 0 });
        }
        return { success: true };
      }),
    };

    const plansService: any = {
      tree: jest.fn(async () => ({
        nodes: planNodes,
        entries: planEntries,
        topics,
      })),
      createNode: jest.fn(async (_u: any, body: any) => {
        const id = `pl-${planNodes.length + 1}`;
        planNodes.push({ id, ownerId: userId, kind: body.kind, title: body.title, parentId: body.parentId || null, orderIndex: planNodes.length });
        return { id };
      }),
      renameNode: jest.fn(async (_u: any, id: string, title: string) => {
        const n = planNodes.find((x) => x.id === id);
        if (n) n.title = title;
        return { success: true };
      }),
      deleteNode: jest.fn(async (_u: any, id: string) => {
        planNodes = planNodes.filter((n) => n.id !== id);
        return { success: true };
      }),
      add: jest.fn(async (_u: any, body: any) => {
        for (const it of body.items) {
          planEntries.push({ id: `pe-${planEntries.length + 1}`, ownerId: userId, nodeId: body.parentId, topicId: it.id, orderIndex: planEntries.length });
        }
        return { added: body.items.length };
      }),
      deleteEntry: jest.fn(async (_u: any, id: string) => {
        planEntries = planEntries.filter((e) => e.id !== id);
        return { success: true };
      }),
    };

    const topicsService: any = {
      create: jest.fn(async (_u: any, data: any) => {
        const created = { id: `top-${topics.length + 1}`, ownerId: userId, title: data.title, description: data.description || '', modules: [] };
        topics.push(created);
        return created;
      }),
      remove: jest.fn(async (id: string) => {
        topics = topics.filter((t) => t.id !== id);
        return { success: true };
      }),
      addModule: jest.fn(async (topicId: string, _u: any, modData: any) => {
        const existing = modData.id ? modules.find((m) => m.id === modData.id) : null;
        if (existing) {
          Object.assign(existing, modData);
          return existing;
        }
        const saved = { id: `mod-${modules.length + 1}`, topicId, orderIndex: modules.length, ...modData };
        modules.push(saved);
        return saved;
      }),
    };

    service = new AiBridgeService(
      nbNodeRepo,
      nbPlaceRepo,
      topicRepo,
      moduleRepo,
      planNodeRepo,
      planEntryRepo,
      versionRepo,
      notebooksService,
      plansService,
      topicsService,
      repo() as any,
    );
  });

  it('erzeugt ein 15-Minuten-Token und beschränkt die Sicht strikt auf den gewählten Scope', async () => {
    const created = await service.createSession(user, {
      ttlMinutes: 15,
      notebookNodeIds: ['book-et'],
      planNodeIds: ['plan-bfe'],
      includeUnsorted: false,
    });

    expect(created.token).toMatch(/^lma_[0-9a-f]{48}$/);
    expect(created.prompt).toContain(created.token);
    expect(created.prompt).toContain('Elektrotechnik');
    expect(created.prompt).not.toContain('Geheimthema');
    // Kurzanleitung: Gliederung statt JSON-Baum, keine Module – passt in einen Chat.
    expect(created.prompt.length).toBeLessThan(8000);
    expect(created.prompt).not.toContain('"modules"');

    const session = await service.authenticateToken(`Bearer ${created.token}`);
    const tree = await service.scopedTree(session);
    expect(tree.notebook.nodes.map((n: any) => n.id)).toEqual(['book-et', 'sec-et-1']);
    expect(tree.notebook.topics.map((t: any) => t.topicId)).toEqual(['top-ohm']);
    expect(tree.plans.nodes.map((n: any) => n.id)).toEqual(['plan-bfe']);

    // Zugriff auf nicht freigegebenes Thema wird verweigert:
    await expect(service.getScopedTopic(session, 'top-secret')).rejects.toThrow(/außerhalb/);
  });

  it('führt Batch mit symbolischen $ref-Referenzen aus und macht alles per Rollback rückgängig', async () => {
    const { token, session: info } = await service.createSession(user, {
      notebookNodeIds: ['book-et'],
      planNodeIds: ['plan-bfe'],
    });
    const session = await service.authenticateToken(token);

    const res = await service.executeBatch(session, {
      operations: [
        { op: 'create_notebook_node', kind: 'section', title: 'Schaltungen', parentId: 'book-et', ref: '$sec_neu' },
        { op: 'move_topic', topicId: 'top-ohm', targetNodeId: '$sec_neu' },
        { op: 'create_plan_node', kind: 'area', title: 'LF 1', parentId: 'plan-bfe', ref: '$lf1' },
        { op: 'link_to_plan', parentId: '$lf1', items: [{ type: 'topic', id: 'top-ohm' }] },
        {
          op: 'update_document',
          moduleId: 'mod-doc-1',
          title: 'AB 1: Ohmsches Gesetz (Neu)',
          spec: { content: [{ type: 'section', text: 'Neuer Abschnitt' }, { type: 'text', text: 'Neuer Text' }] },
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.count).toBe(5);
    expect(nbPlacements.find((p) => p.topicId === 'top-ohm')?.nodeId).toBe('nb-4');
    expect(planEntries).toHaveLength(1);
    expect(modules[0].title).toBe('AB 1: Ohmsches Gesetz (Neu)');
    expect(versions).toHaveLength(1); // Automatischer Snapshot vor KI-Änderung

    // Jetzt 1-Klick-Rollback durch die Lehrkraft:
    const rolledBack = await service.rollbackSession(user, info.id);
    expect(rolledBack.success).toBe(true);
    expect(rolledBack.reverted).toBe(5);

    // Vorheriger Zustand vollständig wiederhergestellt:
    expect(nbPlacements.find((p) => p.topicId === 'top-ohm')?.nodeId).toBe('sec-et-1');
    expect(planEntries).toHaveLength(0);
    expect(modules[0].title).toBe('AB 1: Alt');
    expect(modules[0].content.spec.content[0].text).toBe('Alter Inhalt');
  });

  it('Probelauf: neue Ordner und Pläne nehmen Folgeschritte auf, ohne etwas anzulegen', async () => {
    const { token } = await service.createSession(user, { notebookNodeIds: ['book-et'], planNodeIds: ['plan-bfe'] });
    const session = await service.authenticateToken(token);
    const res = await service.executeBatch(session, {
      dryRun: true,
      operations: [
        { op: 'create_notebook_node', kind: 'area', title: 'Antriebe', parentId: 'book-et', ref: '$area' },
        { op: 'create_notebook_node', kind: 'section', title: 'Gleichstrommotor', parentId: '$area', ref: '$sec' },
        { op: 'create_topic', title: 'PWM', targetNodeId: '$sec', ref: '$top' },
        { op: 'create_plan_node', kind: 'area', title: 'LF 1', parentId: 'plan-bfe', ref: '$lf1' },
        { op: 'create_plan_node', kind: 'section', title: 'Motoren', parentId: '$lf1' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(5);
    expect(nbPlacements.find((p) => p.nodeId?.startsWith('dry_'))).toBeUndefined();
  });

  it('lehnt ungültige DocSpec sofort mit konkreter Fehlermeldung ab', async () => {
    const { token } = await service.createSession(user, { notebookNodeIds: ['book-et'], planNodeIds: ['plan-bfe'] });
    const session = await service.authenticateToken(token);

    await expect(
      service.executeBatch(session, {
        operations: [
          {
            op: 'update_document',
            moduleId: 'mod-doc-1',
            spec: { content: [{ type: 'unbekannter_block' }] },
          },
        ],
      }),
    ).rejects.toThrow(/Ungültige DocSpec/);
  });

  const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
  /** Derselbe Dienst mit denselben Tabellen – wie nach einem Neustart des Servers. */
  const restarted = () => new AiBridgeService(...(['nbNodeRepo', 'nbPlaceRepo', 'topicRepo', 'moduleRepo', 'planNodeRepo', 'planEntryRepo', 'versionRepo', 'notebooks', 'plans', 'topics', 'sessionRepo'] as const).map((k) => (service as any)[k]) as [any, any, any, any, any, any, any, any, any, any, any]);

  it('Sitzung und Rückgängig überstehen einen Neustart; Verlängern geht nur, solange sie läuft', async () => {
    const { token, session: info } = await service.createSession(user, { notebookNodeIds: ['book-et'], planNodeIds: ['plan-bfe'] });
    expect(info.remainingSeconds).toBeGreaterThan(59 * 60); // Standard: 60 Minuten
    await service.executeBatch(await service.authenticateToken(token), {
      operations: [{ op: 'rename_notebook_node', id: 'sec-et-1', title: 'Umbenannt' }],
    });
    const other = restarted();
    expect((await other.listSessions(user))[0].opsCount).toBe(1);
    const ext = await other.extendSession(user, info.id, 30);
    expect(ext.session.remainingSeconds).toBeGreaterThan(89 * 60);
    expect((await other.rollbackSession(user, info.id)).reverted).toBe(1);
    expect(nbNodes.find((n) => n.id === 'sec-et-1').title).toBe('Grundlagen');
    await other.revokeSession(user, info.id);
    await expect(other.authenticateToken(token)).rejects.toThrow(/abgelaufen oder wurde beendet/);
    await expect(other.extendSession(user, info.id, 30)).rejects.toThrow(/schon beendet/);
  });

  it('scheitert ein Schritt mittendrin, bleiben die vorigen rückgängig machbar', async () => {
    const { token, session: info } = await service.createSession(user, { notebookNodeIds: ['book-et'], planNodeIds: ['plan-bfe'] });
    await expect(service.executeBatch(await service.authenticateToken(token), {
      operations: [
        { op: 'rename_notebook_node', id: 'sec-et-1', title: 'Neu' },
        { op: 'update_document', moduleId: 'mod-doc-1', spec: { content: [{ type: 'unbekannter_block' }] } },
      ],
    })).rejects.toThrow(/Ungültige DocSpec/);
    expect((await restarted().rollbackSession(user, info.id)).reverted).toBe(1);
    expect(nbNodes.find((n) => n.id === 'sec-et-1').title).toBe('Grundlagen');
  });

  it('Blatt neu aufbereiten: nur dieses Dokument, Bilder als Verweise, beim Schreiben wieder eingesetzt', async () => {
    modules[0].content = { kind: 'arbeitsblatt', spec: { content: [{ type: 'text', text: 'Alt' }, { type: 'image', src: PNG, width: '6cm' }] } };
    const { token, prompt } = await service.createSession(user, { regenerateModuleIds: ['mod-doc-1'] });
    expect(prompt).toContain('mod-doc-1');
    expect(prompt).toMatch(/lm-img:[a-f0-9]{12}/);
    expect(prompt).not.toContain('base64,iVBOR');
    expect(prompt).toContain('Inhalte und Reihenfolge wie im Original');

    const session = await service.authenticateToken(token);
    const doc = await service.getScopedDocument(session, 'mod-doc-1');
    const ref = doc.images[0].ref;
    expect(doc.spec.content[1].src).toBe(ref);
    // Nur Dokumente – Strukturieren ist aus, andere Lernthemen bleiben zu
    await expect(service.executeBatch(session, { operations: [{ op: 'rename_notebook_node', id: 'sec-et-1', title: 'x' }] })).rejects.toThrow(/nur update_document/);
    await expect(service.getScopedTopic(session, 'top-secret')).rejects.toThrow(/außerhalb/);
    await expect(service.executeBatch(session, { operations: [{ op: 'create_document', topicId: 'top-ohm', title: 'Neu', spec: { content: [] } }] })).rejects.toThrow(/nur update_document/);

    await service.executeBatch(session, {
      operations: [{ op: 'update_document', moduleId: 'mod-doc-1', spec: { content: [{ type: 'task', title: 'Aufgabe', blocks: [{ type: 'image', src: ref }] }] } }],
    });
    expect(modules[0].content.spec.content[0].blocks[0].src).toBe(PNG);

    await expect(service.executeBatch(session, {
      operations: [{ op: 'update_document', moduleId: 'mod-doc-1', spec: { content: [{ type: 'image', src: 'lm-img:000000000000' }] } }],
    })).rejects.toThrow(/Unbekannte Bild-Verweise lm-img:000000000000/);
  });

  it('fremde Dokumente lassen sich nicht neu aufbereiten', async () => {
    topics.push({ id: 'top-fremd', ownerId: 'other', title: 'Fremd', modules: [] });
    modules.push({ id: 'mod-fremd', topicId: 'top-fremd', type: 'document', title: 'Fremd', content: { spec: { content: [] } } });
    await expect(service.createSession(user, { regenerateModuleIds: ['mod-fremd'] })).rejects.toThrow(/Nur eigene/);
  });

  it('nur lesen: die KI ändert nichts, die Lehrkraft kann Vorschläge selbst ausführen – nur im freigegebenen Bereich', async () => {
    const { token, session: info, prompt } = await service.createSession(user, { notebookNodeIds: ['book-et'], planNodeIds: [], permissions: { organize: false, writeDocs: false } });
    expect(prompt).toContain('Nur lesen');
    const op = { op: 'rename_notebook_node', id: 'sec-et-1', title: 'Vorschlag' } as const;
    await expect(service.executeBatch(await service.authenticateToken(token), { operations: [op] })).rejects.toThrow(/organize/);
    await service.executeBatchByTeacher(user, info.id, { operations: [op] });
    expect(nbNodes.find((n) => n.id === 'sec-et-1').title).toBe('Vorschlag');
    await expect(service.executeBatchByTeacher(user, info.id, { operations: [{ op: 'rename_notebook_node', id: 'book-other', title: 'x' }] })).rejects.toThrow(/nicht freigegeben/);
  });
});
