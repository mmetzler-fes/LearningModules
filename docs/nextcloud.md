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

Wohin Bilder gehen (die „Ablage“ der Lehrkraft):

1. in die **eigene Freigabe** der Lehrkraft, wenn sie eine verbunden hat;
2. sonst in die **[Nextcloud der Schule](#nextcloud-der-schule)**, wenn der
   Schuladmin eine eingerichtet hat – die Lehrkraft muss dann nichts tun;
3. sonst bleiben sie verkleinert in der App
   ([Grenze](#grenze-fuer-bilder-in-der-app)).

Die Nextcloud des Hauptadmins (automatisches Backup) nimmt keine Bilder auf:
Ein Server kann mehrere Schulen haben, und dieser Ordner gehört nicht allen.

## Nextcloud der Schule

Unter **🏫 Meine Schule → ☁️ Nextcloud der Schule für Bilder** trägt der
Schuladmin einen Freigabelink ein (Ordner in der Schul-Nextcloud, *Hochladen
und Bearbeiten erlauben*, mit Passwort). Lehrkräfte der Schule ohne eigene
Freigabe legen ihre Bilder dann dort ab, jede in einem eigenen Ordner
`Bilder/<Name> (<Kennung>)/<Thema>/`. Im Nextcloud-Dialog der Lehrkraft steht
„Deine Schule stellt eine Nextcloud bereit“; alles andere (☁️ Aus Nextcloud,
KI-Prompt, Auslagern) funktioniert wie mit eigener Freigabe. Ein tägliches
Backup je Lehrkraft gibt es nur mit eigener Freigabe.

- **Bilder folgen dem Thema.** Jedes Bild gehört in die Ablage der Lehrkraft,
  der das Thema gehört. Liegt es woanders, kopiert die App es dorthin und
  hängt den Link um – beim Start, stündlich und nach jedem Verbinden. Das
  gilt beim **Schulwechsel** (sobald die neue Schule eine Nextcloud hat oder
  die Lehrkraft eine eigene Freigabe), bei einer **eigenen Freigabe**, die
  später dazukommt (sie geht vor, die Bilder ziehen mit), und bei
  **Kopien aus dem Shop** (die Bilder kommen in die Ablage der Käuferin, sofern
  sie eine hat). Hat die Lehrkraft keine Ablage, bleibt der Link – das Bild
  kommt weiter aus dem alten Ordner.
- **Fester Schulordner:** Jeder Link nennt die Schul-Nextcloud und den Ordner
  (`/api/nextcloud/sch/<Schule>/<Ordner>/…`). Ein Schulwechsel oder ein
  gelöschtes Konto macht ihn nicht kaputt.
- **Erst danach aufräumen:** Unter *🗂 Ordner der Lehrkräfte – aufräumen*
  sieht der Schuladmin je Ordner, wem er gehört, ob die Lehrkraft noch an der
  Schule ist, wie viele Bilder darin liegen und in wie vielen Modulen sie noch
  stecken. **🗑 Löschen** gibt es erst, wenn kein Modul mehr eines davon zeigt.
- **Umziehen** in eine andere Freigabe kopiert alle Ordner mit und schaltet
  erst danach um; die Links bleiben gleich. **Trennen** geht, solange Bilder
  in Modulen stecken, nur mit ausdrücklicher Bestätigung – sie fehlen dann.
- Wer Link und Passwort kennt, sieht die Bilder aller Lehrkräfte der Schule –
  also keine Fotos von Schülerinnen und Schülern.
- Trennt eine Lehrkraft ihre **eigene Freigabe**, bietet der Dialog
  **🏫 In die Nextcloud der Schule übernehmen und trennen** an.

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

**Lesefreigabe zurückziehen:** Erst im Dialog das Feld leeren und
**🔌 Verbinden** wählen. Dann hängt die App alle direkten Links in den Modulen
auf den Weg über den Server um, und die Lesefreigabe kann in der Nextcloud
gelöscht werden. Wird stattdessen eine neue Lesefreigabe eingetragen, zeigen
die Links auf die neue. Löscht jemand die Lesefreigabe zuerst in der
Nextcloud, merkt die App das (Prüfung beim Start und höchstens alle sechs
Stunden beim Öffnen des Dialogs), stellt genauso um und zeigt einen Hinweis.
Bis dahin fehlen die Bilder in den Modulen.

### Freigabe trennen

**Freigabe trennen** zeigt zuerst, was an der Freigabe hängt: wie viele Bilder
(und wie groß) in welchen Themen stecken – auch in Kopien anderer Lehrkräfte
aus dem Shop. Ohne Bilder wird gleich getrennt, sonst gibt es drei Wege:

- **⬇ Zurück in die App holen und trennen:** Der Browser holt jedes Bild,
  verkleinert es wie beim Einfügen und speichert es wieder in den Modulen; erst
  danach wird getrennt. Das geht nur, solange die Bilder in der App damit unter
  der [Grenze](#grenze-fuer-bilder-in-der-app) bleiben – sonst bricht die App
  ab, bevor sich etwas ändert, und schlägt das Umziehen vor.
- **🚚 Zu einer anderen Nextcloud umziehen** (siehe unten).
- **Trotzdem trennen:** mit Liste der betroffenen Themen. Die Bilder fehlen
  dann in den Modulen; die Dateien bleiben in der Nextcloud. Wer später
  dieselbe Freigabe wieder verbindet, hat alle Bilder zurück.

### Umziehen

Für eine andere Nextcloud (Schulwechsel, neue Cloud) unter **🚚 Zu einer
anderen Nextcloud umziehen** die neue Ordnerfreigabe und ihr Passwort
eintragen. Die App prüft sie sofort (Passwort, Schreibprobe), kopiert dann im
Hintergrund den Ordner `Bilder` hinüber und schaltet **erst danach** um. Die
Links in den Modulen bleiben gleich und zeigen ab dann auf die neue Freigabe;
direkte Links einer Lesefreigabe laufen danach über den Server. Der Dialog
zeigt den Fortschritt. Bricht der Umzug ab, bleibt die bisherige Freigabe
verbunden – nichts fehlt. Die alte Freigabe wird nicht verändert und kann
nach dem Umzug gelöscht werden.

Einen anderen Freigabelink oben einfach einzutragen, lässt die App nicht zu,
solange Bilder aus der bisherigen in Modulen stecken – sonst zeigten alle ins
Leere.

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

Ohne verbundene Nextcloud bleibt das Bild in der App – siehe
[Grenze für Bilder in der App](#grenze-fuer-bilder-in-der-app).

Der Ordnername ist der Titel des Themas. Wird das Thema umbenannt, landen
neue Bilder im Ordner mit dem neuen Namen; vorhandene Links bleiben gültig.

## Grenze für Bilder in der App

Ohne eigene Freigabe landen Bilder auf dem Server der App. Damit er nicht
vollläuft:

- **Verkleinern:** Fotos über 1600 px oder 600 KB rechnet der Browser vor dem
  Speichern herunter (JPEG bleibt JPEG, alles andere wird PNG – Transparenz und
  scharfe Kanten bleiben). SVG und GIF bleiben unverändert. Mit Nextcloud geht
  das Bild unverändert dorthin.
- **Hinweis** (Standard ab 20 MB je Lehrkraft): Beim Einfügen erscheint ein
  Hinweis mit dem Stand, am Knopf ☁️ Nextcloud ein Punkt, im Dialog der Stand.
- **Grenze** (Standard 50 MB): Neue Bilder lassen sich nicht mehr in der App
  speichern; die App bietet an, die Nextcloud einzurichten. Vorhandene Bilder
  bleiben, Module lassen sich weiter bearbeiten und speichern – der Server lehnt
  nur ein Speichern ab, mit dem **neue** Bilder in der App dazukämen (der
  Entwurf bleibt erhalten). Nach dem Verbinden bringt *Vorhandene Bilder
  auslagern* alles in die Nextcloud.
- **Gezählt** werden die Bilder in selbst verfassten Modulen der eigenen
  Themen, jedes Bild einmal – dasselbe, was sich auslagern lässt. Gekauftes und
  Übernommenes zählt nicht. Mit verbundener Nextcloud gibt es keine Grenze.

Die Werte stellt der Admin unter **Administration → Shop & Sicherheit → 🖼
Bilder in der App** ein (0 = aus). Bilder über einen Import oder eine Kopie
aus dem Shop prüft die Grenze nicht.

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
Bilder im Hintergrund nach `Bilder/<Thema>/` der eigenen Freigabe.

Zusätzlich hängt „Bilder folgen dem Thema“ (siehe
[Nextcloud der Schule](#nextcloud-der-schule)) jeden Link auf den früheren
Ordner in die Ablage der Lehrkraft um, **der das Thema gehört** (sonst des
Verfassers, sonst dessen, der das Bild hochgeladen hat) – eigene Freigabe
oder Nextcloud der Schule, auch wenn das Bild z. B. vom Admin stammt. Fehlt das Bild dort, kopiert
die App es hinüber; liegt es schon dort, nimmt sie es (auch wenn es beim Admin
inzwischen gelöscht ist). Hat noch niemand davon eine eigene Freigabe, bleibt
der Link, bis jemand verbindet. Das Server-Log meldet, wie viel umgehängt
wurde. Ein gleichnamiges, gleiches Bild wird wiederverwendet, ein
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
`/api/nextcloud/files/…` (eigene Freigabe), `/api/nextcloud/sch/<Schule>/<Ordner>/…`
(Nextcloud der Schule, `school_nextcloud`); `/api/nextcloud/school/…` nur noch
für Bilder im früheren Ordner des Admin-Backups. Schuladmin-Endpunkte unter
`/api/my-school/nextcloud` (Code: `school-nextcloud.service.ts`). Ausgeliefert werden nur Bilddateien unter `Bilder/`. Nur https,
keine internen Adressen, keine Weiterleitungen. Code:
`src/nextcloud/`, Oberfläche in `src/renderer/js/views/nextcloud.js`.
