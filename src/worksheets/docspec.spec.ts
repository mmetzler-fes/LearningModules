import { docSpec, withBlockIds } from './docspec';

const ds = docSpec();

// Alle Formeln aus den Kursen des Generators (Stand 2026-10).
const KURS_FORMELN = [
  '"1." ~~ X_C = 1 over {2 cdot %pi cdot f cdot C}',
  '"2." ~~ Z = sqrt{R^2 + X_C^2}',
  '"3." ~~ {U_A} over {U_E} = {X_C} over Z ~~~~~ "(Abgriff am Kondensator)"',
  '"4." ~~ U_A = left( {X_C} over Z right) cdot U_E',
  'R = 1 over {2 cdot %pi cdot f_g cdot C} ~~~~~ "und damit" ~~~~~ f_g = 1 over {2 cdot %pi cdot R cdot C}',
  'U_E = sqrt{U_R^2 + U_C^2} ~~~~~ "und ebenso" ~~~~~ Z = sqrt{R^2 + X_C^2}',
  'Z = sqrt{R^2 + X_L^2}',
  'a = 20 cdot log left( {U_A} over {U_E} right) ~~~~~ "Einheit: Dezibel (dB)"',
  't = {Alarm} over {f_Tick} ~~~~~ "mit" ~~~~~ f_Tick = {f_Takt} over {Divider}',
  '{U_A} over {U_E} = R over Z = R over sqrt{R^2 + X_C^2}',
  '{U_A} over {U_E} = R over sqrt{R^2 + R^2} = R over {R cdot sqrt 2} = 1 over sqrt 2 = "0,707"',
  '{U_A} over {U_E} = {X_C} over Z = {X_C} over sqrt{R^2 + X_C^2}',
];

describe('starmathToMathml', () => {
  it.each(KURS_FORMELN)('übersetzt %s', (f) => {
    expect(ds.starmathToMathml(f)).toMatch(/^<math display="block">.*<\/math>$/);
  });

  it('Bruch, Wurzel, Index und Exponent', () => {
    expect(ds.starmathToMathml('1 over 2')).toContain('<mfrac><mrow><mn>1</mn></mrow><mrow><mn>2</mn></mrow></mfrac>');
    expect(ds.starmathToMathml('sqrt 2')).toContain('<msqrt><mn>2</mn></msqrt>');
    expect(ds.starmathToMathml('X_C^2')).toContain('<msubsup><mrow><mi>X</mi></mrow><mrow><mi>C</mi></mrow><mrow><mn>2</mn></mrow></msubsup>');
  });

  it('over bindet den Ausdruck davor, nicht die ganze Gleichung', () => {
    const m = ds.starmathToMathml('R over Z = 1');
    expect(m).toContain('<mfrac><mrow><mi>R</mi></mrow><mrow><mi>Z</mi></mrow></mfrac><mo>=</mo><mn>1</mn>');
  });

  it('griechisch steil, mit i kursiv; %iota bleibt Jota', () => {
    expect(ds.starmathToMathml('%pi')).toContain('<mi mathvariant="normal">π</mi>');
    expect(ds.starmathToMathml('%ipi')).toContain('<mi>π</mi>');
    expect(ds.starmathToMathml('%PI')).toContain('Π');
    expect(ds.starmathToMathml('%iota')).toContain('<mi mathvariant="normal">ι</mi>');
  });

  it('left/right mit dehnbaren Klammern, Text in Anführungszeichen', () => {
    const m = ds.starmathToMathml('left( a right) "Text <b>"');
    expect(m).toContain('<mo stretchy="true">(</mo>');
    expect(m).toContain('<mtext>Text &lt;b&gt;</mtext>');
  });

  it.each([
    ['{a over b', '„}“ erwartet'],
    ['a over', 'endet unerwartet'],
    ['left( a', '„right“ erwartet'],
    ['a }', 'ohne passende öffnende Klammer'],
    ['%foo', 'unbekanntes Symbol'],
    ['a § b', 'unbekanntes Zeichen'],
  ])('Fehler bei %s', (f, msg) => {
    expect(() => ds.starmathToMathml(f)).toThrow(msg);
  });
});

describe('textLines (Zeilenumbrüche wie im Generator)', () => {
  const lang = 'x'.repeat(80);
  it('lange Zeilen laufen als Absatz weiter', () => {
    expect(ds.textLines(`${lang}\nweiter`)).toEqual([`${lang} weiter`]);
  });
  it('kurze Zeilen, Aufzählungen, Zuweisungen und Lücken bleiben', () => {
    expect(ds.textLines('kurz\nnächste')).toEqual(['kurz', 'nächste']);
    expect(ds.textLines(`${lang}\nb) zweitens`)).toEqual([lang, 'b) zweitens']);
    expect(ds.textLines(`U = R · I ${lang}\nI = U / R`)).toEqual([`U = R · I ${lang}`, 'I = U / R']);
    expect(ds.textLines(`${lang}   Einheit\nweiter`)).toEqual([`${lang}   Einheit`, 'weiter']);
  });
});

describe('richText', () => {
  it('setzt Indizes tief, lässt Bezeichner stehen und escapt', () => {
    expect(ds.richText('n_S und P_{Schlupf}')).toBe('n<sub>S</sub> und P<sub>Schlupf</sub>');
    expect(ds.richText('to_line und AB_Vorlage')).toBe('to_line und AB_Vorlage');
    expect(ds.richText('c\\_str() <x>')).toBe('c_str() &lt;x&gt;');
  });
});

describe('validateDocSpec', () => {
  it('nimmt ein vollständiges Blatt an', () => {
    const spec = {
      titel: 'Test',
      content: [
        { type: 'section', text: 'Worum es geht' },
        'Ein einfacher Text',
        { type: 'task', title: 'Rechnen', blocks: [
          { type: 'formula', math: 'I = U over R' },
          { type: 'karo', lines: 4 },
          { type: 'solution', blocks: [{ type: 'text', text: 'I = 2 A' }] },
        ] },
        { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
        { type: 'image', src: 'https://example.org/a.png', width: '9cm' },
        { type: 'pagebreak' },
      ],
    };
    expect(ds.validateDocSpec(spec)).toEqual([]);
  });

  it('nennt Fehler mit Fundstelle', () => {
    const errors = ds.validateDocSpec({ content: [
      { type: 'task' },
      { type: 'tabelle' },
      { type: 'task', title: 'x', blocks: [{ type: 'karo', lines: 0 }] },
      { type: 'solution', blocks: [{ type: 'solution', text: 'x' }] },
      { type: 'formula', math: '{a' },
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'text', text: 'x', blocks: [] },
    ] });
    expect(errors).toEqual([
      'content[0] (task): title fehlt.',
      expect.stringContaining('content[1]: Unbekannter Blocktyp „tabelle“'),
      'content[2].blocks[0] (karo): lines: ganze Zahl von 1 bis 60.',
      'content[3].blocks[0] (solution): Lösung in einer Lösung ist nicht möglich.',
      expect.stringContaining('content[4] (formula): Formel –'),
      'content[5] (image): src: nur Bilder als data:image/… oder https://.',
      'content[6] (text): blocks gibt es nur bei section, task, subtask, solution, box.',
    ]);
  });

  it('verlangt ein Objekt mit content', () => {
    expect(ds.validateDocSpec(null)).toHaveLength(1);
    expect(ds.validateDocSpec({ titel: 'x' })).toEqual(['content: Die Liste der Blöcke fehlt.']);
  });
});

describe('renderDocSpecHtml', () => {
  const spec = { content: [
    { type: 'section', text: 'A' },
    { type: 'task', title: 'B', text: 'Einleitung' },
    { type: 'subtask', title: 'C' },
    { type: 'section', text: 'D' },
    { type: 'task', title: 'E', blocks: [{ type: 'solution', blocks: ['Lösungstext'] }] },
    { type: 'pagebreak' },
  ] };

  it('nummeriert wie die Gliederung im Druck', () => {
    const html = ds.renderDocSpecHtml(spec);
    expect(html.match(/<span class="ds-num">([^<]+)<\/span>/g)!.map((s: string) => s.replace(/<[^>]+>/g, '')))
      .toEqual(['1.', '1.1', '1.1.1', '2.', '2.1']);
    expect(html).toContain('<p class="ds-text">Einleitung</p>');
  });

  it('blendet Lösungen über die Klasse aus, auf Wunsch nicht', () => {
    expect(ds.renderDocSpecHtml(spec)).toContain('class="docspec ds-hide-solutions"');
    expect(ds.renderDocSpecHtml(spec, { showSolutions: true })).toContain('class="docspec"');
    expect(ds.renderDocSpecHtml(spec)).toContain('<div class="ds-solution"><p class="ds-solution-label">Lösung:</p>');
  });

  it('Seitenumbrüche nur in der Editor-Vorschau', () => {
    expect(ds.renderDocSpecHtml(spec)).not.toContain('ds-pagebreak');
    expect(ds.renderDocSpecHtml(spec, { showPageBreaks: true })).toContain('ds-pagebreak');
  });

  it('escapt Inhalte und lässt unsichere Bildquellen weg', () => {
    const html = ds.renderDocSpecHtml({ content: [
      { type: 'code', code: '<script>x</script>' },
      { type: 'image', src: 'javascript:alert(1)', width: '1px;background:red' },
      { type: 'table', rows: [['<b>']] },
    ] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('background:red');
    expect(html).toContain('&lt;b&gt;');
  });

  it('kaputte Formel erscheint als Quelltext statt den Rest zu verhindern', () => {
    expect(ds.renderDocSpecHtml({ content: [{ type: 'formula', math: '{a' }, 'danach'] }))
      .toContain('<code class="ds-missing">{a</code></div><p class="ds-text">danach</p>');
  });
});

describe('Verweise', () => {
  const refs = { '06_verzweigungen': { pfad: '1.6', titel: 'Verzweigungen' }, '13_ad': { pfad: '2.1', titel: 'AD-Wandler' },
    '18_us': { pfad: '2.6', titel: 'Ultraschall' }, ka: { pfad: '', titel: 'Klassenarbeit' } };

  it('löst Nummer, Bereich und Titel auf', () => {
    expect(ds.resolveRefText('siehe Blatt {{blatt:06_verzweigungen}} ({{titel:06_verzweigungen}})', refs))
      .toBe('siehe Blatt 1.6 (Verzweigungen)');
    expect(ds.resolveRefText('Blätter {{ blatt:13_ad..18_us }}', refs)).toBe('Blätter 2.1–2.6');
    expect(ds.resolveRefText('{{blatt:ka}}', refs)).toBe('Klassenarbeit');
  });

  it('meldet fehlende Blätter sichtbar, ohne Nummern bleibt ein Platzhalter', () => {
    expect(ds.resolveRefText('{{blatt:weg}}', refs)).toBe('⚠ Blatt fehlt: weg');
    expect(ds.resolveRefText('{{blatt:13_ad..weg}}', refs)).toBe('⚠ Blatt fehlt: weg');
    expect(ds.resolveRefText('{{blatt:13_ad..18_us}} {{titel:x}}', null)).toBe('[13_ad–18_us] x');
  });

  it('Code, Formeln und Bildquellen bleiben unberührt; Slugs werden gefunden', () => {
    const spec = { content: [
      { type: 'text', text: 'Siehe {{blatt:13_ad}}' },
      { type: 'code', code: '{{blatt:13_ad}}' },
      { type: 'table', rows: [['{{titel:18_us}}']] },
    ] };
    const out = ds.resolveDocRefs(spec, refs) as any;
    expect(out.content[0].text).toBe('Siehe 2.1');
    expect(out.content[1].code).toBe('{{blatt:13_ad}}');
    expect(out.content[2].rows[0][0]).toBe('Ultraschall');
    expect(spec.content[0].text).toBe('Siehe {{blatt:13_ad}}'); // Original unverändert
    expect(ds.docRefSlugs(spec)).toEqual(['13_ad', '18_us']);
  });

  it('die Web-Ansicht löst mit refs auf', () => {
    expect(ds.renderDocSpecHtml({ content: ['Blatt {{blatt:13_ad}}'] }, { refs })).toContain('Blatt 2.1');
    expect(ds.renderDocSpecHtml({ content: ['Blatt {{blatt:13_ad}}'] })).toContain('Blatt [13_ad]');
  });
});

describe('Phase 3: Auszeichnung und neue Blöcke', () => {
  it('Auszeichnung wie im Generator, nur am Wortrand', () => {
    expect(ds.richText('**fett**, *kursiv*, ***beides***, ++u++, ~~s~~, `c`, x^{2}, CO_{2}, [L](https://a.b)'))
      .toBe('<strong>fett</strong>, <em>kursiv</em>, <strong><em>beides</em></strong>, <u>u</u>, <s>s</s>, <code>c</code>, '
        + 'x<sup>2</sup>, CO<sub>2</sub>, <a href="https://a.b" target="_blank" rel="noopener noreferrer">L</a>');
    expect(ds.richText('"8*7 = 56" und a**b**c, 10^9, C++')).toBe('&quot;8*7 = 56&quot; und a**b**c, 10^9, C++');
    expect(ds.richText('\\*kein\\* **<b>**')).toBe('*kein* <strong>&lt;b&gt;</strong>');
    expect(ds.richText('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
  });

  it('Backslash am Zeilenende erzwingt den Umbruch', () => {
    expect(ds.textLines(`${'x'.repeat(80)}\\\nweiter`)).toEqual(['x'.repeat(80), 'weiter']);
  });

  it('Überschrift ohne Nummer zählt nicht mit', () => {
    const html = ds.renderDocSpecHtml({ content: [{ type: 'heading', text: 'Vorwort' }, { type: 'section', text: 'A' }] });
    expect(html).toContain('<h2 class="ds-heading ds-plain">Vorwort</h2>');
    expect(html).toContain('<span class="ds-num">1.</span> A');
  });

  it('Ausrichtung, verschachtelte und nummerierte Listen', () => {
    const html = ds.renderDocSpecHtml({ content: [
      { type: 'text', align: 'center', text: 'Mitte' },
      { type: 'list', ordered: true, items: ['a', { text: 'b', items: ['b1'] }] },
    ] });
    expect(html).toContain('<p class="ds-text" style="text-align:center">Mitte</p>');
    expect(html).toContain('<ol class="ds-list"><li>a</li><li>b<ol class="ds-list"><li>b1</li></ol></li></ol>');
  });

  it('verbundene Zellen, Kasten, Bild neben Text', () => {
    const html = ds.renderDocSpecHtml({ content: [
      { type: 'table', header: [{ text: 'G', colspan: 2 }], rows: [[{ text: 'A', rowspan: 2 }, 'a1'], ['a2']] },
      { type: 'box', title: 'Merke', shaded: true, blocks: ['Inhalt'] },
      { type: 'image', src: 'https://x/a.png', float: 'right', border: true },
      'Daneben',
      { type: 'karo' },
    ] });
    expect(html).toContain('<th colspan="2">G</th>');
    expect(html).toContain('<td rowspan="2">A</td><td>a1</td></tr><tr><td>a2</td>');
    expect(html).toContain('<div class="ds-box ds-box-shaded"><p class="ds-box-title"><strong>Merke</strong></p><p class="ds-text">Inhalt</p></div>');
    expect(html).toMatch(/<div class="ds-float ds-float-right"><figure class="ds-image ds-image-border">.*<div class="ds-float-text"><p class="ds-text">Daneben<\/p><\/div><\/div><div class="ds-karo"/);
  });

  it('Prüfung der neuen Felder', () => {
    expect(ds.validateDocSpec({ content: [
      { type: 'heading', text: 'x', level: 4 },
      { type: 'text', text: 'x', align: 'mitte' },
      { type: 'list', items: [{ items: [] }] },
      { type: 'table', rows: [[{ text: 'x', colspan: 0 }]] },
      { type: 'image', src: 'https://a/b.png', float: 'oben' },
      { type: 'box' },
      { type: 'box', blocks: [{ type: 'solution', blocks: [{ type: 'karo' }] }] },
    ] })).toEqual([
      'content[0] (heading): level: 1, 2 oder 3.',
      'content[1] (text): align: left, center, right, justify.',
      'content[2] (list): items: Jeder Punkt ist ein Text oder { text, items } (höchstens 3 Ebenen).',
      'content[3] (table): Zelle ist ein Text oder { text, colspan, rowspan } mit Zahlen von 1 bis 20.',
      'content[4] (image): float: left, right, center.',
      'content[5] (box): blocks oder text fehlt.',
    ]);
  });
});

describe('Block quiz', () => {
  it('braucht ein Modul und steht nicht in einer Lösung', () => {
    expect(ds.validateDocSpec({ content: [{ type: 'quiz', module: 'm1', title: 'Kurzquiz' }] })).toEqual([]);
    expect(ds.validateDocSpec({ content: [{ type: 'quiz' }] }).join()).toMatch(/module/);
    expect(ds.validateDocSpec({ content: [{ type: 'solution', blocks: [{ type: 'quiz', module: 'm1' }] }] }).join()).toMatch(/Lösung/);
  });

  it('zeigt einen Platzhalter mit dem Modul', () => {
    const html = ds.renderDocSpecHtml({ content: [{ type: 'quiz', module: 'm1', title: 'Kurzquiz' }] });
    expect(html).toContain('data-module="m1"');
    expect(html).toContain('Kurzquiz');
  });
});

describe('withBlockIds', () => {
  it('fehlende IDs nach der Position, vorhandene bleiben; Text-JSON bleibt Text', () => {
    const content = { kind: 'arbeitsblatt', spec: { content: [{ type: 'text', text: 'a' }, { id: 'abcd2345', type: 'karo' }, { type: 'task', title: 'T', blocks: [{ type: 'karo' }] }] } };
    const out = withBlockIds(content);
    expect(out.spec.content.map((b: any) => b.id)).toEqual(['pos0', 'abcd2345', 'pos2']);
    expect((out.spec.content[2] as any).blocks[0].id).toBe('pos2x0');
    const asText = withBlockIds(JSON.stringify({ spec: { content: [{ type: 'text' }] } }));
    expect(JSON.parse(asText).spec.content[0].id).toBe('pos0');
  });

  it('belegte Position: neue zufällige ID (ohne crypto in der Sandbox)', () => {
    const out = withBlockIds({ spec: { content: [{ type: 'text' }, { id: 'pos0', type: 'karo' }] } });
    expect(out.spec.content[0].id).toMatch(/^[a-km-np-z2-9]{8}$/);
    expect(out.spec.content[1].id).toBe('pos0');
  });

  it('ohne Spec unverändert', () => {
    const c = { foo: 1 };
    expect(withBlockIds(c)).toBe(c);
    expect(withBlockIds('kein json')).toBe('kein json');
  });
});
