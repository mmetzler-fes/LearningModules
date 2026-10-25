// ==================== ONENOTE-DATEIEN LESEN ====================
//
// Liest einen exportierten OneNote-Abschnitt (.one, Format MS-ONESTORE mit
// den Inhalten nach MS-ONE) im Browser: Seiten mit Titel und Ebene, dazu die
// angehängten Dateien und Bilder jeder Seite. Text, Freihand und Layout
// bleiben bewusst außen vor (docs/onenote-import.md).
//
// Ohne Abhängigkeiten und ohne import, damit dieselbe Datei auch in den Tests
// läuft (src/core/browser-module.ts).

const FILE_DATA_HEADER = 'bde316e7-2665-4511-a4c4-8d4d0b7a9eac';
const ONE_FILE_TYPE = '7b5c52e4-d88c-4da7-aeb1-5378d02996d3';
const FRAGMENT_MAGIC_LO = 0xf5f7f4c4;
const FRAGMENT_MAGIC_HI = 0xa4567ab1;

/** Objektarten (JCID) aus MS-ONE, soweit wir sie brauchen. */
const JCID = {
  sectionNode: 0x00060007,
  pageSeriesNode: 0x00060008,
  pageNode: 0x0006000b,
  imageNode: 0x00060011,
  pageMetaData: 0x00020030,
  embeddedFileNode: 0x00060035,
  pageManifestNode: 0x00060037,
};

/** Eigenschaften (PropertyID ohne Typbits) aus MS-ONE. */
const PROP = {
  cachedTitleString: 0x1cf3,
  pageLevel: 0x1dff,
  embeddedFileName: 0x1d9c,
  embeddedFileContainer: 0x1d9b,
  pictureContainer: 0x1c3f,
  imageFilename: 0x1dd7,
  childGraphSpaceElementNodes: 0x1d63,
  metaDataObjectsAboveGraphSpace: 0x3442,
};

class Reader {
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }
  u8() { return this.b[this.pos++]; }
  u16() { const x = this.v.getUint16(this.pos, true); this.pos += 2; return x; }
  u32() { const x = this.v.getUint32(this.pos, true); this.pos += 4; return x; }
  u64() { const lo = this.u32(); const hi = this.u32(); return hi * 0x100000000 + lo; }
  guid() { const g = guidAt(this.b, this.pos); this.pos += 16; return g; }
  extGuid() { const g = this.guid(); return `${g}:${this.u32()}`; }
}

/** GUID in der üblichen Schreibweise (die ersten drei Felder little-endian). */
function guidAt(b, p) {
  const h = (i) => b[p + i].toString(16).padStart(2, '0');
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

function utf16(bytes) {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return s.replace(/\0+$/, '');
}

/** FileNodeChunkReference: Lage und Länge, je nach Format verschieden kodiert. */
function chunkRef(r, stpFormat, cbFormat) {
  let stp;
  if (stpFormat === 0) stp = r.u64();
  else if (stpFormat === 1) stp = r.u32();
  else if (stpFormat === 2) stp = r.u16() * 8;
  else stp = r.u32() * 8;
  let cb;
  if (cbFormat === 0) cb = r.u32();
  else if (cbFormat === 1) cb = r.u64();
  else if (cbFormat === 2) cb = r.u8() * 8;
  else cb = r.u16() * 8;
  return { stp, cb };
}

/**
 * Eine FileNodeList über alle Fragmente lesen. Ergebnis: Knoten mit ID,
 * Rohdaten-Leser (bei der Datenposition) und ggf. Verweis.
 */
function readNodeList(bytes, ref, seen = new Set()) {
  const nodes = [];
  let frag = ref;
  while (frag && frag.stp && frag.cb && !seen.has(frag.stp)) {
    seen.add(frag.stp);
    const r = new Reader(bytes, frag.stp);
    if (r.u32() !== FRAGMENT_MAGIC_LO || r.u32() !== FRAGMENT_MAGIC_HI) throw new Error('OneNote-Datei beschädigt (Fragment).');
    r.u32(); // FileNodeListID
    r.u32(); // nFragmentSequence
    const end = frag.stp + frag.cb - 20; // nextFragment (12) + Fußzeile (8)
    let terminated = false;
    while (r.pos + 4 <= end) {
      const start = r.pos;
      const head = r.u32();
      const id = head & 0x3ff;
      const size = (head >>> 10) & 0x1fff;
      const stpFormat = (head >>> 23) & 0x3;
      const cbFormat = (head >>> 25) & 0x3;
      const baseType = (head >>> 27) & 0xf;
      if (id === 0 || size < 4) break;
      if (id === 0x0ff) { terminated = true; break; }
      const node = { id, ref: null, r: null };
      if (baseType === 1 || baseType === 2) node.ref = chunkRef(r, stpFormat, cbFormat);
      node.r = new Reader(bytes, r.pos);
      node.end = start + size;
      nodes.push(node);
      r.pos = start + size;
    }
    const n = new Reader(bytes, frag.stp + frag.cb - 20);
    // Nach dem Endzeichen ist der Rest des Fragments leer – weiter geht es im nächsten.
    void terminated;
    const next = { stp: n.u64(), cb: n.u32() };
    frag = next.cb && next.stp + next.cb <= bytes.length ? next : null;
  }
  return nodes;
}

/** CompactID → ExtendedGUID über die Tabelle des Objekts. */
function resolveCompact(raw, table) {
  const n = raw & 0xff;
  const idx = raw >>> 8;
  if (!n && !idx) return null;
  const g = table.get(idx);
  return g ? `${g}:${n}` : null;
}

/**
 * Ein ObjectSpaceObjectPropSet lesen: Eigenschaften nach ID; Objekt- und
 * Objektraum-Verweise schon als ExtendedGUID.
 */
function readPropSet(bytes, ref, table) {
  const r = new Reader(bytes, ref.stp);
  const stream = () => {
    const head = r.u32();
    const count = head & 0xffffff;
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(resolveCompact(r.u32(), table));
    return { ids, extended: !!(head & 0x40000000), noOsid: !!(head & 0x80000000) };
  };
  const oids = stream();
  let osids = { ids: [], extended: false };
  let ctx = { ids: [] };
  if (!oids.noOsid) osids = stream();
  if (osids.extended) ctx = stream();
  const cur = { oid: 0, osid: 0, ctx: 0 };

  const readSet = () => {
    const count = r.u16();
    const prids = [];
    for (let i = 0; i < count; i++) prids.push(r.u32());
    const props = new Map();
    for (const prid of prids) {
      const id = prid & 0x3ffffff;
      const type = (prid >>> 26) & 0x1f;
      props.set(id & 0xffff, readValue(type, prid));
    }
    return props;
  };
  const readValue = (type, prid) => {
    switch (type) {
      case 0x1: return null;
      case 0x2: return !!(prid >>> 31);
      case 0x3: return r.u8();
      case 0x4: return r.u16();
      case 0x5: return r.u32();
      case 0x6: return r.u64();
      case 0x7: { const len = r.u32(); const data = bytes.subarray(r.pos, r.pos + len); r.pos += len; return data; }
      case 0x8: return oids.ids[cur.oid++] || null;
      case 0x9: { const n = r.u32(); const out = oids.ids.slice(cur.oid, cur.oid + n); cur.oid += n; return out; }
      case 0xa: return osids.ids[cur.osid++] || null;
      case 0xb: { const n = r.u32(); const out = osids.ids.slice(cur.osid, cur.osid + n); cur.osid += n; return out; }
      case 0xc: return ctx.ids[cur.ctx++] || null;
      case 0xd: { const n = r.u32(); const out = ctx.ids.slice(cur.ctx, cur.ctx + n); cur.ctx += n; return out; }
      case 0x10: {
        const n = r.u32();
        if (!n) return [];
        r.u32(); // prid der Elemente (Typ PropertySet)
        const out = [];
        for (let i = 0; i < n; i++) out.push(readSet());
        return out;
      }
      case 0x11: return readSet();
      default: throw new Error(`Unbekannter Eigenschaftstyp ${type}.`);
    }
  };
  return readSet();
}

/** Objekte einer Objektgruppe bzw. Revision einsammeln. */
function collectObjects(bytes, nodes, objects, fileData) {
  let table = new Map();
  const declare = (oid, jcid, ref, extra = {}) => {
    const key = resolveCompact(oid, table);
    if (key) objects.set(key, { jcid, ref, table, ...extra });
  };
  for (const node of nodes) {
    const r = node.r;
    switch (node.id) {
      case 0x0b0: // ObjectGroupListReferenceFND
        collectObjects(bytes, readNodeList(bytes, node.ref), objects, fileData);
        break;
      case 0x021: case 0x022: // GlobalIdTableStart(2)FND
        table = new Map();
        break;
      case 0x024: { // GlobalIdTableEntryFNDX
        const idx = r.u32();
        table.set(idx, r.guid());
        break;
      }
      case 0x02d: case 0x02e: { // ObjectDeclarationWithRefCount(2)FNDX
        const oid = r.u32();
        const bits = r.u16();
        declare(oid, (bits & 0x3ff) | 0x00060000, node.ref);
        break;
      }
      case 0x0a4: case 0x0a5: case 0x0c4: case 0x0c5: { // ObjectDeclaration2…
        const oid = r.u32();
        declare(oid, r.u32(), node.ref);
        break;
      }
      case 0x041: case 0x042: { // ObjectRevisionWithRefCount(2)FNDX
        const key = resolveCompact(r.u32(), table);
        const old = key && objects.get(key);
        if (old) objects.set(key, { ...old, ref: node.ref, table });
        break;
      }
      case 0x072: case 0x073: { // ObjectDeclarationFileData3(Large)RefCountFND
        const oid = r.u32();
        const jcid = r.u32();
        if (node.id === 0x072) r.u8(); else r.u32();
        const len = r.u32();
        const ref = utf16(bytes.subarray(r.pos, r.pos + len * 2));
        const m = /\{([0-9a-f-]{36})\}/i.exec(ref);
        declare(oid, jcid, null, { file: m ? fileData.get(m[1].toLowerCase()) || null : null });
        break;
      }
      default:
        break;
    }
  }
}

/** Alle Objekträume: gosid → { objects, roots }, dazu die Wurzel. */
function readObjectSpaces(bytes) {
  const h = new Reader(bytes, 0);
  if (h.guid() !== ONE_FILE_TYPE) throw new Error('Keine OneNote-Abschnittsdatei (.one).');
  const r = new Reader(bytes, 172);
  const root = readNodeList(bytes, { stp: r.u64(), cb: r.u32() });

  const fileData = new Map();
  for (const node of root.filter((n) => n.id === 0x090)) {
    for (const f of readNodeList(bytes, node.ref)) {
      if (f.id !== 0x094) continue;
      const guid = f.r.guid();
      const fr = new Reader(bytes, f.ref.stp);
      if (fr.guid() !== FILE_DATA_HEADER) continue;
      const length = fr.u64();
      fileData.set(guid, { offset: f.ref.stp + 36, length });
    }
  }

  let rootSpace = null;
  const spaces = new Map();
  for (const node of root) {
    if (node.id === 0x004) rootSpace = node.r.extGuid();
    if (node.id !== 0x008) continue;
    const gosid = node.r.extGuid();
    const manifest = readNodeList(bytes, node.ref);
    const revRef = manifest.filter((n) => n.id === 0x010).pop();
    if (!revRef) continue;
    spaces.set(gosid, readRevisions(bytes, readNodeList(bytes, revRef.ref), fileData));
  }
  return { rootSpace, spaces, fileData };
}

/**
 * Stand eines Objektraums: die letzte Revision mit Standardinhalt, aufgebaut
 * über die Kette der Revisionen, von denen sie abhängt.
 */
function readRevisions(bytes, nodes, fileData) {
  const revs = new Map();
  let cur = null;
  const order = [];
  for (const node of nodes) {
    if (node.id === 0x01e || node.id === 0x01f || node.id === 0x01b) {
      const rid = node.r.extGuid();
      const dep = node.r.extGuid();
      cur = { rid, dep, nodes: [], roots: new Map(), role: 1 };
      if (node.id !== 0x01b) cur.role = node.r.u32();
      if (node.id === 0x01f) { node.r.u16(); cur.ctx = node.r.extGuid(); }
      revs.set(rid, cur);
      order.push(cur);
    } else if (node.id === 0x01c) {
      cur = null;
    } else if (cur) {
      cur.nodes.push(node);
    }
  }
  const nil = '00000000-0000-0000-0000-000000000000:0';
  const isDefaultCtx = (rev) => !rev.ctx || rev.ctx === nil;
  const last = [...order].reverse().find((rev) => rev.role === 1 && isDefaultCtx(rev)) || order[order.length - 1];
  const chain = [];
  for (let rev = last; rev && !chain.includes(rev); rev = revs.get(rev.dep)) chain.unshift(rev);
  const objects = new Map();
  const roots = new Map();
  for (const rev of chain) {
    collectObjects(bytes, rev.nodes, objects, fileData);
    for (const node of rev.nodes) {
      if (node.id === 0x05a) { const oid = node.r.extGuid(); roots.set(node.r.u32(), oid); }
    }
  }
  return { objects, roots };
}

/** Eigenschaften eines Objekts (zwischengespeichert). */
function propsOf(bytes, obj) {
  if (!obj || !obj.ref) return new Map();
  if (!obj.props) obj.props = readPropSet(bytes, obj.ref, obj.table);
  return obj.props;
}

const asText = (v) => (v instanceof Uint8Array ? utf16(v) : '');

/** Alle Objekte unter `start`, in Reihenfolge der Verweise (Tiefensuche). */
function walk(bytes, objects, start, visit) {
  const seen = new Set();
  const go = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const obj = objects.get(key);
    if (!obj) return;
    visit(obj, key);
    for (const v of propsOf(bytes, obj).values()) {
      if (typeof v === 'string') go(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') go(x);
    }
  };
  go(start);
}

/** Dateiart an den ersten Bytes. */
function sniff(data) {
  const s = (i, t) => [...t].every((c, k) => data[i + k] === c.charCodeAt(0));
  if (s(0, '%PDF')) return { ext: 'pdf', type: 'application/pdf' };
  if (data[0] === 0x89 && s(1, 'PNG')) return { ext: 'png', type: 'image/png' };
  if (data[0] === 0xff && data[1] === 0xd8) return { ext: 'jpg', type: 'image/jpeg' };
  if (s(0, 'GIF8')) return { ext: 'gif', type: 'image/gif' };
  return { ext: 'bin', type: 'application/octet-stream' };
}

/**
 * Abschnitt lesen. Ergebnis: `{ pages: [{ title, level, files, images }] }`;
 * je Datei `{ name, size, data() }` – die Bytes erst auf Abruf.
 */
export function readOneSection(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { rootSpace, spaces } = readObjectSpaces(bytes);
  const section = spaces.get(rootSpace);
  if (!section) throw new Error('Abschnitt ohne Inhalt.');

  const blob = (file) => () => bytes.subarray(file.offset, file.offset + file.length);
  // Seiten in der Reihenfolge des Abschnitts: Seitenreihe → Objekträume der Seiten.
  const pageSpaces = [];
  walk(bytes, section.objects, section.roots.get(1), (obj) => {
    if (obj.jcid !== JCID.pageSeriesNode) return;
    const list = propsOf(bytes, obj).get(PROP.childGraphSpaceElementNodes);
    if (Array.isArray(list)) for (const id of list) if (id && !pageSpaces.includes(id)) pageSpaces.push(id);
  });

  const pages = [];
  for (const gosid of pageSpaces) {
    const space = spaces.get(gosid);
    if (!space) continue;
    const meta = propsOf(bytes, space.objects.get(space.roots.get(2)));
    const page = {
      title: asText(meta.get(PROP.cachedTitleString)).trim(),
      level: Number(meta.get(PROP.pageLevel)) || 1,
      files: [],
      images: [],
    };
    walk(bytes, space.objects, space.roots.get(1), (obj) => {
      const props = propsOf(bytes, obj);
      if (obj.jcid === JCID.embeddedFileNode) {
        const container = space.objects.get(props.get(PROP.embeddedFileContainer));
        if (!container || !container.file) return;
        page.files.push({ name: asText(props.get(PROP.embeddedFileName)) || 'Anhang', size: container.file.length, data: blob(container.file) });
      } else if (obj.jcid === JCID.imageNode) {
        const container = space.objects.get(props.get(PROP.pictureContainer));
        if (!container || !container.file) return;
        page.images.push({ name: asText(props.get(PROP.imageFilename)), size: container.file.length, data: blob(container.file) });
      }
    });
    for (const f of [...page.files, ...page.images]) f.kind = sniff(f.data().subarray(0, 8));
    pages.push(page);
  }
  return { pages };
}

/** Nur für die Entwicklung: rohe Objekte eines Abschnitts (jcid, Eigenschaften). */
export function dumpOneSection(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { rootSpace, spaces, fileData } = readObjectSpaces(bytes);
  const out = { rootSpace, files: fileData.size, spaces: [] };
  for (const [gosid, space] of spaces) {
    const objs = [];
    for (const [key, obj] of space.objects) {
      let props = {};
      try {
        for (const [k, v] of propsOf(bytes, obj)) {
          props[k.toString(16)] = v instanceof Uint8Array ? (v.length < 400 ? utf16(v) : `<${v.length} B>`) : v;
        }
      } catch (e) { props = { error: e.message }; }
      objs.push({ key, jcid: obj.jcid.toString(16), file: obj.file ? obj.file.length : undefined, props });
    }
    out.spaces.push({ gosid, roots: Object.fromEntries(space.roots), objects: objs });
  }
  return out;
}

// ---------- Was übernommen wird ----------

/** Bereiche eines Klassennotizbuchs, deutsch und englisch. */
const CLASS_KEEP = ['_inhaltsbibliothek', '_content library', '_nur für lehrer', '_teacher only'];
const CLASS_MARK = [...CLASS_KEEP, '_collaboration space', '_platz für zusammenarbeit'];
const RECYCLE = /^onenote_recyclebin$/i;

const byName = (a, b) => a.title.localeCompare(b.title, 'de', { numeric: true });

/**
 * Aufbau eines Notizbuchs aus den Pfaden seiner Abschnitte (`Gruppe/…/Abschnitt.one`).
 * Bei einem Klassennotizbuch bleiben nur Inhaltsbibliothek und „Nur für
 * Lehrer“ – Schülerbereiche, Platz für Zusammenarbeit und Abschnitte oben
 * (Willkommen) fallen weg; `skipped` zählt sie, ohne Namen zu nennen.
 * Ergebnis: `{ classNotebook, root: { title, path, sections, groups }, skipped }`.
 */
export function notebookPlan(paths) {
  const sections = paths.filter((p) => /\.one$/i.test(p)).map((p) => p.split('/').filter(Boolean))
    .filter((parts) => !parts.slice(0, -1).some((x) => RECYCLE.test(x)));
  const top = new Set(sections.filter((p) => p.length > 1).map((p) => p[0].toLowerCase()));
  const classNotebook = [...top].some((t) => CLASS_MARK.includes(t));
  let skipped = 0;
  const root = { title: '', path: '', sections: [], groups: [] };
  for (const parts of sections) {
    if (classNotebook && !(parts.length > 1 && CLASS_KEEP.includes(parts[0].toLowerCase()))) { skipped++; continue; }
    let node = root;
    for (const [i, name] of parts.slice(0, -1).entries()) {
      const path = parts.slice(0, i + 1).join('/');
      let next = node.groups.find((g) => g.path === path);
      if (!next) {
        next = { title: name.replace(/^_+/, '').trim() || name, path, sections: [], groups: [] };
        node.groups.push(next);
      }
      node = next;
    }
    node.sections.push({ title: parts[parts.length - 1].replace(/\.one$/i, ''), path: parts.join('/') });
  }
  const sort = (n) => { n.sections.sort(byName); n.groups.sort(byName); n.groups.forEach(sort); };
  sort(root);
  return { classNotebook, root, skipped };
}

/**
 * Module aus den Seiten eines Abschnitts: je Seite mit Anlagen ein Modul mit
 * allen Dateien. Unterseiten heißen „Seite › Unterseite“. Ein Ausdruck ohne
 * Originaldatei (nur die Seitenbilder `Name_1.png`, `Name_2.png` …) wird als
 * `printouts` gemeldet – daraus macht der Dialog ein PDF.
 * Ergebnis: `{ modules: [{ title, files, printouts }], empty }`.
 */
export function sectionModules(pages) {
  const modules = [];
  const parents = [];
  let empty = 0;
  for (const page of pages) {
    const title = page.title || 'Ohne Titel';
    parents.length = Math.max(0, page.level - 1);
    const full = [...parents.filter(Boolean), title].join(' › ');
    parents[page.level - 1] = title;
    const stems = new Set(page.files.map((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase()));
    const groups = new Map();
    for (const img of page.images) {
      const m = /^(.+?)_(\d+)(?:\.[A-Za-z0-9]+)?$/.exec(img.name || '');
      if (!m) continue;
      const stem = m[1].replace(/\.[A-Za-z0-9]{2,4}$/, '');
      if (stems.has(stem.toLowerCase())) continue;
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem).push({ n: Number(m[2]), image: img });
    }
    const printouts = [...groups].map(([stem, list]) => ({
      name: `${stem}.pdf`,
      images: list.sort((a, b) => a.n - b.n).map((x) => x.image),
    }));
    if (!page.files.length && !printouts.length) { empty++; continue; }
    modules.push({ title: full, files: page.files, printouts });
  }
  return { modules, empty };
}

/**
 * PDF aus JPEG-Bildern, je Bild eine Seite in A4-Breite:
 * `[{ bytes: Uint8Array, width, height }]` → Uint8Array.
 */
export function jpegsToPdf(images) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 0xff) : x;
    parts.push(b);
    length += b.length;
  };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`));
  images.forEach((img, i) => {
    const page = 3 + i * 3;
    const w = 595.28;
    const h = Math.round((w * img.height) / img.width * 100) / 100;
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`));
    obj(page + 1, () => { push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); });
    obj(page + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      push(img.bytes);
      push('\nendstream');
    });
  });
  const count = 3 + images.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
