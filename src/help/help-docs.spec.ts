import * as fs from 'fs';
import * as path from 'path';
import { forTeachers, outline, slug, isDocName, HELP_GROUPS } from './help-docs';

const DOCS = path.resolve(__dirname, '../../docs');

describe('Hilfe aus docs/', () => {
  it('entfernt Entwicklerabschnitte samt Unterabschnitten, aber nicht mehr', () => {
    const md = [
      '# Titel', '', 'Einleitung.', '',
      '## Bedienung', 'So geht es.', '',
      '## Technik', 'Interna', '### Endpunkte', '| GET | /api |', '',
      '## Ergebnisse', 'Wieder sichtbar.', '',
      '```', '## Technik im Codeblock bleibt', '```', '',
      'Code: `src/x.ts`,', '`src/y.ts`.', '', 'Danach.',
    ].join('\n');
    const out = forTeachers(md);
    expect(out).toContain('## Bedienung');
    expect(out).toContain('## Ergebnisse');
    expect(out).toContain('## Technik im Codeblock bleibt');
    expect(out).toContain('Danach.');
    expect(out).not.toContain('Interna');
    expect(out).not.toContain('/api');
    expect(out).not.toContain('src/x.ts');
    expect(out).not.toContain('src/y.ts');
  });

  it('Übersicht: Titel und Abschnitte mit Ankern', () => {
    expect(outline('# Klassen\n## Schüler­liste\n## Löschregel').sections.map((s) => s.anchor))
      .toEqual(['schueler-liste', 'loeschregel']);
    expect(outline('# Klassen\n## Schuljahr').title).toBe('Klassen');
    expect(slug('🏆 Quiz-Arena')).toBe('quiz-arena');
  });

  it('nimmt nur harmlose Dateinamen an', () => {
    expect(isDocName('quick-link')).toBe(true);
    expect(isDocName('../etc/passwd')).toBe(false);
    expect(isDocName('Quick')).toBe(false);
  });

  it('echte Doku: jede Datei hat einen Titel, kein Entwicklerabschnitt bleibt übrig', () => {
    const files = fs.readdirSync(DOCS).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const md = forTeachers(fs.readFileSync(path.join(DOCS, f), 'utf-8'));
      expect(outline(md).title).toBeTruthy();
      expect(md).not.toMatch(/^#{2,}\s+(Technik|Technisch|Umsetzung|Endpunkte|Beteiligte Dateien)\s*$/m);
      expect(md).not.toMatch(/^Code:\s/m);
    }
  });

  it('jede Datei der Übersicht gibt es wirklich', () => {
    for (const g of HELP_GROUPS) for (const f of g.files) expect(fs.existsSync(path.join(DOCS, `${f}.md`))).toBe(true);
  });
});
