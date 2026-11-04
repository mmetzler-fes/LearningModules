import * as crypto from 'crypto';

/** Regeln der HTML-Apps ohne Datenbank (docs/html-apps.md). */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_UNITS = 30;
export const MAX_STEPS = 500;

export const FRAME_PREFIX = '/api/html-app-frame/';

const ID = /^[a-z0-9-]{1,40}$/;
const KINDS = ['task', 'info'];

export interface AppStep {
  id: string;
  title: string;
  /** `task`: wird bewertet, `info`: zählt mit dem Ansehen. */
  kind: 'task' | 'info';
}

export interface AppUnit {
  id: string;
  title: string;
  steps: AppStep[];
}

export interface AppManifest {
  lmApp: 2;
  id: string;
  version: string;
  title: string;
  units: AppUnit[];
}

export const isHtmlAppType = (type: unknown) => type === 'htmlApp' || type === 'htmlAppUnit';

/** Abschnitt, den die App nicht mehr hat: im Baum ausgeblendet, seine Ergebnisse bleiben. */
export function isRemovedUnit(m: { type?: string; content?: any }): boolean {
  if (m?.type !== 'htmlAppUnit') return false;
  if (typeof m.content !== 'string') return !!m.content?.removed;
  try { return !!JSON.parse(m.content).removed; } catch { return false; }
}

/** Für den Shop: ohne HTML-Apps ohne Freigabe, samt ihren Abschnitten. */
export function withoutBlockedApps<T extends { id: string; type?: string; parentId?: string | null; content?: any }>(modules: T[]): T[] {
  const blocked = new Set(modules.filter((m) => {
    if (m.type !== 'htmlApp') return false;
    if (typeof m.content !== 'string') return !m.content?.shopAllowed;
    try { return !JSON.parse(m.content).shopAllowed; } catch { return true; }
  }).map((m) => m.id));
  return modules.filter((m) => !blocked.has(m.id) && !(m.parentId && blocked.has(m.parentId)) && !(m.type === 'htmlAppUnit' && !m.parentId));
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Text des Steckbriefs prüfen. Bei `errors` gibt es keinen Steckbrief. */
export function readManifest(json: string): { manifest: AppManifest | null; errors: string[] } {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch (e: any) {
    return { manifest: null, errors: [`Der Steckbrief ist kein gültiges JSON: ${e.message}`] };
  }
  const errors: string[] = [];
  if (raw?.lmApp !== 2) errors.push('„lmApp“ muss 2 sein; ältere Apps müssen auf die Schrittschnittstelle umgebaut werden.');
  if (!ID.test(String(raw?.id ?? ''))) errors.push('„id“: nur a-z, 0-9 und -, höchstens 40 Zeichen.');
  if (!text(raw?.version, 40)) errors.push('„version“ fehlt.');
  if (!text(raw?.title, 200)) errors.push('„title“ fehlt.');
  const units = Array.isArray(raw?.units) ? raw.units : null;
  if (!units?.length) errors.push('„units“ braucht mindestens einen Abschnitt.');
  else if (units.length > MAX_UNITS) errors.push(`Höchstens ${MAX_UNITS} Abschnitte.`);
  const seenUnits = new Set<string>();
  const seenSteps = new Set<string>();
  (units || []).forEach((u: any, i: number) => {
    const where = `Abschnitt ${i + 1}`;
    if (!ID.test(String(u?.id ?? ''))) errors.push(`${where}: „id“ nur a-z, 0-9 und -, höchstens 40 Zeichen.`);
    else if (seenUnits.has(u.id)) errors.push(`${where}: „id“ „${u.id}“ kommt doppelt vor.`);
    seenUnits.add(u?.id);
    if (!text(u?.title, 200)) errors.push(`${where}: „title“ fehlt.`);
    if (!Array.isArray(u?.steps) || !u.steps.length) { errors.push(`${where}: „steps“ braucht mindestens einen Schritt.`); return; }
    u.steps.forEach((s: any, k: number) => {
      const at = `${where}, Schritt ${k + 1}`;
      if (!ID.test(String(s?.id ?? ''))) errors.push(`${at}: „id“ nur a-z, 0-9 und -, höchstens 40 Zeichen.`);
      else if (seenSteps.has(s.id)) errors.push(`${at}: „id“ „${s.id}“ kommt doppelt vor.`);
      seenSteps.add(s?.id);
      if (!text(s?.title, 200)) errors.push(`${at}: „title“ fehlt.`);
      if (!KINDS.includes(s?.kind)) errors.push(`${at}: „kind“ muss task oder info sein.`);
    });
  });
  if (seenSteps.size > MAX_STEPS) errors.push(`Höchstens ${MAX_STEPS} Schritte.`);
  if (errors.length) return { manifest: null, errors };
  return {
    errors: [],
    manifest: {
      lmApp: 2, id: raw.id, version: text(raw.version, 40), title: text(raw.title, 200),
      units: units.map((u: any) => ({
        id: u.id, title: text(u.title, 200),
        steps: u.steps.map((s: any) => ({ id: s.id, title: text(s.title, 200), kind: s.kind })),
      })),
    },
  };
}

/** Untermodule an den Steckbrief anpassen: Zuordnung über die `id` des Abschnitts. */
export function planUnits(manifest: AppManifest | null, kids: Array<{ id: string; content?: any }>) {
  const units = manifest?.units || [];
  const byUnit = new Map(kids.map((k) => [k.content?.unit, k]));
  return {
    create: units.map((u, order) => ({ unit: u, order })).filter(({ unit }) => !byUnit.has(unit.id)),
    update: units.map((u, order) => ({ unit: u, order, id: byUnit.get(u.id)?.id })).filter((x) => x.id) as Array<{ unit: AppUnit; order: number; id: string }>,
    remove: kids.filter((k) => !units.some((u) => u.id === k.content?.unit)).map((k) => k.id),
  };
}

// ---- Ausweise ------------------------------------------------------------
//
// Zwei Sorten mit getrennten Zwecken: Der `view`-Ausweis steht in der Adresse
// und ist der App sichtbar, er öffnet nur die Datei. Der `session`-Ausweis
// bleibt in der Hauptseite und trägt die Meldungen.

const SECRET = () => `${process.env.JWT_SECRET || 'secretKey'}:html-app`;
const sign = (payload: string) => crypto.createHmac('sha256', SECRET()).update(payload).digest('base64url');

export const LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface ViewToken { k: 'view'; f: string; o: string; e: number }
export interface SessionToken { k: 'session'; m: string; l: string; s: string; n: string; e: number }

export function issueToken(data: Omit<ViewToken, 'e'> | Omit<SessionToken, 'e'>, expires: number): string {
  const payload = Buffer.from(JSON.stringify({ ...data, e: expires })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readToken<T extends ViewToken | SessionToken>(token: unknown, kind: T['k'], now = Date.now()): T | null {
  const [payload, mac] = String(token ?? '').split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.k === kind && data.e > now ? data : null;
  } catch {
    return null;
  }
}

// ---- Eigene Adresse --------------------------------------------------------

/** Ursprung aus `HTML_APP_ORIGIN` (`https://…`), sonst `null`: Ohne ihn gibt es keine HTML-Apps. */
export function appOrigin(env = process.env.HTML_APP_ORIGIN): string | null {
  return originOf(env);
}

export function originOf(value: unknown): string | null {
  try {
    const u = new URL(String(value ?? ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

const requestHost = (headers: Record<string, any>) => String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim().toLowerCase();

/** Stammt die Anfrage von der Hauptseite? Gibt deren Ursprung zurück, sonst `null`. */
export function parentOriginOf(headers: Record<string, any>, appUrl = process.env.APP_URL): string | null {
  const origin = originOf(headers.origin);
  if (!origin || origin === appOrigin()) return null;
  return new URL(origin).host === requestHost(headers) || origin === originOf(appUrl) ? origin : null;
}

/**
 * Trennung der Adressen: Auf der App-Adresse gibt es nur die beiden Rahmen, auf
 * der Hauptadresse keine. Sonst könnte eine App die Hauptseite in ihrem Fenster
 * laden, und eine Datei liefe mit dem Ursprung der Anmeldung.
 */
export function frameAllowedHere(headers: Record<string, any>, path: string, origin = appOrigin()): boolean {
  const isFrame = path.startsWith(FRAME_PREFIX);
  if (!origin) return !isFrame;
  const onAppHost = requestHost(headers) === new URL(origin).host;
  return onAppHost ? isFrame : !isFrame;
}

export function htmlAppHostGuard() {
  return (req: any, res: any, next: any) => {
    if (frameAllowedHere(req.headers, req.path)) return next();
    res.status(404).type('text/plain').send('Nicht gefunden');
  };
}

// ---- Kopfzeilen der Rahmen -------------------------------------------------

export const FRAME_SANDBOX = 'allow-scripts allow-modals allow-forms';

/**
 * Kopf der App-Datei: Sandkasten ohne Netz. Es laufen nur die Skripte mit diesen Hashes, also nur
 * geprüfter Code; Trusted Types leitet jedes HTML aus Text durch das Schutzskript.
 */
export function appHeaders(origin: string, parentOrigin: string, scriptHashes: string[]): Record<string, string> {
  return {
    'Content-Security-Policy': [
      `sandbox ${FRAME_SANDBOX}`, "default-src 'none'", `script-src ${scriptHashes.join(' ')}`, "style-src 'unsafe-inline'",
      'img-src data: blob:', 'font-src data:', 'media-src data: blob:', "connect-src 'none'", "form-action 'none'",
      "require-trusted-types-for 'script'", 'trusted-types default',
      // Die Regel gilt für alle Vorfahren: Rahmenseite und Hauptseite.
      "base-uri 'none'", `frame-ancestors ${origin} ${parentOrigin}`,
    ].join('; '),
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    'Referrer-Policy': 'no-referrer',
    // Jeder Schritt lädt den Rahmen neu; die Adresse ändert sich innerhalb eines Durchlaufs nicht.
    'Cache-Control': 'private, max-age=3600',
  };
}

/**
 * Rahmenseite um die App. `frame-src 'self'` hält den Seitenwechsel der App auf,
 * den `connect-src` nicht verhindert; sie leitet nur die Nachrichten weiter.
 */
export function shellPage(token: string, parentOrigin: string): { html: string; headers: Record<string, string> } {
  const nonce = crypto.randomBytes(16).toString('base64');
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const src = `${FRAME_PREFIX}app?t=${encodeURIComponent(token)}`;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>HTML-App</title>
<style nonce="${nonce}">html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body>
<iframe id="app" title="HTML-App" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer"></iframe>
<script nonce="${nonce}">
(function () {
  var parentOrigin = ${json(parentOrigin)};
  var frame = document.getElementById('app');
  var fromApp = { 'lm.ready': 1, 'lm.shown': 1, 'lm.answer': 1, 'lm.state': 1, 'lm.download': 1, 'lm.flushed': 1, 'lm.crash': 1 };
  var fromHost = { 'lm.init': 1, 'lm.lock': 1, 'lm.reveal': 1, 'lm.check': 1, 'lm.flush': 1, 'lm.error': 1 };
  addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.lm !== 2) return;
    if (e.source === frame.contentWindow && fromApp[m.type]) {
      parent.postMessage({ lm: 2, type: m.type, data: m.data }, parentOrigin);
    } else if (e.source === parent && e.origin === parentOrigin && fromHost[m.type]) {
      frame.contentWindow.postMessage({ lm: 2, type: m.type, data: m.data }, '*');
    }
  });
  frame.src = ${json(src)};
})();
</script></body></html>`;
  return {
    html,
    headers: {
      'Content-Security-Policy': [
        "default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "frame-src 'self'",
        "base-uri 'none'", "form-action 'none'", `frame-ancestors ${parentOrigin}`,
      ].join('; '),
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  };
}
