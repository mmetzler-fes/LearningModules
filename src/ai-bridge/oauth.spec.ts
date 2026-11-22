import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import * as crypto from "crypto";
import { OAuthService } from "./oauth.service";
import { OAuthController } from "./oauth.controller";
import { McpController } from "./ai-bridge.controller";
import { repo } from "../work/test-repo";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

describe("OAuth 2.0 & MCP-Server Integration (RFC 8414, RFC 7591, PKCE)", () => {
  const userId = "teacher-42";
  let clientRows: any[];
  let connRows: any[];
  let sessionRows: any[];
  let userRows: any[];

  let clientRepo: any;
  let connRepo: any;
  let sessionRepo: any;
  let userRepo: any;

  let bridgeMock: any;
  let authMock: any;
  let jwtMock: any;
  let oauthService: OAuthService;
  let oauthController: OAuthController;
  let mcpController: McpController;

  beforeEach(() => {
    clientRows = [];
    connRows = [];
    sessionRows = [
      {
        id: "sess-1",
        userId,
        tokenHash: sha256("lma_testtoken"),
        tokenPreview: "lma_test…oken",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000), // eingeschaltet
        scope: { notebookNodeIds: ["*"], planNodeIds: ["*"], includeUnsorted: true, permissions: { organize: true, writeDocs: true } },
        undoStack: [],
        log: [],
        purpose: null,
        persistent: true,
        runs: [],
      },
    ];
    userRows = [
      { id: userId, email: "lehrer@schule.de", role: "teacher", active: true },
    ];

    clientRepo = repo(clientRows);
    connRepo = repo(connRows);
    sessionRepo = repo(sessionRows);
    userRepo = repo(userRows);

    bridgeMock = {
      fromRow: (r: any) => ({
        id: r.id,
        userId: r.userId,
        createdAt: new Date(r.createdAt).getTime(),
        expiresAt: new Date(r.expiresAt).getTime(),
        scope: r.scope,
        undoStack: r.undoStack || [],
        log: r.log || [],
        purpose: r.purpose || null,
        persistent: !!r.persistent,
        runs: r.runs || [],
      }),
      sessionOfToken: async (t: string) => {
        const cleaned = String(t || "").replace(/^Bearer\s+/i, "").trim();
        const r = sessionRows.find((s) => s.tokenHash === sha256(cleaned));
        return r ? bridgeMock.fromRow(r) : null;
      },
      authenticateToken: async (t: string, pre?: any) => {
        if (pre) {
          if (pre.expiresAt <= Date.now()) {
            throw new UnauthorizedException("Der KI-Zugang ist gerade ausgeschaltet. Bitte in LearningModules unter 🤖 KI-Assistent einschalten und dann erneut versuchen.");
          }
          return pre;
        }
        const s = await bridgeMock.sessionOfToken(t);
        if (!s) throw new UnauthorizedException("Ungültig");
        if (s.expiresAt <= Date.now()) throw new UnauthorizedException("ausgeschaltet");
        return s;
      },
      getOrCreatePersistentSession: async (uid: string) => {
        const r = sessionRows.find((s) => s.userId === uid && s.persistent);
        if (r) return bridgeMock.fromRow(r);
        const created = {
          id: "sess-created",
          userId: uid,
          tokenHash: sha256("lma_newtoken"),
          tokenPreview: "lma_new…oken",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
          scope: { notebookNodeIds: ["*"], planNodeIds: ["*"], includeUnsorted: true, permissions: { organize: true, writeDocs: true } },
          undoStack: [],
          log: [],
          purpose: null,
          persistent: true,
          runs: [],
        };
        sessionRows.push(created);
        return bridgeMock.fromRow(created);
      },
      getInstructionsForAi: async () => ({ instructions: "Anleitung" }),
      scopedTree: async () => ({ notebook: { nodes: [] } }),
      getScopedTopic: async () => ({ id: "t1" }),
      getScopedDocument: async () => ({ id: "d1" }),
      getDocSpecReference: () => ({ blocks: [] }),
      getQuizReference: () => "# quiz",
      executeBatch: async () => ({ count: 1, ok: true }),
    };

    authMock = {
      login: async (email: string, pass: string) => {
        if (email === "lehrer@schule.de" && pass === "geheim123") {
          return { user: { id: userId, email } };
        }
        return null;
      },
    };

    jwtMock = {
      verify: (token: string) => {
        if (token === "valid_jwt") return { sub: userId };
        throw new Error("Invalid token");
      },
    };

    oauthService = new OAuthService(
      clientRepo as any,
      connRepo as any,
      sessionRepo as any,
      userRepo as any,
      bridgeMock,
      authMock,
      jwtMock,
    );

    oauthController = new OAuthController(oauthService);
    mcpController = new McpController(bridgeMock, oauthService);
  });

  // ---- 1. Discovery Metadata ----
  describe("OAuth Discovery (RFC 8414)", () => {
    it("liefert alle Pflichtfelder für OAuth 2.0 / MCP Clients", () => {
      const req: any = {
        headers: { host: "schule.example.com", "x-forwarded-proto": "https" },
      };
      const meta = oauthController.getMetadata(req);
      expect(meta.issuer).toBe("https://schule.example.com");
      expect(meta.authorization_endpoint).toBe("https://schule.example.com/oauth/authorize");
      expect(meta.token_endpoint).toBe("https://schule.example.com/oauth/token");
      expect(meta.registration_endpoint).toBe("https://schule.example.com/oauth/register");
      expect(meta.revocation_endpoint).toBe("https://schule.example.com/oauth/revoke");
      expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
      expect(meta.grant_types_supported).toContain("authorization_code");
      expect(meta.grant_types_supported).toContain("refresh_token");
      expect(meta.scopes_supported).toContain("mcp");
    });
  });

  // ---- 2. Dynamic Client Registration ----
  describe("Client-Registrierung (RFC 7591)", () => {
    it("registriert einen MCP-Client dynamisch", async () => {
      const reg = await oauthService.registerClient(
        { client_name: "Claude Desktop", redirect_uris: ["https://claude.ai/oauth/callback"] },
        "https://schule.example.com",
      );
      expect(reg.client_id).toMatch(/^lmc_/);
      expect(reg.client_secret).toMatch(/^lms_/);
      expect(reg.client_name).toBe("Claude Desktop");
      expect(reg.redirect_uris).toEqual(["https://claude.ai/oauth/callback"]);

      const found = await oauthService.findClient(reg.client_id);
      expect(found).not.toBeNull();
      expect(found!.clientName).toBe("Claude Desktop");
    });

    it("Anmeldeseite nur für registrierte KIs und ihre Rücksprung-Adresse", async () => {
      const reg = await oauthService.registerClient(
        { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://evil.example/cb", "http://localhost:3333/cb"] },
        "https://schule.example.com",
      );
      expect(reg.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback", "http://localhost:3333/cb"]);
      expect(await oauthService.checkedClient(reg.client_id, "https://claude.ai/api/mcp/auth_callback")).not.toBeNull();
      expect(await oauthService.checkedClient(reg.client_id, "https://angreifer.example/cb")).toBeNull();
      expect(await oauthService.checkedClient("claude", "https://angreifer.example/cb")).toBeNull();

      const page = (q: any) => {
        const out: any = { headers: {} as Record<string, string> };
        const res: any = {
          status: (s: number) => { out.status = s; return res; },
          setHeader: (k: string, v: string) => { out.headers[k] = v; return res; },
          send: (b: string) => { out.body = b; return res; },
        };
        return oauthController.authorizePage({ headers: {} } as any, res, q).then(() => out);
      };
      const bad = await page({ client_id: reg.client_id, redirect_uri: "https://angreifer.example/cb", state: "x" });
      expect(bad.status).toBe(400);
      const good = await page({ client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "x" });
      expect(good.body).toContain("claude.ai");
      expect(good.headers["X-Frame-Options"]).toBe("DENY");
      expect(oauthController.getProtectedResource({ headers: { host: "s.example", "x-forwarded-proto": "https" } } as any))
        .toMatchObject({ resource: "https://s.example/api/mcp", authorization_servers: ["https://s.example"] });
    });

    it("kennt Standard-Clients auch ohne explizite Registrierung", async () => {
      const claude = await oauthService.findClient("claude");
      expect(claude?.clientName).toBe("Claude.ai");

      const chatgpt = await oauthService.findClient("chatgpt");
      expect(chatgpt?.clientName).toBe("ChatGPT");
    });
  });

  // ---- 3. PKCE Authorization Code & Token Exchange ----
  describe("PKCE Authorization & Token Exchange", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = pkceChallenge(verifier);

    it("tauscht Authorization Code mit gültigem PKCE Code-Verifier gegen Access- & Refresh-Token", async () => {
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_claude",
        "Claude.ai",
        "https://claude.ai/oauth/callback",
        challenge,
        "S256",
      );

      expect(code).toMatch(/^lmc_code_/);

      const tokens = await oauthService.exchangeCode(
        "lmc_claude",
        code,
        "https://claude.ai/oauth/callback",
        verifier,
      );

      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.access_token).toMatch(/^lma_oauth_/);
      expect(tokens.refresh_token).toMatch(/^lmr_/);
      expect(tokens.expires_in).toBe(3600);

      // Verbindung in DB angelegt
      expect(connRows.length).toBe(1);
      expect(connRows[0].clientName).toBe("Claude.ai");
      expect(connRows[0].userId).toBe(userId);
      expect(connRows[0].sessionId).toBe("sess-1");

      // Code kann nicht noch einmal eingelöst werden (Replay Protection)
      await expect(
        oauthService.exchangeCode("lmc_claude", code, "https://claude.ai/oauth/callback", verifier),
      ).rejects.toThrow(BadRequestException);
    });

    it("lehnt falschen PKCE Code-Verifier ab", async () => {
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_test",
        "Test KI",
        "https://ki.example.com/cb",
        challenge,
        "S256",
      );

      await expect(
        oauthService.exchangeCode("lmc_test", code, "https://ki.example.com/cb", "falscher-verifier"),
      ).rejects.toThrow(BadRequestException);
    });

    it("lehnt ungültige oder abgelaufene Codes ab", async () => {
      await expect(
        oauthService.exchangeCode("lmc_test", "unbekannter_code", "https://cb.com", verifier),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- 4. Token Refresh ----
  describe("Token Refresh (grant_type=refresh_token)", () => {
    it("erneuert das Access-Token mit einem gültigen Refresh-Token", async () => {
      const verifier = "my-secret-verifier-for-test-suite";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_1",
        "Claude",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );

      const tokens1 = await oauthService.exchangeCode("lmc_1", code, "https://cb.com", verifier);
      const originalAccessToken = tokens1.access_token;
      const refreshToken = tokens1.refresh_token;

      // Token erneuern
      const tokens2 = await oauthService.refreshToken("lmc_1", refreshToken);
      expect(tokens2.access_token).toMatch(/^lma_oauth_/);
      expect(tokens2.access_token).not.toBe(originalAccessToken);
      expect(tokens2.expires_in).toBe(3600);

      // Altes Access-Token gilt nicht mehr
      const oldCheck = await oauthService.sessionOfToken(originalAccessToken);
      expect(oldCheck.session).toBeNull();

      // Neues Access-Token gilt
      const newCheck = await oauthService.sessionOfToken(tokens2.access_token);
      expect(newCheck.session).not.toBeNull();
      expect(newCheck.session?.id).toBe("sess-1");
    });

    it("lehnt ungültiges Refresh-Token ab", async () => {
      await expect(
        oauthService.refreshToken("lmc_1", "ungueltiges_refresh_token"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- 5. Revocation & Disconnect ----
  describe("Verbindung trennen & Token widerrufen", () => {
    it("listet aktive Verbindungen auf und trennt sie sofort", async () => {
      const verifier = "verifier-for-disconnect-test";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_c1",
        "Claude.ai",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );
      const tokens = await oauthService.exchangeCode("lmc_c1", code, "https://cb.com", verifier);

      // In Liste vorhanden
      const conns = await oauthService.listConnections(userId);
      expect(conns.length).toBe(1);
      expect(conns[0].clientName).toBe("Claude.ai");

      // Trennen
      const connId = conns[0].id;
      await oauthService.disconnect(userId, connId);

      // Jetzt nicht mehr in aktiver Liste
      const connsAfter = await oauthService.listConnections(userId);
      expect(connsAfter.length).toBe(0);

      // Access Token ungültig
      const check = await oauthService.sessionOfToken(tokens.access_token);
      expect(check.session).toBeNull();
    });

    it("RFC 7009: revokeToken macht Verbindung ungültig", async () => {
      const verifier = "verifier-for-rfc7009";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_c2",
        "ChatGPT",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );
      const tokens = await oauthService.exchangeCode("lmc_c2", code, "https://cb.com", verifier);

      await oauthService.revokeToken(tokens.access_token);

      const check = await oauthService.sessionOfToken(tokens.access_token);
      expect(check.session).toBeNull();
    });
  });

  // ---- 6. MCP Server Integration ----
  describe("MCP Controller mit OAuth Token", () => {
    it("lehnt Anfrage ohne Token mit 401 und OAuth Metadata Link ab", async () => {
      let status = 0;
      let headers: Record<string, string> = {};
      let jsonBody: any = null;

      const req: any = { headers: { host: "localhost:3000" } };
      const res: any = {
        status: (s: number) => { status = s; return res; },
        setHeader: (k: string, v: string) => { headers[k] = v; return res; },
        json: (b: any) => { jsonBody = b; return res; },
      };

      await (mcpController as any).serve(req, res, { jsonrpc: "2.0", id: 1, method: "tools/list" }, undefined);

      expect(status).toBe(401);
      expect(headers["WWW-Authenticate"]).toContain("resource_metadata=");
      expect(headers["WWW-Authenticate"]).toContain("/.well-known/oauth-protected-resource");
      expect(jsonBody.error.code).toBe(-32001);
    });

    it("beantwortet MCP Tool Calls mit gültigem OAuth Access Token", async () => {
      const verifier = "verifier-for-mcp-test";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_mcp",
        "Claude Desktop",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );
      const tokens = await oauthService.exchangeCode("lmc_mcp", code, "https://cb.com", verifier);

      let status = 0;
      let jsonBody: any = null;

      const req: any = { headers: { host: "localhost:3000", authorization: `Bearer ${tokens.access_token}` } };
      const res: any = {
        status: (s: number) => { status = s; return res; },
        setHeader: () => res,
        json: (b: any) => { jsonBody = b; return res; },
      };

      await (mcpController as any).serve(
        req,
        res,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        tokens.access_token,
      );

      expect(status).toBe(200);
      expect(jsonBody.result.tools).toBeDefined();
      expect(jsonBody.result.tools.length).toBeGreaterThan(0);
    });

    it("meldet 401 expired, wenn das OAuth Token abgelaufen ist", async () => {
      const verifier = "verifier-for-expired-test";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_exp",
        "Claude",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );
      const tokens = await oauthService.exchangeCode("lmc_exp", code, "https://cb.com", verifier);

      // Ablaufdatum in die Vergangenheit setzen
      connRows[0].accessTokenExpiresAt = new Date(Date.now() - 1000);

      let status = 0;
      let headers: Record<string, string> = {};
      let jsonBody: any = null;

      const req: any = { headers: { host: "localhost:3000" } };
      const res: any = {
        status: (s: number) => { status = s; return res; },
        setHeader: (k: string, v: string) => { headers[k] = v; return res; },
        json: (b: any) => { jsonBody = b; return res; },
      };

      await (mcpController as any).serve(req, res, { jsonrpc: "2.0", id: 1, method: "tools/list" }, tokens.access_token);

      expect(status).toBe(401);
      expect(headers["WWW-Authenticate"]).toContain("error=\"invalid_token\"");
      expect(headers["WWW-Authenticate"]).toContain("Access token expired");
      expect(jsonBody.error.message).toContain("abgelaufen");
    });

    it("meldet Fehler, wenn der dauerhafte Zugang der Lehrkraft ausgeschaltet ist", async () => {
      const verifier = "verifier-for-switched-off";
      const code = await oauthService.createAuthorizationCode(
        userId,
        "lmc_off",
        "Claude",
        "https://cb.com",
        pkceChallenge(verifier),
        "S256",
      );
      const tokens = await oauthService.exchangeCode("lmc_off", code, "https://cb.com", verifier);

      // Lehrkraft schaltet Zugang aus (expiresAt in Vergangenheit)
      sessionRows[0].expiresAt = new Date(Date.now() - 1000);

      let status = 0;
      let jsonBody: any = null;

      const req: any = { headers: { host: "localhost:3000" } };
      const res: any = {
        status: (s: number) => { status = s; return res; },
        setHeader: () => res,
        json: (b: any) => { jsonBody = b; return res; },
      };

      await (mcpController as any).serve(
        req,
        res,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_tree", arguments: {} } },
        tokens.access_token,
      );

      expect(status).toBe(200);
      expect(jsonBody.result.isError).toBe(true);
      expect(jsonBody.result.content[0].text).toContain("ausgeschaltet");
    });
  });
});
