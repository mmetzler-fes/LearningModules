import * as crypto from 'crypto';
import { isQuickRule, quickToken, splitQuickToken } from './quick-token';

describe('Quick-Link mit Klasse', () => {
  it('setzt Token und Klasse zusammen und wieder auseinander', () => {
    const token = crypto.randomBytes(12).toString('base64url');
    const classId = crypto.randomUUID();
    expect(splitQuickToken(quickToken(token, classId))).toEqual({ token, classId });
  });

  it('lässt gewöhnliche Tokens in Ruhe', () => {
    for (let i = 0; i < 50; i++) expect(splitQuickToken(crypto.randomBytes(12).toString('base64url'))).toBeNull();
    expect(splitQuickToken('.abc')).toBeNull();
    expect(splitQuickToken('abc.')).toBeNull();
  });

  it('erkennt die Regel hinter einem Quick-Link-Knopf', () => {
    expect(isQuickRule({ classId: null, quickTopicId: 't1' })).toBe(true);
    expect(isQuickRule({ classId: null, quickNodeId: 'n1' })).toBe(true);
    expect(isQuickRule({ classId: 'k1', quickTopicId: 't1' })).toBe(false);
    expect(isQuickRule({ classId: null })).toBe(false);
    expect(isQuickRule(null)).toBe(false);
  });
});
