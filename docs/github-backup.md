# GitHub-Backup

Eigene Lerninhalte regelmäßig in ein **privates** GitHub-Repository sichern –
je Lernthema eine JSON-Datei, dazu jedes Dokument als **.zlm**, geordnet wie
im Notizbuch – und einzelne Module daraus zurückholen, auch aus älteren
Ständen. Die .zlm-Dateien öffnet der [lm-editor](https://mmetzler-fes.github.io/lm-editor/)
auch ohne Server und offline.

Gesichert wird genau das, was auch der JSON-Export herausgibt: in jedem Thema
nur die **selbst verfassten Module** (samt Untermodulen). Gekaufte oder aus dem
Shop übernommene Module bleiben draußen. Dabei gehen nur Lerninhalte an
GitHub – keine Klassen, Ergebnisse oder Schülernamen.

## Einrichten

1. **Konto:** Auf [github.com](https://github.com) ein kostenloses Konto anlegen
   (falls noch keins da ist).
2. **Repository anlegen:** oben rechts **+** → *New repository*. Name z. B.
   `lernmodule-backup`, Sichtbarkeit **Private**. Sonst nichts ankreuzen –
   ein leeres Repository richtet die App selbst ein.
3. **Token erzeugen:** Profilbild → *Settings* → *Developer settings* →
   *Personal access tokens* → **Fine-grained tokens** → *Generate new token*.
   - *Token name*: z. B. „LernModule“
   - *Expiration*: höchstens ein Jahr (GitHub verlangt ein Ablaufdatum)
   - *Repository access*: **Only select repositories** → das Backup-Repository
   - *Permissions* → *Repository permissions* → **Contents: Read and write**
     (*Metadata: Read* setzt GitHub automatisch dazu)

   Den Token (`github_pat_…`) gleich kopieren – GitHub zeigt ihn nur einmal.
4. **In der App:** 🏠 LernModule → **💾 GitHub-Backup**. Repository als
   `benutzername/lernmodule-backup` eintragen (eine kopierte Adresse
   `https://github.com/…` geht auch), Token einfügen, Zeitplan wählen,
   *Automatisches Backup eingeschaltet* anhaken, **Speichern**.
5. **🔌 Verbindung testen** prüft Token, Schreibrecht und ob das Repository
   wirklich privat ist. **⬆ Jetzt sichern** macht das erste Backup sofort.

Der Token darf nur dieses eine Repository – geht er verloren, ist nur das
Backup betroffen, nicht das übrige GitHub-Konto. Die App speichert ihn
verschlüsselt und zeigt ihn nie wieder an.

## Was bei einem Backup passiert

- Die App vergleicht jedes Thema mit der Datei im Repository. **Nur
  Geändertes und Neues** wird hochgeladen – alles zusammen in **einem Commit**,
  z. B. „Backup 16.10.2026: 2 geändert, 1 neu“, darunter die Themen.
- Hat sich nichts geändert, entsteht kein Commit.
- Die Dateien liegen in `themen/`, benannt nach Titel und Kennung des Themas:
  `themen/Bruchrechnung--<kennung>.json`. `themen/index.json` führt den
  aktuellen Titel je Datei.
- **Umbenennen:** Die Datei behält ihren ersten Namen, damit die
  Versionsgeschichte zusammenhängend bleibt; der neue Titel steht im Inhalt und
  im Index. Wer mag, benennt die Datei auf GitHub um – entscheidend ist nur
  die Kennung nach dem letzten `--`.
- **Dokumente** (Arbeitsblätter, Klassenarbeiten …) liegen zusätzlich als
  .zlm im Ordner `Notizbuch/`, so wie sie im Notizbuch eingeordnet sind:
  `Notizbuch/<Book>/<Bereich>/<Abschnitt>/<Thema>/<Dokument>.zlm`. Themen
  ohne Platz im Notizbuch stehen unter `Notizbuch/Unsortiert/<Thema>/`.
  Gleichnamige Dokumente im selben Thema heißen „… (2).zlm“.
- **Verschieben und Umbenennen im Notizbuch:** Die .zlm zieht beim nächsten
  Backup mit um, der alte Ort wird gelöscht. Ältere Stände stehen in der
  Versionsgeschichte unter dem alten Pfad.
- **Gelöschte Themen** bleiben im Repository liegen. Aufräumen geht direkt auf
  GitHub (Datei öffnen → ⋯ → *Delete file*); die App legt die Datei nicht neu
  an, solange es das Thema nicht mehr gibt.

Schlägt ein Backup fehl, kommt beim ersten Fehler eine Mail; die App versucht
es stündlich erneut. Zwei Wochen bevor der Token abläuft, gibt es ebenfalls
eine Mail – dann auf GitHub den Token neu erzeugen (*Regenerate token*) und
in der App eintragen.

## Offline im lm-editor öffnen

Eine .zlm enthält alles, was das Dokument braucht: Text, Bilder (auch die
aus der Nextcloud), die eingebetteten Quizze und die eigene Beschriftung mit
dem Stift. So geht es:

1. Auf GitHub die Datei öffnen → **Download raw file** (⬇). Oder das ganze
   Repository: **Code → Download ZIP**.
2. Im [lm-editor](https://mmetzler-fes.github.io/lm-editor/) auf
   **📂 Öffnen** klicken oder die Datei auf die Seite ziehen. Ist der
   lm-editor installiert, geht auch **rechte Maustaste → Öffnen mit**.

Was dort geändert wird, bleibt in der Datei auf dem eigenen Rechner. Zurück
in die App kommt eine .zlm über **Öffnen mit LernModule → Im Notizbuch
ablegen**.

## Wiederherstellen

Im selben Dialog unter **Wiederherstellen** → *Gesicherte Themen anzeigen*:

1. **Thema** wählen.
2. **Stand** wählen: *Aktueller Stand* oder ein früherer Commit (Datum und
   Beschreibung).
3. **Module** an- oder abhaken. Untermodule kommen mit ihrem Modul mit.
4. **Ziel**: als neues Thema „… (wiederhergestellt)“ oder in eines deiner
   Themen ergänzen.

Was gerade in der App steht, wird dabei **nie überschrieben** – die Module
kommen als zusätzliche Kopien dazu. Wiederhergestellte Module gehören dir
wie selbst verfasste.

Jede Datei lässt sich außerdem herunterladen und über den normalen
**JSON-Import** einlesen – auch auf einem anderen Server.

## Trennen

**Trennen** löscht Token und Einstellungen in der App. Das Repository auf
GitHub bleibt unverändert; den Token dort am besten auch löschen.

## Für Admins

Unter *Shop & Sicherheit* → **💾 GitHub-Backup der Lehrkräfte** lässt sich die
Funktion serverweit abschalten (Standard: erlaubt) – etwa wenn der
Schulträger keine Übertragung an GitHub (USA) wünscht. Gespeicherte
Einstellungen bleiben dabei erhalten; es wird nur nichts mehr übertragen, und
der Knopf **💾 GitHub-Backup** ist bei den Lehrkräften ausgeblendet.

## Technik

- Tabelle `github_backups` (eine Zeile je Lehrkraft); Token mit dem
  App-Secret verschlüsselt (`MasterKeyService.sealSecret`). Nach einem Umzug
  auf einen Server mit anderem App-Secret ist der Token neu einzutragen.
- Schalter `github_backup_allowed` in `system_config`.
- Abgleich ohne gespeicherten Zustand: Die App berechnet den Git-Blob-SHA
  (`sha1("blob <länge>\0" + inhalt)`) jeder Datei und vergleicht mit dem
  Dateibaum des Branches (`GET /git/trees/<sha>?recursive=1`). Geschrieben
  wird über die Git-Data-API (Blobs → Tree → Commit → Ref ohne `force`);
  hat sich der Branch zwischendurch bewegt, scheitert der Lauf statt
  fremde Commits zu überschreiben.
- Ein leeres Repository wird mit einer `README.md` über die Contents-API
  eingerichtet.
- .zlm (`zlm-export.ts`, Format: `src/renderer/lm-editor/docs/FORMAT.md`):
  Bilder aus data:-Adressen und Links (Nextcloud über den Server, sonst nur
  öffentliche Adressen) nach `media/`, eingebettete Quizze samt Untermodulen
  nach `modules/`, die Beschriftung der Lehrkraft (`document_inks`) als
  `layers/teacher.json`. Ungepackt, mit festen Zeitstempeln und fester
  Reihenfolge: Gleicher Inhalt ergibt dieselben Bytes, und Git speichert
  neue Stände als Differenz. Welche .zlm zu welchem Dokument gehört, führt
  `themen/index.json` unter `dokumente`; verschobene werden im selben Commit
  am alten Ort gelöscht (Tree-Eintrag mit `sha: null`).
- Zeitplan wie beim Cloud-Backup (`src/core/schedule/slot.ts`): Prüfung alle
  10 Minuten, verpasste Läufe werden nachgeholt, nach Fehlern stündlich.
- Ablauf des Tokens aus dem Antwortkopf
  `github-authentication-token-expiration`.
- Code: `src/github-backup/` – `backup-plan.ts` (Abgleich, ohne Netz),
  `zlm-export.ts` (.zlm), `github-api.ts` (REST), `github-backup.service.ts`.
