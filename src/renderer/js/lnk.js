// Windows-Verknüpfung (.lnk), die eine Adresse im Standardbrowser öffnet.
//
// Ziel ist %windir%\explorer.exe mit der Adresse als Argument – Explorer
// reicht sie an den Standardbrowser weiter, das klappt auch für Schüler mit
// eingeschränkten Rechten (kein cmd, kein PowerShell). Steht in der Adresse
// %COMPUTERNAME%, setzt Windows beim Öffnen den Rechnernamen ein (sofern es
// Umgebungsvariablen in den Argumenten auflöst – sonst kommt der Platzhalter
// an, und die App ignoriert ihn).
//
// Aufbau nach Microsoft [MS-SHLLINK]: Kopf, LinkInfo mit lokalem Pfad,
// Zeichenketten (Name, Argumente, Symbol), Umgebungs-Datenblöcke für Ziel
// und Symbol, Endblock.

const TARGET_ENV = '%windir%\\explorer.exe';
const TARGET_PATH = 'C:\\Windows\\explorer.exe';
// Ein Symbol, das nach Internet aussieht statt nach Ordner: Edge, falls
// vorhanden – sonst nimmt Windows selbst ein Standardsymbol.
const ICON_ENV = '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe';

class Writer {
  constructor() { this.parts = []; this.length = 0; }
  bytes(arr) { const b = arr instanceof Uint8Array ? arr : new Uint8Array(arr); this.parts.push(b); this.length += b.length; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.bytes(b); }
  zeros(n) { this.bytes(new Uint8Array(n)); }
  /** Nullterminiert, ein Byte je Zeichen (nur ASCII-Pfade). */
  ansiz(s) { this.bytes([...s].map((c) => c.charCodeAt(0) & 0xff)); this.bytes([0]); }
  /** StringData: Länge in Zeichen + UTF-16LE ohne Nullterminator. */
  counted(s) { this.u16(s.length); for (const c of s) this.u16(c.charCodeAt(0)); }
  done() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

/** EnvironmentVariableDataBlock bzw. IconEnvironmentDataBlock (je 788 Bytes). */
function envBlock(w, signature, value) {
  w.u32(0x314);
  w.u32(signature);
  const ansi = new Uint8Array(260);
  [...value].slice(0, 259).forEach((c, i) => { ansi[i] = c.charCodeAt(0) & 0xff; });
  w.bytes(ansi);
  const uni = new Uint8Array(520);
  const dv = new DataView(uni.buffer);
  [...value].slice(0, 259).forEach((c, i) => dv.setUint16(i * 2, c.charCodeAt(0), true));
  w.bytes(uni);
}

function linkInfo() {
  const volume = new Writer();
  volume.u32(0x11);          // VolumeIDSize
  volume.u32(3);             // DRIVE_FIXED
  volume.u32(0);             // Seriennummer unbekannt
  volume.u32(0x10);          // VolumeLabelOffset
  volume.bytes([0]);         // leere Bezeichnung
  const vol = volume.done();
  const base = new Writer(); base.ansiz(TARGET_PATH); const basePath = base.done();
  const headerSize = 0x1c;
  const size = headerSize + vol.length + basePath.length + 1;
  const w = new Writer();
  w.u32(size);
  w.u32(headerSize);
  w.u32(1);                                   // VolumeIDAndLocalBasePath
  w.u32(headerSize);                          // VolumeIDOffset
  w.u32(headerSize + vol.length);             // LocalBasePathOffset
  w.u32(0);                                   // kein Netzwerkpfad
  w.u32(headerSize + vol.length + basePath.length); // CommonPathSuffixOffset
  w.bytes(vol);
  w.bytes(basePath);
  w.bytes([0]);                               // leerer CommonPathSuffix
  return w.done();
}

/**
 * Baut die Verknüpfung. `url` ohne Anführungszeichen; `name` erscheint als
 * Kommentar/Tooltip.
 */
export function buildUrlShortcut(url, name = '') {
  const args = `"${String(url).replace(/"/g, '')}"`;
  const w = new Writer();
  // ---- ShellLinkHeader (76 Bytes) ----
  w.u32(0x4c);
  w.bytes([0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]);
  const HAS_LINK_INFO = 0x2, HAS_NAME = 0x4, HAS_ARGUMENTS = 0x20, HAS_ICON = 0x40, IS_UNICODE = 0x80;
  const HAS_EXP_STRING = 0x200, HAS_EXP_ICON = 0x4000;
  w.u32(HAS_LINK_INFO | (name ? HAS_NAME : 0) | HAS_ARGUMENTS | HAS_ICON | IS_UNICODE | HAS_EXP_STRING | HAS_EXP_ICON);
  w.u32(0x20);               // FILE_ATTRIBUTE_ARCHIVE
  w.zeros(24);               // Zeitstempel
  w.u32(0);                  // Dateigröße
  w.u32(0);                  // Symbolindex
  w.u32(1);                  // SW_SHOWNORMAL
  w.u16(0);                  // Tastenkürzel
  w.zeros(10);               // reserviert
  // ---- LinkInfo ----
  w.bytes(linkInfo());
  // ---- StringData ----
  if (name) w.counted(name);
  w.counted(args);
  w.counted(ICON_ENV);
  // ---- ExtraData ----
  envBlock(w, 0xa0000001, TARGET_ENV);
  envBlock(w, 0xa0000007, ICON_ENV);
  w.u32(0);                  // TerminalBlock
  return w.done();
}

/** Adresse mit Platzhalter für den Rechnernamen. */
export function withPcPlaceholder(url) {
  const u = String(url || '');
  return `${u}${u.includes('?') ? '&' : '?'}pc=%COMPUTERNAME%`;
}
