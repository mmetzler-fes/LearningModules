import { canonical, fingerprint, freshDate, mapCategories, newKeyPair, normalizeUrl, parseRemoteRef, remoteRef, sign, verify, MAX_SKEW_MS } from './federation-rules';

describe('Vernetzung: Signatur', () => {
  const a = newKeyPair();
  const b = newKeyPair();
  const text = canonical('post', '/api/federation/catalog?x=1', '2026-10-10T12:00:00.000Z', Buffer.from('{"a":1}'));

  it('was signiert wird', () => {
    expect(text.split('\n').slice(0, 3)).toEqual(['POST', '/api/federation/catalog?x=1', '2026-10-10T12:00:00.000Z']);
    expect(canonical('GET', '/x', 'd', null).split('\n')[3]).toBe(canonical('GET', '/x', 'd', '').split('\n')[3]);
  });

  it('gültig nur mit dem passenden Schlüssel und unverändertem Inhalt', () => {
    const sig = sign(a.privateKey, text);
    expect(verify(a.publicKey, text, sig)).toBe(true);
    expect(verify(b.publicKey, text, sig)).toBe(false);
    const other = canonical('POST', '/api/federation/catalog?x=1', '2026-10-10T12:00:00.000Z', Buffer.from('{"a":2}'));
    expect(verify(a.publicKey, other, sig)).toBe(false);
    expect(verify('kaputt', text, sig)).toBe(false);
  });

  it('Fingerabdruck', () => {
    expect(fingerprint(a.publicKey)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(fingerprint(a.publicKey)).not.toBe(fingerprint(b.publicKey));
  });

  it('Zeitfenster', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(freshDate('2026-10-10T12:04:00Z', now)).toBe(true);
    expect(freshDate(new Date(now - MAX_SKEW_MS - 1000).toISOString(), now)).toBe(false);
    expect(freshDate('gestern', now)).toBe(false);
  });
});

describe('Vernetzung: Adressen und Kennungen', () => {
  it('nur Schema und Host, https', () => {
    expect(normalizeUrl('lm.schule.de/irgendwas/')).toBe('https://lm.schule.de');
    expect(normalizeUrl('https://lm.schule.de:8443/')).toBe('https://lm.schule.de:8443');
    expect(normalizeUrl('http://lm.schule.de')).toBeNull();
    expect(normalizeUrl('http://localhost:3999', true)).toBe('http://localhost:3999');
    expect(normalizeUrl('https://user:pw@lm.schule.de')).toBeNull();
    expect(normalizeUrl('ftp://x.de')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('fremde Kennungen', () => {
    expect(remoteRef('S2', 'u1')).toBe('remote:S2:u1');
    expect(parseRemoteRef('remote:S2:u1:x')).toEqual({ peerId: 'S2', id: 'u1:x' });
    expect(parseRemoteRef('u1')).toBeNull();
  });
});

describe('Vernetzung: Kategorien abbilden', () => {
  const theirs = [
    { id: 'oeh-d:04005', facet: 'subject', parentId: null, label: 'Elektrotechnik' },
    { id: 'lm:et.at', facet: 'subject', parentId: 'oeh-d:04005', label: 'Automatisierungstechnik' },
    { id: 'local:x', facet: 'subject', parentId: 'lm:et.at', label: 'TIA-Portal' },
    { id: 'local:y', facet: 'stage', parentId: null, label: 'Eigene Stufe' },
  ];
  it('Bekanntes bleibt, Unbekanntes wird zum nächsten bekannten Oberbegriff', () => {
    const known = new Set(['oeh-d:04005', 'lm:et.at']);
    expect(mapCategories(['local:x', 'oeh-d:04005', 'local:y', 'gibtsnicht'], theirs, known).sort()).toEqual(['lm:et.at', 'oeh-d:04005']);
  });
});
