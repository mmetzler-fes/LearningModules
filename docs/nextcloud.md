# Nextcloud für Bilder und Backup

Bilder in Modulen liegen sonst in der Datenbank der App – jedes Bild macht
sie, jedes Backup und jede Quiz-Seite größer. Mit verbundener Nextcloud
speichert die App neue Bilder **in deiner Nextcloud**: je Lernthema in einem
eigenen Ordner. Im Modul steht nur noch der Link; Schülerinnen und Schüler
laden das Bild direkt aus deiner Nextcloud. Dazu kann die App deine Inhalte
täglich in die Nextcloud sichern.

## Einrichten

Im Home-Menü (🏠 LernModule) → **☁️ Nextcloud**. Die App bekommt **nie ein
Nextcloud-Konto oder App-Passwort** – nur einen freigegebenen Ordner und
sieht damit ausschließlich diesen.

Bilder liegen immer in der Nextcloud **der Lehrkraft** – nicht beim Admin:
Ein Server kann mehrere Schulen haben, und der Ordner des Admins gehört nicht
allen. Ohne eigene Freigabe bleiben neue Bilder wie bisher in der App.

### Freigabe einrichten

1. In der Nextcloud einen Ordner anlegen, z. B. `LearningModules`.
2. **Teilen → Link teilen**, **„Hochladen und Bearbeiten erlauben“**, ein
   **Passwort** setzen, Link kopieren.
3. Im Dialog Freigabelink und Passwort eintragen → **🔌 Verbinden**.

Verbinden prüft sofort: Die Freigabe öffnet sich mit dem Passwort, die App
legt den Unterordner `Bilder` an und schreibt (und löscht) eine Prüfdatei.
Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt.

Eine „Dateiablage“ (nur Hochladen) reicht nicht: Die App muss den Ordner auch
lesen können (Bildauswahl, Auslieferung an Schüler).

### Wie die Bilder zu den Schülern kommen

Schülerinnen und Schüler kennen das Passwort nicht. Deshalb holt **dieser
Server** die Bilder mit dem Passwort aus der Nextcloud und reicht sie durch –
er speichert sie dabei nicht. In der Nextcloud ist nichts öffentlich.

**Optional – direkt aus der Nextcloud:** Wer den Server entlasten will, teilt
den Unterordner `Bilder` zusätzlich **nur lesend und ohne Passwort** und trägt
diesen Link unter *Optional: Bilder direkt aus der Nextcloud laden* ein. Die
App prüft beim Verbinden, dass er wirklich auf `Bilder` zeigt. Dann laden die
Schüler die Bilder direkt – sie sind aber für jeden mit Link sichtbar, also
**keine Fotos von Schülerinnen und Schülern**.

**Freigabe trennen** vergisst Link und Passwort. Die Dateien bleiben in
der Nextcloud; Bilder, die über den Server liefen, sind in den Modulen dann
nicht mehr zu sehen.

## Bilder einfügen

- **📁 Bild auswählen** (in jedem Bildfeld, beim Drag-and-Drop-Hintergrund,
  bei Bild-Hotspots und beim Einfügen ins Arbeitsblatt) lädt das Bild in den
  Ordner `Bilder/<Thema>/` hoch. Gibt es den Dateinamen dort schon,
  bekommt das neue Bild `-2`, `-3` … angehängt – nichts wird überschrieben.
- **☁️ Aus Nextcloud** zeigt die Bilder eines Ordners, vorgewählt der des
  aktuellen Themas, und fügt eines mit einem Klick ein. Bilder lassen sich
  also auch direkt in der Nextcloud in diese Ordner legen.
- Klappt das Hochladen nicht, fragt die App, ob das Bild stattdessen wie
  bisher in der App gespeichert werden soll.

Ohne verbundene Nextcloud bleibt alles wie bisher.

Der Ordnername ist der Titel des Themas. Wird das Thema umbenannt, landen
neue Bilder im Ordner mit dem neuen Namen; vorhandene Links bleiben gültig.

## Bilder im KI-Prompt

Im **🤖 KI-Prompt** erscheint bei verbundener Nextcloud **☁️ Bilder aus
meiner Nextcloud anbieten** mit der Wahl eines Ordners unter `Bilder`. Die KI
bekommt die Dateinamen dieses Ordners als Liste (`nc:<Ordner>/<Datei>`) und
darf nur daraus wählen – sie erfindet so keine Links. Sprechende Dateinamen
wie `flughafen-gate.jpg` helfen ihr bei der Wahl.

Beim Import macht die App daraus die Links auf deine Nextcloud. Ein Eintrag,
den es dort nicht gibt, bleibt leer; der Import-Bericht nennt ihn. Ist keine
Nextcloud verbunden, bleiben die Bildfelder leer, und der Bericht sagt, dass
erst die Nextcloud verbunden werden sollte.

### Bilder erst von einer KI erzeugen lassen

Für Wörter ohne passende Bilder (z. B. ein Memory Bild ↔ Wort): im KI-Prompt
unter **🎨 Bilder erst von einer KI erzeugen lassen**

1. die Wörter eintragen (je Zeile eines), Stil und Ordner prüfen – der Ordner
   ist ohne Angabe das Thema des Prompts;
2. **🎨 Prompt für Bilder** – kopieren und in einer Bild-KI (ChatGPT, Gemini,
   Copilot …) einfügen. Der Prompt gibt einen einheitlichen Stil vor, verbietet
   Text im Bild (sonst verrät das Bild die Lösung) und nennt je Wort einen
   festen Dateinamen;
3. die Bilder herunterladen und mit **📤 Bilder hochladen** oder per
   Hineinziehen hinzufügen. Die App ordnet sie den Wörtern zu – auch bei
   Namen wie „ChatGPT Image dog (1).png“; falsche oder fehlende Zuordnungen
   lassen sich je Wort auswählen. Umbenennen beim Speichern ist nicht nötig;
4. **⬆ In die Nextcloud laden** – jedes Bild kommt unter dem Namen seines
   Wortes in den Ordner. Eine neue Fassung ersetzt die alte.

Danach ist der Ordner im Quiz-Prompt gewählt und angehakt; der Prompt bietet
die Bilder der KI an.

## Bilder aus dem früheren Ordner der Schule

Eine frühere Version konnte Bilder im Nextcloud-Ordner des automatischen
Backups (beim Admin) ablegen, in `Bilder/<Name> (<Kennung>)/<Thema>/`. Diese
Bilder bleiben in den Modulen sichtbar – der Server liefert sie weiter aus.
Neue Bilder kommen dort aber nicht mehr hin.

Sobald die Lehrkraft ihre **eigene Freigabe verbindet**, kopiert die App diese
Bilder im Hintergrund nach `Bilder/<Thema>/` der eigenen Freigabe und stellt
die Links in allen Modulen und Entwürfen um (auch in Kopien aus dem Shop auf
diesem Server). Ein gleichnamiges, gleiches Bild wird wiederverwendet, ein
anderes bekommt `-2`, `-3` … angehängt. Der Dialog zeigt den Fortschritt und
das Ergebnis. Schlägt etwas fehl, versucht die App es später erneut,
„Verbinden“ sofort. Die alten Dateien bleiben beim Admin liegen, alte Links
(etwa in exportierten Dateien oder auf verbundenen Servern) funktionieren
also weiter.

## Vorhandene Bilder auslagern

Im Dialog unter **Vorhandene Bilder auslagern** → **🔍 Bilder in der App
suchen** listet die App deine Themen, in denen noch Bilder in der App liegen
(mit Anzahl und Größe). **📤 In die Nextcloud auslagern** lädt sie Thema für
Thema in den jeweiligen Ordner und ersetzt sie in den Modulen durch Links –
auch Bilder mitten im Text eines Arbeitsblatts. Gleiche Bilder gehen nur
einmal hoch (Dateiname `bild-<Prüfsumme>`); ein zweiter Lauf lädt nichts
doppelt. Gekaufte oder übernommene Module bleiben unverändert.

## Export

Beim Export als **H5P** oder **Moodle-XML** holt der Server verlinkte Bilder
und bettet sie in die Datei ein – sie funktioniert dann auch ohne deine
Nextcloud. Was sich nicht holen lässt, bleibt ein Link; der Export-Bericht
sagt, wie viele. Der JSON-Export enthält die Links, so wie sie im Modul stehen.

## Backup

Unter **Backup deiner Inhalte** → **Täglich
sichern um …** und **⬆ Jetzt sichern**. Gesichert wird in den Unterordner
`Backups` – je Lernthema eine JSON-Datei (`<Titel> (<Kennung>).json`), nur
selbst verfasste Module wie beim offenen Export, und nur, wenn sich etwas
geändert hat. Ältere Stände zeigt die Nextcloud bei jeder Datei unter
**Versionen**. Zurückholen: Datei herunterladen und über **📥 Thema
importieren** einlesen. Schlägt ein Backup fehl, kommt eine Mail, und die App
versucht es stündlich erneut.


## Wichtig

- Die App sieht nur den freigegebenen Ordner – kein Konto, keine anderen
  Dateien. Wer Link und Passwort der Freigabe kennt, kann den Ordner
  bearbeiten; das Passwort bleibt deshalb in der App verschlüsselt.
- Wer eine Datei in der Nextcloud löscht oder verschiebt, macht das Bild in
  allen Modulen kaputt, die es zeigen – auch bei Lehrkräften, die das Thema
  über den Shop nutzen.
- Der Ordnername ist der Titel des Themas. Wird das Thema umbenannt, landen
  neue Bilder im Ordner mit dem neuen Namen; vorhandene Links bleiben gültig.

## Technik

Alles läuft über den Server (die Nextcloud erlaubt dem Browser keine Zugriffe
von fremden Seiten) und die öffentliche WebDAV-Schnittstelle der Freigabe:
`/public.php/webdav/` (Benutzer = Kürzel) oder in neueren Versionen
`/public.php/dav/files/<Kürzel>/`. Bild-Links über den Server:
`/api/nextcloud/files/…`; `/api/nextcloud/school/…` nur noch für Bilder im
früheren Ordner der Schule. Ausgeliefert werden nur Bilddateien unter `Bilder/`. Nur https,
keine internen Adressen, keine Weiterleitungen. Code:
`src/nextcloud/`, Oberfläche in `src/renderer/js/views/nextcloud.js`.
