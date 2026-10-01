import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * Masterkey der App und die Verschlüsselung aller Exporte, die nicht reines
 * Creator-Material sind (Backups, fremde Module, H5P-Sicherungen).
 *
 * Verfahren: Für jede Datei wird aus dem Masterkey mit scrypt und einem
 * zufälligen Salz ein 256-Bit-Schlüssel abgeleitet, damit wird mit
 * AES-256-GCM verschlüsselt. GCM erkennt jede Veränderung an der Datei.
 *
 * Dateiformat (alles Binär):
 *   "LMENC1"  6 Byte  Kennung und Version
 *   fp        8 Byte  Fingerabdruck des Masterkeys (welcher Schlüssel?)
 *   salt     16 Byte  scrypt-Salz
 *   iv       12 Byte  GCM-Nonce
 *   tag      16 Byte  GCM-Prüfsumme
 *   …                 Chiffrat von gzip(JSON {kind, createdAt, data})
 *
 * Aufbewahrung: Die Masterkeys liegen in data/masterkeys.json, ihrerseits
 * verschlüsselt mit dem App-Secret (Umgebungsvariable APP_SECRET; fehlt sie,
 * erzeugt die App einmalig data/.app-secret mit Rechten 0600). Der Admin kann
 * den Masterkey setzen, aber nie wieder auslesen. Frühere Masterkeys bleiben
 * erhalten, damit ältere Backups lesbar bleiben.
 *
 * Wer ein Backup auf einem anderen Server einspielen will, setzt dort
 * denselben Masterkey – deshalb hängt die Ableitung allein am Masterkey und
 * nicht am App-Secret.
 */
const MAGIC = Buffer.from('LMENC1', 'ascii');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

interface StoredKey {
  fingerprint: string;
  createdAt: string;
  /** Masterkey, verschlüsselt mit dem App-Secret: iv.tag.cipher (base64). */
  sealed: string;
}

export type EncryptedKind = 'topic' | 'backup';

@Injectable()
export class MasterKeyService implements OnModuleInit {
  private readonly logger = new Logger(MasterKeyService.name);
  private readonly dir = path.join(process.cwd(), 'data');
  private readonly keyFile = path.join(this.dir, 'masterkeys.json');
  private readonly secretFile = path.join(this.dir, '.app-secret');

  onModuleInit() {
    // Ohne Masterkey ließe sich nichts verschlüsselt exportieren. Ein
    // zufälliger ist besser als keiner; der Admin ersetzt ihn, sobald Backups
    // auch woanders lesbar sein sollen.
    if (this.keys().length === 0) {
      this.setMasterKey(crypto.randomBytes(24).toString('base64url'));
      this.logger.warn('Kein Masterkey vorhanden – ein zufälliger wurde erzeugt. Bitte in der Administration einen eigenen setzen.');
    }
  }

  // ---- Aufbewahrung ----

  private appSecret(): Buffer {
    const fromEnv = process.env.APP_SECRET;
    if (fromEnv && fromEnv.length >= 16) return crypto.createHash('sha256').update(fromEnv).digest();
    if (!fs.existsSync(this.secretFile)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      this.logger.warn(`APP_SECRET nicht gesetzt – ${this.secretFile} angelegt. Für den Betrieb besser APP_SECRET setzen.`);
    }
    return crypto.createHash('sha256').update(fs.readFileSync(this.secretFile, 'utf8').trim()).digest();
  }

  private keys(): StoredKey[] {
    try {
      const list = JSON.parse(fs.readFileSync(this.keyFile, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /**
   * Ein Geheimnis (etwa das WebDAV-Passwort des Cloud-Backups) mit dem
   * App-Secret verschlüsseln – genauso, wie die Masterkeys aufbewahrt werden.
   */
  sealSecret(plain: string): string {
    return this.seal(plain);
  }

  unsealSecret(sealed: string): string {
    return this.unseal(sealed);
  }

  private seal(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.appSecret(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }

  private unseal(sealed: string): string {
    const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.appSecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  /** Kurzer Fingerabdruck, der den Masterkey nicht verrät. */
  private fingerprint(masterKey: string): string {
    return crypto.createHash('sha256').update(`lm-fp:${masterKey}`).digest().subarray(0, 8).toString('hex');
  }

  /** Was der Admin sehen darf: Fingerabdruck und Datum, nie den Schlüssel. */
  status() {
    const keys = this.keys();
    const current = keys[keys.length - 1];
    return {
      fingerprint: current?.fingerprint || null,
      setAt: current?.createdAt || null,
      previousKeys: Math.max(0, keys.length - 1),
      appSecretFromEnv: !!(process.env.APP_SECRET && process.env.APP_SECRET.length >= 16),
    };
  }

  /** Neuen Masterkey setzen; frühere bleiben zum Entschlüsseln erhalten. */
  setMasterKey(masterKey: string) {
    const key = String(masterKey || '');
    if (key.length < 12) throw new BadRequestException('Der Masterkey braucht mindestens 12 Zeichen.');
    const fp = this.fingerprint(key);
    const keys = this.keys().filter((k) => k.fingerprint !== fp);
    keys.push({ fingerprint: fp, createdAt: new Date().toISOString(), sealed: this.seal(key) });
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
    return this.status();
  }

  // ---- Ver- und Entschlüsseln ----

  encrypt(kind: EncryptedKind, data: any): Buffer {
    const keys = this.keys();
    const current = keys[keys.length - 1];
    if (!current) throw new BadRequestException('Es ist kein Masterkey gesetzt.');
    const masterKey = this.unseal(current.sealed);

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(masterKey, salt, 32, SCRYPT);
    const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ kind, createdAt: new Date().toISOString(), data }), 'utf8'));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, Buffer.from(current.fingerprint, 'hex'), salt, iv, cipher.getAuthTag(), enc]);
  }

  /** Erkennt eine verschlüsselte Datei an ihrer Kennung. */
  isEncrypted(buf: Buffer): boolean {
    return !!buf && buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
  }

  decrypt(buf: Buffer, expected: EncryptedKind): any {
    if (!this.isEncrypted(buf)) throw new BadRequestException('Das ist keine verschlüsselte Datei dieser App.');
    let o = MAGIC.length;
    const fp = buf.subarray(o, (o += 8)).toString('hex');
    const salt = buf.subarray(o, (o += 16));
    const iv = buf.subarray(o, (o += 12));
    const tag = buf.subarray(o, (o += 16));
    const enc = buf.subarray(o);

    const stored = this.keys().find((k) => k.fingerprint === fp);
    if (!stored) {
      throw new BadRequestException(
        'Die Datei wurde mit einem anderen Masterkey verschlüsselt. Der Admin kann ihn unter Administration → Shop & Sicherheit setzen.',
      );
    }
    let payload: any;
    try {
      const key = crypto.scryptSync(this.unseal(stored.sealed), salt, 32, SCRYPT);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
      payload = JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
    } catch {
      throw new BadRequestException('Die Datei ist beschädigt oder wurde verändert.');
    }
    if (payload?.kind !== expected) {
      throw new BadRequestException(
        expected === 'backup' ? 'Das ist kein Backup, sondern ein Themen-Export.' : 'Das ist kein Themen-Export, sondern ein Backup.',
      );
    }
    return payload.data;
  }
}
