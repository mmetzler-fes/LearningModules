import { UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { handleMcp, MCP_TOOLS, McpBridge } from './mcp';

function bridge(over: Partial<McpBridge> = {}): McpBridge & { ran: any[] } {
  const ran: any[] = [];
  return {
    ran,
    authenticate: async () => ({ id: 's1' }),
    overview: async () => ({ permissions: { organize: true } }),
    tree: async () => ({ notebook: { nodes: [] } }),
    topic: async (_s, id) => ({ id, modules: [] }),
    document: async (_s, id) => ({ id, spec: { content: [] } }),
    docSpecReference: () => ({ blocks: [] }),
    quizReference: (types) => `# ${types}`,
    run: async (_s, operations, dryRun) => { ran.push({ operations, dryRun }); return { ok: true, dryRun, count: operations.length }; },
    ...over,
  };
}
const call = (name: string, args: any = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

describe('MCP-Server der KI-Schnittstelle', () => {
  it('initialize: Version wie angefragt (sonst die neueste), Werkzeuge, Anleitung', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, bridge());
    expect(r.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'LearningModules' } });
    expect(r.result.instructions).toMatch(/get_overview/);
    expect((await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, bridge())).result.protocolVersion).toBe('2025-06-18');
  });

  it('Benachrichtigungen ohne Antwort, ping, unbekannte Methode', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, bridge())).toBeNull();
    expect((await handleMcp({ jsonrpc: '2.0', id: 3, method: 'ping' }, bridge())).result).toEqual({});
    expect((await handleMcp({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, bridge())).error.code).toBe(-32601);
    expect((await handleMcp({ id: 5 } as any, bridge())).error.code).toBe(-32600);
  });

  it('tools/list nennt alle Werkzeuge mit Schema', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge());
    expect(r.result.tools.map((t: any) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    for (const t of r.result.tools) expect(t.inputSchema.type).toBe('object');
  });

  it('Werkzeuge liefern Text; run_operations führt aus (auch als Probelauf)', async () => {
    const b = bridge();
    const topic = await handleMcp(call('get_topic', { topicId: 't1' }), b);
    expect(JSON.parse(topic.result.content[0].text)).toEqual({ id: 't1', modules: [] });
    expect((await handleMcp(call('get_quiz_reference', { types: 'trueFalse' }), b)).result.content[0].text).toBe('# trueFalse');
    const ops = [{ op: 'rename_topic', topicId: 't1', title: 'x' }];
    const res = await handleMcp(call('run_operations', { operations: ops, dryRun: true }), b);
    expect(res.result.isError).toBeUndefined();
    expect(b.ran).toEqual([{ operations: ops, dryRun: true }]);
    expect((await handleMcp(call('run_operations', {}), b)).result.isError).toBe(true);
    expect((await handleMcp(call('gibtsnicht'), b)).error.code).toBe(-32602);
  });

  it('Fehler der App kommen als Werkzeug-Ergebnis an – etwa „ausgeschaltet“', async () => {
    const off = bridge({ authenticate: async () => { throw new UnauthorizedException('Der KI-Zugang ist gerade ausgeschaltet.'); } });
    const r = await handleMcp(call('get_tree'), off);
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'Der KI-Zugang ist gerade ausgeschaltet.' }], isError: true });
    // Verbinden geht trotzdem
    expect((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, off)).result.tools.length).toBe(MCP_TOOLS.length);
    const bad = bridge({ run: async () => { throw new BadRequestException('operations[0]: Feld "op" fehlt.'); } });
    expect((await handleMcp(call('run_operations', { operations: [{}] }), bad)).result.content[0].text).toMatch(/Feld "op" fehlt/);
  });

  it('Feedback-Werkzeuge: Liste, Bereichsfoto als Bild, Status setzen; ohne Admin eine Meldung', async () => {
    const updates: any[] = [];
    const admin = bridge({
      feedbackList: async () => [{ id: 'f1', text: 'Knopf fehlt', hasImage: true }],
      feedbackImage: async () => ({ type: 'image/png', data: Buffer.from('PNG') }),
      feedbackUpdate: async (_s, id, patch) => { updates.push({ id, ...patch }); return { success: true }; },
    });
    expect((await handleMcp(call('get_feedback'), admin)).result.content[0].text).toMatch(/Knopf fehlt/);
    expect((await handleMcp(call('get_feedback_image', { id: 'f1' }), admin)).result.content[0])
      .toEqual({ type: 'image', data: Buffer.from('PNG').toString('base64'), mimeType: 'image/png' });
    await handleMcp(call('update_feedback', { id: 'f1', status: 'done', priority: 2, adminNote: 'behoben' }), admin);
    expect(updates).toEqual([{ id: 'f1', status: 'done', priority: 2, adminNote: 'behoben' }]);
    const teacher = bridge({ feedbackList: async () => { throw new ForbiddenException('Nur Admins haben Zugriff.'); } });
    expect((await handleMcp(call('get_feedback'), teacher)).result).toMatchObject({ isError: true, content: [{ text: 'Nur Admins haben Zugriff.' }] });
  });
});
