/**
 * Grundausstattung des Lernbegleiters (der Eule).
 *
 * Kommentare gibt es je Lage. Aus den Kommentaren einer Lage zieht der
 * Browser zufällig einen. Schule und Lehrkraft können eigene ergänzen; die
 * Grundausstattung bleibt immer dabei.
 */

export const COMPANION_CATEGORIES = [
  { key: 'correctFirst', label: 'Richtig beim ersten Versuch' },
  { key: 'correctLater', label: 'Richtig nach Fehlversuchen' },
  { key: 'partial', label: 'Teilweise richtig' },
  { key: 'wrong1', label: 'Erster Fehlversuch' },
  { key: 'wrong2', label: 'Zweiter Fehlversuch' },
  { key: 'wrong3', label: 'Dritter und weitere Fehlversuche' },
  { key: 'penalty', label: 'Zeitstrafe beginnt' },
  { key: 'joker', label: 'Joker taucht auf' },
  { key: 'ungraded', label: 'Nicht automatisch bewertbare Aufgabe' },
] as const;

export type CompanionCategory = (typeof COMPANION_CATEGORIES)[number]['key'];

export const CATEGORY_KEYS: string[] = COMPANION_CATEGORIES.map((c) => c.key);

export const DEFAULT_COMMENTS: Record<CompanionCategory, string[]> = {
  correctFirst: [
    'Bravo!',
    'Gut gemacht!',
    'Genial!',
    'Volltreffer – gleich beim ersten Versuch!',
    'Super, das sitzt!',
    'Klasse, weiter so!',
  ],
  correctLater: [
    'Na also – dranbleiben lohnt sich!',
    'Geschafft! Gut, dass du nicht aufgegeben hast.',
    'Jetzt passt es. Merk dir, woran es lag!',
  ],
  partial: [
    'Fast! Ein Teil stimmt schon.',
    'Du bist auf dem richtigen Weg – schau dir den Rest noch mal an.',
    'Nah dran! Was fehlt noch?',
  ],
  wrong1: [
    'Denk noch mal drüber nach.',
    'Hmm, nicht ganz. Versuch es noch einmal!',
    'Kein Problem – zweiter Anlauf!',
  ],
  wrong2: [
    'Lies die Aufgabe genau durch.',
    'Nimm dir einen Moment Zeit und geh Schritt für Schritt vor.',
    'Schau dir die Aufgabenstellung noch einmal in Ruhe an.',
  ],
  wrong3: [
    'Raten gilt nicht!',
    'Halt – erst denken, dann klicken.',
    'Probieren ist nicht dasselbe wie Lernen. Überleg dir eine Begründung.',
  ],
  penalty: [
    'Raten gilt nicht. Jetzt erst mal in Ruhe nachdenken.',
    'Kurze Denkpause – nutze sie, um die Aufgabe noch einmal zu lesen.',
  ],
  joker: [
    'Ein Joker! Du darfst dir die Lösung ansehen – Punkte gibt es dafür aber nicht.',
    'Glück gehabt: Joker gezogen. Schau dir die Lösung gut an!',
  ],
  ungraded: [
    '👍 Danke, abgegeben!',
    '👍 Prima, weiter geht’s.',
  ],
};

/** Joker und Zeitstrafe, solange Schule und Lehrkraft nichts anderes festlegen. */
export interface CompanionSettings {
  /** Höchstzahl an Jokern je Durchlauf. */
  jokerMax: number;
  /** Erste Zeitstrafe in Sekunden (nach dem dritten Fehlversuch). */
  penaltyStart: number;
  /** Längste Zeitstrafe in Sekunden. */
  penaltyMax: number;
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  jokerMax: 2,
  penaltyStart: 30,
  penaltyMax: 120,
};

/** Was Schule oder Lehrkraft speichern; alles optional. */
export interface CompanionConfig {
  comments?: Partial<Record<CompanionCategory, string[]>>;
  jokerMax?: number | null;
  penaltyStart?: number | null;
  penaltyMax?: number | null;
  /** Nextcloud-Freigabe (oder https-Link) mit dem Tusch für die Siegerehrung. */
  soundUrl?: string | null;
}

export const MAX_COMMENT_LENGTH = 200;
export const MAX_COMMENTS_PER_CATEGORY = 50;
