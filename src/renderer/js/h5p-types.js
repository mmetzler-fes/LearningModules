/**
 * H5P Content Type Definitions
 * Defines all supported H5P module types with metadata and editor configurations.
 */
const H5P_TYPES = {
  accordion: {
    id: 'accordion',
    name: 'Accordion',
    icon: '📋',
    description: 'Aufklappbare Textabschnitte zum strukturierten Darstellen von Inhalten.',
    category: 'Darstellung',
    // Reine Information, keine Aufgabe: zaehlt in der Auswertung nicht mit.
    informational: true,
    fields: [
      { key: 'panels', type: 'list', label: 'Abschnitte', itemFields: [
        { key: 'title', type: 'text', label: 'Titel', required: true },
        // Formatierter Text mit Bildern (Bildwerkzeuge wie im Arbeitsblatt)
        { key: 'content', type: 'richtext', label: 'Inhalt', required: true, images: true },
      ]},
    ],
  },
  arithmeticQuiz: {
    id: 'arithmeticQuiz',
    name: 'Arithmetic Quiz',
    icon: '🔢',
    description: 'Mathematik-Quiz mit automatisch generierten Rechenaufgaben.',
    category: 'Quiz',
    fields: [
      { key: 'arithmeticType', type: 'select', label: 'Rechenart', options: [
        { value: 'addition', label: 'Addition' },
        { value: 'subtraction', label: 'Subtraktion' },
        { value: 'multiplication', label: 'Multiplikation' },
        { value: 'division', label: 'Division' },
      ]},
      { key: 'maxNumber', type: 'number', label: 'Maximale Zahl', default: 10 },
      { key: 'numQuestions', type: 'number', label: 'Anzahl Fragen', default: 10 },
      { key: 'timeLimit', type: 'number', label: 'Zeitlimit (Sekunden, 0 = kein Limit)', default: 0 },
    ],
  },
  audioRecorder: {
    id: 'audioRecorder',
    name: 'Audio Recorder',
    icon: '🎙️',
    description: 'Schüler nehmen eine Antwort auf; die Aufnahme landet in deiner Nextcloud-Dateiablage.',
    category: 'Medien',
    // Aufnahmen gehen über den Server in eine Nextcloud-Freigabe (am besten
    // "Dateiablage – nur Hochladen"); gespeichert wird in der App nichts.
    fields: [
      { key: 'instruction', type: 'textarea', label: 'Aufgabenstellung' },
      { key: 'maxDuration', type: 'number', label: 'Max. Aufnahmedauer (Sekunden, höchstens 600)', default: 60 },
      { key: 'uploadUrl', type: 'text', label: 'Nextcloud-Ablage: Freigabelink mit Hochladen (Typ „Dateiablage“)', placeholder: 'https://cloud…/s/…' },
      { key: 'uploadPassword', type: 'text', label: 'Passwort der Freigabe (falls gesetzt)' },
      { key: 'uploadTest', type: 'uploadTest', label: '' },
    ],
  },
  branchingScenario: {
    id: 'branchingScenario',
    name: 'Branching Scenario',
    icon: '🌳',
    description: 'Entscheidungsszenarien: Jede Antwort führt zu einem anderen Schritt, am Ende steht eine Bewertung – z. B. Fehlersuche oder Inbetriebnahme.',
    category: 'Interaktiv',
    // Eigener Editor (branching-editor.js), Format siehe branching.js
    editorType: 'branching',
    fields: [
      { key: 'startScreen', type: 'group', label: 'Startbildschirm' },
      { key: 'allowBack', type: 'checkbox', label: 'Zurück erlauben' },
      { key: 'steps', type: 'list', label: 'Schritte' },
    ],
  },
  collage: {
    id: 'collage',
    name: 'Collage',
    icon: '🖼️',
    description: 'Bildcollagen in verschiedenen Layouts erstellen.',
    category: 'Medien',
    // Abgelöst durch "🧩 Bild zusammenstellen" in jeder Bildauswahl – das
    // Ergebnis ist dort ein gewöhnliches Bild. Bestehende Collagen bleiben.
    deprecated: true,
    // Reine Information, keine Aufgabe: zaehlt in der Auswertung nicht mit.
    informational: true,
    fields: [
      { key: 'layout', type: 'select', label: 'Layout', options: [
        { value: '1-1', label: '2 Spalten (50/50)' },
        { value: '1-2', label: '2 Spalten (33/66)' },
        { value: '2-1', label: '2 Spalten (66/33)' },
        { value: '1-1-1', label: '3 Spalten' },
        { value: '2x2', label: '2x2 Raster' },
      ]},
      { key: 'images', type: 'list', label: 'Bilder', itemFields: [
        { key: 'imageUrl', type: 'text', label: 'Bild-URL oder Dateiname' },
        { key: 'alt', type: 'text', label: 'Alternativtext' },
      ]},
    ],
  },
  coursePresentation: {
    id: 'coursePresentation',
    name: 'Course Presentation',
    icon: '📊',
    description: 'Interaktive Präsentation mit Folien und integrierten Aufgaben.',
    category: 'Präsentation',
    fields: [
      { key: 'slides', type: 'list', label: 'Folien', itemFields: [
        { key: 'slideTitle', type: 'text', label: 'Folientitel', required: true },
        { key: 'slideContent', type: 'textarea', label: 'Inhalt (HTML erlaubt)' },
        { key: 'slideNotes', type: 'textarea', label: 'Sprechernotizen' },
      ]},
      { key: 'enableNavigation', type: 'checkbox', label: 'Navigation aktivieren', default: true },
    ],
  },
  /**
   * Text oder Arbeitsblatt zum Lesen – direkt in der App, im Design der App
   * und auf jedem Gerät gut lesbar. Ein Writer-Dokument (.odt) lässt sich
   * übernehmen; danach ist der Text hier bearbeitbar und gehört zum Modul,
   * landet also im Backup und lässt sich über den Shop teilen.
   */
  worksheet: {
    id: 'worksheet',
    name: 'Text / Arbeitsblatt',
    icon: '📝',
    description: 'Text mit Überschriften, Tabellen und Bildern – selbst schreiben oder aus LibreOffice Writer (.odt) übernehmen.',
    category: 'Darstellung',
    // Reine Information, keine Aufgabe: zählt in der Auswertung nicht mit.
    informational: true,
    fields: [
      { key: 'html', type: 'worksheet', label: 'Inhalt', required: true },
    ],
  },
  dialogCards: {
    id: 'dialogCards',
    name: 'Dialog Cards',
    icon: '💬',
    description: 'Lernkarten mit Vorder- und Rückseite zum Umdrehen.',
    category: 'Lernen',
    fields: [
      { key: 'cards', type: 'list', label: 'Karten', itemFields: [
        { key: 'front', type: 'text', label: 'Vorderseite', required: true },
        { key: 'back', type: 'text', label: 'Rückseite', required: true },
        { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
        { key: 'audioUrl', type: 'audio', label: 'Audio (optional)' },
        { key: 'tip', type: 'text', label: 'Hinweis (optional)' },
      ]},
      { key: 'mode', type: 'select', label: 'Modus', options: [
        { value: 'normal', label: 'Normal' },
        { value: 'repetition', label: 'Wiederholung' },
      ]},
    ],
  },
  dictation: {
    id: 'dictation',
    name: 'Dictation',
    icon: '✏️',
    description: 'Sätze anhören und aufschreiben – mit eigener Aufnahme, Audio-Link oder Sprachausgabe; Auswertung Wort für Wort.',
    category: 'Sprache',
    // Ton je Satz: hochgeladene Datei, sonst Audio-URL (Nextcloud-Freigabelinks
    // werden zum Direktlink), sonst liest der Browser den Satz vor.
    fields: [
      { key: 'instructions', type: 'text', label: 'Arbeitsauftrag', placeholder: 'Hör dir jeden Satz an und schreibe ihn auf.' },
      { key: 'sentences', type: 'list', label: 'Sätze', itemFields: [
        { key: 'text', type: 'text', label: 'Korrekte Schreibweise', required: true },
        { key: 'audioFile', type: 'audio', label: 'Audio-Datei (optional)' },
        { key: 'audioUrl', type: 'text', label: 'oder Audio-URL (optional, z. B. Nextcloud-Freigabelink)' },
      ]},
      { key: 'language', type: 'select', label: 'Sprache der Sprachausgabe (wenn kein Audio hinterlegt ist)', default: 'de-DE', options: [
        { value: 'de-DE', label: 'Deutsch' },
        { value: 'en-GB', label: 'Englisch (GB)' },
        { value: 'en-US', label: 'Englisch (US)' },
        { value: 'fr-FR', label: 'Französisch' },
        { value: 'es-ES', label: 'Spanisch' },
        { value: 'it-IT', label: 'Italienisch' },
      ]},
      { key: 'maxPlays', type: 'number', label: 'Wie oft darf jeder Satz gehört werden? (0 = beliebig)', default: 0 },
      { key: 'slowPlayback', type: 'checkbox', label: '„Langsam abspielen“ anbieten', default: true },
      { key: 'caseSensitive', type: 'checkbox', label: 'Groß-/Kleinschreibung werten', default: true },
      { key: 'punctuation', type: 'checkbox', label: 'Satzzeichen werten', default: true },
      { key: 'tryAgain', type: 'checkbox', label: 'Erneut versuchen erlauben', default: true },
    ],
  },
  dragAndDrop: {
    id: 'dragAndDrop',
    name: 'Drag and Drop',
    icon: '🎯',
    description: 'Elemente per Drag & Drop auf Zielzonen ziehen.',
    category: 'Interaktiv',
    editorType: 'dragAndDrop',
    fields: [
      { key: 'taskDescription', type: 'richtext', label: 'Aufgabenbeschreibung' },
      { key: 'backgroundImage', type: 'text', label: 'Hintergrundbild' },
      { key: 'dropZones', type: 'list', label: 'Ablagezonen', itemFields: [
        { key: 'label', type: 'text', label: 'Zonenbezeichnung', required: true },
        { key: 'x', type: 'number', label: 'X (%)' },
        { key: 'y', type: 'number', label: 'Y (%)' },
        { key: 'width', type: 'number', label: 'Breite (%)' },
        { key: 'height', type: 'number', label: 'Höhe (%)' },
      ]},
      { key: 'draggables', type: 'list', label: 'Ziehbare Elemente', itemFields: [
        { key: 'text', type: 'text', label: 'Element-Text', required: true },
        { key: 'correctZone', type: 'text', label: 'Korrekte Zone (Bezeichnung)' },
        { key: 'multiple', type: 'checkbox', label: 'Mehrfach verwendbar', default: false }
      ]},
    ],
  },
  dragTheWords: {
    id: 'dragTheWords',
    name: 'Drag the Words',
    icon: '📝',
    description: 'Wörter in Lücken eines Textes ziehen.',
    category: 'Sprache',
    fields: [
      { key: 'taskDescription', type: 'richtext', label: 'Aufgabenbeschreibung' },
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'textField', type: 'richtext', label: 'Text (ziehbare Wörter mit *Sternchen* markieren)', required: true,
        placeholder: 'Die *Sonne* scheint am *Himmel*.' },
      { key: 'distractors', type: 'text', label: 'Ablenkwörter (werden nicht benötigt, mit *Sternchen* markieren)',
        placeholder: '*Mond* *Wolke*' },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'enableSolutionsButton', type: 'checkbox', label: 'Lösung anzeigen erlauben', default: true, advanced: true },
      { key: 'instantFeedback', type: 'checkbox', label: 'Sofortiges Feedback', default: false, advanced: true },
    ],
  },
  essay: {
    id: 'essay',
    name: 'Essay',
    icon: '📝',
    description: 'Freitext-Aufgabe mit optionaler Musterlösung und Mindestzeichenzahl.',
    category: 'Quiz',
    fields: [
      { key: 'taskDescription', type: 'textarea', label: 'Aufgabenstellung', required: true },
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'sampleSolution', type: 'textarea', label: 'Musterlösung (optional)' },
      { key: 'minChars', type: 'number', label: 'Mindestanzahl Zeichen', default: 0 },
      { key: 'inputFieldSize', type: 'number', label: 'Eingabefeld-Höhe (Zeilen)', default: 10 },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'ignoreScoring', type: 'checkbox', label: 'Automatische Bewertung deaktivieren', default: true, advanced: true },
      { key: 'pointsHost', type: 'number', label: 'Max. Punkte', default: 1, advanced: true },
    ],
  },
  fillInTheBlanks: {
    id: 'fillInTheBlanks',
    name: 'Fill in the Blanks',
    icon: '📄',
    description: 'Lückentext-Aufgaben zum Ausfüllen.',
    category: 'Sprache',
    fields: [
      { key: 'taskDescription', type: 'richtext', label: 'Aufgabenbeschreibung' },
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'questions', type: 'list', label: 'Sätze mit Lücken', itemFields: [
        { key: 'text', type: 'richtext', label: 'Satz (Lücken mit *Antwort* markieren)', required: true,
          placeholder: 'Berlin ist die *Hauptstadt* von Deutschland.' },
      ]},
      { key: 'caseSensitive', type: 'checkbox', label: 'Groß-/Kleinschreibung beachten', default: false },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'enableSolutionsButton', type: 'checkbox', label: 'Lösung anzeigen erlauben', default: true, advanced: true },
      { key: 'showSolutionsRequiresInput', type: 'checkbox', label: 'Lösung erst nach Eingabe anzeigen', default: true, advanced: true },
    ],
  },
  flashcards: {
    id: 'flashcards',
    name: 'Flashcards',
    icon: '🃏',
    description: 'Karteikarten mit Bild und Textantwort.',
    category: 'Lernen',
    fields: [
      { key: 'cards', type: 'list', label: 'Karten', itemFields: [
        { key: 'question', type: 'text', label: 'Frage / Vorderseite', required: true },
        { key: 'answer', type: 'text', label: 'Antwort (Alternativen mit / trennen)', required: true, placeholder: 'z.B. Berlin / berlin / Hauptstadt' },
        { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      ]},
    ],
  },
  iframeEmbedder: {
    id: 'iframeEmbedder',
    name: 'IFRAME Embedder',
    icon: '🌐',
    description: 'Externe Webinhalte via IFrame einbetten.',
    category: 'Medien',
    // Reine Information, keine Aufgabe: zaehlt in der Auswertung nicht mit.
    informational: true,
    fields: [
      { key: 'url', type: 'text', label: 'URL der einzubettenden Seite', required: true, placeholder: 'https://...' },
      { key: 'width', type: 'number', label: 'Breite (px)', default: 800 },
      { key: 'height', type: 'number', label: 'Höhe (px)', default: 600 },
    ],
  },
  imageHotspots: {
    id: 'imageHotspots',
    name: 'Image Hotspots',
    icon: '📌',
    description: 'Interaktive Punkte auf einem Bild mit Zusatzinformationen.',
    category: 'Interaktiv',
    // Reine Information, keine Aufgabe: zaehlt in der Auswertung nicht mit.
    informational: true,
    // Visueller Editor (hotspot-editor.js): Hotspots direkt aufs Bild setzen.
    editorType: 'imageHotspots',
    fields: [
      { key: 'imageUrl', type: 'text', label: 'Hintergrundbild-URL' },
      { key: 'imageFile', type: 'image', label: 'Hintergrundbild' },
      { key: 'imageAlt', type: 'text', label: 'Bildbeschreibung' },
      { key: 'hotspots', type: 'list', label: 'Hotspots', itemFields: [
        { key: 'title', type: 'text', label: 'Titel', required: true },
        { key: 'content', type: 'textarea', label: 'Inhalt' },
        { key: 'posX', type: 'number', label: 'Position X (%)', default: 50 },
        { key: 'posY', type: 'number', label: 'Position Y (%)', default: 50 },
      ]},
    ],
  },
  markTheWords: {
    id: 'markTheWords',
    name: 'Mark the Words',
    icon: '🖍️',
    description: 'Korrekte Wörter in einem Text markieren.',
    category: 'Sprache',
    fields: [
      { key: 'taskDescription', type: 'richtext', label: 'Aufgabenbeschreibung' },
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'textField', type: 'textarea', label: 'Text (korrekte Wörter mit *Sternchen* markieren)', required: true,
        placeholder: 'Markiere alle *Nomen*: Der *Hund* liegt auf dem *Sofa*.' },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'enableSolutionsButton', type: 'checkbox', label: 'Lösung anzeigen erlauben', default: true, advanced: true },
    ],
  },
  multipleChoice: {
    id: 'multipleChoice',
    name: 'Multiple Choice',
    icon: '✅',
    description: 'Fragen mit mehreren Antwortmöglichkeiten.',
    category: 'Quiz',
    fields: [
      { key: 'question', type: 'richtext', label: 'Frage', required: true },
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'answers', type: 'list', label: 'Antworten', itemFields: [
        { key: 'text', type: 'richtext', label: 'Antworttext', required: true },
        { key: 'correct', type: 'checkbox', label: 'Korrekt' },
        { key: 'tip', type: 'text', label: 'Hinweis (optional)' },
      ]},
      { key: 'singleAnswer', type: 'checkbox', label: 'Nur eine Antwort erlaubt', default: true },
      { key: 'randomAnswers', type: 'checkbox', label: 'Antworten zufällig mischen', default: false, advanced: true },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'enableSolutionsButton', type: 'checkbox', label: 'Lösung anzeigen erlauben', default: true, advanced: true },
      { key: 'passPercentage', type: 'number', label: 'Bestehensgrenze (%)', default: 100, advanced: true },
    ],
  },
  trueFalse: {
    id: 'trueFalse',
    name: 'True False Question',
    icon: '⚖️',
    description: 'Wahr/Falsch-Fragen.',
    category: 'Quiz',
    fields: [
      { key: 'imageUrl', type: 'image', label: 'Bild (optional)' },
      { key: 'questions', type: 'list', label: 'Fragen', itemFields: [
        { key: 'question', type: 'textarea', label: 'Frage', required: true },
        { key: 'correctAnswer', type: 'select', label: 'Korrekte Antwort', options: [
          { value: 'true', label: 'Wahr' },
          { value: 'false', label: 'Falsch' },
        ]},
        { key: 'feedbackCorrect', type: 'text', label: 'Feedback bei richtiger Antwort', default: 'Richtig!' },
        { key: 'feedbackWrong', type: 'text', label: 'Feedback bei falscher Antwort', default: 'Leider falsch.' },
      ]},
      { key: 'randomOrder', type: 'checkbox', label: 'Fragen zufällig mischen', default: false },
      { key: 'enableRetry', type: 'checkbox', label: 'Wiederholen erlauben', default: true, advanced: true },
      { key: 'enableSolutionsButton', type: 'checkbox', label: 'Lösung anzeigen erlauben', default: true, advanced: true },
    ],
  },
  video: {
    id: 'video',
    name: 'Video',
    icon: '🎬',
    description: 'Videos einbetten und abspielen.',
    category: 'Medien',
    // Reine Information, keine Aufgabe: zaehlt in der Auswertung nicht mit.
    informational: true,
    // Erkannt werden YouTube, Vimeo, Nextcloud-Freigabelinks und direkte
    // Links auf Videodateien (siehe video.js). Videos werden bewusst nicht
    // hochgeladen – sie blähten Datenbank und jede Quiz-Seite auf.
    fields: [
      { key: 'videoUrl', type: 'text', label: 'Video-Link (YouTube, Vimeo, Nextcloud-Freigabelink oder Link auf .mp4)', required: true, placeholder: 'https://...' },
      { key: 'title', type: 'text', label: 'Videotitel' },
      { key: 'startAt', type: 'number', label: 'Startzeit (Sekunden)', default: 0 },
      { key: 'autoplay', type: 'checkbox', label: 'Automatisch abspielen', default: false },
      { key: 'loop', type: 'checkbox', label: 'Schleife', default: false },
    ],
  },
  h5p_native: {
    id: 'h5p_native',
    name: 'H5P Native',
    icon: '🌐',
    description: 'Nativ aus einer H5P-Datei importierter Inhalt (Original-H5P-Daten werden unverändert gespeichert).',
    category: 'Import',
    fields: [],
  },
};

// Helper to get all types as array
function getH5pTypesArray() {
  return Object.values(H5P_TYPES);
}

// Get unique categories
function getH5pCategories() {
  const cats = new Set(getH5pTypesArray().map((t) => t.category));
  return Array.from(cats).sort();
}
