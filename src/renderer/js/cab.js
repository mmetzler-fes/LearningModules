// ==================== CABINET-ARCHIVE LESEN ====================
//
// Ein OneNote-Paket (.onepkg) ist ein Cabinet-Archiv (MS-CAB), meist mit
// LZX komprimiert. Der Browser kann das nicht von Haus aus – hier die
// Entpackung, nach der Beschreibung von Microsoft und dem Vorbild libmspack.
// Unterstützt: unkomprimiert und LZX; MSZIP und Quantum nicht (kommen in
// OneNote-Paketen nicht vor).
//
// Ohne Abhängigkeiten und ohne import (siehe src/core/browser-module.ts).

const CAB_RESERVE_PRESENT = 0x0004;
const CAB_PREV = 0x0001;
const CAB_NEXT = 0x0002;
const NAME_IS_UTF = 0x80;

/** Inhaltsverzeichnis eines Cabinet-Archivs. */
export function readCab(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 36 || b[0] !== 0x4d || b[1] !== 0x53 || b[2] !== 0x43 || b[3] !== 0x46) {
    throw new Error('Keine OneNote-Paketdatei (.onepkg).');
  }
  const coffFiles = v.getUint32(16, true);
  const cFolders = v.getUint16(26, true);
  const cFiles = v.getUint16(28, true);
  const flags = v.getUint16(30, true);
  let p = 36;
  let cbFolder = 0;
  let cbData = 0;
  if (flags & CAB_RESERVE_PRESENT) {
    const cbHeader = v.getUint16(p, true);
    cbFolder = b[p + 2];
    cbData = b[p + 3];
    p += 4 + cbHeader;
  }
  const skipString = () => { while (p < b.length && b[p] !== 0) p++; p++; };
  if (flags & CAB_PREV) { skipString(); skipString(); }
  if (flags & CAB_NEXT) { skipString(); skipString(); }
  if (flags & (CAB_PREV | CAB_NEXT)) throw new Error('Das Paket ist auf mehrere Dateien verteilt – bitte als eine Datei exportieren.');

  const folders = [];
  for (let i = 0; i < cFolders; i++) {
    folders.push({ start: v.getUint32(p, true), blocks: v.getUint16(p + 4, true), compression: v.getUint16(p + 6, true) });
    p += 8 + cbFolder;
  }
  const files = [];
  p = coffFiles;
  for (let i = 0; i < cFiles; i++) {
    const size = v.getUint32(p, true);
    const offset = v.getUint32(p + 4, true);
    const folder = v.getUint16(p + 8, true);
    const attribs = v.getUint16(p + 14, true);
    p += 16;
    const start = p;
    while (p < b.length && b[p] !== 0) p++;
    const raw = b.subarray(start, p);
    p++;
    // OneNote schreibt UTF-8, setzt das Kennzeichen dafür aber nicht immer.
    const name = (attribs & NAME_IS_UTF || isUtf8(raw) ? decodeUtf8(raw) : decodeLatin1(raw)).replace(/\\/g, '/');
    files.push({ name, size, offset, folder });
  }

  const cache = new Map();
  /** Inhalt eines Ordners (Folder) entpacken – höchstens bis `upTo` Bytes. */
  const folderData = (index, upTo) => {
    const done = cache.get(index);
    if (done && done.length >= upTo) return done;
    const f = folders[index];
    if (!f) throw new Error('Paket beschädigt (Ordner fehlt).');
    const blocks = [];
    let q = f.start;
    for (let i = 0; i < f.blocks; i++) {
      const cb = v.getUint16(q + 4, true);
      const cbUncomp = v.getUint16(q + 6, true);
      q += 8 + cbData;
      blocks.push({ data: b.subarray(q, q + cb), size: cbUncomp });
      q += cb;
    }
    const type = f.compression & 0x0f;
    let out;
    if (type === 0) {
      out = concat(blocks.map((x) => x.data));
    } else if (type === 3) {
      out = lzxDecompress(blocks, (f.compression >>> 8) & 0x1f, upTo);
    } else {
      throw new Error(`Komprimierung ${type === 1 ? 'MSZIP' : type === 2 ? 'Quantum' : type} wird nicht unterstützt.`);
    }
    cache.set(index, out);
    return out;
  };

  return {
    files,
    /** Bytes einer Datei aus dem Inhaltsverzeichnis. */
    extract(file) {
      const data = folderData(file.folder, file.offset + file.size);
      if (data.length < file.offset + file.size) throw new Error(`Paket beschädigt (${file.name} unvollständig).`);
      return data.subarray(file.offset, file.offset + file.size);
    },
  };
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

function decodeLatin1(bytes) {
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return s;
}

/** Gültiges UTF-8 (reines ASCII eingeschlossen)? */
function isUtf8(bytes) {
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i++];
    const n = c < 0x80 ? 0 : c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1;
    if (n < 0) return false;
    for (let k = 0; k < n; k++) if ((bytes[i++] & 0xc0) !== 0x80) return false;
  }
  return true;
}

function decodeUtf8(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i++];
    let cp = c;
    if (c >= 0xf0) cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (c >= 0xe0) cp = ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (c >= 0xc0) cp = ((c & 0x1f) << 6) | (bytes[i++] & 0x3f);
    s += String.fromCodePoint(cp);
  }
  return s;
}

// ---------- LZX ----------

const MIN_MATCH = 2;
const NUM_CHARS = 256;
const PRETREE_NUM = 20;
const ALIGNED_NUM = 8;
const NUM_SECONDARY_LENGTHS = 249;
const BLOCK_VERBATIM = 1;
const BLOCK_ALIGNED = 2;
const BLOCK_UNCOMPRESSED = 3;

const EXTRA_BITS = [];
const POSITION_BASE = [];
for (let i = 0, j = 0; i < 51; i += 2) {
  EXTRA_BITS[i] = j;
  EXTRA_BITS[i + 1] = j;
  if (i !== 0 && j < 17) j++;
}
for (let i = 0, j = 0; i < 51; i++) {
  POSITION_BASE[i] = j;
  j += 2 ** EXTRA_BITS[i];
}

/**
 * Kanonischer Huffman-Code: schnelle Tabelle für kurze Codes, für längere
 * Bit für Bit. Leere Längen ergeben einen Baum, der beim Lesen Fehler wirft.
 */
function buildTree(lengths, tableBits) {
  const count = new Array(17).fill(0);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Array(17).fill(0);
  for (let l = 1; l < 16; l++) offs[l + 1] = offs[l] + count[l];
  const sorted = new Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) sorted[offs[lengths[s]]++] = s;
  const table = new Int32Array(1 << tableBits).fill(-1);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let n = 0; n < count[l]; n++, k++) {
      if (l <= tableBits) {
        const from = code << (tableBits - l);
        const to = from + (1 << (tableBits - l));
        for (let x = from; x < to && x < table.length; x++) table[x] = (sorted[k] << 5) | l;
      }
      code++;
    }
    code <<= 1;
  }
  return { count, sorted, table, tableBits, empty: k === 0 };
}

function lzxDecompress(blocks, windowBits, upTo) {
  if (windowBits < 15 || windowBits > 21) throw new Error('LZX: ungültige Fenstergröße.');
  const input = concat(blocks.map((x) => x.data));
  const total = blocks.reduce((n, x) => n + x.size, 0);
  const limit = Math.min(total, upTo || total);
  const out = new Uint8Array(total);
  const windowSize = 1 << windowBits;
  const window = new Uint8Array(windowSize);
  const posnSlots = windowBits === 21 ? 50 : windowBits === 20 ? 42 : windowBits << 1;
  const mainLens = new Uint8Array(NUM_CHARS + posnSlots * 8);
  const lengthLens = new Uint8Array(NUM_SECONDARY_LENGTHS + 1);
  let mainTree = null;
  let lengthTree = null;
  let alignedTree = null;

  // Bitstrom: 16-Bit-Wörter little-endian, Bits vom höchsten an.
  let ip = 0;
  let buf = 0;
  let left = 0;
  const ensure = (n) => {
    while (left < n) {
      const w = (input[ip] | 0) | ((input[ip + 1] | 0) << 8);
      ip += 2;
      buf = (buf | (w << (16 - left))) >>> 0;
      left += 16;
    }
  };
  const peek = (n) => buf >>> (32 - n);
  const remove = (n) => { buf = (buf << n) >>> 0; left -= n; };
  const bits = (n) => {
    if (!n) return 0;
    if (n > 16) { const hi = bits(n - 16); return hi * 65536 + bits(16); }
    ensure(n);
    const x = peek(n);
    remove(n);
    return x;
  };
  const sym = (tree) => {
    if (tree.empty) throw new Error('LZX: leerer Huffman-Baum.');
    ensure(16);
    const e = tree.table[peek(tree.tableBits)];
    if (e >= 0) { remove(e & 31); return e >>> 5; }
    // Langsamer Weg für Codes, länger als die Tabelle.
    const word = peek(16);
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l <= 16; l++) {
      code |= (word >>> (16 - l)) & 1;
      const c = tree.count[l];
      if (code - first < c) { remove(l); return tree.sorted[index + code - first]; }
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('LZX: ungültiger Huffman-Code.');
  };
  const readLengths = (lens, first, last) => {
    const pre = new Array(PRETREE_NUM);
    for (let i = 0; i < PRETREE_NUM; i++) pre[i] = bits(4);
    const tree = buildTree(pre, 6);
    for (let x = first; x < last;) {
      let z = sym(tree);
      if (z === 17) { let y = bits(4) + 4; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 18) { let y = bits(5) + 20; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 19) {
        let y = bits(1) + 4;
        z = sym(tree);
        z = lens[x] - z;
        if (z < 0) z += 17;
        while (y-- && x < last) lens[x++] = z;
      } else {
        z = lens[x] - z;
        if (z < 0) z += 17;
        lens[x++] = z;
      }
    }
  };

  let R0 = 1;
  let R1 = 1;
  let R2 = 1;
  let pos = 0;
  let outPos = 0;
  let blockType = 0;
  let blockLength = 0;
  let blockRemaining = 0;
  let intelSize = 0;
  let intelStarted = false;

  ensure(1);
  if (bits(1)) intelSize = bits(16) * 65536 + bits(16);

  for (let frame = 0; frame < blocks.length && outPos < limit; frame++) {
    const frameSize = blocks[frame].size;
    const frameStart = pos;
    let todo = frameSize;
    while (todo > 0) {
      if (blockRemaining === 0) {
        if (blockType === BLOCK_UNCOMPRESSED && (blockLength & 1)) ip++;
        if (blockType === BLOCK_UNCOMPRESSED) { buf = 0; left = 0; }
        blockType = bits(3);
        blockRemaining = blockLength = bits(16) * 256 + bits(8);
        if (blockType === BLOCK_ALIGNED) {
          const al = new Array(ALIGNED_NUM);
          for (let i = 0; i < ALIGNED_NUM; i++) al[i] = bits(3);
          alignedTree = buildTree(al, 7);
        }
        if (blockType === BLOCK_ALIGNED || blockType === BLOCK_VERBATIM) {
          readLengths(mainLens, 0, NUM_CHARS);
          readLengths(mainLens, NUM_CHARS, mainLens.length);
          mainTree = buildTree(mainLens, 12);
          if (mainLens[0xe8]) intelStarted = true;
          readLengths(lengthLens, 0, NUM_SECONDARY_LENGTHS);
          lengthTree = buildTree(lengthLens, 12);
        } else if (blockType === BLOCK_UNCOMPRESSED) {
          intelStarted = true;
          ensure(16);
          if (left > 16) ip -= 2;
          buf = 0;
          left = 0;
          const r = (o) => input[ip + o] | (input[ip + o + 1] << 8) | (input[ip + o + 2] << 16) | (input[ip + o + 3] << 24);
          R0 = r(0) >>> 0; R1 = r(4) >>> 0; R2 = r(8) >>> 0;
          ip += 12;
        } else {
          throw new Error(`LZX: unbekannte Blockart ${blockType}.`);
        }
      }

      let run = Math.min(blockRemaining, todo);
      todo -= run;
      blockRemaining -= run;

      if (blockType === BLOCK_UNCOMPRESSED) {
        for (; run > 0; run--) { window[pos++] = input[ip++] | 0; if (pos === windowSize) pos = 0; }
        continue;
      }
      while (run > 0) {
        let main = sym(mainTree);
        if (main < NUM_CHARS) {
          window[pos++] = main;
          if (pos === windowSize) pos = 0;
          run--;
          continue;
        }
        main -= NUM_CHARS;
        let len = main & 7;
        if (len === 7) len += sym(lengthTree);
        len += MIN_MATCH;
        let off = main >>> 3;
        if (off === 0) {
          off = R0;
        } else if (off === 1) {
          off = R1; R1 = R0; R0 = off;
        } else if (off === 2) {
          off = R2; R2 = R0; R0 = off;
        } else {
          const extra = off >= 36 ? 17 : EXTRA_BITS[off];
          const base = POSITION_BASE[off] - 2;
          if (blockType === BLOCK_ALIGNED) {
            if (extra > 3) off = base + bits(extra - 3) * 8 + sym(alignedTree);
            else if (extra === 3) off = base + sym(alignedTree);
            else if (extra > 0) off = base + bits(extra);
            else off = 1;
          } else {
            off = base + bits(extra);
          }
          R2 = R1; R1 = R0; R0 = off;
        }
        let src = pos - off;
        if (src < 0) src += windowSize;
        for (let i = 0; i < len; i++) {
          window[pos++] = window[src++];
          if (pos === windowSize) pos = 0;
          if (src === windowSize) src = 0;
        }
        run -= len;
      }
      if (run < 0) {
        if (-run > blockRemaining) throw new Error('LZX: Treffer über das Blockende hinaus.');
        blockRemaining += run;
      }
    }

    // Rahmen ausgeben (das Fenster ist ein Vielfaches von 32 KB, kein Umlauf mitten im Rahmen).
    const frameOut = window.subarray(frameStart, frameStart + frameSize);
    out.set(frameOut, outPos);
    if (intelStarted && intelSize && frame < 32768 && frameSize > 10) {
      translateE8(out, outPos, frameSize, intelSize);
    }
    outPos += frameSize;
    // Bitstrom an 16 Bit ausrichten.
    if (left > 0) ensure(16);
    if (left & 15) remove(left & 15);
  }
  return outPos === total ? out : out.subarray(0, outPos);
}

/** E8-Übersetzung (x86-Sprünge) rückgängig machen. */
function translateE8(data, start, size, fileSize) {
  const end = start + size - 10;
  let cur = start;
  for (let i = start; i < end;) {
    if (data[i++] !== 0xe8) { cur++; continue; }
    const abs = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    if (abs >= -cur && abs < fileSize) {
      const rel = abs >= 0 ? abs - cur : abs + fileSize;
      data[i] = rel & 0xff; data[i + 1] = (rel >>> 8) & 0xff; data[i + 2] = (rel >>> 16) & 0xff; data[i + 3] = (rel >>> 24) & 0xff;
    }
    i += 4;
    cur += 5;
  }
}
