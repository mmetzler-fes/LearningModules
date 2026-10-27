import { loadBrowserModule } from '../core/browser-module';
import { docSpec } from './docspec';

const ai = loadBrowserModule<any>('ai-prompt.js');

describe('buildDocPrompt', () => {
  const base = { title: 'Der AD-Wandler', description: 'Funktionsweise und Auflösung', kind: 'arbeitsblatt', level: 'TG11', pages: 4, sheets: 1 };

  it('das Beispiel im Prompt ist selbst ein gültiges Dokument', () => {
    expect(docSpec().validateDocSpec(ai.DOC_PROMPT_EXAMPLE)).toEqual([]);
  });

  it('enthält Auftrag, Format, Blöcke und Regeln eines Arbeitsblatts', () => {
    const p = ai.buildDocPrompt(base);
    expect(p).toContain('ein Arbeitsblatt');
    expect(p).toContain('- Thema: Der AD-Wandler');
    expect(p).toContain('"type": "document"');
    expect(p).toContain('"kind": "arbeitsblatt"');
    expect(p).toContain('{"type": "karo", "lines": 6}');
    expect(p).toContain('„Worum es geht“ mit Lernzielen');
    expect(p).toContain('Gib NUR den JSON-Code');
    expect(p).not.toContain('Quiz-Module (nach dem Dokument');
  });

  it('KI-Vorgaben des Ordners, Kurs, vorhandene Blätter, Bilder', () => {
    const p = ai.buildDocPrompt({ ...base, kurs: 'Arduino', guidelines: 'Board: ESP32, Taster nullaktiv.',
      existing: [{ slug: '06_verzweigungen', pfad: '1.6', titel: 'Verzweigungen' }], ncImages: ['nc:Arduino/adc.png'] });
    expect(p).toContain('- Kurs: Arduino');
    expect(p).toContain('## Fachliche Vorgaben der Lehrkraft (verbindlich)\nBoard: ESP32, Taster nullaktiv.');
    expect(p).toContain('  - 06_verzweigungen: 1.6 Verzweigungen');
    expect(p).toContain('{{blatt:<slug>}}');
    expect(p).toContain('- nc:Arduino/adc.png');
  });

  it('Klassenarbeit mit Punkten, Serie in mehreren Antworten, Quiz dazu', () => {
    const p = ai.buildDocPrompt({ ...base, kind: 'klassenarbeit', sheets: 3, quizCount: 4, quizTypes: ['multipleChoice', 'unbekannt'] });
    expect(p).toContain('3 aufeinander aufbauende Dokumente (Klassenarbeit)');
    expect(p).toContain('Punktzahl im Titel');
    expect(p).toContain('GENAU EIN Blatt');
    expect(p).toContain('"content.slug"');
    expect(p).toContain('## Quiz-Module (nach dem Dokument, orderIndex 1, 2 …)');
    expect(p).toContain('### "multipleChoice"');
    expect(p).not.toContain('### "unbekannt"');
  });

  it('vorhandene Blätter als Vorbild im selben Format', () => {
    const spec = { content: [{ type: 'task', title: 'Messen', text: 'Miss die Spannung.' }] };
    const p = ai.buildDocPrompt({ ...base, examples: [{ title: 'Spannung messen', kind: 'arbeitsblatt', spec }] });
    expect(p).toContain('## Vorhandene Blätter als Vorbild');
    expect(p).toContain('### Spannung messen');
    expect(p).toContain(JSON.stringify(spec));
    expect(p).toContain('übernimm aber keine Aufgaben wörtlich');
    expect(ai.buildDocPrompt(base)).not.toContain('als Vorbild');
  });

  it('Text ohne Karo-Regel', () => {
    expect(ai.buildDocPrompt({ ...base, kind: 'text' })).not.toContain('karo-Block und direkt danach');
  });
});

describe('Material aus eigenen Dokumenten', () => {
  const spec = {
    content: [
      { type: 'section', text: 'Grundlagen' },
      { type: 'text', text: 'Ein OPV verstärkt die **Differenz** der Eingänge.' },
      { type: 'formula', math: 'V_u = -R_2 over R_1' },
      { type: 'table', header: ['R1', 'R2'], rows: [['1 kΩ', { text: '10 kΩ' }]] },
      { type: 'image', src: '[eingebettetes Bild]', caption: 'Invertierer' },
      { type: 'task', title: 'Verstärkung', text: 'Berechne V_u.', blocks: [
        { type: 'karo', lines: 4 },
        { type: 'solution', blocks: [{ type: 'text', text: 'V_u = -10' }] },
      ] },
      { type: 'list', ordered: true, items: ['a', { text: 'b', items: ['b1'] }] },
    ],
  };

  it('docSpecToText macht aus dem Blatt lesbaren Text', () => {
    const t = ai.docSpecToText(spec);
    expect(t).toContain('## Grundlagen');
    expect(t).toContain('Formel (StarMath): V_u = -R_2 over R_1');
    expect(t).toContain('| R1 | R2 |');
    expect(t).toContain('| 1 kΩ | 10 kΩ |');
    expect(t).toContain('[Abbildung: Invertierer]');
    expect(t).toContain('### Aufgabe: Verstärkung\nBerechne V_u.');
    expect(t).toContain('[Lösung]\nV_u = -10\n[Ende Lösung]');
    expect(t).toContain('2. b\n  1. b1');
    expect(t).not.toContain('karo');
  });

  it('beide Prompts nehmen das Material auf und verlangen nur dessen Inhalt', () => {
    const material = [{ title: 'AB1 Invertierer', path: 'BPE8 › Grundlagen', text: ai.docSpecToText(spec) }];
    const quiz = ai.buildAiPrompt({ description: 'OPV', types: ['multipleChoice'], count: 4, material });
    expect(quiz).toContain('## Material der Lehrkraft');
    expect(quiz).toContain('### BPE8 › Grundlagen › AB1 Invertierer');
    expect(quiz).toContain('Verwende ausschließlich das Material oben.');
    const doc = ai.buildDocPrompt({ description: 'neu gliedern', kind: 'arbeitsblatt', material });
    expect(doc).toContain('## Material der Lehrkraft');
    expect(doc).toContain('neu gegliedert');
  });
});
