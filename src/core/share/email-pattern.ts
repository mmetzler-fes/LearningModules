/**
 * Abgleich einer E-Mail-Adresse mit Listen-Einträgen. Gemeinsam genutzt von
 * der globalen Whitelist/Blacklist (wer darf sich registrieren) und den
 * Whitelists der Schulen (wer gehört wohin).
 */

/**
 * Checks whether an email matches a single pattern entry.
 * Supported formats:
 *   *.fes-es.de        — any email at fes-es.de or any subdomain
 *   @fes-es.de         — any email at exactly fes-es.de
 *   *@fes-es.de        — same as @fes-es.de
 *   fes-es.de          — same as @fes-es.de
 *   user@fes-es.de     — exact email address
 */
export function emailMatchesPattern(email: string, pattern: string): boolean {
  const p = pattern.toLowerCase().trim();
  const e = email.toLowerCase().trim();
  if (!p) return false;

  // @domain.de – muss VOR der Prüfung auf eine exakte Adresse stehen, sonst
  // landet "@fes-es.de" im Exakt-Vergleich und passt auf gar nichts.
  if (p.startsWith('@') || p.startsWith('*@')) {
    return (e.split('@')[1] || '') === p.slice(p.indexOf('@') + 1);
  }

  // Exact email address match
  if (p.includes('@') && !p.startsWith('*')) {
    return e === p;
  }

  // Wildcard subdomain: *.fes-es.de
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    const emailDomain = e.split('@')[1] || '';
    return emailDomain === base || emailDomain.endsWith('.' + base);
  }

  // @domain.com or plain domain.com
  const domain = p.replace(/^@/, '');
  const emailDomain = e.split('@')[1] || '';
  return emailDomain === domain;
}

/** Passt die Adresse auf mindestens einen Eintrag der Liste? */
export function emailMatchesAny(email: string, patterns: string[] | null | undefined): boolean {
  return (patterns || []).some((p) => emailMatchesPattern(email, p));
}
