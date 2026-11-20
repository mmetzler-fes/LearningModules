import * as crypto from 'crypto';
import { decodeJwt, emailOf, namesOf, pkce, verifyIdToken } from './oidc';

function makeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = publicKey.export({ format: 'jwk' });
  return { privateKey, jwk: { ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' } };
}
function sign(privateKey: crypto.KeyObject, payload: any, kid = 'k1') {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}

describe('OpenID Connect – ID-Token prüfen', () => {
  const { privateKey, jwk } = makeKey();
  const now = Date.now();
  const base = { iss: 'https://login.microsoftonline.com/t1/v2.0', aud: 'client-1', sub: 's', exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), nonce: 'n1' };
  const opts = { jwksUri: 'x', issuer: base.iss, audience: 'client-1', nonce: 'n1', now, keys: [jwk] };

  it('nimmt ein gültiges Token an', async () => {
    const c = await verifyIdToken(sign(privateKey, base), opts);
    expect(c.sub).toBe('s');
  });
  it('lehnt falsche Signatur, Aussteller, Empfänger, Ablauf und nonce ab', async () => {
    const other = makeKey();
    await expect(verifyIdToken(sign(other.privateKey, base), opts)).rejects.toThrow(/Signatur/);
    await expect(verifyIdToken(sign(privateKey, { ...base, iss: 'https://evil' }), opts)).rejects.toThrow(/Aussteller/);
    await expect(verifyIdToken(sign(privateKey, { ...base, aud: 'other' }), opts)).rejects.toThrow(/nicht für diese App/);
    await expect(verifyIdToken(sign(privateKey, { ...base, exp: Math.floor(now / 1000) - 600 }), opts)).rejects.toThrow(/abgelaufen/);
    await expect(verifyIdToken(sign(privateKey, { ...base, nonce: 'x' }), opts)).rejects.toThrow(/passt nicht/);
    await expect(verifyIdToken(sign(privateKey, base, 'unknown'), opts)).rejects.toThrow(/Unbekannter/);
  });
  it('PKCE, Namen und E-Mail', () => {
    const { verifier, challenge } = pkce();
    expect(crypto.createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(namesOf({ name: 'Muster, Max' } as any)).toMatchObject({ firstName: 'Max', lastName: 'Muster' });
    expect(namesOf({ given_name: 'Anna', family_name: 'Apfel' } as any).name).toBe('Anna Apfel');
    expect(emailOf({ preferred_username: 'A.Apfel@Schule.de' } as any)).toBe('a.apfel@schule.de');
    expect(decodeJwt(sign(privateKey, base)).header.kid).toBe('k1');
  });
});
