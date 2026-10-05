// Blowfish im CFB-Modus - von WebCrypto nicht angeboten, aber von der
// ODF-Verschlüsselung verlangt. Übernommen aus dem SchülerLernTool, dessen
// Klassenlisten so verschlüsselt sind.

import { P_INIT, S_INIT } from './blowfish-const.js';

export class Blowfish {
  constructor(keyBytes) {
    this.p = Uint32Array.from(P_INIT);
    this.s = [
      S_INIT.slice(0, 256), S_INIT.slice(256, 512),
      S_INIT.slice(512, 768), S_INIT.slice(768, 1024)
    ].map((b) => Uint32Array.from(b));

    // Schlüssel zyklisch in das P-Array einmischen.
    let k = 0;
    for (let i = 0; i < 18; i++) {
      let word = 0;
      for (let j = 0; j < 4; j++) {
        word = ((word << 8) | keyBytes[k % keyBytes.length]) >>> 0;
        k++;
      }
      this.p[i] = (this.p[i] ^ word) >>> 0;
    }

    // P-Array und S-Boxen fortlaufend mit sich selbst verschlüsseln.
    let l = 0, r = 0;
    for (let i = 0; i < 18; i += 2) {
      [l, r] = this.encryptBlock(l, r);
      this.p[i] = l;
      this.p[i + 1] = r;
    }
    for (let box = 0; box < 4; box++) {
      for (let i = 0; i < 256; i += 2) {
        [l, r] = this.encryptBlock(l, r);
        this.s[box][i] = l;
        this.s[box][i + 1] = r;
      }
    }
  }

  f(x) {
    const a = (x >>> 24) & 0xff, b = (x >>> 16) & 0xff;
    const c = (x >>> 8) & 0xff, d = x & 0xff;
    let y = (this.s[0][a] + this.s[1][b]) >>> 0;
    y = (y ^ this.s[2][c]) >>> 0;
    return (y + this.s[3][d]) >>> 0;
  }

  encryptBlock(l, r) {
    for (let i = 0; i < 16; i++) {
      l = (l ^ this.p[i]) >>> 0;
      r = (r ^ this.f(l)) >>> 0;
      [l, r] = [r, l];
    }
    [l, r] = [r, l];
    r = (r ^ this.p[16]) >>> 0;
    l = (l ^ this.p[17]) >>> 0;
    return [l, r];
  }

  /** Verschlüsselt einen 8-Byte-Block an Ort und Stelle (Big Endian). */
  encryptBlockBytes(block) {
    const view = new DataView(block.buffer, block.byteOffset, 8);
    const [l, r] = this.encryptBlock(view.getUint32(0), view.getUint32(4));
    view.setUint32(0, l);
    view.setUint32(4, r);
  }
}

/**
 * CFB mit voller Blockbreite (64 Bit). Verschlüsseln und Entschlüsseln
 * unterscheiden sich nur darin, welcher Text zurückgeführt wird.
 */
function cfb(key, iv, input, decrypt) {
  const bf = new Blowfish(key);
  const out = new Uint8Array(input.length);
  const feedback = Uint8Array.from(iv);

  for (let offset = 0; offset < input.length; offset += 8) {
    const keystream = Uint8Array.from(feedback);
    bf.encryptBlockBytes(keystream);
    const len = Math.min(8, input.length - offset);
    for (let i = 0; i < len; i++) {
      out[offset + i] = input[offset + i] ^ keystream[i];
    }
    // Rückgeführt wird stets der Geheimtext.
    const next = decrypt ? input.subarray(offset, offset + len) : out.subarray(offset, offset + len);
    feedback.set(next, 0);
  }
  return out;
}

export const blowfishCfbDecrypt = (key, iv, data) => cfb(key, iv, data, true);
