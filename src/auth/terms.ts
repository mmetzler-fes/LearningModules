/**
 * Nutzungsbedingungen (docs/nutzungsbedingungen.md): einmalig bei der
 * Anmeldung zu bestätigen. Erhöht man die Fassung, fragt die App alle Konten
 * erneut.
 */
import * as fs from 'fs';
import * as path from 'path';
import { forTeachers } from '../help/help-docs';

export const TERMS_VERSION = 2;

/** Hat dieses Konto der aktuellen Fassung zugestimmt? */
export function hasAcceptedTerms(user: { termsVersion?: number | null } | null | undefined): boolean {
  return !!user && (user.termsVersion ?? 0) >= TERMS_VERSION;
}

/** Ab hier steht nur noch Hilfe für Admins – nicht Teil der Bedingungen. */
const ADMIN_PART = /\n## Erlaubnis der Schulleitung\b[\s\S]*$/;

/** Text der Bedingungen, ohne die Abschnitte für Admins und Entwickler. */
export function termsMarkdown(): string {
  const candidates = [path.resolve(__dirname, '../../docs'), path.resolve(process.cwd(), 'docs')];
  const dir = candidates.find((d) => fs.existsSync(path.join(d, 'nutzungsbedingungen.md')));
  if (!dir) return '# Nutzungsbedingungen\n\nDer Text fehlt auf diesem Server – bitte an den Admin wenden.\n';
  return forTeachers(fs.readFileSync(path.join(dir, 'nutzungsbedingungen.md'), 'utf-8').replace(ADMIN_PART, '\n'));
}

export const TERMS_REQUIRED_MESSAGE = 'Bitte melde dich neu an und bestätige die Nutzungsbedingungen.';
