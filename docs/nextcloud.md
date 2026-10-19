# Nextcloud für Bilder

Bilder in Modulen liegen sonst in der Datenbank der App – jedes Bild macht
sie, jedes Backup und jede Quiz-Seite größer. Mit verbundener Nextcloud
speichert die App neue Bilder **in deiner Nextcloud**: je Lernthema in einem
eigenen Ordner. Im Modul steht nur noch der Link; Schülerinnen und Schüler
laden das Bild direkt aus deiner Nextcloud.

## Einrichten

Im Home-Menü (🏠 LernModule) → **☁️ Nextcloud**:

| Feld | Bedeutung |
|---|---|
| Adresse | z. B. `https://cloud.meine-schule.de` – eine kopierte Browser-Adresse geht auch. Hat der Admin ein automatisches Backup in eine Nextcloud eingerichtet, steht deren Adresse als Vorschlag da (nur die Adresse – Zugangsdaten des Backups werden nicht übernommen). |
| Benutzername | dein Nextcloud-Benutzername |
| App-Passwort | in der Nextcloud unter **Persönliche Einstellungen → Sicherheit → Neues App-Passwort erstellen**. Nicht dein normales Passwort: Ein App-Passwort lässt sich dort jederzeit einzeln widerrufen. |
| Hauptordner | Vorgabe `LearningModules`; darin legt die App `Bilder/` an |

**🔌 Verbinden** speichert und prüft sofort: Anmeldung, Ordner
`<Hauptordner>/Bilder` und eine **Lesefreigabe** dieses Ordners (die App legt
sie an, wenn es noch keine gibt). Das App-Passwort wird verschlüsselt
gespeichert und nie wieder angezeigt.

**Trennen** vergisst die Zugangsdaten. Die Bilder bleiben in der Nextcloud,
die Links in den Modulen funktionieren weiter, solange die Freigabe besteht.

## Bilder einfügen

- **📁 Bild auswählen** (in jedem Bildfeld, beim Drag-and-Drop-Hintergrund
  und bei Bild-Hotspots) lädt das Bild in den Ordner
  `<Hauptordner>/Bilder/<Thema>/` hoch. Gibt es den Dateinamen dort schon,
  bekommt das neue Bild `-2`, `-3` … angehängt – nichts wird überschrieben.
- **☁️ Aus Nextcloud** zeigt die Bilder eines Ordners, vorgewählt der des
  aktuellen Themas, und fügt eines mit einem Klick ein. Bilder lassen sich
  also auch direkt in der Nextcloud in diese Ordner legen.
- Klappt das Hochladen nicht, fragt die App, ob das Bild stattdessen wie
  bisher in der App gespeichert werden soll.

Ohne verbundene Nextcloud bleibt alles wie bisher.

Der Ordnername ist der Titel des Themas. Wird das Thema umbenannt, landen
neue Bilder im Ordner mit dem neuen Namen; vorhandene Links bleiben gültig.

## Wichtig

- Die Bilder sind über die **öffentliche Lesefreigabe** erreichbar – für
  jeden, der den Link kennt. Für Unterrichtsmaterial ist das in Ordnung,
  **Fotos von Schülerinnen und Schülern gehören nicht hinein**.
- Die Lesefreigabe gilt nur für den Ordner `Bilder`. Andere Ordner – etwa
  der des automatischen Backups – bleiben davon unberührt und so geschützt
  wie eingerichtet.
- Wer eine Datei in der Nextcloud löscht, verschiebt oder die Freigabe
  aufhebt, macht die Bilder in allen Modulen kaputt, die sie zeigen – auch
  bei Lehrkräften, die das Thema über den Shop nutzen.
- Die Freigabe darf nur lesen. Eine Freigabe mit Hochladerecht nimmt die App
  nicht: Ihr Link steckt in jeder Bild-URL, die Schüler sehen.

## Technik

Hochgeladen wird über den Server (die Nextcloud erlaubt dem Browser keine
Zugriffe von fremden Seiten): WebDAV unter `remote.php/dav/files/<Benutzer-ID>/`,
die Freigabe über die OCS-Schnittstelle (`files_sharing`). Die Bild-URL hat
die Form `<Adresse>/s/<Freigabe>/download?path=/<Thema>&files=<Datei>`. Nur
https, keine internen Adressen, keine Weiterleitungen. Code:
`src/nextcloud/`, Oberfläche in `src/renderer/js/views/nextcloud.js`.
