import { CourseFiles, CourseFormatError, importTitelmuster, readCourse, writeCourse } from './course-format';

/** Kurs-ZIP im Speicher: Pfad → Inhalt. */
function zip(entries: Record<string, string | Buffer>): CourseFiles {
  return {
    names: Object.keys(entries),
    read: (n) => (n in entries ? Buffer.from(entries[n] as any) : null),
  };
}

const KURS = `kurs: Arduino
kuerzel: arduino_einfuehrung
template: templates/AB_Vorlage3.vorbereitet.ott
autor: Martin Metzler
titelmuster: "{kurs} {nummer} – {titel}"
meta: {}
`;

const blatt = (nr: number | string, titel: string, extra = '') => `nummer: ${nr}\ntitel: ${titel}\n${extra}content:\n  - type: section\n    text: Worum es geht\n`;

describe('readCourse', () => {
  const files = zip({
    'kurse/arduino/kurs.yaml': KURS,
    'kurse/arduino/CLAUDE.md': '# Kurs Arduino\nESP32, Arduino-IDE.\n',
    'kurse/arduino/01_led/arbeitsblatt.yaml': blatt(1, 'Erste LED'),
    'kurse/arduino/02_ausgaenge/arbeitsblatt.yaml': `${blatt(2, 'Digitale Ausgänge')}  - type: code
    file: quellcodes/blink.ino
    from_line: 2
    to_line: 3
  - type: task
    title: Schaltung
    blocks:
      - type: image
        file: bilder/led.png
        width: 9
      - type: image
        file: fehlt.png
`,
    'kurse/arduino/02_ausgaenge/bilder/led.png': Buffer.from([0x89, 0x50]),
    'kurse/arduino/quellcodes/blink.ino': 'void setup() {}\r\nvoid loop() {\r\n  blink();\r\n}\r\n',
    'kurse/arduino/10_sensor/arbeitsblatt.yaml': blatt(10, 'Sensor'),
    'kurse/arduino/11_extra/arbeitsblatt.yaml': blatt(11, 'Extra'),
    'kurse/arduino/ka_01_10/arbeitsblatt.yaml': blatt('KA', 'Klassenarbeit', 'template: templates/Klassenarbeit.vorbereitet.ott\nmeta:\n  TITEL: "Arduino – KA"\n  PUNKTE: 43\n'),
    'kurse/arduino/skripte/sensoren.yaml': 'titel: Sensoren\nkopfzeile: Arduino (ESP32) – Sensoren und Anzeigen\nblaetter:\n  - 10_sensor\n  - 99_gibts_nicht\n',
    'kurse/arduino/skripte/grundlagen.yaml': 'titel: Mikrocontroller – Grundlagen\nslug: Skript_Grundlagen\nblaetter:\n  - 01_led\n  - 02_ausgaenge\n',
  });
  const plan = readCourse(files);

  it('Kursangaben, Titelmuster mit Pfadnummer, KI-Vorgaben aus CLAUDE.md', () => {
    expect(plan.title).toBe('Arduino');
    expect(plan.settings).toEqual({
      kurs: 'Arduino', autor: 'Martin Metzler', titelmuster: '{kurs} {pfad} – {titel}', aiGuidelines: '# Kurs Arduino\nESP32, Arduino-IDE.',
    });
  });

  it('Abschnitte aus den Skripten in der Reihenfolge ihrer Blätter, Rest und Klassenarbeiten getrennt', () => {
    expect(plan.sections).toEqual([
      { title: 'Grundlagen', skript: { titel: 'Mikrocontroller – Grundlagen', slug: 'Skript_Grundlagen' }, sheets: ['01_led', '02_ausgaenge'] },
      { title: 'Sensoren und Anzeigen', skript: { titel: 'Sensoren', kopfzeile: 'Arduino (ESP32) – Sensoren und Anzeigen', slug: 'sensoren' }, sheets: ['10_sensor'] },
    ]);
    expect(plan.loose).toEqual(['11_extra']);
    expect(plan.exams).toEqual(['ka_01_10']);
  });

  it('Blatt: Titel, Art, Slug = Ordner; Kursfelder raus, meta bleibt', () => {
    const ka = plan.sheets.get('ka_01_10')!;
    expect(ka).toMatchObject({ title: 'Klassenarbeit', kind: 'klassenarbeit', content: { kind: 'klassenarbeit', slug: 'ka_01_10' } });
    expect(ka.content.spec).toEqual({ meta: { TITEL: 'Arduino – KA', PUNKTE: 43 }, content: [{ type: 'section', text: 'Worum es geht' }] });
    expect(plan.sheets.get('01_led')!.kind).toBe('arbeitsblatt');
  });

  it('Code aus Dateien eingesetzt (Zeilenausschnitt), Bilder als data:, Breite mit Einheit', () => {
    const c = plan.sheets.get('02_ausgaenge')!.content.spec.content;
    expect(c[1]).toEqual({ type: 'code', code: 'void loop() {\n  blink();' });
    expect(c[2].blocks[0]).toEqual({ type: 'image', src: 'data:image/png;base64,iVA=', width: '9cm' });
    expect(c[2].blocks[1]).toEqual({ type: 'image', file: 'fehlt.png' });
  });

  it('Hinweise für Vorlage, fehlende Dateien und unbekannte Skript-Blätter', () => {
    expect(plan.warnings).toEqual([
      expect.stringContaining('Vorlage templates/AB_Vorlage3'),
      '02_ausgaenge: Datei fehlt.png fehlt im ZIP.',
      'Skript sensoren.yaml: unbekannte Blätter 99_gibts_nicht',
    ]);
  });

  it('„blaetter: alle“ und Kurs direkt im ZIP-Wurzelordner', () => {
    const p = readCourse(zip({
      'kurs.yaml': 'kurs: Physik\n',
      'b_02/arbeitsblatt.yaml': blatt(2, 'Zwei'),
      'b_01/arbeitsblatt.yaml': blatt(1, 'Eins'),
      'skripte/alles.yaml': 'titel: Alles\nblaetter: alle\n',
    }));
    expect(p.sections[0]).toMatchObject({ title: 'Alles', sheets: ['b_01', 'b_02'] });
    expect(p.settings.titelmuster).toBe('{kurs} {pfad} – {titel}');
  });

  it('Dateiverweise können das ZIP nicht verlassen', () => {
    const p = readCourse(zip({
      'k/kurs.yaml': 'kurs: X\n',
      'k/a/arbeitsblatt.yaml': 'titel: A\ncontent:\n  - type: code\n    file: ../../../etc/passwd\n',
    }));
    expect(p.sheets.get('a')!.content.spec.content[0]).toEqual({ type: 'code', file: '../../../etc/passwd' });
  });

  it('Fehler ohne kurs.yaml, ohne Blätter oder bei kaputtem YAML', () => {
    expect(() => readCourse(zip({ 'a/arbeitsblatt.yaml': 'x' }))).toThrow(CourseFormatError);
    expect(() => readCourse(zip({ 'kurs.yaml': 'kurs: X' }))).toThrow('keine Blätter');
    expect(() => readCourse(zip({ 'kurs.yaml': 'kurs: X', 'a/arbeitsblatt.yaml': 'titel: [kaputt' }))).toThrow('a/arbeitsblatt.yaml: kein gültiges YAML');
  });
});

describe('importTitelmuster', () => {
  it('{nummer} wird {pfad}, ohne Muster gilt die Vorgabe', () => {
    expect(importTitelmuster('{kurs} Blatt {nummer}: {titel}')).toBe('{kurs} Blatt {pfad}: {titel}');
    expect(importTitelmuster(undefined)).toBe('{kurs} {pfad} – {titel}');
  });
});

describe('writeCourse', () => {
  const { dump } = require('js-yaml');
  const yaml = (v: any) => dump(v, { lineWidth: -1, noRefs: true });
  const { docSpec } = require('./docspec');
  const resolve = (spec: any, refs: any) => docSpec().resolveDocRefs(spec, refs);
  const section = { key: 's1', title: 'Grundlagen', skript: { titel: 'Mikrocontroller – Grundlagen', slug: 'Skript_Grundlagen' } };

  const out = writeCourse(
    { title: 'Arduino', settings: { kurs: 'Arduino', titelmuster: '{kurs} {pfad} – {titel} ({abschnitt})', autor: 'M. M.', aiGuidelines: 'Vorgaben' } },
    [
      { title: 'Erste LED', kind: 'arbeitsblatt', slug: '01_led', section, spec: { content: [{ type: 'image', src: 'data:image/png;base64,iVA=', width: '9cm' }] } },
      { title: 'Ausgänge', kind: 'arbeitsblatt', slug: 'ausgaenge', section, spec: { content: ['Wie in Blatt {{blatt:01_led}}'] } },
      { title: 'KA', kind: 'klassenarbeit', slug: 'ka_01_10', section: null, spec: { meta: { TITEL: 'Arduino – KA' }, content: ['Blätter {{blatt:01_led..ausgaenge}}'] } },
      { title: 'Netz', kind: 'arbeitsblatt', slug: 'x', section: null, spec: { content: [{ type: 'image', src: 'https://a/b.png' }] } },
    ],
    resolve,
    yaml,
  );
  const files = Object.keys(out.files).sort();
  const read = (p: string) => out.files[`arduino/${p}`].toString('utf-8');

  it('Ordner mit durchgehenden Nummern, Klassenarbeit ohne, Bilder als Dateien', () => {
    expect(out.kuerzel).toBe('arduino');
    expect(files).toEqual([
      'arduino/01_led/arbeitsblatt.yaml', 'arduino/01_led/bilder/bild-1.png', 'arduino/02_ausgaenge/arbeitsblatt.yaml',
      'arduino/03_x/arbeitsblatt.yaml', 'arduino/CLAUDE.md', 'arduino/ka_01_10/arbeitsblatt.yaml', 'arduino/kurs.yaml', 'arduino/skripte/skript_grundlagen.yaml',
    ]);
    expect(read('01_led/arbeitsblatt.yaml')).toContain('file: bilder/bild-1.png');
    expect(read('01_led/arbeitsblatt.yaml')).toContain('width: 9.00cm');
    expect(out.warnings).toEqual([expect.stringContaining('03_x: Bild ohne Datei')]);
  });

  it('Verweise mit den Exportnummern aufgelöst', () => {
    expect(read('02_ausgaenge/arbeitsblatt.yaml')).toContain('Wie in Blatt 1');
    expect(read('ka_01_10/arbeitsblatt.yaml')).toContain('Blätter 1–2');
    expect(read('ka_01_10/arbeitsblatt.yaml')).toMatch(/^nummer: KA\ntitel: KA\nmeta:\n {2}TITEL: Arduino – KA/);
  });

  it('kurs.yaml mit Generator-Titelmuster, Skript mit Blättern des Abschnitts', () => {
    expect(read('kurs.yaml')).toContain('titelmuster: \'{kurs} {nummer} – {titel}\'');
    expect(read('skripte/skript_grundlagen.yaml')).toBe('titel: Mikrocontroller – Grundlagen\nslug: Skript_Grundlagen\nblaetter:\n  - 01_led\n  - 02_ausgaenge\n');
  });

  it('wieder eingelesen ergibt sich derselbe Kurs', () => {
    const names = Object.keys(out.files);
    const plan = readCourse({ names, read: (n) => out.files[n] || null });
    expect(plan.settings).toMatchObject({ kurs: 'Arduino', autor: 'M. M.', aiGuidelines: 'Vorgaben' });
    expect(plan.sections).toEqual([{ title: 'Grundlagen', skript: { titel: 'Mikrocontroller – Grundlagen', slug: 'Skript_Grundlagen' }, sheets: ['01_led', '02_ausgaenge'] }]);
    expect(plan.exams).toEqual(['ka_01_10']);
    expect(plan.sheets.get('01_led')!.content.spec.content[0]).toEqual({ type: 'image', src: 'data:image/png;base64,iVA=', width: '9.00cm' });
  });
});
