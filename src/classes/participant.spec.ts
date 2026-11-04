import { participantRelation } from './participant';

describe('participantRelation: Lehrkraft auf der Eingabeseite eines Klassenlinks', () => {
  const list = [{ firstName: 'Anna', lastName: 'Apfel' }] as any[];
  it('eigene Klasse: nie als Schülereintrag', () => {
    expect(participantRelation('me', 'Anna Apfel', { ownerId: 'me' }, list)).toBe('owner');
  });
  it('steht in der Liste: auch in einer strikten Klasse', () => {
    expect(participantRelation('me', 'Anna Apfel', { ownerId: 'x', strict: true }, list)).toBe('listed');
  });
  it('nicht in der Liste: offen kommt sie dazu, strikt nicht', () => {
    expect(participantRelation('me', 'Berta Birne', { ownerId: 'x', strict: false }, list)).toBe('open');
    expect(participantRelation('me', 'Berta Birne', { ownerId: 'x', strict: true }, list)).toBe('closed');
  });
});
