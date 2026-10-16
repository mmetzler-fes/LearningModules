import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Schlanker Zugriff auf ein GitHub-Repository über die REST-API – nur das,
 * was das Backup braucht. Gearbeitet wird mit der Git-Data-API, damit ein
 * Lauf genau einen Commit erzeugt, egal wie viele Dateien sich ändern.
 */

const API = 'https://api.github.com';

/** SHA, unter dem Git den Inhalt als Blob ablegt – damit vergleicht die App ohne Download. */
export function gitBlobSha(content: Buffer | string) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** "besitzer/repo" – auch aus einer kopierten Adresse (https://github.com/besitzer/repo(.git)). */
export function parseRepo(input: string): string | null {
  const s = String(input || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(s) ? s : null;
}

/**
 * Ablauf aus dem Kopf `github-authentication-token-expiration`, etwa
 * "2026-11-30 12:00:00 UTC" oder "2026-11-30 12:00:00 +0100".
 */
export function parseTokenExpiry(header: string | null): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/.exec(String(header || '').trim());
  if (!m) return null;
  const zone = m[3] === 'UTC' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${zone}`);
  return isNaN(d.getTime()) ? null : d;
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: string;
}

export interface Head {
  branch: string;
  commitSha: string;
  treeSha: string;
}

export class GithubRepo {
  /** Zuletzt gemeldeter Ablauf des Tokens (siehe parseTokenExpiry). */
  tokenExpiresAt: Date | null = null;
  private branchName: string | null = null;

  constructor(
    readonly repo: string,
    private readonly token: string,
  ) {}

  private async call(method: string, path: string, body?: any, accept = 'application/vnd.github+json') {
    let res: Response;
    try {
      res = await fetch(`${API}/repos/${this.repo}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'LearningModules-Backup',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(2 * 60 * 1000),
      });
    } catch (err: any) {
      const code = err?.cause?.code || err?.name || err?.message;
      throw new BadRequestException(`GitHub ist nicht erreichbar (${code}).`);
    }
    const expiry = parseTokenExpiry(res.headers.get('github-authentication-token-expiration'));
    if (expiry) this.tokenExpiresAt = expiry;
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    let detail = '';
    try {
      detail = String((await res.json())?.message || '');
    } catch {
      /* kein JSON */
    }
    const reasons: Record<number, string> = {
      401: 'der Token ist ungültig oder abgelaufen',
      403: /rate limit/i.test(detail)
        ? 'zu viele Anfragen – GitHub bremst gerade, später erneut versuchen'
        : 'der Token darf das nicht – er braucht für dieses Repository „Contents: Read and write“',
      404: 'Repository nicht gefunden – Name prüfen und ob der Token Zugriff auf genau dieses Repository hat',
    };
    throw new BadRequestException(`${what}: ${reasons[res.status] || `HTTP ${res.status}${detail ? ` (${detail})` : ''}`}.`);
  }

  private async json(method: string, path: string, what: string, body?: any) {
    const res = await this.call(method, path, body);
    if (!res.ok) await this.fail(res, what);
    return res.json();
  }

  /** Eigenschaften des Repositorys: privat? Schreibrecht? Standard-Branch. */
  async info() {
    const r = await this.json('GET', '', 'Repository nicht lesbar');
    this.branchName = r.default_branch || 'main';
    return {
      fullName: String(r.full_name || this.repo),
      private: !!r.private,
      canPush: r.permissions ? !!r.permissions.push : null,
      branch: this.branchName as string,
    };
  }

  private async branch() {
    if (!this.branchName) await this.info();
    return this.branchName as string;
  }

  /** Aktueller Stand des Standard-Branches – null bei einem leeren Repository. */
  async head(): Promise<Head | null> {
    const branch = await this.branch();
    const res = await this.call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
    // Leeres Repository: 409 ("Git Repository is empty"), mitunter 404.
    if (res.status === 409 || res.status === 404) return null;
    if (!res.ok) await this.fail(res, 'Branch nicht lesbar');
    const commitSha = (await res.json()).object.sha;
    const commit = await this.json('GET', `/git/commits/${commitSha}`, 'Commit nicht lesbar');
    return { branch, commitSha, treeSha: commit.tree.sha };
  }

  /**
   * Ein leeres Repository mit einer ersten Datei anlegen – die Git-Data-API
   * arbeitet erst, wenn es einen Commit gibt.
   */
  async initialize(path: string, content: string, message: string) {
    await this.json('PUT', `/contents/${encodePath(path)}`, 'Repository konnte nicht eingerichtet werden', {
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
    });
    const head = await this.head();
    if (!head) throw new BadRequestException('Das Repository bleibt nach dem Einrichten leer.');
    return head;
  }

  async tree(treeSha: string): Promise<TreeEntry[]> {
    const t = await this.json('GET', `/git/trees/${treeSha}?recursive=1`, 'Dateiliste nicht lesbar');
    return (t.tree || []).filter((e: any) => e.type === 'blob').map((e: any) => ({ path: e.path, sha: e.sha, type: e.type }));
  }

  /** Dateien schreiben (Inhalt) in einem Commit auf den Branch. */
  async commit(head: Head, files: Array<{ path: string; content: string }>, message: string) {
    const entries: any[] = [];
    for (const f of files) {
      const blob = await this.json('POST', '/git/blobs', 'Datei konnte nicht hochgeladen werden', {
        content: Buffer.from(f.content, 'utf-8').toString('base64'),
        encoding: 'base64',
      });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await this.json('POST', '/git/trees', 'Dateibaum konnte nicht angelegt werden', { base_tree: head.treeSha, tree: entries });
    const commit = await this.json('POST', '/git/commits', 'Commit konnte nicht angelegt werden', {
      message,
      tree: tree.sha,
      parents: [head.commitSha],
    });
    // Kein force: Hat sich der Branch inzwischen bewegt, scheitert das hier,
    // statt fremde Commits zu überschreiben.
    const res = await this.call('PATCH', `/git/refs/heads/${encodeURIComponent(head.branch)}`, { sha: commit.sha, force: false });
    if (res.status === 422) {
      throw new BadRequestException('Das Repository wurde während des Backups anderweitig geändert – beim nächsten Versuch klappt es.');
    }
    if (!res.ok) await this.fail(res, 'Branch konnte nicht aktualisiert werden');
    return commit.sha as string;
  }

  /** Commits, die eine Datei geändert haben – neueste zuerst. */
  async history(path: string, limit = 50) {
    const branch = await this.branch();
    const list = await this.json(
      'GET',
      `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${limit}`,
      'Versionen nicht lesbar',
    );
    return (list || []).map((c: any) => ({
      sha: String(c.sha),
      date: c.commit?.committer?.date || c.commit?.author?.date || null,
      message: String(c.commit?.message || '').split('\n')[0],
    }));
  }

  /** Inhalt einer Datei, wahlweise aus einem bestimmten Commit. Null, wenn es sie nicht gibt. */
  async read(path: string, ref?: string): Promise<string | null> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : `?ref=${encodeURIComponent(await this.branch())}`;
    // "raw" liefert auch Dateien über 1 MB, die als JSON-Antwort fehlen würden.
    const res = await this.call('GET', `/contents/${encodePath(path)}${q}`, undefined, 'application/vnd.github.raw+json');
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, 'Datei nicht lesbar');
    return res.text();
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}
