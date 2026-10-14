import { canonical, cleanPath, fingerprint, freshDate, mapCategories, networkMembers, newKeyPair, normalizeUrl, parseRemoteRef, pseudonym, remoteRef, shortestRoutes, sign, verify, MAX_PATH, MAX_SKEW_MS } from './federation-rules';

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

describe('Vertrauensnetzwerk', () => {
  const B = { serverId: 'B', name: 'Schule B' };
  const C = { serverId: 'C', name: 'Schule C' };

  it('Weg: ohne Angabe ein eigenes Angebot des Lieferanten', () => {
    expect(cleanPath(undefined, B)).toEqual([B]);
    expect(cleanPath([], B)).toEqual([B]);
  });

  it('Weg: muss beim Lieferanten enden, ohne Doppel, nicht zu lang', () => {
    expect(cleanPath([C, B], B)).toEqual([C, B]);
    expect(cleanPath([B, C], B)).toBeNull();
    expect(cleanPath([C, C, B], B)).toBeNull();
    expect(cleanPath([{ serverId: '' }, B], B)).toBeNull();
    const long = Array.from({ length: MAX_PATH }, (_, i) => ({ serverId: `S${i}`, name: `S${i}` }));
    expect(cleanPath([...long.slice(0, MAX_PATH - 1), B], B)).toHaveLength(MAX_PATH);
    expect(cleanPath([...long, B], B)).toBeNull();
  });

  it('dasselbe Angebot auf zwei Wegen: der kürzere', () => {
    const r = shortestRoutes([
      { origin: 'D:1', path: [1, 2, 3], via: 'lang' },
      { origin: 'D:1', path: [1, 2], via: 'kurz' },
      { origin: 'D:2', path: [1, 2, 3], via: 'einzig' },
    ]);
    expect(r.map((x) => x.via).sort()).toEqual(['einzig', 'kurz']);
  });

  it('bekannte Server: kürzester Abstand, ohne sich selbst, nicht zu weit', () => {
    const m = networkMembers([
      { id: 'B', name: 'B', servers: [{ serverId: 'C', name: 'C', hops: 1 }, { serverId: 'A', name: 'A', hops: 1 }, { serverId: 'F', name: 'F', hops: MAX_PATH }] },
      { id: 'C', name: 'C', servers: [{ serverId: 'D', name: 'D', hops: 1 }] },
    ], 'A');
    expect(m.map((x) => [x.serverId, x.hops])).toEqual([['B', 1], ['C', 1], ['D', 2]]);
  });

  it('Pseudonym: fest je Server und Person, verrät die Kennung nicht', () => {
    expect(pseudonym('A', 'u1')).toBe(pseudonym('A', 'u1'));
    expect(pseudonym('A', 'u1')).not.toBe(pseudonym('B', 'u1'));
    expect(pseudonym('A', 'u1')).not.toContain('u1');
  });
});
