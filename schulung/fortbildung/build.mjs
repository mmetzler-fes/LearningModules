// ==================== LEHRERFORTBILDUNG ALS NOTIZBUCH ====================
//
// Erzeugt schulung/fortbildung/LearningModules-Fortbildung.zip – eine
// Notizbuch-Datei: in LearningModules unter 📓 Notizbuch → 📥 Importieren
// einlesen. Ein Book mit Abschnitten, je Schritt ein Lernthema: ein Dokument
// mit der Anleitung (darin ein eingebettetes Quiz) und dahinter weitere
// Quiz-Module verschiedener Arten.
//
//   node schulung/fortbildung/build.mjs
//
// Texte und Fragen stehen unten in KAPITEL – dort ändern, neu bauen, neu
// importieren. Ablauf der Schulung: README.md daneben.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const OUT = fileURLToPath(new URL('./LearningModules-Fortbildung.zip', import.meta.url));

// ---------- Bausteine des Dokuments (Format: worksheet-renderer/SPEC.md) ----------

const S = (text) => ({ type: 'section', text });
const T = (title, text, blocks = []) => ({ type: 'task', title, text, blocks });
const P = (text) => ({ type: 'text', text });
const L = (...items) => ({ type: 'list', items });
const OL = (...items) => ({ type: 'list', ordered: true, items });
const N = (text) => ({ type: 'note', text });
const K = (lines = 3) => ({ type: 'karo', lines, pattern: 'linien' });
const BOX = (title, ...blocks) => ({ type: 'box', title, blocks });
const Q = (module, title) => ({ type: 'quiz', module, title });
const SOL = (text) => ({ type: 'solution', blocks: [{ type: 'text', text }] });

// ---------- Module ----------

const doc = (id, title, content) => ({ id, type: 'document', title, description: '', content: { kind: 'arbeitsblatt', spec: { content } } });
const mc = (id, title, question, answers, single = true) => ({
  id, type: 'multipleChoice', title, description: '',
  content: { question, imageUrl: '', answers: answers.map(([text, correct, tip = '']) => ({ text, correct, tip })), singleAnswer: single, randomAnswers: true },
});
const tf = (id, title, items) => ({
  id, type: 'trueFalse', title, description: '',
  content: { imageUrl: '', randomOrder: true, questions: items.map(([question, ok, why]) => ({
    question, correctAnswer: ok ? 'true' : 'false', feedbackCorrect: `Richtig! ${why}`, feedbackWrong: `Nicht ganz: ${why}` })) },
});
const fib = (id, title, taskDescription, sentences) => ({
  id, type: 'fillInTheBlanks', title, description: '',
  content: { taskDescription, imageUrl: '', questions: sentences.map((text) => ({ text })), caseSensitive: false },
});
const dtw = (id, title, taskDescription, textField, distractors = '') => ({
  id, type: 'dragTheWords', title, description: '', content: { taskDescription, imageUrl: '', textField, distractors },
});
const mtw = (id, title, taskDescription, textField) => ({
  id, type: 'markTheWords', title, description: '', content: { taskDescription, imageUrl: '', textField },
});
const sorting = (id, title, taskDescription, items) => ({
  id, type: 'sorting', title, description: '', content: { taskDescription, items: items.map((text) => ({ text, imageUrl: '' })), layout: 'vertical' },
});
const memory = (id, title, taskDescription, pairs) => ({
  id, type: 'memory', title, description: '', content: { taskDescription, pairs: pairs.map(([aText, bText]) => ({ aText, aImage: '', bText, bImage: '' })) },
});
const crossword = (id, title, taskDescription, words) => ({
  id, type: 'crossword', title, description: '', content: { taskDescription, words: words.map(([answer, clue]) => ({ answer, clue, imageUrl: '' })), seed: 0 },
});
/** Zuordnen: `pairs` [[Zone, Element]] (layout pairs) oder `groups` { Gruppe: [Elemente] }; dazu Ablenker. */
const dnd = (id, title, taskDescription, { pairs = null, groups = null, distractors = [] }) => {
  const zones = pairs ? pairs.map(([z, d]) => ({ label: z, correctDraggable: d, imageUrl: '', hideText: false }))
    : Object.keys(groups).map((z) => ({ label: z, correctDraggable: '', imageUrl: '', hideText: false }));
  const drags = pairs ? pairs.map(([z, d]) => ({ text: d, correctZone: z }))
    : Object.entries(groups).flatMap(([z, items]) => items.map((text) => ({ text, correctZone: z })));
  return {
    id, type: 'dragAndDrop', title, description: '',
    content: { taskDescription, layout: pairs ? 'pairs' : '', dropZones: zones,
      draggables: [...drags, ...distractors.map((text) => ({ text, correctZone: '' }))].map((d) => ({ ...d, imageUrl: '', hideText: false, multiple: false })) },
  };
};
const formula = (id, title, question, variables, results) => ({
  id, type: 'formula', title, description: '', content: { question, imageUrl: '', variables, results, allowNewValues: true },
});

// ---------- Inhalt ----------

const KLASSE = 'Fortbildung';
const SCHUELER = ['Anna Apfel', 'Ben Birne', 'Cem Kirsche'];

const KAPITEL = [
  { abschnitt: '1 · Start', themen: [
    {
      titel: '1.1 Willkommen – was LearningModules kann',
      beschreibung: 'Überblick, Ablauf der Fortbildung und wie diese Lernthemen funktionieren.',
      module: [
        doc('w-doc', 'Willkommen', [
          S('Worum es geht'),
          P('**LearningModules** ist eine Lernplattform im Browser: Du stellst **Lernthemen** aus **Modulen** zusammen – Dokumente (Arbeitsblätter), Quizze, Lückentexte, Zuordnungen und mehr – und verteilst sie per **Link oder QR-Code** an deine Klasse. Schüler brauchen **kein Konto**.'),
          L('Du arbeitest gerade selbst als „Schüler“ in einem Lernthema: oben ein Dokument, darin und dahinter kleine Abfragen.',
            'So erlebst du die App aus beiden Blickwinkeln – die Anleitungen zeigen dir dann, wie du das selbst baust.',
            'Am Ende hast du eine eigene Testklasse, ein Klassennotizbuch und eine Quiz-Arena ausprobiert.'),
          S('Ablauf heute'),
          OL('Registrieren und die App installieren', 'Testklasse anlegen (frei und strikt)', 'Notizbuch und Lernmodule kennenlernen',
            'Klassennotizbuch und Schülerlink', 'Abfragen: Quiz, Lernbegleiter, Quiz-Arena', 'Ergebnisse, Material teilen, Ausblick'),
          T('Kurz ausprobieren', 'Beantworte die Frage – so sieht ein **eingebettetes Quiz** im Dokument aus.', [Q('w-mc', 'Was brauchen Schüler?')]),
          N('Tipp: Du kannst jederzeit zurückblättern. Im Modus 🧠 Quiz siehst du nach jeder Aufgabe, ob sie stimmt.'),
        ]),
        mc('w-mc', 'Was brauchen Schüler?', 'Was brauchen Schüler, um ein Lernthema zu bearbeiten?', [
          ['Nur einen Link oder QR-Code – und ihren Namen', true, 'Genau: kein Konto, kein Passwort.'],
          ['Ein eigenes Konto mit E-Mail-Adresse', false, 'Nein – Schüler brauchen kein Konto.'],
          ['Eine installierte App', false, 'Ein Browser genügt.'],
        ]),
        tf('w-tf', 'Stimmt das?', [
          ['Lernthemen bestehen aus Modulen, zum Beispiel Dokumenten und Quizzen.', true, 'Ein Lernthema ist eine Sammlung von Modulen.'],
          ['Namen und Ergebnisse der Schüler liegen bei einem großen Anbieter in den USA.', false, 'Die App läuft auf einem eigenen Server – die Daten bleiben dort.'],
          ['Material lässt sich mit Kolleginnen und Kollegen teilen.', true, 'Über den Shop – als Kopie oder zur Nutzung.'],
        ]),
      ],
    },
    {
      titel: '1.2 Als Lehrkraft registrieren',
      beschreibung: 'Konto anlegen, Initialpasswort, erstes Anmelden, angemeldet bleiben.',
      module: [
        doc('r-doc', 'Registrieren und anmelden', [
          S('Konto anlegen'),
          OL('Die Adresse der App öffnen (z. B. von der Schulhomepage).',
            'Unten **📝 Als Lehrer registrieren** – E-Mail-Adresse der Schule und Namen eingeben.',
            'Per E-Mail kommt ein **Initialpasswort**. Damit anmelden – beim ersten Mal legst du ein **eigenes Passwort** fest.',
            'Die Nutzungsbedingungen einmal bestätigen.'),
          N('Registrieren geht nur mit Adressen, die die Schule zugelassen hat. Kommt keine Mail: Spam-Ordner prüfen oder den Admin fragen.'),
          S('Angemeldet bleiben'),
          P('Am **eigenen** Gerät das Häkchen **Angemeldet bleiben** setzen: Die Anmeldung gilt dann bis **90 Tage nach der letzten Nutzung**. Unter **📱 Geräte** siehst du, wo du angemeldet bist, und meldest einzelne Geräte oder **überall** ab – etwa wenn ein iPad verloren geht.'),
          T('Probier aus', 'Melde dich an, öffne **📱 Geräte** und sieh nach, welches Gerät dort steht.', [K(2)]),
          T('Kurz geprüft', '', [Q('r-sort', 'Reihenfolge beim Registrieren')]),
          BOX('Sicherheit', P('Mit **🔐 Zwei-Faktor** schützt du dein Konto zusätzlich mit einer Authenticator-App. Wer das Passwort ändert, ist auf allen anderen Geräten abgemeldet.')),
        ]),
        sorting('r-sort', 'Reihenfolge beim Registrieren', 'Bringe die Schritte in die richtige Reihenfolge.', [
          '„Als Lehrer registrieren“ wählen', 'E-Mail-Adresse eingeben', 'Initialpasswort aus der Mail holen',
          'Mit dem Initialpasswort anmelden', 'Eigenes Passwort festlegen',
        ]),
        tf('r-tf', 'Anmeldung', [
          ['Beim Registrieren wähle ich sofort mein endgültiges Passwort.', false, 'Zuerst kommt ein Initialpasswort per Mail; das eigene legst du beim ersten Anmelden fest.'],
          ['„Angemeldet bleiben“ setze ich nur am eigenen Gerät.', true, 'An fremden oder geteilten Geräten bleibt die Anmeldung sonst bestehen.'],
          ['Unter 📱 Geräte kann ich ein verlorenes iPad abmelden.', true, 'Das wirkt sofort.'],
        ]),
      ],
    },
    {
      titel: '1.3 Die App installieren (PC und iPad)',
      beschreibung: 'Mit Symbol starten, ohne Browserleisten; Dateien mit „Öffnen mit“.',
      module: [
        doc('i-doc', 'App installieren', [
          S('Warum installieren?'),
          P('LernModule läuft im Browser. Als **App installiert** startet sie mit eigenem **Symbol**, in einem eigenen Fenster **ohne Adressleiste** – mehr Platz, vor allem für den Stift auf dem iPad.'),
          S('Am PC (Chrome oder Edge)'),
          OL('LernModule öffnen und anmelden.', 'In der Seitenleiste **📲 Als App installieren** – oder Menü ⋮ → „Streamen, speichern und teilen“ → „Seite als App installieren…“.',
            'Das Symbol liegt danach im Startmenü; auf Wunsch auch auf dem Desktop.'),
          P('Danach öffnet die App Dateien direkt aus dem Explorer: **rechte Maustaste → „Öffnen mit“ → LernModule** für .odt, .docx, .pdf, .xopp (Xournal++) und .zlm – mit **📓 Im Notizbuch ablegen**.'),
          S('Am iPad (Safari)'),
          OL('LernModule in Safari öffnen.', 'Teilen-Knopf → **Zum Home-Bildschirm**.', 'In der App einmal neu anmelden (mit „Angemeldet bleiben“).'),
          T('Kurz geprüft', '', [Q('i-dnd', 'Wo geht was?')]),
        ]),
        dnd('i-dnd', 'Wo geht was?', 'Ordne zu: Wo geht das?', { groups: {
          'PC (Chrome/Edge)': ['📲 Als App installieren', 'Datei per „Öffnen mit“'],
          'iPad (Safari)': ['Zum Home-Bildschirm', 'Schreiben mit dem Apple Pencil'],
        } }),
        mc('i-mc', 'Installieren', 'Was ändert sich, wenn LernModule als App installiert ist?', [
          ['Eigenes Fenster mit Symbol, ohne Adressleiste', true],
          ['Die App funktioniert dann ohne Internet', false, 'Inhalte kommen weiter vom Server – ohne Netz geht es (noch) nicht.'],
          ['Die Schüler brauchen dann auch die App', false, 'Schüler nutzen einfach den Link im Browser.'],
        ]),
      ],
    },
  ] },

  { abschnitt: '2 · Klasse und Schüler', themen: [
    {
      titel: '2.1 Testklasse anlegen – frei und strikt',
      beschreibung: `Klasse „${KLASSE}“ mit drei Testschülern; offene und strikte Anmeldung.`,
      module: [
        doc('k-doc', 'Testklasse anlegen', [
          S('Eine Klasse für die Fortbildung'),
          P(`Damit alle dasselbe sehen, legt jede und jeder die gleiche Testklasse an: **${KLASSE}** mit den Schülern **${SCHUELER.join('**, **')}**.`),
          T('Klasse anlegen', '', [OL('Menü **🏫 Klassen** → **➕ Neue Klasse** → Name „Fortbildung“.',
            `In der Schülerliste mit **➕ Schüler** die drei Schüler eintragen: ${SCHUELER.join(', ')}.`,
            'Das Häkchen **🔒 strikt** vorerst **nicht** setzen.')]),
          S('Frei oder strikt?'),
          BOX('Offen (strikt aus)', P('Wer seinen Namen eingibt und nicht in der Liste steht, kommt **als unbestätigter Eintrag** dazu. Gut für den Start, wenn die Liste noch fehlt.')),
          BOX('🔒 Strikt', P('Nur wer **eindeutig in der Liste** steht, kommt hinein. Die Meldung verrät nie, welche Namen es gibt. Gut für den Alltag und für Klassenarbeiten.')),
          N('Die Anmeldung braucht nur den Vornamen – bei zwei gleichen Vornamen den Anfang des Nachnamens („Max S“).'),
          T('Kurz geprüft', '', [Q('k-dnd', 'Offen oder strikt?')]),
          S('Testschüler'),
          P('Unter **🏫 Klassen → 🧪 Testschüler** legst du dir einen eigenen Testschüler an (Name und Testpasswort). Mit ihm spielst du jeden deiner Links selbst durch – auch bei strikter Anmeldung; seine Ergebnisse zählen nicht in der Klasse mit.'),
        ]),
        dnd('k-dnd', 'Offen oder strikt?', 'Was passt zu welcher Einstellung?', { groups: {
          'Offen': ['Unbekannte Namen kommen als unbestätigt dazu', 'Gut, wenn die Liste noch fehlt'],
          '🔒 Strikt': ['Nur wer in der Liste steht, kommt hinein', 'Gut für Klassenarbeiten'],
        } }),
        fib('k-fib', 'Lücken zur Klasse', 'Ergänze.', [
          'Neue Klassen legt man unter *Klassen* an.',
          'Mit dem Häkchen *strikt* kommen nur Schüler aus der Liste hinein.',
          'Den eigenen *Testschüler* darf man auch bei strikter Anmeldung nutzen.',
        ]),
      ],
    },
    {
      titel: '2.2 Schüler freischalten und PIN',
      beschreibung: 'Unbestätigte Einträge bestätigen, zuordnen; die PIN der Schüler.',
      module: [
        doc('f-doc', 'Schüler freischalten', [
          S('Unbestätigte Einträge'),
          P('Ist die Klasse **offen**, landen unbekannte Namen in der Schülerliste mit dem Vermerk **unbestätigt**. Solange sie unbestätigt sind, sehen diese Schüler ihre Aufgaben – ihre **Ergebnisse und Blätter erst nach deiner Bestätigung**.'),
          L('**✓** bestätigt den Eintrag (ein neuer Schüler).', '**✏️** korrigiert die Schreibweise.',
            '**⇄** ordnet ihn einem Schüler der Liste zu – seine Ergebnisse gehen mit, der Eintrag verschwindet.'),
          T('Probier aus (zu zweit)', 'Melde dich später über einen Link der Testklasse als „Dora Dattel“ an (steht nicht in der Liste). Danach siehst du sie in der Schülerliste als unbestätigt – bestätige sie mit ✓.', [K(2)]),
          S('Die PIN'),
          P('Jeder Schüler hat eine **PIN aus 4 Ziffern** (Spalte PIN der Schülerliste). Mit Name und PIN kommt er ins **Klassennotizbuch** und arbeitet an seinen Blättern weiter – auch an einem anderen Gerät.'),
          T('Kurz geprüft', '', [Q('f-tf', 'Unbestätigt – was gilt?')]),
        ]),
        tf('f-tf', 'Unbestätigt – was gilt?', [
          ['Unbestätigte Schüler sehen ihre Aufgaben.', true, 'Die Aufgaben ja – Ergebnisse und Blätter erst nach der Bestätigung.'],
          ['Mit ⇄ ordne ich einen Eintrag einem Schüler der Liste zu.', true, 'Seine Ergebnisse gehen dabei mit.'],
          ['Die PIN hat sechs Buchstaben.', false, 'Sie hat vier Ziffern.'],
        ]),
        mtw('f-mtw', 'Symbole der Schülerliste', 'Markiere alle Zeichen, mit denen du einen unbestätigten Eintrag bearbeitest.',
          'In der Schülerliste stehen Knöpfe wie *✓* zum Bestätigen, *✏️* zum Korrigieren und *⇄* zum Zuordnen.\nDaneben gibt es 🔑 für eine neue PIN und 🗑 zum Löschen.'),
      ],
    },
  ] },

  { abschnitt: '3 · Inhalte', themen: [
    {
      titel: '3.1 Das Notizbuch im Überblick',
      beschreibung: 'Book, Bereich, Abschnitt, Lernthema; Vorschau; freigeben.',
      module: [
        doc('n-doc', 'Das Notizbuch', [
          S('Ordnen wie in OneNote'),
          P('Unter **📓 Notizbuch** ordnest du alle Lernthemen: **📓 Book → 📂 Bereich → 📑 Abschnitt → 📘 Lernthema → Module**. Die Ordnung gehört dir allein – Schüler sehen sie nicht.'),
          L('Ein Klick auf ein Modul zeigt es rechts in der **👁 Vorschau** – so, wie die Schüler es sehen.',
            '**●** / **○** neben einem Lernthema: **freigegeben** oder gesperrt. Neue und importierte Lernthemen sind zunächst **gesperrt**.',
            '**⋯** oder rechte Maustaste: das Menü – Neues Modul, Quick-Link, Kopieren, Teilen, Klassennotizbuch zuweisen …',
            'Ziehen und Ablegen ordnet um; mit ☑ wählst du mehrere auf einmal.'),
          T('Probier aus', 'Lege ein Book „Meine Fortbildung“ an, darin einen Bereich und ein Lernthema „Test“. Gib es mit ● frei.', [K(2)]),
          T('Kurz geprüft', '', [Q('n-sort', 'Von groß nach klein')]),
          N('Diese Fortbildung ist selbst ein Book – importiert als Notizbuch-Datei über 📥 Importieren.'),
        ]),
        sorting('n-sort', 'Von groß nach klein', 'Ordne von der größten zur kleinsten Einheit.', ['Book', 'Bereich', 'Abschnitt', 'Lernthema', 'Modul']),
        mc('n-mc', 'Gesperrt oder frei?', 'Ein importiertes Lernthema taucht bei den Schülern nicht auf. Woran liegt es am wahrscheinlichsten?', [
          ['Es ist noch gesperrt (○) – erst freigeben', true, 'Importiertes startet gesperrt: erst ansehen, dann freigeben.'],
          ['Die Schüler müssen sich erst registrieren', false],
          ['Lernthemen im Notizbuch sind nie für Schüler', false],
        ]),
      ],
    },
    {
      titel: '3.2 Das Lernmodul „Dokument“',
      beschreibung: 'Arbeitsblätter mit Aufgaben, Schreibfeldern, Lösungen und eingebetteten Quizzen.',
      module: [
        doc('d-doc', 'Das Dokument', [
          S('Ein Arbeitsblatt in der App'),
          P('Ein **Dokument** ist ein Arbeitsblatt: Abschnitte, **Aufgaben** (automatisch nummeriert), Text, Listen, Tabellen, Bilder, **Schreibfelder** (Karo, Linien), **Lösungen** und **eingebettete Quizze**. Gedruckt wird es als PDF oder .odt – mit Kopfzeile der Schule, auf Wunsch als **Lösungsblatt**.'),
          T('So entsteht ein Dokument', '', [OL('Im Notizbuch an einem Lernthema **⋯ → ➕ Neues Modul → 📄 Dokument**.',
            'Im Reiter **✏️ Bearbeiten** schreiben wie in Writer; Absatzart vorne links (Text, Abschnitt, Aufgabe …).',
            '**➕** oder **rechte Maustaste** in den Text: Schreibfeld, **Quiz aus dem Lernthema**, Lösung, Formel, Tabelle, Bild …',
            'Oder fertig übernehmen: **📄 Übernehmen…** liest .odt, .docx, PDF und Xournal++ (.xopp) ein.')]),
          T('Eine Aufgabe mit Schreibfeld', 'Nenne zwei Vorteile eines Dokuments gegenüber einem kopierten Arbeitsblatt.', [K(4),
            SOL('Zum Beispiel: Quizze direkt im Blatt mit sofortiger Rückmeldung; Schüler schreiben mit Stift oder Tastatur, auch zu Hause weiter; Lösungsblatt auf Knopfdruck; nichts geht verloren.')]),
          T('Kurz geprüft', 'Ziehe die Wörter an die richtige Stelle.', [Q('d-dtw', 'Was gehört ins Dokument?')]),
          BOX('Mit dem Stift (iPad)', P('**✍️ Mit Stift bearbeiten** öffnet das Blatt im Stift-Editor: schreiben, markieren, Textfelder, Geodreieck. Schüler speichern über ihren Klassenlink bei dir – mit ihrer PIN geht es später weiter. Quizze im Blatt lassen sich mit **A− / A+** kleiner und größer stellen.')),
        ]),
        dtw('d-dtw', 'Was gehört ins Dokument?', 'Ziehe die Wörter in die Lücken.',
          'In ein Dokument fügst du *Schreibfelder* für Antworten ein. Was nur die Lehrkraft sehen soll, steht in einer *Lösung*. Ein *Quiz* aus dem Lernthema läuft direkt im Blatt.',
          '*Passwort* *Klasse*'),
        crossword('d-cross', 'Kreuzworträtsel Dokument', 'Löse das Rätsel rund ums Dokument.', [
          ['Karo', 'Muster eines Schreibfelds zum Rechnen'], ['Loesung', 'Erscheint nur im Lösungsblatt'],
          ['Aufgabe', 'Wird automatisch nummeriert (1.1, 1.2 …)'], ['Quiz', 'Läuft eingebettet direkt im Blatt'],
          ['Kopfzeile', 'Steht im Druck oben mit Kurs und Titel'], ['Stift', 'Damit schreibt man auf dem iPad ins Blatt'],
        ]),
      ],
    },
    {
      titel: '3.3 Quiz-Module kennenlernen',
      beschreibung: 'Je ein Beispiel der wichtigsten Quiz-Arten – zum Durchspielen.',
      module: [
        doc('q-doc', 'Die Quiz-Arten', [
          S('Welche Abfrage passt wozu?'),
          P('Hinter diesem Dokument folgt **je ein Beispiel** – spiele sie durch. Neue Quizze legst du im Notizbuch mit **⋯ → ➕ Neues Modul** an und wählst den Typ.'),
          { type: 'table', header: ['Typ', 'Gut für'], rows: [
            ['Multiple Choice', 'Verständnis, eine oder mehrere richtige Antworten'],
            ['Wahr/Falsch', 'viele Aussagen schnell prüfen'],
            ['Lückentext', 'Begriffe und Fachwörter selbst schreiben'],
            ['Drag the Words', 'Lückentext mit vorgegebenen Wörtern'],
            ['Mark the Words', 'Wörter in einem Text finden'],
            ['Reihenfolge', 'Abläufe und Arbeitsschritte'],
            ['Drag and Drop', 'zuordnen, in Gruppen sortieren'],
            ['Kreuzworträtsel, Memory', 'Wiederholen mit Spaß'],
            ['Formelaufgabe', 'Rechnen mit Zufallswerten je Schüler'],
          ] },
          N('Schneller zu fertigen Quizzen: **🤖 KI-Prompt** erzeugt einen Auftrag für eine KI, deren Antwort du über 📥 Importieren einliest – oder Moodle-XML und H5P-Dateien importieren.'),
          T('Kurz geprüft', '', [Q('q-mc', 'Welcher Typ passt?')]),
        ]),
        mc('q-mc', 'Welcher Typ passt?', 'Die Schüler sollen die Schritte eines Versuchs in die richtige Reihenfolge bringen. Welcher Typ passt am besten?', [
          ['Reihenfolge (Sorting)', true], ['Wahr/Falsch', false], ['Memory', false, 'Memory findet Paare, keine Abfolge.'],
        ]),
        mc('q-mc2', 'Mehrere richtige Antworten', 'Welche Abfragen bewertet die App automatisch? (mehrere richtig)', [
          ['Multiple Choice', true], ['Lückentext', true], ['Drag and Drop', true], ['Memory', false, 'Memory ist ein Übungsspiel ohne Wertung.'],
        ], false),
        tf('q-tf', 'Wahr oder falsch?', [
          ['Ein Quiz kann direkt in einem Dokument laufen.', true, 'Als eingebettetes Quiz.'],
          ['Ein Lückentext erlaubt keine alternativen Antworten.', false, 'Alternativen trennt man mit /, z. B. *Farad/F*.'],
          ['Memory zählt in die Punkte.', false, 'Memory ist zum Üben, ohne Wertung.'],
        ]),
        fib('q-fib', 'Lückentext', 'Ergänze die Fachbegriffe.', [
          'Schüler starten über einen *Link/QR-Code*.', 'Ein Lernthema ist zunächst *gesperrt* und muss freigegeben werden.',
        ]),
        dtw('q-dtw', 'Drag the Words', 'Ziehe die Wörter in die Lücken.',
          'Im Modus *Quiz* gibt es Rückmeldung nach jeder Aufgabe. In der *Klassenarbeit* gibt es keine Rückmeldung.', '*Memory*'),
        mtw('q-mtw', 'Mark the Words', 'Markiere alle Quiz-Arten.', 'Heute lernst du *Multiple Choice*, *Lückentext* und *Memory* kennen.\nDazu gehören auch Klassen, Links und ein *Kreuzworträtsel*.'),
        sorting('q-sort', 'Reihenfolge', 'Bringe die Schritte zum ersten eigenen Quiz in die richtige Reihenfolge.', [
          'Lernthema im Notizbuch anlegen', 'Neues Modul mit Typ „Multiple Choice“', 'Frage und Antworten eintragen und speichern',
          'In der Vorschau ausprobieren', 'Lernthema freigeben (●)',
        ]),
        dnd('q-dnd', 'Drag and Drop: Paare', 'Ordne jedem Typ ein Beispiel zu.', { pairs: [
          ['Multiple Choice', 'Eine Frage, vier Antworten'], ['Lückentext', 'Fachwort selbst schreiben'],
          ['Reihenfolge', 'Arbeitsschritte ordnen'], ['Memory', 'Paare aufdecken'],
        ] }),
        memory('q-mem', 'Memory', 'Finde die Paare: Symbol und Bedeutung.', [
          ['📓', 'Notizbuch'], ['📒', 'Klassennotizbuch'], ['🏫', 'Klassen'], ['🦉', 'Lernbegleiter'], ['🏆', 'Quiz-Arena'], ['🛒', 'Shop'],
        ]),
        formula('q-formula', 'Formelaufgabe', '<p>In einer Klasse mit {n} Schülern haben {r} die Aufgabe richtig gelöst. Wie viel Prozent sind das?</p>',
          [{ name: 'n', min: 20, max: 30, decimals: 0 }, { name: 'r', min: 8, max: 19, decimals: 0 }],
          [{ label: 'Anteil', formula: 'r/n*100', unit: '%', tolerance: 0.5, toleranceType: 'absolute', decimals: 1 }]),
      ],
    },
  ] },

  { abschnitt: '4 · Im Unterricht', themen: [
    {
      titel: '4.1 Das Klassennotizbuch',
      beschreibung: 'Ein fester Ort je Klasse: Inhalte zuweisen, ein- und ausschalten, Merker.',
      module: [
        doc('c-doc', 'Das Klassennotizbuch', [
          S('Ein Ort für die ganze Klasse'),
          P('Jede Klasse hat ein **📒 Klassennotizbuch** – wie ein OneNote-Kursnotizbuch. Die Schüler finden dort das ganze Schuljahr ihre Aufgaben, Ergebnisse und Blätter; du siehst alles zur Klasse an einer Stelle.'),
          T('Inhalte zuweisen', '', [OL('Im **📓 Notizbuch** an einem Lernthema oder Bereich **⋯ → 📒 Klassennotizbuch zuweisen…** → Klasse „Fortbildung“ wählen.',
            'Ein ganzer Bereich kommt **als Baum** mit allen Unterbereichen und Lernthemen – alles Verweise auf dein Notizbuch: Änderungen gelten sofort.',
            'Im Klassennotizbuch schaltest du mit **● / ◐ / ○** ein und aus – einzelne Module, Lernthemen, Bereiche oder alles. Was später dazukommt, ist zunächst **aus**.')]),
          L('**📍** an einem Modul: „Hier ist die Klasse gerade“ – bei den Schülern ist es aufgeklappt und hat den Fokus.',
            '**📊 Ergebnisübersicht**: wie weit jeder Schüler je Modul ist.', '**📡 Live**: wer gerade bei welcher Aufgabe ist.',
            '**🔒 Nur für Lehrer**: Lösungen und Kopiervorlagen nur für dich.'),
          T('Probier aus', 'Weise diese Fortbildung (oder dein Lernthema „Test“) der Klasse „Fortbildung“ zu und schalte ein Modul ein.', [K(2)]),
          T('Kurz geprüft', '', [Q('c-sort', 'Vom Notizbuch zur Klasse')]),
        ]),
        sorting('c-sort', 'Vom Notizbuch zur Klasse', 'Bringe die Schritte in die richtige Reihenfolge.', [
          'Lernthema im Notizbuch freigeben', 'Klassennotizbuch zuweisen und Klasse wählen', 'Im Klassennotizbuch einschalten (●)', 'Den Schülern den Klassenbuch-Link geben',
        ]),
        mc('c-mc', 'Neues im Notizbuch', 'Du legst im Notizbuch ein neues Modul in einem zugewiesenen Lernthema an. Was sehen die Schüler?', [
          ['Erst nichts – es kommt ausgeschaltet dazu, du schaltest es mit ● ein', true],
          ['Sofort das neue Modul', false, 'Neues ist zunächst aus – du entscheidest, wann.'],
          ['Eine Fehlermeldung', false],
        ]),
      ],
    },
    {
      titel: '4.2 Der Klassenbuch-Link für die Schüler',
      beschreibung: 'Link und QR-Code, Erstanmeldung mit PIN, was Schüler sehen.',
      module: [
        doc('l-doc', 'Der Klassenbuch-Link', [
          S('Ein Link für das ganze Schuljahr'),
          P('Im Klassennotizbuch unter **⚙ Klassenbuch-Link** stehen **Link und QR-Code** – einer für das ganze Jahr. Den QR-Code kannst du kopieren, z. B. in OneNote oder auf ein Blatt.'),
          T('Erstanmeldung', '', [OL('Im Unterricht **🔓 Erstanmeldung freischalten**.', 'Die Schüler öffnen den Link, geben ihren **Namen** ein und lassen die PIN leer.',
            'Jeder sieht **einmal seine PIN** – aufschreiben!', 'Am Ende des Tages schließt sich die Erstanmeldung von selbst.')]),
          P('Danach melden sich die Schüler mit **Name und PIN** an – auch an einem anderen Gerät. Sie sehen ihre **Aufgaben** (eingeklappt, mit „x/y erledigt“), **Meine Ergebnisse** und **Meine Blätter**.'),
          T('Probier aus (zweites Gerät oder privates Fenster)', `Öffne den Klassenbuch-Link und melde dich als ${SCHUELER[0]} an. Notiere die PIN.`, [K(2)]),
          T('Kurz geprüft', '', [Q('l-tf', 'Klassenbuch-Link')]),
        ]),
        tf('l-tf', 'Klassenbuch-Link', [
          ['Der Klassenbuch-Link gilt das ganze Schuljahr.', true, 'Mit 🔄 Neu lässt er sich bei Bedarf erneuern.'],
          ['Die PIN wird den Schülern bei jeder Anmeldung angezeigt.', false, 'Nur einmal – bei der Erstanmeldung. Danach müssen sie sie eingeben.'],
          ['Schüler können mit Name und PIN auch an einem anderen Gerät weiterarbeiten.', true, 'Ihre Blätter liegen bei dir auf dem Server.'],
        ]),
        fib('l-fib', 'Erstanmeldung', 'Ergänze.', ['Die PIN besteht aus *4/vier* Ziffern.', 'Die Erstanmeldung schließt sich am Ende des *Tages* von selbst.']),
      ],
    },
    {
      titel: '4.3 Abfragen: Quiz, Lernbegleiter, Quiz-Arena',
      beschreibung: 'Die Modi im Vergleich; die Quiz-Arena im Klassennotizbuch starten.',
      module: [
        doc('a-doc', 'Die Modi', [
          S('Wie sollen die Schüler arbeiten?'),
          { type: 'table', header: ['Modus', 'So läuft es', 'Ergebnis'], rows: [
            ['🧠 Quiz', 'Rückmeldung nach jeder Aufgabe, zurückblättern erlaubt', 'gespeichert'],
            ['💡 Lernen mit Lösungen', 'nach jeder Aufgabe die Musterlösung', 'nicht gespeichert'],
            ['🦉 Lernbegleitung', 'eine Lerneule kommentiert jeden Versuch; Lernpunkte, Joker', 'gespeichert'],
            ['📝 Klassenarbeit', 'keine Rückmeldung, kein Zurückblättern', 'gespeichert'],
            ['🏆 Quiz-Arena', 'alle gleichzeitig, Punkte nach Richtigkeit und Tempo', 'gespeichert'],
          ] },
          S('Die Quiz-Arena im Klassennotizbuch'),
          OL('In der Freigabe der Zuweisung **🏆 Quiz-Arena** einschalten.', 'Im Klassennotizbuch unter **🏆 Quiz-Arena** → **🏆 Quiz-Arena starten**: der Wartebereich öffnet sich (z. B. am Beamer).',
            'Die Schüler sehen im Klassennotizbuch jetzt **nur die Arena** und kommen mit einem Klick hinein – ohne Namen tippen.',
            '**▶️ Quiz-Arena starten**, Aufgabe für Aufgabe, am Ende Siegertreppchen.'),
          T('Probier aus', 'Startet zu zweit oder zu dritt eine Quiz-Arena mit dem Lernthema „3.3 Quiz-Module kennenlernen“.', [K(2)]),
          T('Kurz geprüft', '', [Q('a-dnd', 'Modus und Verhalten')]),
          BOX('Lernbegleiter einstellen', P('Unter **🦉 Lernbegleiter** stellst du eigene Kommentare der Eule, Joker und Zeitstrafe ein.')),
        ]),
        dnd('a-dnd', 'Modus und Verhalten', 'Ordne jedem Modus sein Verhalten zu.', { pairs: [
          ['🧠 Quiz', 'Rückmeldung nach jeder Aufgabe'], ['🦉 Lernbegleitung', 'Eine Eule kommentiert jeden Versuch'],
          ['📝 Klassenarbeit', 'Keine Rückmeldung'], ['🏆 Quiz-Arena', 'Alle gleichzeitig mit Punkten'],
        ], distractors: ['Ohne Namen und ohne Ergebnis'] }),
        mc('a-mc', 'Was wird nicht gespeichert?', 'In welchem Modus wird kein Ergebnis gespeichert?', [
          ['💡 Lernen mit Lösungen', true], ['🧠 Quiz', false], ['🏆 Quiz-Arena', false], ['🦉 Lernbegleitung', false],
        ]),
        tf('a-tf', 'Quiz-Arena', [
          ['In der Quiz-Arena bekommen alle dieselbe Aufgabe gleichzeitig.', true, 'Wie bei Kahoot – mit deinen Aufgaben.'],
          ['Ist die Arena offen, sehen die Schüler im Klassennotizbuch nur noch sie.', true, 'Danach ist wieder alles da.'],
          ['Schnelle falsche Antworten bringen die meisten Punkte.', false, 'Punkte gibt es für Richtigkeit – Tempo zählt nur dazu.'],
        ]),
      ],
    },
    {
      titel: '4.4 Ergebnisse ansehen',
      beschreibung: 'Ergebnisübersicht, Live, Schülerdaten und Blätter.',
      module: [
        doc('e-doc', 'Ergebnisse', [
          S('Wo stehen meine Schüler?'),
          L('**📊 Ergebnisübersicht** im Klassennotizbuch: je Modul das beste Ergebnis in Prozent, ✓ für erledigt, ✍️ für mit dem Stift bearbeitet.',
            '**📡 Live**: wer gerade bei welcher Aufgabe ist – gut während der Stunde.',
            '**👥 Schülerdaten**: je Schüler alle Ergebnisse und Blätter; Blätter öffnen sich zum Ansehen.',
            '**📊 Ergebnisse** im Menü: alle Durchläufe, auch die deines 🧪 Testschülers.'),
          T('Probier aus', `Sieh dir in der Ergebnisübersicht an, was ${SCHUELER[0]} bisher erledigt hat.`, [K(2)]),
          T('Kurz geprüft', '', [Q('e-mc', 'Wo sehe ich was?')]),
        ]),
        mc('e-mc', 'Wo sehe ich was?', 'Du willst während der Stunde sehen, wer gerade an welcher Aufgabe arbeitet. Wohin?', [
          ['📡 Live im Klassennotizbuch', true], ['🛒 Shop', false], ['🏫 Klassen → Schülerliste', false],
        ]),
      ],
    },
  ] },

  { abschnitt: '5 · Weiter geht’s', themen: [
    {
      titel: '5.1 Material schneller: Import, KI und Shop',
      beschreibung: 'Vorhandenes übernehmen, mit KI erstellen, im Shop teilen.',
      module: [
        doc('m-doc', 'Material schneller', [
          S('Nicht alles selbst tippen'),
          L('**📥 Importieren**: Writer, Word, PDF (als bearbeitbares Dokument), Moodle-XML, H5P, Exporte von Kolleginnen und Kollegen.',
            '**🤖 KI-Prompt**: Thema eintragen, Prompt kopieren, in eine KI einfügen, die Antwort importieren. Vorhandene Blätter lassen sich als **Vorbild** mitgeben.',
            '**Xournal++ (.xopp)**: PDF und Handschrift – die Handschrift wird deine Beschriftung im Stift-Editor.',
            '**🛒 Shop**: fertiges Material übernehmen – als **Kopie** (bearbeiten) oder **zur Nutzung**; eigenes teilen.'),
          N('Was importiert oder kopiert wird, startet gesperrt – erst ansehen, dann freigeben.'),
          T('Kurz geprüft', '', [Q('m-dnd', 'Woher kommt das Material?')]),
        ]),
        dnd('m-dnd', 'Woher kommt das Material?', 'Ordne zu.', { pairs: [
          ['📥 Importieren', 'Eine .docx eines Kollegen'], ['🤖 KI-Prompt', 'Neue Fragen zu einem Thema erzeugen'],
          ['🛒 Shop', 'Fertiges Lernthema übernehmen'],
        ] }),
      ],
    },
    {
      titel: '5.2 Checkliste und Feedback',
      beschreibung: 'Was du nach der Fortbildung kannst – und wie es weitergeht.',
      module: [
        doc('z-doc', 'Checkliste', [
          S('Kannst du das jetzt?'),
          L('☐ Registriert, angemeldet, „Angemeldet bleiben“ und 📱 Geräte kennen', '☐ App am PC bzw. iPad installiert',
            `☐ Klasse „${KLASSE}“ mit ${SCHUELER.length} Schülern angelegt, offen und strikt ausprobiert`, '☐ Einen unbestätigten Schüler bestätigt',
            '☐ Im Notizbuch ein Lernthema mit Dokument und Quiz angelegt und freigegeben', '☐ Ein Lernthema dem Klassennotizbuch zugewiesen und eingeschaltet',
            '☐ Als Schüler über den Klassenbuch-Link mit PIN angemeldet', '☐ Eine Quiz-Arena gestartet', '☐ Ergebnisse angesehen'),
          S('Und jetzt?'),
          T('Dein nächster Schritt', 'Welches Lernthema baust du für deine nächste Stunde?', [K(4)]),
          N('Hilfe zu allem steht in der App unter ❓ Hilfe. Rückmeldungen und Ideen gern an die Schulungsleitung.'),
        ]),
      ],
    },
  ] },
];

// ---------- Notizbuch-Datei bauen ----------

const zip = new AdmZip();
let n = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const sections = KAPITEL.map((k) => ({
  kind: 'section', title: k.abschnitt, tags: [], children: [],
  topics: k.themen.map((t) => {
    const name = `${String(++n).padStart(2, '0')}_${slug(t.titel)}.json`;
    const ids = new Set(t.module.map((m) => m.id));
    for (const m of t.module) {
      // Eingebettete Quizze müssen im selben Lernthema liegen.
      const walk = (blocks) => (blocks || []).forEach((b) => { if (b.type === 'quiz' && !ids.has(b.module)) throw new Error(`${t.titel}: Quiz ${b.module} fehlt`); walk(b.blocks); });
      if (m.type === 'document') walk(m.content.spec.content);
    }
    zip.addFile(name, Buffer.from(JSON.stringify({ topic: { title: t.titel, description: t.beschreibung,
      modules: t.module.map((m, i) => ({ ...m, orderIndex: i })) } }, null, 2), 'utf-8'));
    return name;
  }),
}));
zip.addFile('notebook.json', Buffer.from(JSON.stringify({
  format: 'learningmodules-notebook', version: 1, exportedAt: new Date().toISOString(),
  node: { kind: 'book', title: 'LearningModules – Fortbildung', tags: [], children: sections, topics: [] }, skipped: [],
}, null, 2), 'utf-8'));
writeFileSync(OUT, zip.toBuffer());
const modules = KAPITEL.flatMap((k) => k.themen.flatMap((t) => t.module));
console.log(`${OUT}: ${n} Lernthemen, ${modules.length} Module (${modules.filter((m) => m.type === 'document').length} Dokumente)`);
