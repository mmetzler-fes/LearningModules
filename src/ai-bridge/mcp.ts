/**
 * MCP-Server der KI-Schnittstelle (Model Context Protocol, „Streamable HTTP“ ohne Sitzung):
 * JSON-RPC 2.0 per POST, Antwort als JSON. Die Werkzeuge sind dieselben Operationen wie unter
 * /api/ai-bridge – gleiche Rechte, gleicher Bereich, jeder `run_operations`-Aufruf ein Lauf zum
 * Annehmen oder Ablehnen (ai-bridge.service.ts). Ohne Datenbank und ohne HTTP prüfbar (mcp.spec.ts).
 *
 * Verbinden geht auch, solange der dauerhafte Zugang ausgeschaltet ist (initialize, tools/list);
 * die Werkzeuge melden dann „ausgeschaltet“ – so kann die KI die Lehrkraft darum bitten.
 */

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpBridge {
  /** Prüft Token und Ablauf; wirft mit verständlicher Meldung. */
  authenticate(): Promise<any>;
  overview(session: any): Promise<any>;
  tree(session: any): Promise<any>;
  topic(session: any, topicId: string): Promise<any>;
  document(session: any, moduleId: string): Promise<any>;
  docSpecReference(): any;
  quizReference(types: string): any;
  run(session: any, operations: any[], dryRun: boolean): Promise<any>;
  /** 💬 Feedback zur App – nur für Admin-Konten (sonst wirft es mit Begründung). */
  feedbackList?(session: any): Promise<any>;
  feedbackImage?(session: any, id: string): Promise<{ type: string; data: Buffer }>;
  feedbackUpdate?(session: any, id: string, patch: { priority?: number; status?: string; adminNote?: string }): Promise<any>;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const str = (description: string) => ({ type: 'string', description });

export const MCP_TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, any> }> = [
  {
    name: 'get_overview',
    description: 'Zuerst aufrufen: Rechte, freigegebener Bereich (Books, Bereiche, Abschnitte, Lernthemen mit IDs), alle Operationen mit Beispielen und Hinweise zu Formaten.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_tree',
    description: 'Aktuelle Struktur des freigegebenen Bereichs (Lernnotizbuch und Planung) mit IDs – nach Änderungen zum Nachprüfen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_topic',
    description: 'Ein Lernthema mit allen Modulen (Dokumente, Quizze) samt Inhalt. Bilder erscheinen als lm-img:-Verweise – beim Zurückschreiben unverändert lassen. "pending": true = eigener, noch nicht angenommener Entwurf.',
    inputSchema: { type: 'object', properties: { topicId: str('ID des Lernthemas') }, required: ['topicId'], additionalProperties: false },
  },
  {
    name: 'get_document',
    description: 'Ein Dokument (Arbeitsblatt) als DocSpec – vor update_document lesen.',
    inputSchema: { type: 'object', properties: { moduleId: str('ID des Dokuments') }, required: ['moduleId'], additionalProperties: false },
  },
  {
    name: 'get_docspec_reference',
    description: 'Vollständiges Format der Arbeitsblätter (DocSpec) – nur bei Bedarf.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_quiz_reference',
    description: 'Format der Quiz-Typen (Markdown), nur die genannten, z. B. "multipleChoice,trueFalse".',
    inputSchema: { type: 'object', properties: { types: str('Komma-getrennte Quiz-Typen') }, required: ['types'], additionalProperties: false },
  },
  {
    name: 'run_operations',
    description: 'Änderungen ausführen: {"operations": [{"op": …}, …]} – die Operationen nennt get_overview. Mit "dryRun": true nur prüfen. '
      + 'Symbolische Verweise ("ref": "$t1", später "topicId": "$t1") gelten innerhalb eines Aufrufs. Ein Dokument je Lernthema. '
      + 'Jeder Aufruf ist für die Lehrkraft eine Änderung zum Annehmen oder Ablehnen – zusammengehörige Schritte deshalb in einen Aufruf.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: { type: 'array', items: { type: 'object', properties: { op: str('Name der Operation') }, required: ['op'] }, description: 'Schritte in Reihenfolge' },
        dryRun: { type: 'boolean', description: 'Nur prüfen, nichts ändern' },
      },
      required: ['operations'],
      additionalProperties: false,
    },
  },
];

MCP_TOOLS.push(
  {
    name: 'get_feedback',
    description: 'Nur Admin: Rückmeldungen zur App (💬 Feedback) – offene zuerst, nach Priorität. Namen gekürzt (Klasse · Vorname N.). "hasImage": Bereichsfoto mit get_feedback_image ansehen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_feedback_image',
    description: 'Nur Admin: das Bereichsfoto einer Rückmeldung als Bild.',
    inputSchema: { type: 'object', properties: { id: str('ID der Rückmeldung') }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'update_feedback',
    description: 'Nur Admin: Rückmeldung ordnen oder erledigen – priority 0–3, status "open" | "done", adminNote (was getan wurde). Löschen nur in der App.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('ID der Rückmeldung'),
        priority: { type: 'number', description: '0 (keine) bis 3 (hoch)' },
        status: { type: 'string', enum: ['open', 'done'] },
        adminNote: str('Notiz, z. B. was geändert wurde (Commit)'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
);

export const MCP_INSTRUCTIONS = [
  'LearningModules: Lernnotizbuch einer Lehrkraft (Books › Bereiche › Abschnitte › Lernthemen mit je einem Dokument und Quizzen) und ihre Planung.',
  'Ablauf: 1. get_overview. 2. Lesen (get_topic, get_document, Formate nur bei Bedarf). 3. run_operations, bei Unsicherheit erst mit dryRun. 4. Mit get_tree bzw. get_topic nachprüfen.',
  'Nie Schülerdaten. Änderungen sind vorläufig, bis die Lehrkraft sie annimmt; was Schüler sehen, wird ein Entwurf. Meldet ein Werkzeug „ausgeschaltet“, bitte die Lehrkraft, den KI-Zugang in LearningModules einzuschalten.',
].join('\n');

const text = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });

/** Eine Nachricht beantworten; `null` bei Benachrichtigungen (ohne `id`). */
export async function handleMcp(msg: Rpc, bridge: McpBridge, server = { name: 'LearningModules', version: '1.0.0' }): Promise<any | null> {
  const id = msg?.id ?? null;
  const ok = (result: any) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Ungültige JSON-RPC-Anfrage');
  const notification = msg.id === undefined;

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion || '');
      return ok({
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: server,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: MCP_TOOLS });
    case 'tools/call': {
      const name = String(msg.params?.name || '');
      const args = msg.params?.arguments || {};
      if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unbekanntes Werkzeug „${name}“`);
      try {
        const session = await bridge.authenticate();
        switch (name) {
          case 'get_overview': return ok(text(await bridge.overview(session)));
          case 'get_tree': return ok(text(await bridge.tree(session)));
          case 'get_topic': return ok(text(await bridge.topic(session, String(args.topicId || ''))));
          case 'get_document': return ok(text(await bridge.document(session, String(args.moduleId || ''))));
          case 'get_docspec_reference': return ok(text(bridge.docSpecReference()));
          case 'get_quiz_reference': return ok(text(bridge.quizReference(String(args.types || ''))));
          case 'get_feedback':
            if (!bridge.feedbackList) break;
            return ok(text(await bridge.feedbackList(session)));
          case 'get_feedback_image': {
            if (!bridge.feedbackImage) break;
            const img = await bridge.feedbackImage(session, String(args.id || ''));
            return ok({ content: [{ type: 'image', data: img.data.toString('base64'), mimeType: img.type }] });
          }
          case 'update_feedback':
            if (!bridge.feedbackUpdate) break;
            return ok(text(await bridge.feedbackUpdate(session, String(args.id || ''), { priority: args.priority, status: args.status, adminNote: args.adminNote })));
          case 'run_operations': {
            if (!Array.isArray(args.operations)) return ok({ ...text('operations fehlt (Liste von Schritten).'), isError: true });
            return ok(text(await bridge.run(session, args.operations, !!args.dryRun)));
          }
        }
        return fail(-32602, `Unbekanntes Werkzeug „${name}“`);
      } catch (err: any) {
        // Fehler der App (Rechte, Format, ausgeschaltet) als Werkzeug-Ergebnis – die KI soll sie lesen.
        const detail = err?.response?.message ?? err?.message ?? 'Fehler';
        return ok({ ...text(Array.isArray(detail) ? detail.join(' · ') : String(detail)), isError: true });
      }
    }
    default:
      if (notification || msg.method.startsWith('notifications/')) return null;
      return fail(-32601, `Methode „${msg.method}“ gibt es hier nicht`);
  }
}
