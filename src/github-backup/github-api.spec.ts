import { gitBlobSha, GithubRepo } from './github-api';
import { INDEX_PATH, parseDocIndex, parseIndex, planBackup, BackupTopic } from './backup-plan';

/**
 * Ein GitHub im Kleinen: genug von der REST-API, um einen Backup-Lauf samt
 * Einrichten, Commit und Lesen alter Stände durchzuspielen.
 */
class FakeGithub {
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  ref: string | null = null;
  calls: string[] = [];
  private n = 0;

  private id() {
    return (++this.n).toString(16).padStart(40, '0');
  }

  private addCommit(files: Map<string, string>, message: string, parents: string[]) {
    const tree = this.id();
    this.trees.set(tree, files);
    const sha = this.id();
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  fetch = async (url: string, init: any): Promise<Response> => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/lehrer\/backup/, ''));
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push(`${method} ${path}`);
    const json = (status: number, data: any) =>
      new Response(JSON.stringify(data), { status, headers: { 'github-authentication-token-expiration': '2026-11-30 12:00:00 UTC' } });

    if (method === 'GET' && path === '') return json(200, { full_name: 'lehrer/backup', private: true, permissions: { push: true }, default_branch: 'main' });
    if (method === 'GET' && path === '/git/ref/heads/main') {
      return this.ref ? json(200, { object: { sha: this.ref } }) : json(409, { message: 'Git Repository is empty.' });
    }
    if (method === 'PUT' && path.startsWith('/contents/')) {
      const content = Buffer.from(body.content, 'base64');
      this.blobs.set(gitBlobSha(content), content);
      this.ref = this.addCommit(new Map([[path.slice('/contents/'.length), gitBlobSha(content)]]), body.message, []);
      return json(201, {});
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) return json(200, { tree: { sha: this.commits.get(path.split('/').pop()!)!.tree } });
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const files = this.trees.get(path.split('/').pop()!)!;
      return json(200, { tree: [...files].map(([p, sha]) => ({ path: p, sha, type: 'blob' })) });
    }
    if (method === 'POST' && path === '/git/blobs') {
      const content = Buffer.from(body.content, 'base64');
      const sha = gitBlobSha(content);
      this.blobs.set(sha, content);
      return json(201, { sha });
    }
    if (method === 'POST' && path === '/git/trees') {
      const files = new Map(this.trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) files.delete(e.path);
        else files.set(e.path, e.sha);
      }
      const sha = this.id();
      this.trees.set(sha, files);
      return json(201, { sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = this.id();
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return json(201, { sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      const commit = this.commits.get(body.sha)!;
      if (!commit.parents.includes(this.ref!)) return json(422, { message: 'Update is not a fast forward' });
      this.ref = body.sha;
      return json(200, {});
    }
    if (method === 'GET' && path.startsWith('/contents/')) {
      const file = path.slice('/contents/'.length);
      const ref = u.searchParams.get('ref')!;
      const commit = this.commits.get(ref === 'main' ? this.ref! : ref);
      const sha = commit && this.trees.get(commit.tree)!.get(file);
      return sha ? new Response(new Uint8Array(this.blobs.get(sha)!), { status: 200 }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && path === '/commits') {
      const file = u.searchParams.get('path')!;
      const out: any[] = [];
      for (let sha = this.ref; sha; sha = this.commits.get(sha)!.parents[0] || null) {
        const c = this.commits.get(sha)!;
        const parent = c.parents[0] && this.commits.get(c.parents[0]);
        const before = parent ? this.trees.get(parent.tree)!.get(file) : undefined;
        const now = this.trees.get(c.tree)!.get(file);
        if (now && now !== before) out.push({ sha, commit: { message: c.message, committer: { date: '2026-10-16T10:00:00Z' } } });
      }
      return json(200, out);
    }
    return json(404, { message: `unbekannt: ${method} ${path}` });
  };
}

async function backup(gh: GithubRepo, topics: BackupTopic[]) {
  const head = (await gh.head()) || (await gh.initialize('README.md', '# Backup\n', 'eingerichtet'));
  const tree = await gh.tree(head.treeSha);
  const indexText = tree.some((e) => e.path === INDEX_PATH) ? await gh.read(INDEX_PATH, head.commitSha) : null;
  const plan = planBackup(tree, topics, parseIndex(indexText), parseDocIndex(indexText));
  return plan.files.length || plan.remove.length ? gh.commit(head, plan.files, 'Backup', plan.remove) : null;
}

describe('GithubRepo gegen ein nachgebautes GitHub', () => {
  let fake: FakeGithub;
  const realFetch = global.fetch;

  beforeEach(() => {
    fake = new FakeGithub();
    global.fetch = fake.fetch as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('richtet ein leeres Repository ein, sichert in einem Commit und liest alte Stände', async () => {
    const gh = new GithubRepo('lehrer/backup', 'github_pat_test');
    const v1 = [{ id: 't1', title: 'Mathe', content: '{"v":1}\n', modules: 2 }];

    const first = await backup(gh, v1);
    expect(first).not.toBeNull();
    expect(fake.calls.filter((c) => c === 'PATCH /git/refs/heads/main')).toHaveLength(1);
    expect(gh.tokenExpiresAt?.toISOString()).toBe('2026-11-30T12:00:00.000Z');

    // Unverändert: kein weiterer Commit.
    fake.calls = [];
    expect(await backup(gh, v1)).toBeNull();
    expect(fake.calls.some((c) => c.startsWith('POST'))).toBe(false);

    // Geändert: neuer Commit, alter Stand bleibt lesbar.
    await backup(gh, [{ ...v1[0], content: '{"v":2}\n' }]);
    expect(await gh.read('themen/Mathe--t1.json')).toBe('{"v":2}\n');
    const history = await gh.history('themen/Mathe--t1.json');
    expect(history).toHaveLength(2);
    expect(await gh.read('themen/Mathe--t1.json', history[1].sha)).toBe('{"v":1}\n');
    expect(await gh.read('themen/gibt-es-nicht--x.json')).toBeNull();
  });

  it('legt Dokumente als .zlm im Notizbuch ab und zieht sie beim Verschieben um', async () => {
    const gh = new GithubRepo('lehrer/backup', 'github_pat_test');
    const zlm = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
    const t = (folder: string[]) => [{ id: 't1', title: 'Brüche', content: '{}\n', modules: 1, folder, documents: [{ id: 'd1', title: 'AB 1', bytes: zlm }] }];

    await backup(gh, t(['Mathe', 'Brüche']));
    const files = async () => [...fake.trees.get(fake.commits.get(fake.ref!)!.tree)!.keys()].sort();
    expect(await files()).toContain('Notizbuch/Mathe/Brüche/AB 1.zlm');
    expect(fake.blobs.get(gitBlobSha(zlm))).toEqual(zlm);

    expect(await backup(gh, t(['Mathe', 'Brüche']))).toBeNull();

    await backup(gh, t(['Mathe', 'Klasse 6', 'Brüche']));
    expect(await files()).toContain('Notizbuch/Mathe/Klasse 6/Brüche/AB 1.zlm');
    expect(await files()).not.toContain('Notizbuch/Mathe/Brüche/AB 1.zlm');
  });

  it('überschreibt keine Commits, die zwischendurch dazukamen', async () => {
    const gh = new GithubRepo('lehrer/backup', 'github_pat_test');
    await backup(gh, [{ id: 't1', title: 'Mathe', content: '1', modules: 1 }]);
    const head = (await gh.head())!;
    // Jemand committet direkt auf GitHub …
    await backup(gh, [{ id: 't1', title: 'Mathe', content: '2', modules: 1 }]);
    // … dann versucht ein Lauf mit dem veralteten Stand zu schreiben.
    await expect(gh.commit(head, [{ path: 'themen/Mathe--t1.json', content: '3' }], 'Backup')).rejects.toThrow(/anderweitig geändert/);
  });

  it('übersetzt typische Fehler', async () => {
    global.fetch = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as any;
    await expect(new GithubRepo('lehrer/backup', 'x').info()).rejects.toThrow(/Token ist ungültig oder abgelaufen/);
    global.fetch = (async () => new Response('{"message":"Not Found"}', { status: 404 })) as any;
    await expect(new GithubRepo('lehrer/backup', 'x').info()).rejects.toThrow(/Repository nicht gefunden/);
  });
});
