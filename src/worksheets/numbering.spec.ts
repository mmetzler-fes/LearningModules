import { formatHeader, legacyNumbering, numberDocuments, sanitizeDocSettings, slugify, NumModule, NumNode, NumPlacement } from './numbering';

/** Kleiner Baukasten: Knoten, Themen mit je einem Dokument (oder mehreren). */
function build() {
  const nodes: NumNode[] = [];
  const places: NumPlacement[] = [];
  const mods: NumModule[] = [];
  const node = (id: string, kind: string, parentId: string | null, docSettings: any = null) => {
    nodes.push({ id, kind, title: id, parentId, orderIndex: nodes.filter((n) => n.parentId === parentId).length, docSettings });
  };
  const topic = (id: string, nodeId: string | null, docs: Array<string | [string, string]>) => {
    places.push({ topicId: id, nodeId, orderIndex: places.filter((p) => p.nodeId === nodeId).length });
    docs.forEach((d, i) => {
      const [title, kind] = Array.isArray(d) ? d : [d, 'arbeitsblatt'];
      mods.push({ id: title, topicId: id, type: 'document', title, orderIndex: i, content: { kind } });
    });
  };
  const run = () => numberDocuments(nodes, places, mods);
  const pfade = () => Object.fromEntries([...run().docs.values()].map((d) => [d.moduleId, d.pfad]));
  return { node, topic, mods, run, pfade };
}

describe('numberDocuments', () => {
  it('Arduino-Kurs: Abschnitte zählen neu, Pfadnummer, Kopfzeile aus dem Kurs', () => {
    const b = build();
    b.node('arduino', 'book', null, { kurs: 'Arduino', numbering: 'tree' });
    b.node('grundlagen', 'section', 'arduino');
    b.node('sensoren', 'section', 'arduino');
    b.node('ka', 'section', 'arduino');
    b.topic('t1', 'grundlagen', ['Erste LED', 'LED blinken']);
    b.topic('t2', 'grundlagen', ['Lauflicht']);
    b.topic('t3', 'sensoren', ['Der AD-Wandler']);
    b.topic('t4', 'ka', [['Klassenarbeit 13–18', 'klassenarbeit']]);
    const r = b.run();
    expect(b.pfade()).toEqual({ 'Erste LED': '1.1', 'LED blinken': '1.2', Lauflicht: '1.3', 'Der AD-Wandler': '2.1', 'Klassenarbeit 13–18': '' });
    expect(r.docs.get('Der AD-Wandler')!.header).toBe('Arduino 2.1 – Der AD-Wandler');
    expect(r.docs.get('Klassenarbeit 13–18')!.header).toBe('Arduino – Klassenarbeit 13–18');
    expect(Object.fromEntries(r.nodeNumbers)).toEqual({ grundlagen: '1', sensoren: '2' }); // KA ohne Nummer
  });

  it('Beispiel aus dem Plan: Zählbeginn an einem Bereich, Unterordner zuerst', () => {
    const b = build();
    b.node('informatik', 'book', null);
    b.node('arduino', 'area', 'informatik', { numbering: 'tree' });
    b.node('grundlagen', 'section', 'arduino');
    b.node('sensoren', 'area', 'arduino');
    b.node('analog', 'section', 'sensoren');
    b.node('i2c', 'section', 'sensoren');
    b.node('iot', 'section', 'arduino');
    b.topic('t1', 'grundlagen', ['Erste LED', 'Digitale Ausgänge']);
    b.topic('t2', 'analog', ['AD-Wandler', 'PWM']);
    b.topic('t3', 'i2c', ['LC-Display']);
    b.topic('t4', 'iot', ['WLAN und MQTT']);
    expect(b.pfade()).toEqual({
      'Erste LED': '1.1', 'Digitale Ausgänge': '1.2', 'AD-Wandler': '2.1.1', PWM: '2.1.2', 'LC-Display': '2.2.1', 'WLAN und MQTT': '3.1',
    });
  });

  it('ohne Einstellung keine Nummern – auch nicht im Book', () => {
    const b = build();
    b.node('informatik', 'book', null);
    b.node('arduino', 'area', 'informatik');
    b.node('analog', 'section', 'arduino');
    b.topic('t', 'analog', ['AD-Wandler']);
    const r = b.run();
    expect(b.pfade()).toEqual({ 'AD-Wandler': '' });
    expect(r.nodeNumbers.size).toBe(0);
  });

  it('durchgezählt: Unterordner gliedern nur, die Ordner selbst ohne Nummer', () => {
    const b = build();
    b.node('arduino', 'book', null);
    b.node('sensoren', 'area', 'arduino', { numbering: 'flat' });
    b.node('analog', 'section', 'sensoren');
    b.node('i2c', 'section', 'sensoren');
    b.topic('t1', 'analog', ['AD-Wandler', 'PWM']);
    b.topic('t2', 'i2c', ['LC-Display']);
    const r = b.run();
    expect(b.pfade()).toEqual({ 'AD-Wandler': '1', PWM: '2', 'LC-Display': '3' });
    expect(r.nodeNumbers.size).toBe(0);
  });

  it('je Lehrplaneinheit durchgezählt, Quiz-Lernthemen ohne Nummer; „Aus“ und Neubeginn darunter', () => {
    const b = build();
    b.node('et', 'book', null);
    b.node('bpe8', 'section', 'et', { kurs: 'BPE 8', numbering: 'flat' });
    b.node('bpe9', 'section', 'et', { kurs: 'BPE 9', numbering: 'flat' });
    b.node('alt', 'area', 'bpe9', { numbering: 'off' });
    b.node('neu', 'section', 'alt', { numbering: 'tree' });
    b.topic('t1', 'bpe8', ['Grundschaltungen', 'Komparator']);
    b.mods.push({ id: 'quiz', topicId: 't1', type: 'multipleChoice', title: 'Quiz', orderIndex: 9 });
    b.topic('t2', 'bpe9', ['RC-Glied']);
    b.topic('t3', 'alt', ['Altes Blatt']);
    b.topic('t4', 'neu', ['Neues Blatt']);
    const r = b.run();
    expect(b.pfade()).toEqual({ Grundschaltungen: '1', Komparator: '2', 'RC-Glied': '1', 'Altes Blatt': '', 'Neues Blatt': '1' });
    expect(r.docs.get('Komparator')!.header).toBe('BPE 8 2 – Komparator');
  });

  it('frühere Einstellungen umrechnen: Zählbeginn bzw. Kurs bleibt, Books zählen nicht mehr von selbst', () => {
    expect(legacyNumbering(null)).toBeUndefined();
    expect(legacyNumbering({ numberRoot: true })).toBe('tree');
    expect(legacyNumbering({ kurs: 'Arduino' })).toBe('tree');
    expect(legacyNumbering({ kurs: 'Arduino', numberRoot: false })).toBeUndefined();
    expect(legacyNumbering({ kurs: 'Arduino', numberFlat: true })).toBe('flat');
    expect(legacyNumbering({ numberFlat: true })).toBe('flat');
    expect(legacyNumbering({ autor: 'M. M.' })).toBeUndefined();
  });

  it('beides am Book = durchgehend wie im Generator', () => {
    const b = build();
    b.node('arduino', 'book', null, { kurs: 'Arduino', numbering: 'flat' });
    b.node('grundlagen', 'section', 'arduino');
    b.node('sensoren', 'section', 'arduino');
    b.topic('t1', 'grundlagen', ['Erste LED', 'Lauflicht']);
    b.topic('t2', 'sensoren', ['Der AD-Wandler']);
    const r = b.run();
    expect(b.pfade()).toEqual({ 'Erste LED': '1', Lauflicht: '2', 'Der AD-Wandler': '3' });
    expect(r.docs.get('Der AD-Wandler')!.header).toBe('Arduino 3 – Der AD-Wandler');
  });

  it('gemischter Ordner: erst Unterordner, dann Lernthemen; Ordner ohne Blätter ohne Nummer', () => {
    const b = build();
    b.node('book', 'book', null, { numbering: 'tree' });
    b.node('leer', 'section', 'book');
    b.node('sub', 'section', 'book');
    b.topic('t1', 'book', ['Direkt im Book']);
    b.topic('t2', 'sub', ['Im Abschnitt']);
    b.topic('t3', 'leer', [['Nur Text', 'text']]);
    const r = b.run();
    expect(b.pfade()).toEqual({ 'Im Abschnitt': '1.1', 'Direkt im Book': '2', 'Nur Text': '' });
    expect(r.nodeNumbers.has('leer')).toBe(false);
  });

  it('Verschieben in einen anderen Abschnitt: dort ab 1, der alte rückt auf', () => {
    const b = build();
    b.node('k', 'book', null, { numbering: 'tree' });
    b.node('a', 'section', 'k');
    b.node('b', 'section', 'k');
    b.topic('t1', 'a', ['Eins']);
    b.topic('t2', 'a', ['Zwei']);
    b.topic('t3', 'b', ['Drei']);
    expect(b.pfade()).toEqual({ Eins: '1.1', Zwei: '1.2', Drei: '2.1' });
    const moved = build();
    moved.node('k', 'book', null, { numbering: 'tree' });
    moved.node('a', 'section', 'k');
    moved.node('b', 'section', 'k');
    moved.topic('t2', 'a', ['Zwei']);
    moved.topic('t1', 'b', ['Eins']);
    moved.topic('t3', 'b', ['Drei']);
    expect(moved.pfade()).toEqual({ Zwei: '1.1', Eins: '2.1', Drei: '2.2' });
  });

  it('Kursangaben vererben sich, darunter überschreibbar; Ordner mit eigenem Kurs zählt neu', () => {
    const b = build();
    b.node('it', 'book', null, { kurs: 'IT', autor: 'M. M.', meta: { SCHULE: 'FES' }, numbering: 'tree' });
    b.node('py', 'area', 'it', { kurs: 'Python', titelmuster: '{kurs} Blatt {nummer}: {titel}', numbering: 'tree' });
    b.node('netz', 'section', 'it');
    b.topic('t1', 'py', ['Schleifen']);
    b.topic('t2', 'netz', ['Router']);
    const r = b.run();
    expect(r.docs.get('Schleifen')).toMatchObject({ pfad: '1', header: 'Python Blatt 1: Schleifen', course: { autor: 'M. M.', meta: { SCHULE: 'FES' } } });
    expect(r.docs.get('Router')).toMatchObject({ pfad: '1.1', header: 'IT 1.1 – Router' });
    expect(r.docs.get('Schleifen')!.scope).toBe('py');
  });

  it('Verweisziele je Zählbereich, Slugs eindeutig', () => {
    const b = build();
    b.node('k', 'book', null, { numbering: 'flat' });
    b.topic('t1', 'k', ['Der AD-Wandler', 'Der AD-Wandler']);
    b.mods[0].content.slug = '13_ad_wandler';
    const r = b.run();
    expect(r.refs.get('k')).toEqual({
      '13_ad_wandler': { pfad: '1', titel: 'Der AD-Wandler' },
      der_ad_wandler: { pfad: '2', titel: 'Der AD-Wandler' },
    });
  });

  it('Unsortiertes ohne Nummer; andere Modultypen zählen nicht', () => {
    const b = build();
    b.topic('t1', null, ['A']);
    b.mods.push({ id: 'quiz', topicId: 't1', type: 'multipleChoice', title: 'Quiz', orderIndex: 5 });
    b.topic('t2', null, ['B']);
    expect(b.pfade()).toEqual({ A: '', B: '' });
  });
});

describe('formatHeader', () => {
  it.each([
    ['{kurs} {pfad} – {titel}', { kurs: 'Arduino', pfad: '2.1', titel: 'AD' }, 'Arduino 2.1 – AD'],
    ['{kurs} {pfad} – {titel}', { kurs: '', pfad: '', titel: 'AD' }, 'AD'],
    ['{kurs} {pfad} – {titel}', { kurs: 'Arduino', pfad: '', titel: 'AD' }, 'Arduino – AD'],
    ['{kurs} {pfad} – {titel}', { kurs: '', pfad: '3', titel: 'AD' }, '3 – AD'],
    ['{abschnitt}: {titel} {unbekannt}', { abschnitt: 'IoT', titel: 'MQTT' }, 'IoT: MQTT {unbekannt}'],
  ])('%s', (p, v, out) => expect(formatHeader(p, v as any)).toBe(out));
});

describe('slugify', () => {
  it('Umlaute und Sonderzeichen', () => {
    expect(slugify('Der AD-Wandler – Grundlagen')).toBe('der_ad_wandler_grundlagen');
    expect(slugify('Größe & Übung')).toBe('groesse_uebung');
    expect(slugify('')).toBe('dokument');
  });
});

describe('sanitizeDocSettings', () => {
  it('kürzt, wirft Leeres weg, behält den Rest und prüft meta', () => {
    const out = sanitizeDocSettings(
      { kurs: '  Arduino ', titelmuster: '', autor: 'x'.repeat(300), numbering: 'flat', meta: { PUNKTE: 43, 'böse key': 'x', LEER: '' }, fremd: 1 },
      { skript: { titel: 'Grundlagen' }, titelmuster: 'alt', numberFlat: true, numberRoot: true },
    );
    // Mit `numbering` fallen die alten Felder weg.
    expect(out).toEqual({ skript: { titel: 'Grundlagen' }, kurs: 'Arduino', autor: 'x'.repeat(120), numbering: 'flat', meta: { PUNKTE: '43', LEER: '' } });
    expect(sanitizeDocSettings({ numbering: 'inherit' }, { numbering: 'tree', kurs: 'X' })).toEqual({ kurs: 'X' });
  });
  it('null, wenn nichts bleibt', () => {
    expect(sanitizeDocSettings({ kurs: '', meta: {} }, { kurs: 'X' })).toBeNull();
  });
});
