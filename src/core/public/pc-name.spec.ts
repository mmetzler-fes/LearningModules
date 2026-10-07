import { cleanPcName } from './pc-name';

describe('cleanPcName', () => {
  it('übernimmt echte Rechnernamen', () => {
    expect(cleanPcName('R204-PC07')).toBe('R204-PC07');
    expect(cleanPcName(' lab.pc_3 ')).toBe('lab.pc_3');
  });
  it('verwirft den nicht ersetzten Platzhalter und Unsinn', () => {
    expect(cleanPcName('%COMPUTERNAME%')).toBeNull();
    expect(cleanPcName('$HOSTNAME')).toBeNull();
    expect(cleanPcName('<script>')).toBeNull();
    expect(cleanPcName('a b')).toBeNull();
    expect(cleanPcName('')).toBeNull();
    expect(cleanPcName(undefined)).toBeNull();
    expect(cleanPcName('x'.repeat(64))).toBeNull();
  });
});
