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

  it('Text ohne Karo-Regel', () => {
    expect(ai.buildDocPrompt({ ...base, kind: 'text' })).not.toContain('karo-Block und direkt danach');
  });
});
