// OpenDocument-Dateien im Browser lesen, auch verschlüsselte.
//
// Übernommen aus dem SchülerLernTool (odf-paket.js), dort ist jeder Weg
// beschrieben. Kurz: Das SchülerLernTool selbst schreibt Blowfish CFB mit
// PBKDF2-SHA1. Speichert man die Datei in LibreOffice neu, kommt bis 24.2
// AES-256-CBC heraus, danach AES-256-GCM mit Argon2id über das ganze Paket.
//
// Gelesen wird ausschließlich im Browser: Das Passwort der Klassenliste
// verlässt das Gerät nicht, zum Server gehen nur die Namen.
//
// Statt einer ZIP-Bibliothek reicht die eingebaute DecompressionStream-API
// (Deflate ohne Kopf, wie in ZIP und ODF).

import { blowfishCfbDecrypt } from './blowfish.js';

const NS_MANIFEST = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const NS_LOEXT = 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0';

/** Falsches Passwort – vom Aufrufer gezielt abfangbar. */
export class WrongPassword extends Error {
  constructor() {
    super('Das Passwort passt nicht zu dieser Datei.');
    this.name = 'WrongPassword';
  }
}

// ---------------------------------------------------------------- Hilfen

function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha(algo, bytes) {
  return new Uint8Array(await crypto.subtle.digest(algo, bytes));
}

async function pbkdf2(startKey, salt, iterations, bytes) {
  const material = await crypto.subtle.importKey('raw', startKey, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-1', salt, iterations }, material, bytes * 8);
  return new Uint8Array(bits);
}

/** argon2 aus hash-wasm – nur für Dateien aus neuerem LibreOffice, deshalb erst bei Bedarf geladen. */
function loadArgon2() {
  if (window.hashwasm?.argon2id) return Promise.resolve(window.hashwasm);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/argon2.umd.min.js', import.meta.url).href;
    script.onload = () => (window.hashwasm?.argon2id ? resolve(window.hashwasm) : reject(new Error('argon2 nicht verfügbar.')));
    script.onerror = () => reject(new Error('argon2 konnte nicht geladen werden.'));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------- ZIP

/**
 * Liest ein ZIP über das zentrale Verzeichnis – nur dort stehen die Größen
 * verlässlich, im lokalen Kopf fehlen sie bei nachgestelltem Datenblock.
 * Liefert { Pfad: Uint8Array } mit den entpackten Einträgen.
 */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist keine Tabelle im OpenDocument- oder Excel-Format.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Die Datei ist beschädigt.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Die Datei ist beschädigt.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (name.endsWith('/')) continue;
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await inflateRaw(data);
    else throw new Error('Die Datei ist mit einem unbekannten Verfahren gepackt.');
  }
  return files;
}

// ---------------------------------------------------------------- Entschlüsseln

const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const child = (node, name) => node.getElementsByTagNameNS(NS_MANIFEST, name)[0] || null;
const attr = (node, name, ns = NS_MANIFEST) => (node ? node.getAttributeNS(ns, name) : null) || null;

/** Beschreibt, wie ein Eintrag verschlüsselt ist – oder null. */
function encryptionOf(entry) {
  const data = child(entry, 'encryption-data');
  if (!data) return null;
  const algo = child(data, 'algorithm');
  const start = child(data, 'start-key-generation');
  const derivation = child(data, 'key-derivation');
  return {
    algorithm: attr(algo, 'algorithm-name') || '',
    iv: fromBase64(attr(algo, 'initialisation-vector') || ''),
    startKey: /sha256/i.test(attr(start, 'start-key-generation-name') || '') ? 'SHA-256' : 'SHA-1',
    derivation: attr(derivation, 'key-derivation-name') || '',
    salt: fromBase64(attr(derivation, 'salt') || ''),
    iterations: Number(attr(derivation, 'iteration-count')) || 0,
    keySize: Number(attr(derivation, 'key-size')) || 16,
    argon: {
      iterations: Number(attr(derivation, 'argon2-iterations', NS_LOEXT)) || 0,
      memory: Number(attr(derivation, 'argon2-memory', NS_LOEXT)) || 0,
      lanes: Number(attr(derivation, 'argon2-lanes', NS_LOEXT)) || 0,
    },
    checksumType: attr(data, 'checksum-type') || '',
    checksum: attr(data, 'checksum'),
  };
}

async function deriveKey(v, password) {
  const start = await sha(v.startKey, new TextEncoder().encode(password));
  if (/argon2id/i.test(v.derivation)) {
    const { argon2id } = await loadArgon2();
    return argon2id({
      password: start,
      salt: v.salt,
      iterations: v.argon.iterations,
      memorySize: v.argon.memory,
      parallelism: v.argon.lanes,
      hashLength: v.keySize,
      outputType: 'binary',
    });
  }
  if (/pbkdf2/i.test(v.derivation)) return pbkdf2(start, v.salt, v.iterations, v.keySize);
  throw new Error('Diese Verschlüsselung wird nicht unterstützt.');
}

/**
 * AES-CBC mit beliebigem Auffüllen. WebCrypto akzeptiert nur PKCS#7; ODF
 * erlaubt auch zufällige Füllbytes. Ein angehängter Block, der garantiert
 * gültig endet, umgeht die Prüfung – die echten Füllbytes werden danach
 * anhand des letzten Bytes entfernt.
 */
async function aesCbc(key, iv, data) {
  if (!data.length || data.length % 16) throw new WrongPassword();
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const last = data.subarray(data.length - 16);
  const extra = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, k, new Uint8Array(16).fill(16)),
  ).subarray(0, 16);
  const longer = new Uint8Array(data.length + 16);
  longer.set(data);
  longer.set(extra, data.length);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, longer));
  const padding = plain[plain.length - 1];
  if (padding < 1 || padding > 16) throw new WrongPassword();
  return plain.subarray(0, plain.length - padding);
}

async function decryptEntry(data, v, password) {
  const key = await deriveKey(v, password);
  let packed;
  if (/gcm/i.test(v.algorithm)) {
    // LibreOffice stellt das IV zusätzlich den Daten voran.
    const iv = data.subarray(0, 12);
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    try {
      packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, data.subarray(12)));
    } catch {
      throw new WrongPassword(); // GCM prüft selbst, ob der Schlüssel stimmt
    }
  } else if (/aes256-cbc/i.test(v.algorithm)) {
    packed = await aesCbc(key, v.iv, data);
  } else if (/blowfish/i.test(v.algorithm)) {
    packed = blowfishCfbDecrypt(key, v.iv, data);
  } else {
    throw new Error('Diese Verschlüsselung wird nicht unterstützt.');
  }

  if (v.checksum) {
    const algo = /sha256/i.test(v.checksumType) ? 'SHA-256' : 'SHA-1';
    if (toBase64(await sha(algo, packed.subarray(0, 1024))) !== v.checksum) throw new WrongPassword();
  }
  try {
    return await inflateRaw(packed);
  } catch {
    throw new WrongPassword();
  }
}

// ---------------------------------------------------------------- Öffnen

/** Prüft, ob eine Datei verschlüsselt ist, ohne ein Passwort zu brauchen. */
export async function odfInfo(bytes) {
  const zip = await unzip(bytes);
  const manifest = zip['META-INF/manifest.xml'];
  if (!manifest) throw new Error('Die Datei ist keine OpenDocument-Datei.');
  const encrypted = [...xml(manifest).getElementsByTagNameNS(NS_MANIFEST, 'file-entry')].some((e) =>
    child(e, 'encryption-data'),
  );
  return { encrypted };
}

/**
 * Öffnet eine ODF-Datei und liefert ihre Einträge entschlüsselt
 * ({ 'content.xml': Uint8Array, ... }). Wirft WrongPassword, wenn das
 * Passwort nicht passt.
 */
export async function openOdf(bytes, password) {
  const zip = await unzip(bytes);
  const manifestBytes = zip['META-INF/manifest.xml'];
  if (!manifestBytes) throw new Error('Die Datei ist keine OpenDocument-Datei.');
  const entries = [...xml(manifestBytes).getElementsByTagNameNS(NS_MANIFEST, 'file-entry')];

  // Neueres LibreOffice: das ganze Paket steckt verschlüsselt in einem Eintrag.
  const whole = entries.find((e) => attr(e, 'full-path') === 'encrypted-package');
  if (whole && zip['encrypted-package']) {
    const v = encryptionOf(whole);
    if (!v) throw new Error('Die Datei ist beschädigt.');
    if (!password) throw new WrongPassword();
    return openOdf(await decryptEntry(zip['encrypted-package'], v, password), null);
  }

  const files = {};
  for (const e of entries) {
    const path = attr(e, 'full-path');
    if (!path || !zip[path] || path.endsWith('/')) continue;
    const v = encryptionOf(e);
    if (!v) {
      files[path] = zip[path];
      continue;
    }
    if (!password) throw new WrongPassword();
    files[path] = await decryptEntry(zip[path], v, password);
  }
  for (const [path, content] of Object.entries(zip)) if (!(path in files)) files[path] = content;
  return files;
}
