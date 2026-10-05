/**
 * Vorgabezeit der Quiz-Arena aus gemessenen Bearbeitungszeiten:
 * Median + 3 × Streuung um den Median (MAD, auf die Standardabweichung
 * umgerechnet). Das ist die robuste Form von "Mittelwert + 3 ×
 * Standardabweichung": Die Zeit reicht für fast alle, auch für die
 * Langsameren – aber ein einzelner Schüler, der mitten in der Aufgabe
 * minutenlang wegschaut, verschiebt sie kaum.
 *
 * Unter MIN_SAMPLES Messungen gibt es keine Vorgabe (`null`) – dann gilt
 * die Standardzeit der Freigabe.
 */

export const MIN_SAMPLES = 3;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600;

/** Eine einzelne Messung zählt höchstens so lange wie die längste Arena-Zeit. */
export const MAX_SAMPLE_MS = MAX_SECONDS * 1000;

/** Bei normalverteilten Zeiten ist 1,4826 × MAD die Standardabweichung. */
const MAD_TO_SIGMA = 1.4826;

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sekunden für die Quiz-Arena, auf 5 s aufgerundet – oder `null` bei zu wenig Messungen. */
export function arenaSeconds(samplesMs: number[]): number | null {
  if (samplesMs.length < MIN_SAMPLES) return null;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(sorted.map((x) => Math.abs(x - med)).sort((a, b) => a - b));
  const seconds = (med + 3 * MAD_TO_SIGMA * mad) / 1000;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.ceil(seconds / 5) * 5));
}
