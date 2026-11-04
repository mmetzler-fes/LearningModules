import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { parse } from 'parse5';
import * as crypto from 'crypto';
import { AppManifest, readManifest } from './html-app-rules';
import { BRIDGE_JS } from './html-app-bridge';
import { GUARD_JS } from './html-app-guard';

/**
 * Prüfung einer HTML-App (docs/html-apps.md, „Was geprüft wird“). Sie lehnt im Zweifel ab: Was sich
 * nicht sicher lesen lässt, gilt als Fehler. Fassung hochzählen, wenn die Regeln strenger werden.
 */
export const CHECK_VERSION = 1;

const MAX_ERRORS = 30;
const MAX_SCRIPTS = 20;

const BANNED_TAGS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'base', 'fencedframe', 'portal']);
const DATA_TYPES = new Set(['application/lm-app+json', 'application/json']);
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript']);
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'data', 'poster', 'background', 'ping', 'srcset', 'manifest', 'cite', 'longdesc', 'srcdoc']);

/** Namen, die keine App braucht: egal ob als Variable, Eigenschaft oder `x['name']`. */
const BANNED_NAMES = new Set([
  'eval', 'Function', 'importScripts', 'Reflect',
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription',
  'Worker', 'SharedWorker', 'ServiceWorker', 'serviceWorker', 'WebSocket', 'WebTransport', 'EventSource', 'XMLHttpRequest',
  'fetch', 'sendBeacon', 'location', 'defaultView', 'contentWindow', 'contentDocument', 'srcdoc', 'opener', 'XSLTProcessor',
]);
/** Das globale Objekt: nur als `window.name`, nie als Wert oder mit berechnetem Namen. */
const GLOBAL_ALIASES = new Set(['window', 'self', 'globalThis', 'frames']);
const DOCUMENT_BANNED = new Set(['write', 'writeln', 'open', 'domain']);
const HTML_IN_STRING = /<\s*(iframe|frame|frameset|object|embed|fencedframe|portal)\b|\son[a-z]{3,20}\s*=\s*["'`]|javascript:/i;

export interface AppInspection {
  errors: string[];
  manifest: AppManifest | null;
  scripts: string[];
}

interface Finding { add(message: string): void }

function checkScript(code: string, where: string, out: Finding) {
  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  } catch (e: any) {
    out.add(`${where}: lässt sich nicht lesen (${e.message}).`);
    return;
  }
  const at = (n: any) => `${where}, Zeile ${n.loc?.start?.line ?? '?'}`;
  const banned = (name: string, n: any) => out.add(`${at(n)}: „${name}“ ist in HTML-Apps nicht erlaubt.`);
  const allowed = new WeakSet<object>();

  // Erst die Mitglieder ansehen: `window.x` macht das `window` darin zulässig.
  walk.full(ast, (n: any) => {
    if (n.type !== 'MemberExpression') return;
    const name = !n.computed ? n.property.name : typeof n.property.value === 'string' ? n.property.value : null;
    if (name !== null && BANNED_NAMES.has(name)) banned(name, n);
    if (n.object.type !== 'Identifier') return;
    const isAlias = GLOBAL_ALIASES.has(n.object.name);
    if (isAlias && name !== null) allowed.add(n.object);
    if ((isAlias || n.object.name === 'document') && name === null) out.add(`${at(n)}: „${n.object.name}[…]“ mit berechnetem Namen ist nicht erlaubt.`);
    if (n.object.name === 'document' && name !== null && DOCUMENT_BANNED.has(name)) banned(`document.${name}`, n);
    if (isAlias && name === 'open') banned(`${n.object.name}.open`, n);
  });
  const propertyKeys = new WeakSet<object>();
  walk.full(ast, (n: any) => {
    if (n.type === 'MemberExpression' && !n.computed) propertyKeys.add(n.property);
    if (n.type === 'Property' && !n.computed && !n.shorthand) propertyKeys.add(n.key);
    if ((n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && !n.computed) propertyKeys.add(n.key);
  });
  walk.full(ast, (n: any) => {
    switch (n.type) {
      case 'Identifier':
        if (propertyKeys.has(n)) return;
        if (BANNED_NAMES.has(n.name)) banned(n.name, n);
        if (GLOBAL_ALIASES.has(n.name) && !allowed.has(n)) out.add(`${at(n)}: „${n.name}“ nur als „${n.name}.name“, nicht als Wert.`);
        break;
      case 'ImportExpression':
        banned('import()', n);
        break;
      case 'WithStatement':
        banned('with', n);
        break;
      case 'CallExpression':
        if (n.callee.type === 'Identifier' && n.callee.name === 'open') banned('open()', n);
        break;
      case 'Literal':
        if (typeof n.value === 'string' && HTML_IN_STRING.test(n.value)) out.add(`${at(n)}: Der Text enthält Rahmen, „on…=“ oder „javascript:“; das läuft in HTML-Apps nicht.`);
        break;
      case 'TemplateElement':
        if (HTML_IN_STRING.test(n.value.cooked ?? n.value.raw)) out.add(`${at(n)}: Der Text enthält Rahmen, „on…=“ oder „javascript:“; das läuft in HTML-Apps nicht.`);
        break;
      default:
    }
  });
}

const attrOf = (node: any, name: string) => node.attrs?.find((a: any) => a.name === name)?.value;
const attrName = (a: any) => (a.prefix ? `${a.prefix}:${a.name}` : a.name);
const textOf = (node: any) => (node.childNodes || []).map((c: any) => c.value ?? '').join('');

function okUrl(name: string, value: string) {
  const v = value.trim();
  if (name === 'href' || name === 'xlink:href') return v.startsWith('#');
  if (name === 'src' || name === 'poster') return /^data:(image|audio|video|font)\//i.test(v);
  return false;
}

/** Liest und prüft eine Datei. Ohne Fehler liefert sie Steckbrief und die Skripte für die CSP. */
export function inspectApp(html: string): AppInspection {
  const errors: string[] = [];
  const out: Finding = { add: (m) => { if (errors.length < MAX_ERRORS) errors.push(m); } };
  const scripts: string[] = [];
  const manifests: string[] = [];
  const visit = (node: any) => {
    const tag = node.tagName;
    if (tag) {
      if (BANNED_TAGS.has(tag)) out.add(`<${tag}> ist in HTML-Apps nicht erlaubt.`);
      if (tag === 'meta' && attrOf(node, 'http-equiv') !== undefined) out.add('<meta http-equiv> ist in HTML-Apps nicht erlaubt.');
      for (const a of node.attrs || []) {
        const name = attrName(a);
        if (/^on/i.test(a.name)) out.add(`<${tag} ${a.name}=…>: Ereignisse über addEventListener anmelden, nicht im HTML.`);
        if (URL_ATTRS.has(name) && !okUrl(name, a.value)) out.add(`<${tag} ${name}="${a.value.slice(0, 50)}">: Adressen nach außen sind nicht erlaubt; Bilder als data:.`);
        if (a.name === 'style' && /url\(\s*["']?\s*(?!data:|#)|@import/i.test(a.value)) out.add(`<${tag} style>: nur url(data:…).`);
      }
      if (tag === 'style' && /url\(\s*["']?\s*(?!data:|#)|@import/i.test(textOf(node))) out.add('<style>: nur url(data:…), kein @import.');
      if (tag === 'script') {
        const type = String(attrOf(node, 'type') ?? '').trim().toLowerCase();
        if (type === 'application/lm-app+json') manifests.push(textOf(node));
        if (!JS_TYPES.has(type) && !DATA_TYPES.has(type)) out.add(`<script type="${type}"> ist nicht erlaubt.`);
        else if (JS_TYPES.has(type)) {
          const code = textOf(node);
          scripts.push(code);
          // Die Bridge läuft ungeprüft; eine Kopie in der Datei (zum Alleinöffnen) muss ihr genau gleichen.
          if (code.trim() !== BRIDGE_JS.trim()) checkScript(code, `Skript ${scripts.length}`, out);
        }
      }
    }
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(parse(html));
  if (scripts.length > MAX_SCRIPTS) out.add(`Höchstens ${MAX_SCRIPTS} Skripte.`);

  if (!manifests.length) out.add('Der Steckbrief fehlt: <script type="application/lm-app+json"> im <head>.');
  if (manifests.length > 1) out.add('Es darf nur einen Steckbrief geben.');
  let manifest: AppManifest | null = null;
  if (manifests.length === 1) {
    const read = readManifest(manifests[0]);
    read.errors.forEach(out.add);
    manifest = read.manifest;
  }
  return { errors, manifest: errors.length ? null : manifest, scripts };
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const cspHash = (s: string) => `'sha256-${sha256(s)}'`;

/** Auslieferung: Schutzskript und Bridge zuerst, und die CSP lässt nur diese Skripte zu. */
export function deliverable(html: string, scripts: string[]) {
  const body = html.replace(/^﻿?\s*<!doctype[^>]*>/i, '');
  return {
    html: `<!doctype html><script>${GUARD_JS}</script><script>${BRIDGE_JS}</script>${body}`,
    scriptHashes: [GUARD_JS, BRIDGE_JS, ...scripts].map(cspHash),
  };
}
