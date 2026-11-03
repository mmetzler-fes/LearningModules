import * as crypto from 'crypto';

/** Regeln der HTML-Apps ohne Datenbank (docs/html-apps.md). */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_STATE_BYTES = 256 * 1024;
export const MAX_ITEMS = 500;
export const MAX_UNITS = 30;

export const FRAME_PREFIX = '/api/html-app-frame/';

const ID = /^[a-z0-9-]{1,40}$/;
const KINDS = ['graded', 'practice', 'info'];

export interface AppUnit {
  id: string;
  title: string;
  kind: 'graded' | 'practice' | 'info';
  items?: number;
}

export interface AppManifest {
  lmApp: 1;
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

/** Steckbrief lesen. Fehlt er: `manifest: null`. Ist er ungültig: `errors`, die Datei wird abgelehnt. */
export function parseManifest(html: string): { manifest: AppManifest | null; errors: string[] } {
  const found = /<script\b[^>]*\btype\s*=\s*["']?application\/lm-app\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!found) return { manifest: null, errors: [] };
  let raw: any;
  try {
    raw = JSON.parse(found[1]);
  } catch (e: any) {
    return { manifest: null, errors: [`Der Steckbrief ist kein gültiges JSON: ${e.message}`] };
  }
  const errors: string[] = [];
  if (raw?.lmApp !== 1) errors.push('„lmApp“ muss 1 sein.');
  if (!ID.test(String(raw?.id ?? ''))) errors.push('„id“: nur a-z, 0-9 und -, höchstens 40 Zeichen.');
  if (!text(raw?.version, 40)) errors.push('„version“ fehlt.');
  if (!text(raw?.title, 200)) errors.push('„title“ fehlt.');
  const units = Array.isArray(raw?.units) ? raw.units : null;
  if (!units?.length) errors.push('„units“ braucht mindestens einen Abschnitt.');
  else if (units.length > MAX_UNITS) errors.push(`Höchstens ${MAX_UNITS} Abschnitte.`);
  const seen = new Set<string>();
  (units || []).forEach((u: any, i: number) => {
    const where = `Abschnitt ${i + 1}`;
    if (!ID.test(String(u?.id ?? ''))) errors.push(`${where}: „id“ nur a-z, 0-9 und -, höchstens 40 Zeichen.`);
    else if (seen.has(u.id)) errors.push(`${where}: „id“ „${u.id}“ kommt doppelt vor.`);
    seen.add(u?.id);
    if (!text(u?.title, 200)) errors.push(`${where}: „title“ fehlt.`);
    if (!KINDS.includes(u?.kind)) errors.push(`${where}: „kind“ muss graded, practice oder info sein.`);
    if (u?.items !== undefined && !(Number.isInteger(u.items) && u.items >= 0 && u.items <= MAX_ITEMS)) {
      errors.push(`${where}: „items“ muss eine ganze Zahl von 0 bis ${MAX_ITEMS} sein.`);
    }
  });
  if (errors.length) return { manifest: null, errors };
  return {
    errors: [],
    manifest: {
      lmApp: 1, id: raw.id, version: text(raw.version, 40), title: text(raw.title, 200),
      units: units.map((u: any) => ({
        id: u.id, title: text(u.title, 200), kind: u.kind, ...(u.items !== undefined ? { items: u.items } : {}),
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

export interface CleanResult {
  unit: string;
  score: number;
  max: number;
  items: Array<{ id: string; label?: string; points: number }>;
}

/** Meldung `lm.result` prüfen. Ergebnis: Werte oder der Text für `LM.onError`. */
export function cleanResult(data: any): CleanResult | { error: string } {
  const max = Number(data?.max);
  const score = Number(data?.score);
  if (!Number.isFinite(max) || max <= 0 || max > 100000) return { error: '„max“ muss größer als 0 sein.' };
  if (!Number.isFinite(score) || score < 0 || score > max) return { error: '„score“ muss zwischen 0 und „max“ liegen.' };
  const rawItems = data?.items ?? [];
  if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS) return { error: `„items“: höchstens ${MAX_ITEMS} Einträge.` };
  const items: CleanResult['items'] = [];
  for (const it of rawItems) {
    const points = Number(it?.points);
    if (!text(it?.id, 80) || !Number.isFinite(points) || points < 0 || points > 1) return { error: '„items“: je Eintrag „id“ und „points“ von 0 bis 1.' };
    items.push({ id: text(it.id, 80), ...(it.label ? { label: text(it.label, 200) } : {}), points });
  }
  return { unit: text(data?.unit, 40), score, max, items };
}

/** Meldung `lm.progress` prüfen: entweder `active` (LM.enter) oder `done`/`total`. */
export function cleanProgress(data: any): { unit: string; active: boolean; done?: number; total?: number } | { error: string } {
  const unit = text(data?.unit, 40);
  if (data?.active) return { unit, active: true };
  const done = Number(data?.done);
  const total = Number(data?.total);
  if (!Number.isInteger(done) || !Number.isInteger(total) || total < 0 || total > 100000 || done < 0 || done > total) {
    return { error: '„done“ und „total“: ganze Zahlen, „done“ höchstens „total“.' };
  }
  return { unit, active: false, done, total };
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

export const FRAME_SANDBOX = 'allow-scripts allow-modals allow-downloads allow-forms';

/** Kopf der App-Datei: Sandkasten ohne Netz. */
export function appHeaders(origin: string, parentOrigin: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      `sandbox ${FRAME_SANDBOX}`, "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
      'img-src data: blob:', 'font-src data:', 'media-src data: blob:', "connect-src 'none'", "form-action 'none'",
      // Die Regel gilt für alle Vorfahren: Rahmenseite und Hauptseite.
      "base-uri 'none'", `frame-ancestors ${origin} ${parentOrigin}`,
    ].join('; '),
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
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
  var fromApp = { 'lm.ready': 1, 'lm.progress': 1, 'lm.result': 1, 'lm.state': 1 };
  var fromHost = { 'lm.init': 1, 'lm.open': 1, 'lm.error': 1 };
  addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.lm !== 1) return;
    if (e.source === frame.contentWindow && fromApp[m.type]) {
      parent.postMessage({ lm: 1, type: m.type, data: m.data }, parentOrigin);
    } else if (e.source === parent && e.origin === parentOrigin && fromHost[m.type]) {
      frame.contentWindow.postMessage({ lm: 1, type: m.type, data: m.data }, '*');
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
