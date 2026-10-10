import { hashTestPassword, isTestName, isTestStudent, testLabel, testStudentId, verifyTestPassword } from './test-student';

describe('Testschüler', () => {
  it('Kennung', () => {
    expect(testStudentId('u1')).toBe('test:u1');
    expect(isTestStudent('test:u1')).toBe(true);
    expect(isTestStudent('abc')).toBe(false);
    expect(isTestStudent(null)).toBe(false);
  });

  it('Passwort nur als Hash, richtig geprüft', () => {
    const h = hashTestPassword('geheim1');
    expect(h).not.toContain('geheim1');
    expect(verifyTestPassword('geheim1', h)).toBe(true);
    expect(verifyTestPassword('Geheim1', h)).toBe(false);
    expect(verifyTestPassword('geheim1', null)).toBe(false);
    expect(hashTestPassword('geheim1')).not.toBe(h);
  });

  it('Name tolerant erkannt', () => {
    expect(isTestName('  test   kai ', 'Test Kai')).toBe(true);
    expect(isTestName('Test Kay', 'Test Kai')).toBe(false);
    expect(isTestName('Test Kai', null)).toBe(false);
    expect(testLabel('Test Kai')).toBe('🧪 Test Kai');
  });
});
