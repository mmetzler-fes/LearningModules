// ==================== ONENOTE-ABSCHNITT SCHREIBEN ====================
//
// Erzeugt einen OneNote-Abschnitt (.one, MS-ONESTORE + MS-ONE) mit Seiten aus
// Absätzen (Text, Links), Bildern im Textblock, frei gesetzten Seitenbildern
// (Ausdruck, untereinander) und angehängten Dateien. Aufbau nachgebildet nach
// Dateien, die OneNote 2016/365 selbst schreibt (Beispiel: data/onenote-sample),
// und in OneNote geprüft (Öffnen, Tippen, hinter Links, Stift auf Bildern,
// in ein Notizbuch ziehen). Was dabei zählt, steht in docs/onenote-export.md.
//
// Ohne Abhängigkeiten und ohne import, damit dieselbe Datei auch in den Tests
// läuft (src/core/browser-module.ts).

// ---------- Hilfen: CRC32, MD5, GUIDs, Bytes ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const len = bytes.length, total = ((len + 8) >> 6) + 1 << 6;
  const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), o = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((x, i) => o.setUint32(i * 4, x, true));
  return out;
}

const randomGuid = () => {
  const g = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(g);
  else for (let i = 0; i < 16; i++) g[i] = Math.floor(Math.random() * 256); // Testumgebung
  g[7] = (g[7] & 0x0f) | 0x40;
  g[8] = (g[8] & 0x3f) | 0x80;
  return g;
};
const guidText = (g) => { const h = (i) => g[i].toString(16).padStart(2, '0'); return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`.toUpperCase(); };
const NIL_GUID = new Uint8Array(16);

class Buf {
  constructor() { this.parts = []; this.length = 0; }
  bytes(b) { this.parts.push(b); this.length += b.length; return this; }
  u8(x) { return this.bytes(Uint8Array.of(x & 0xff)); }
  u16(x) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, x, true); return this.bytes(b); }
  u32(x) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x >>> 0, true); return this.bytes(b); }
  u64(x) { const b = new Uint8Array(8); const v = new DataView(b.buffer); v.setUint32(0, Number(BigInt(x) & 0xffffffffn), true); v.setUint32(4, Number(BigInt(x) >> 32n), true); return this.bytes(b); }
  zeros(n) { return this.bytes(new Uint8Array(n)); }
  ext(id) { return this.bytes(id ? id.g : NIL_GUID).u32(id ? id.n : 0); }
  done() { const out = new Uint8Array(this.length); let p = 0; for (const b of this.parts) { out.set(b, p); p += b.length; } return out; }
}
const utf16z = (s) => { const b = new Uint8Array((s.length + 1) * 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) & 0xff; b[2 * i + 1] = s.charCodeAt(i) >> 8; } return b; };
const utf16 = (s) => utf16z(s).subarray(0, s.length * 2);

// ---------- Zeitangaben ----------
const filetime = (d) => (BigInt(d.getTime()) + 11644473600000n) * 10000n;
const time32 = (d) => Math.floor((d.getTime() - Date.UTC(1980, 0, 1)) / 1000);
const f32 = (x) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, true); return b.getUint32(0, true); };

// ---------- Eigenschaften ----------
// Typen nach MS-ONESTORE 2.6.6
const T = { bool: 2, u8: 3, u16: 4, u32: 5, u64: 6, bytes: 7, oid: 8, oids: 9, osid: 0xa, osids: 0xb, ctx: 0xc, ctxs: 0xd };
const P = {
  bool: (id, v) => ({ id, t: T.bool, v }), u8: (id, v) => ({ id, t: T.u8, v }), u16: (id, v) => ({ id, t: T.u16, v }),
  u32: (id, v) => ({ id, t: T.u32, v }), u64: (id, v) => ({ id, t: T.u64, v }), bytes: (id, v) => ({ id, t: T.bytes, v }),
  text: (id, s) => ({ id, t: T.bytes, v: utf16z(s) }), oid: (id, v) => ({ id, t: T.oid, v }), oids: (id, v) => ({ id, t: T.oids, v }),
  osids: (id, v) => ({ id, t: T.osids, v }), ctxs: (id, v) => ({ id, t: T.ctxs, v }), f32: (id, x) => ({ id, t: T.u32, v: f32(x) }),
};

/** ObjectSpaceObjectPropSet; `cid(id)` liefert die CompactID. */
function encodePropSet(props, cid) {
  const sorted = [...props].sort((a, b) => a.t - b.t || a.id - b.id);
  const oids = [], osids = [], ctxs = [];
  for (const p of sorted) {
    if (p.t === T.oid) oids.push(p.v); else if (p.t === T.oids) oids.push(...p.v);
    else if (p.t === T.osids) osids.push(...p.v); else if (p.t === T.ctxs) ctxs.push(...p.v);
  }
  const b = new Buf();
  if (ctxs.length) {
    b.u32(0x40000000 | oids.length); oids.forEach((x) => b.u32(cid(x)));
    b.u32(0x40000000 | osids.length); osids.forEach((x) => b.u32(cid(x)));
    b.u32(ctxs.length); ctxs.forEach((x) => b.u32(cid(x)));
  } else if (osids.length) {
    b.u32(oids.length); oids.forEach((x) => b.u32(cid(x)));
    b.u32(osids.length); osids.forEach((x) => b.u32(cid(x)));
  } else {
    b.u32(0x80000000 | oids.length); oids.forEach((x) => b.u32(cid(x)));
  }
  b.u16(sorted.length);
  for (const p of sorted) b.u32(((p.t === T.bool && p.v ? 0x80000000 : 0) | (p.t << 26) | p.id) >>> 0);
  for (const p of sorted) {
    switch (p.t) {
      case T.u8: b.u8(p.v); break;
      case T.u16: b.u16(p.v); break;
      case T.u32: b.u32(p.v); break;
      case T.u64: b.u64(p.v); break;
      case T.bytes: b.u32(p.v.length).bytes(p.v); break;
      case T.oids: case T.osids: case T.ctxs: b.u32(p.v.length); break;
      default: break;
    }
  }
  return b.done();
}

// ---------- Datei-Aufbau ----------
const FRAG_MAGIC_LO = 0xf5f7f4c4, FRAG_MAGIC_HI = 0xa4567ab1;
const FOOTER = [0x4b, 0xba, 0x33, 0x82, 0xc3, 0x15, 0xc2, 0x8b];
const FILE_DATA_HEADER = Uint8Array.of(0xe7, 0x16, 0xe3, 0xbd, 0x65, 0x26, 0x11, 0x45, 0xa4, 0xc4, 0x8d, 0x4d, 0x0b, 0x7a, 0x9e, 0xac);
const FILE_DATA_FOOTER = Uint8Array.of(0x22, 0xa7, 0xfb, 0x71, 0x79, 0x0f, 0x0b, 0x4a, 0xbb, 0x13, 0x89, 0x92, 0x56, 0x42, 0x6b, 0x24);
const NIL_STP = 0xffffffffffffffffn;

class Writer {
  constructor() {
    this.out = new Buf();
    this.out.zeros(1024); // Kopf, wird am Ende ersetzt
    this.lists = new Map(); // FileNodeListID → Zahl der Knoten
    this.nextListId = 0x10;
  }
  get pos() { return this.out.length; }
  put(bytes) { const stp = this.pos; this.out.bytes(bytes); return { stp, cb: bytes.length }; }
  align() { const pad = (8 - (this.pos % 8)) % 8; if (pad) this.out.zeros(pad); }
  /** Eine FileNodeList mit einem Fragment. `nodes`: [{ id, ref?, body }] */
  list(nodes) {
    const listId = this.nextListId++;
    const b = new Buf();
    b.u32(FRAG_MAGIC_LO).u32(FRAG_MAGIC_HI).u32(listId).u32(0);
    for (const n of nodes) {
      const body = n.body || new Uint8Array(0);
      const hasRef = !!n.ref;
      const size = 4 + (hasRef ? 12 : 0) + body.length;
      const head = (n.id | (size << 10) | (0 << 23) | (0 << 25) | ((hasRef ? n.baseType || 1 : 0) << 27) | 0x80000000) >>> 0;
      b.u32(head);
      if (hasRef) b.u64(n.ref.stp === null ? NIL_STP : n.ref.stp).u32(n.ref.cb);
      b.bytes(body);
    }
    b.zeros(8 + ((8 - ((b.length + 8 + 20) % 8)) % 8)); // Platz, Fragmentlänge auf 8 Bytes
    b.u64(NIL_STP).u32(0).bytes(Uint8Array.from(FOOTER));
    this.lists.set(listId, nodes.length);
    this.align();
    return this.put(b.done());
  }
}

/**
 * IDs: eine GUID mit laufender Nummer (max. 255 je GUID).
 */
class Ids {
  constructor() { this.g = randomGuid(); this.n = 0; }
  next() { if (this.n >= 250) { this.g = randomGuid(); this.n = 0; } return { g: this.g, n: ++this.n }; }
}
const key = (id) => `${guidText(id.g)}:${id.n}`;

/**
 * Objektgruppe schreiben. `objects`: [{ id, jcid, props, readOnly?, file? }]
 * file: { ref: '<ifndf>{GUID}', ext: '.pdf' }
 */
function writeObjectGroup(w, ids, objects) {
  const groupId = ids.next();
  // Globale ID-Tabelle aller vorkommenden GUIDs
  const table = new Map();
  const add = (id) => { const k = guidText(id.g); if (!table.has(k)) table.set(k, { idx: table.size, g: id.g }); };
  for (const o of objects) {
    add(o.id);
    for (const p of o.props || []) {
      if (p.t === T.oid) add(p.v);
      if ([T.oids, T.osids, T.ctxs].includes(p.t)) p.v.forEach(add);
    }
  }
  const cid = (id) => ((table.get(guidText(id.g)).idx << 8) | id.n) >>> 0;
  const nodes = [{ id: 0x0b4, body: new Buf().ext(groupId).done() }, { id: 0x022 }];
  for (const t of table.values()) nodes.push({ id: 0x024, body: new Buf().u32(t.idx).bytes(t.g).done() });
  nodes.push({ id: 0x028 });
  nodes.push({ id: 0x08c, body: new Buf().ext({ g: randomGuid(), n: 1 }).done() });
  // Verwendungszähler: Verweise innerhalb dieser Gruppe, Startobjekte zählen 1
  const refs = new Map();
  for (const o of objects) for (const p of o.props || []) {
    const list = p.t === T.oid ? [p.v] : p.t === T.oids ? p.v : [];
    for (const x of list) refs.set(key(x), (refs.get(key(x)) || 0) + 1);
  }
  const cRefOf = (o) => refs.get(key(o.id)) || 1;
  const hashed = [];
  for (const o of objects) {
    const cRef = cRefOf(o);
    const large = cRef > 255;
    if (o.file) {
      const b = new Buf().u32(cid(o.id)).u32(o.jcid);
      if (large) b.u32(cRef); else b.u8(cRef);
      b.u32(o.file.ref.length).bytes(utf16(o.file.ref)).u32(o.file.ext.length).bytes(utf16(o.file.ext));
      nodes.push({ id: large ? 0x073 : 0x072, body: b.done() });
      continue;
    }
    const data = encodePropSet(o.props, cid);
    const ref = w.put(data);
    const hasOid = o.props.some((p) => p.t === T.oid || p.t === T.oids);
    const hasOsid = o.props.some((p) => p.t === T.osids || p.t === T.ctxs);
    const body = new Buf().u32(cid(o.id)).u32(o.jcid).u8((hasOid ? 1 : 0) | (hasOsid ? 2 : 0));
    if (large) body.u32(cRef); else body.u8(cRef);
    if (o.readOnly) {
      const h = md5(data);
      body.bytes(h);
      hashed.push({ ref, hash: h });
      nodes.push({ id: large ? 0x0c5 : 0x0c4, ref, body: body.done() });
    } else {
      nodes.push({ id: large ? 0x0a5 : 0x0a4, ref, body: body.done() });
    }
  }
  nodes.push({ id: 0x0b8 });
  return { ref: w.list(nodes), groupId, hashed };
}

/** Revision: Objektgruppe + Wurzeln. */
function revisionNodes(w, ids, { rid, role = 1, ctx = null, objects, roots }) {
  const orphans = unreferenced(objects, roots.map((r) => r[1]));
  if (orphans.length) throw new Error(`OneNote: unverwiesene Objekte ${orphans.join(', ')}`);
  const g = writeObjectGroup(w, ids, objects);
  const start = new Buf().ext(rid).ext(null).u32(role).u16(0);
  if (ctx) start.ext(ctx);
  const nodes = [{ id: ctx ? 0x01f : 0x01e, body: start.done() }, { id: 0x0b0, ref: g.ref, baseType: 2, body: new Buf().ext(g.groupId).done() }];
  for (const [r, id] of roots) nodes.push({ id: 0x05a, body: new Buf().ext(id).u32(r).done() });
  nodes.push({ id: 0x01c });
  return { nodes, hashed: g.hashed };
}

function objectSpace(w, gosid, revisions) {
  const revNodes = [{ id: 0x014, body: new Buf().ext(gosid).u32(0).done() }];
  const hashed = [];
  for (const r of revisions) { revNodes.push(...r.nodes); hashed.push(...r.hashed); }
  const revList = w.list(revNodes);
  const manifest = w.list([
    { id: 0x00c, body: new Buf().ext(gosid).done() },
    { id: 0x010, ref: revList, baseType: 2 },
  ]);
  return { manifest, hashed };
}

// ---------- Inhalte (MS-ONE) ----------
const J = {
  section: 0x00060007, pageSeries: 0x00060008, page: 0x0006000b, outline: 0x0006000c, oe: 0x0006000d, richText: 0x0006000e,
  title: 0x0006002c, pageMeta: 0x00020030, sectionMeta: 0x00020031, embeddedFile: 0x00060035, pageManifest: 0x00060037,
  versionHistoryContent: 0x0006003c, revisionMeta: 0x00020044, versionHistoryMeta: 0x00020046, style: 0x0012004d,
  authorContainer: 0x00120001, author: 0x00120051, embeddedFileContainer: 0x00080036, image: 0x00060011, pictureContainer: 0x00080039,
};

function styleProps({ name, font = 'Calibri', size = 22, color = 0xff000000, link = false, hidden = false }) {
  const p = [P.u8(0x34da, 2), P.u16(0x1c0b, size), P.u32(0x1c0c, color), P.u32(0x342e, 0), P.u32(0x342f, 0), P.text(0x1c0a, font)];
  if (name) { p.push(P.text(0x345a, name)); if (name !== 'p') p.push(P.text(0x348a, 'p')); }
  if (link) { p.push(P.bool(0x1e14, true), P.bool(0x1e19, true)); if (hidden) p.push(P.bool(0x1e16, true)); }
  return p;
}

/**
 * Seite bauen. `page`: { title, blocks: [{ type:'text', runs:[{text, href?}] } | { type:'file', name, data, icon }] }
 */
function buildPage(w, ids, page, now, author, fileStore) {
  const t32 = time32(now), ft = filetime(now);
  const objects = [];
  const obj = (jcid, props, extra = {}) => { const id = ids.next(); objects.push({ id, jcid, props, ...extra }); return id; };

  const authorId = obj(J.authorContainer, [P.text(0x1d75, author)], { readOnly: true });
  const sTitle = obj(J.style, styleProps({ name: 'PageTitle', font: 'Calibri Light', size: 40 }), { readOnly: true });
  const sP = obj(J.style, styleProps({ name: 'p' }), { readOnly: true });
  // Zeichenformate (TextRunFormatting): eigene kleine Objekte, getrennt von den
  // benannten Absatzvorlagen – so legt OneNote sie selbst an. Link-Formate nur,
  // wenn ein Link vorkommt: unbenutzte Objekte bringen OneNote durcheinander.
  const runPlain = obj(J.style, [P.u32(0x1c3b, 0x407)], { readOnly: true });
  // Link-Formate wie bei OneNote: voller Satz Kennzeichen; nach einem Link folgt
  // immer ein Stück Text mit ausdrücklich ausgeschaltetem Link.
  let sLinkCode = null, sLink = null, sLinkOff = null;
  const linkFormat = (hidden, on) => obj(J.style, [P.bool(0x1e16, hidden), P.bool(0x34aa, false), P.bool(0x1e14, on), P.bool(0x1e19, on),
    P.u32(0x1c3b, 0x407), P.u8(0x1d01, 0), P.u8(0x3452, 0), P.bool(0x3401, false), P.bool(0x3405, false), P.bool(0x3406, false)], { readOnly: true });
  const linkStyles = () => {
    if (!sLink) { sLinkCode = linkFormat(true, true); sLink = linkFormat(false, true); sLinkOff = linkFormat(false, false); }
  };

  const richText = (inputRuns) => {
    const hasLink = inputRuns.some((r) => r.href);
    const runs = [...inputRuns];
    if (hasLink) {
      linkStyles();
      if (runs[runs.length - 1].href) runs.push({ text: ' ' });
    }
    const plain = hasLink ? sLinkOff : runPlain;
    let text = '';
    const idx = [], fmt = [];
    for (const r of runs) {
      if (r.href) {
        text += `\ufddfHYPERLINK "${r.href}"`; idx.push(text.length); fmt.push(sLinkCode);
        text += r.text; idx.push(text.length); fmt.push(sLink);
      } else { text += r.text; idx.push(text.length); fmt.push(plain); }
    }
    idx.pop(); // die letzte Folge reicht bis zum Ende
    const props = [P.u16(0x1cfe, 1031), P.u32(0x1d7a, t32), P.text(0x1c22, text), P.text(0x1e5b, '1'), P.oid(0x342c, sP), P.oids(0x1e13, fmt)];
    if (idx.length) { const b = new Buf(); idx.forEach((x) => b.u32(x)); props.push(P.bytes(0x1e12, b.done())); }
    return obj(J.richText, props);
  };
  const oe = (content) => obj(J.oe, [P.u8(0x1c03, 1), P.u32(0x1d09, t32), P.u32(0x1d7a, t32),
    P.oid(0x1d78, authorId), P.oid(0x1d79, authorId), P.oids(0x1c1f, [content])]);

  // Titel
  const titleRt = obj(J.richText, [P.bool(0x1cb4, true), P.u16(0x1cfe, 1031), P.u32(0x1d7a, t32), P.text(0x1c22, page.title), P.text(0x1e5b, '1'), P.oid(0x342c, sTitle), P.oids(0x1e13, [runPlain])]);
  const titleOe = obj(J.oe, [P.bool(0x1cb2, true), P.bool(0x1cb4, true), P.bool(0x1ce0, true), P.u8(0x1c03, 1), P.u32(0x1d09, t32), P.u32(0x1d7a, t32),
    P.oid(0x1d78, authorId), P.oid(0x1d79, authorId), P.oids(0x1c1f, [titleRt])]);
  const outlineLayout = Uint8Array.of(0x04, 0xf5, 0xf5, 0xf5, 0, 0, 0, 0x3f, 0, 0, 0, 0, 0, 0, 0x40, 0x3f, 0, 0, 0x40, 0x3f);
  const titleOutline = obj(J.outline, [P.bool(0x1c91, true), P.bool(0x1cb2, true), P.bool(0x1cb4, true), P.bool(0x1ce0, true), P.bool(0x1cf9, true), P.bool(0x1cff, true),
    P.u8(0x1c03, 1), P.u8(0x1c13, 0), P.f32(0x1c1b, 13), P.u32(0x1c84, 0xc), P.f32(0x1cec, 4.5), P.u32(0x1d7a, t32), P.bytes(0x1c12, outlineLayout), P.oids(0x1c20, [titleOe])]);
  const title = obj(J.title, [P.u32(0x1c14, 0), P.u32(0x1c15, 0), P.u32(0x1c3e, 0x9000c), P.u32(0x1c84, 0), P.u32(0x1d7a, t32), P.oids(0x1c20, [titleOutline])]);

  // Inhalt
  const elements = [];
  const free = []; // Ausdruck-Seiten: frei auf der Seite, untereinander
  let flowHeight = 0; // grobe Höhe des Textblocks in halben Zoll
  for (const block of page.blocks) {
    if (block.type === 'text') { elements.push(oe(richText(block.runs))); flowHeight += 0.45; }
    if (block.type === 'file') {
      const fileGuid = randomGuid(), iconGuid = randomGuid();
      fileStore.push({ guid: fileGuid, data: block.data }, { guid: iconGuid, data: block.icon });
      const ext = (block.name.match(/\.[^.]+$/) || ['.bin'])[0];
      const fileObj = obj(J.embeddedFileContainer, [], { file: { ref: `<ifndf>{${guidText(fileGuid)}}`, ext } });
      const iconObj = obj(J.pictureContainer, [], { file: { ref: `<ifndf>{${guidText(iconGuid)}}`, ext: '.png' } });
      const node = obj(J.embeddedFile, [P.u16(0x1cfe, 1031), P.u32(0x1c3b, 0x407), P.text(0x1c22, block.name), P.text(0x1d9c, block.name), P.u32(0x1d7a, t32),
        P.f32(0x34cd, 0.667), P.f32(0x34ce, 0.667), P.oid(0x1d9b, fileObj), P.oid(0x1c3f, iconObj)]);
      elements.push(oe(node));
      flowHeight += 1.6;
    }
    if (block.type === 'image') {
      const imgGuid = randomGuid();
      fileStore.push({ guid: imgGuid, data: block.data });
      const ext = block.ext || '.png';
      const container = obj(J.pictureContainer, [], { file: { ref: `<ifndf>{${guidText(imgGuid)}}`, ext } });
      // Größe in halben Zoll; Vorgabe: 96 dpi
      const w = block.widthIn ? block.widthIn * 2 : (block.width / 96) * 2;
      const h = block.widthIn ? w * (block.height / block.width) : (block.height / 96) * 2;
      const props = [P.u32(0x1d7a, t32), P.bool(0x1cbd, false), P.bool(0x1dce, true), P.bool(0x3e16, false), P.f32(0x1c1b, w), P.f32(0x1c1c, h),
        P.u32(0x1c3b, 0x407), P.u32(0x34cb, 0), P.f32(0x34cd, w), P.f32(0x34ce, h), P.oid(0x1c3f, container), P.text(0x1e58, block.alt || '')];
      if (block.name) props.push(P.text(0x1dd7, block.name));
      if (block.free) { free.push({ props, h }); continue; }
      elements.push(oe(obj(J.image, props)));
      flowHeight += h + 0.2;
    }
  }
  const bodyLayout = Uint8Array.of(0x04, 0xfd, 0xb0, 0x1e, 0, 0, 0, 0x3f, 0, 0, 0, 0, 0, 0, 0x40, 0x3f, 0, 0, 0x40, 0x3f);
  const body = obj(J.outline, [P.bool(0x1cbd, false), P.u8(0x1c03, 1), P.u8(0x1c13, 0), P.f32(0x1c14, 1.1667), P.f32(0x1c15, 2.0), P.f32(0x1c1b, 14.83), P.f32(0x1c1c, 0.6),
    P.u32(0x1c3e, 0), P.u32(0x1c84, 9), P.u32(0x1d7a, t32), P.bytes(0x1c12, bodyLayout), P.oids(0x1c20, elements)]);

  // Freie Bilder unter den Textblock setzen
  let y = 2.0 + flowHeight + 0.8;
  const freeIds = [];
  for (const f of free) {
    freeIds.push(obj(J.image, [...f.props.filter((p) => p.id !== 0x1cbd), P.bool(0x1cbd, true), P.f32(0x1c14, 1.0), P.f32(0x1c15, y)]));
    y += f.h + 0.4;
  }

  const pageGuid = randomGuid();
  const pageNode = obj(J.page, [P.bool(0x1c92, false), P.bool(0x1cdc, true), P.f32(0x1d0f, 1), P.f32(0x1d10, 0.4), P.u32(0x1d7a, t32), P.bytes(0x1c30, pageGuid),
    P.oids(0x1c20, [...freeIds, body]), P.oids(0x1d5f, [title])]);
  const vhMeta = obj(J.versionHistoryMeta, [P.u32(0x1d82, 0x28), P.u32(0x348b, 0x28)]);

  const ctxGuid = { g: randomGuid(), n: 1 };
  const manifest = obj(J.pageManifest, [P.oids(0x1c1f, [pageNode]), P.oids(0x3442, [vhMeta]), P.ctxs(0x347b, [ctxGuid])]);
  const metaProps = () => [P.u32(0x1d82, 0x28), P.u32(0x1dff, page.level || 1), P.u32(0x348b, 0x28), P.u64(0x1c65, ft), P.bytes(0x1c30, pageGuid), P.text(0x1cf3, page.title)];
  const pageMeta = obj(J.pageMeta, metaProps());
  const authorFull = obj(J.author, [P.text(0x1d75, author), P.text(0x1e5d, `{${guidText(randomGuid())}}`)], { readOnly: true });
  const revMeta = obj(J.revisionMeta, [P.u64(0x1d77, ft), P.oid(0x1d79, authorFull)]);

  const gosid = ids.next();
  const rev1 = revisionNodes(w, ids, { rid: ids.next(), objects, roots: [[1, manifest], [2, pageMeta], [4, revMeta]] });
  // Versionsverlauf (eigener Kontext), wie OneNote ihn anlegt
  const vIds = { next: (() => { let n = 1; return () => ({ g: ctxGuid.g, n: ++n }); })() };
  const vhContent = { id: vIds.next(), jcid: J.versionHistoryContent, props: [] };
  const vhMeta2 = { id: vIds.next(), jcid: J.versionHistoryMeta, props: [P.u32(0x1d82, 0x28), P.u32(0x348b, 0x28)] };
  const rev2 = revisionNodes(w, ids, { rid: ids.next(), ctx: ctxGuid, objects: [vhMeta2, vhContent], roots: [[1, vhContent.id], [2, vhMeta2.id]] });
  const space = objectSpace(w, gosid, [rev1, rev2]);
  return { gosid, space, metaProps };
}

/**
 * Abschnitt erzeugen. `section`: { name, author, pages: [...] } → Uint8Array (.one)
 */
export function writeOneSection(section, now = new Date()) {
  const w = new Writer();
  const ids = new Ids();
  const author = section.author || 'LearningModules';
  const fileStore = [];
  const pages = section.pages.map((p) => buildPage(w, ids, p, now, author, fileStore));

  // Abschnitt
  const objects = [];
  const obj = (jcid, props, extra = {}) => { const id = ids.next(); objects.push({ id, jcid, props, ...extra }); return id; };
  const metas = pages.map((p) => obj(J.pageMeta, p.metaProps()));
  const series = obj(J.pageSeries, [P.u32(0x1d7a, time32(now)), P.u64(0x1c65, filetime(now)), P.bytes(0x1c30, randomGuid()), P.oids(0x3442, metas), P.osids(0x1d63, pages.map((p) => p.gosid))]);
  const sectionNode = obj(J.section, [P.u64(0x1c65, filetime(now)), P.bytes(0x1c30, randomGuid()), P.text(0x1d69, section.name), P.oids(0x1c20, [series])]);
  const sectionMeta = obj(J.sectionMeta, [P.u32(0x1cbe, section.color ?? 0xcabc4d), P.u32(0x1d82, 0x28), P.u32(0x348b, 0x28)]);
  const sgosid = ids.next();
  const rev = revisionNodes(w, ids, { rid: ids.next(), objects, roots: [[1, sectionNode], [2, sectionMeta]] });
  const sspace = objectSpace(w, sgosid, [rev]);

  // Dateien
  const fileNodes = [];
  for (const f of fileStore) {
    const b = new Buf().bytes(FILE_DATA_HEADER).u64(f.data.length).u32(0).u64(0).bytes(f.data);
    const pad = (8 - ((36 + f.data.length) % 8)) % 8;
    b.zeros(pad).bytes(FILE_DATA_FOOTER);
    w.align();
    const ref = w.put(b.done());
    fileNodes.push({ id: 0x094, ref, body: f.guid });
  }

  const rootNodes = [{ id: 0x008, ref: sspace.manifest, baseType: 2, body: new Buf().ext(sgosid).done() }, { id: 0x004, body: new Buf().ext(sgosid).done() }];
  for (const p of pages) rootNodes.push({ id: 0x008, ref: p.space.manifest, baseType: 2, body: new Buf().ext(p.gosid).done() });
  if (fileNodes.length) rootNodes.push({ id: 0x090, ref: w.list(fileNodes), baseType: 2 });
  const root = w.list(rootNodes);

  const hashed = [...pages.flatMap((p) => p.space.hashed), ...sspace.hashed];
  const hashedList = hashed.length ? w.list(hashed.map((h) => ({ id: 0x0c2, ref: h.ref, body: h.hash }))) : null;

  // Transaktionsprotokoll: eine Transaktion mit allen Listen
  const entries = new Buf();
  for (const [id, n] of w.lists) entries.u32(id).u32(n);
  const entryBytes = entries.done();
  const log = new Buf().bytes(entryBytes).u32(1).u32(crc32(entryBytes)).zeros(12).done();
  w.align();
  const logRef = w.put(log);

  const bytes = w.out.done();
  const h = new Buf();
  h.bytes(Uint8Array.of(0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3)); // guidFileType (.one)
  h.bytes(randomGuid()); h.bytes(NIL_GUID);
  h.bytes(Uint8Array.of(0x3f, 0xdd, 0x9a, 0x10, 0x1b, 0x91, 0xf5, 0x49, 0xa5, 0xd0, 0x17, 0x91, 0xed, 0xc8, 0xae, 0xd8)); // guidFileFormat
  h.u32(0x2a).u32(0x2a).u32(0x2a).u32(0x2a);
  h.u32(0).u32(0); // fcrLegacyFreeChunkList
  h.u32(0xffffffff).u32(0); // fcrLegacyTransactionLog (nil)
  h.u32(1); // cTransactionsInLog
  h.u32(0); // cbLegacyExpectedFileLength
  h.zeros(8); // rgbPlaceholder
  h.u32(0xffffffff).u32(0); // fcrLegacyFileNodeListRoot (nil)
  h.u32(0); // cbLegacyFreeSpaceInFreeChunkList
  h.u8(0).u8(0).u8(0).u8(0); // wie OneNote selbst, auch ohne Dateien
  h.bytes(NIL_GUID); h.u32(0); // guidAncestor, crcName
  const fcr = (r) => h.u64(r ? r.stp : NIL_STP).u32(r ? r.cb : 0);
  fcr(hashedList); fcr(logRef); fcr(root); fcr(null);
  h.u64(bytes.length); h.u64(0);
  h.bytes(randomGuid()); h.u64(1); h.bytes(randomGuid());
  h.u32(0); h.u64(0).u32(0); h.u64(0).u32(0);
  h.u32(0x490060c6).u32(0x490060c6).u32(0x490060c6).u32(0x490060c6);
  const head = h.done();
  bytes.set(head, 0);
  return bytes;
}

/** Prüfung: jedes Objekt einer Gruppe ist Startobjekt oder wird verwiesen. */
export function unreferenced(objects, rootIds) {
  const used = new Set(rootIds.map(key));
  for (const o of objects) for (const p of o.props || []) {
    const list = p.t === T.oid ? [p.v] : p.t === T.oids ? p.v : [];
    list.forEach((x) => used.add(key(x)));
  }
  return objects.filter((o) => !used.has(key(o.id))).map((o) => o.jcid.toString(16));
}
