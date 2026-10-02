# Audio Recorder

Schülerinnen und Schüler nehmen eine mündliche Antwort auf. Die Aufnahme
landet in der **Nextcloud-Dateiablage der Lehrkraft** – in der App selbst
wird nichts gespeichert.

## Einrichten (Lehrkraft)

1. In Nextcloud einen Ordner anlegen, z. B. `Aufnahmen TG12 Englisch`.
2. *Teilen → Link teilen* → Berechtigung **„Dateiablage (nur Hochladen)“**.
   Dann können Schüler nur hochladen und sehen weder eigene noch fremde
   Aufnahmen. Optional ein Passwort und ein Ablaufdatum setzen.
3. Im Modul den Freigabelink (und ggf. das Passwort) eintragen und
   **🔌 Verbindung testen** klicken. Klappt es, liegt in der Nextcloud die
   Datei `LernModule-Verbindungstest.txt`.

Dateiname der Aufnahmen: `Datum_Uhrzeit_Schülername_Link_Modul.webm`
(iPad/Safari: `.m4a`).

## Ablauf (Schüler)

🎙 Aufnahme starten → ⏹ Stopp (spätestens nach der Höchstdauer) → anhören →
↻ neu aufnehmen oder **⬆ Abgeben**. Mehrfaches Abgeben ist möglich; die
Lehrkraft bekommt dann alle Fassungen. Beim ersten Mal fragt der Browser
nach dem Mikrofon.

In den Ergebnissen steht „abgegeben“ (1 Punkt) mit Dateinamen bzw. „nicht
abgegeben“ – bewertet wird die Aufnahme von der Lehrkraft.

## Technik und Datenschutz

- Der Browser kann nicht direkt in die Nextcloud hochladen (CORS); der
  Server nimmt die Aufnahme an und reicht sie sofort per WebDAV weiter
  (`POST /api/public/recording`). Höchstens 25 MB, Dauer höchstens 10 Minuten.
- Hochgeladen wird nur über einen gültigen Schüler-Link (Themen- oder
  Quick-Link), zu dem das Modul gehört, und nur, wenn das Modul der Lehrkraft
  gehört, die den Link verteilt hat.
- Die Ablage-Adresse kommt immer aus dem gespeicherten Modul. Erlaubt sind nur
  `https`-Freigabelinks auf öffentliche Server – keine internen Adressen.
- Ablage-Link und Passwort erreichen nie Schüler und auch keine Lehrkräfte,
  die das Thema über den Shop nutzen.
- Lehrer-Vorschau: Aufnehmen und Anhören gehen, hochgeladen wird nicht.
