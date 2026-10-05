import { matchStudent, splitTypedName, normalizeName } from './name-match';

const s = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });
const klasse = [
  s('a1', 'Adrian', 'Albrecht'),
  s('a2', 'Adrian', 'Arnold'),
  s('b1', 'Berta', 'Bauer'),
  s('al', 'Anna Lena', 'Müller'),
  s('om', 'Ömer', 'Yılmaz'),
  s('m1', 'Max', 'Mai'),
  s('m2', 'Max', 'Maier'),
];
const id = (input: string) => {
  const r = matchStudent(input, klasse);
  return r.kind === 'match' ? r.student.id : r.kind;
};

describe('matchStudent', () => {
  it('eindeutiger Vorname reicht', () => {
    expect(id('Berta')).toBe('b1');
    expect(id('berta')).toBe('b1');
  });

  it('doppelter Vorname braucht den Anfang des Nachnamens', () => {
    expect(id('Adrian')).toBe('ambiguous');
    expect(id('Adrian A')).toBe('ambiguous');
    expect(id('Adrian Al')).toBe('a1');
    expect(id('Adrian Ar')).toBe('a2');
    expect(id('Adrian Arnold')).toBe('a2');
  });

  it('Doppelvorname: ganz, nur ein Teil oder mit Nachname', () => {
    expect(id('Anna Lena')).toBe('al');
    expect(id('Lena')).toBe('al');
    expect(id('Anna')).toBe('al');
    expect(id('Anna Lena M')).toBe('al');
    expect(id('Anna-Lena Müller')).toBe('al');
  });

  it('Umlaute und Akzente', () => {
    expect(id('Oemer')).toBe('om');
    expect(id('ömer yilmaz')).toBe('om');
    expect(id('Anna Lena Mueller')).toBe('al');
  });

  it('der volle Name gewinnt, auch wenn er Anfang eines anderen ist', () => {
    expect(id('Max Mai')).toBe('m1');
    expect(id('Max Maie')).toBe('m2');
    expect(id('Max')).toBe('ambiguous');
  });

  it('unbekannt', () => {
    expect(id('Carla')).toBe('none');
    expect(id('Berta X')).toBe('none');
    expect(id('   ')).toBe('none');
  });
});

describe('splitTypedName', () => {
  it('letztes Wort ist der Nachname', () => {
    expect(splitTypedName(' Anna  Lena Müller ')).toEqual({ firstName: 'Anna Lena', lastName: 'Müller' });
    expect(splitTypedName('Adrian')).toEqual({ firstName: 'Adrian', lastName: '' });
  });
});

describe('normalizeName', () => {
  it('vereinheitlicht', () => {
    expect(normalizeName('  Ömer  Yılmaz ')).toBe('oemer yilmaz');
  });
});
