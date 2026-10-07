import { shortName } from './short-name';

const s = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });
const klasse = [
  s('a', 'Anna', 'Müller'),
  s('b', 'Berta', 'Bauer'),
  s('m1', 'Max', 'Mai'),
  s('m2', 'Max', 'Maier'),
  s('m3', 'Max', 'Schulz'),
  s('l1', 'Lena', 'Weber'),
  s('l2', 'lena', 'Wolf'),
  s('t1', 'Tom', 'Kraus'),
  s('t2', 'Tom', 'Kraus'),
];
const short = (id: string) => shortName(klasse.find((x) => x.id === id)!, klasse);

describe('Kurzname für die Quiz-Arena', () => {
  it('eindeutiger Vorname reicht', () => {
    expect(short('a')).toBe('Anna');
    expect(short('b')).toBe('Berta');
  });

  it('gleiche Vornamen: so viele Buchstaben des Nachnamens wie nötig', () => {
    expect(short('m3')).toBe('Max S.');
    expect(short('l1')).toBe('Lena We.');
    expect(short('l2')).toBe('lena Wo.');
  });

  it('ist ein Nachname Anfang des anderen, steht der kürzere ganz da', () => {
    expect(short('m1')).toBe('Max Mai');
    expect(short('m2')).toBe('Max Maie.');
  });

  it('gleich lautende Namen bleiben voll ausgeschrieben', () => {
    expect(short('t1')).toBe('Tom Kraus');
  });

  it('ohne Vorname der Nachname, ohne Nachname der Vorname', () => {
    expect(shortName(s('x', '', 'Yılmaz'), klasse)).toBe('Yılmaz');
    expect(shortName(s('y', 'Max', ''), klasse)).toBe('Max');
  });
});
