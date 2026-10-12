import { codeAt, generateSecret, isUsedCode, issuerFor, otpauthUrl, verifyCode } from './totp';

describe('Zwei-Faktor: Codes', () => {
  const secret = generateSecret();
  const t = Date.UTC(2026, 9, 12, 10, 0, 0);
  const step = Math.floor(t / 1000 / 30);

  beforeEach(() => { jest.useFakeTimers().setSystemTime(t); });
  afterEach(() => { jest.useRealTimers(); });

  it('aktueller Code passt, ein Schritt Toleranz', () => {
    expect(verifyCode(secret, codeAt(secret, step))).toBe(step);
    expect(verifyCode(secret, codeAt(secret, step - 1))).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step - 3))).toBeNull();
    expect(verifyCode(secret, '12345')).toBeNull();
  });

  it('ein verwendeter Code gilt kein zweites Mal – und wird als „schon verwendet“ erkannt', () => {
    const code = codeAt(secret, step);
    expect(verifyCode(secret, code, step)).toBeNull();
    expect(isUsedCode(secret, code, step)).toBe(true);
    // der nächste Code geht
    jest.setSystemTime(t + 30_000);
    expect(verifyCode(secret, codeAt(secret, step + 1), step)).toBe(step + 1);
  });

  it('ein falscher Code ist nicht „schon verwendet“', () => {
    const wrong = codeAt(secret, step) === '000000' ? '111111' : '000000';
    expect(isUsedCode(secret, wrong, step)).toBe(false);
    expect(isUsedCode(secret, codeAt(secret, step), null)).toBe(false);
  });
});

describe('Zwei-Faktor: Eintrag in der App', () => {
  it('trägt die Adresse des Servers, damit mehrere Server unterscheidbar sind', () => {
    expect(issuerFor('https://lm-test.metzlercloud.de')).toBe('LernModule (lm-test.metzlercloud.de)');
    expect(issuerFor('https://lm.schule.de:8443/')).toBe('LernModule (lm.schule.de:8443)');
    expect(issuerFor('http://localhost:3000')).toBe('LernModule');
    expect(issuerFor(undefined)).toBe('LernModule');
    expect(issuerFor('kaputt')).toBe('LernModule');
    const url = otpauthUrl(issuerFor('https://lm.schule.de'), 'a@b.de', 'ABC');
    expect(decodeURIComponent(url)).toContain('LernModule (lm.schule.de):a@b.de');
    expect(new URL(url).searchParams.get('issuer')).toBe('LernModule (lm.schule.de)');
  });
});
