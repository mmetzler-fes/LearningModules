/**
 * Benutzername eines Schülers für die Anmeldung mit dem Schulkonto (docs/sso.md): nur der Teil vor dem @,
 * klein geschrieben – „Max.Muster@schule.onmicrosoft.com“ und „max.muster“ sind derselbe.
 */
export function normalizeLoginId(value: unknown): string | null {
  const v = String(value ?? '').trim().toLowerCase().split('@')[0].replace(/\s+/g, '').slice(0, 80);
  return v || null;
}
