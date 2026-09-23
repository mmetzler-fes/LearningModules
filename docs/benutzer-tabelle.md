# Benutzer als Tabelle: Stapel-Import und Gruppenpflege

> Für den Admin, unter **Benutzerverwaltung** → ⬇️ *Tabelle (.ods)* und
> ⬆️ *Tabelle einlesen*.

## Wofür das gut ist

Zwei Aufgaben, eine Datei:

1. **Neue Kolleginnen und Kollegen anlegen** – eine Zeile je Person, statt das
   Formular zwanzigmal auszufüllen.
2. **Gruppen pflegen** – je Gruppe eine Spalte, Häkchen setzen oder entfernen.

## Warum die Passwörter nicht im Export stehen

Im Server liegt nur der scrypt-Hash. Das Klartextpasswort existiert **genau
einmal**: im Moment des Anlegens. Ein Export kann deshalb sagen, *wer* noch ein
offenes Initialpasswort hat, aber nicht *welches* – das ließe sich nur durch
ein Zurücksetzen aller Passwörter erzwingen, was jeden bereits ausgeteilten
Zettel entwerten würde.

Deshalb entstehen die Zugangsdaten dort, wo die Passwörter tatsächlich
vorliegen: **beim Import**. Legt er Konten an, kommt eine zweite Tabelle
zurück – Name, E-Mail, Initialpasswort, eine Zeile je neuem Konto. Zum
Ausdrucken, Zerschneiden und Verteilen. Ohne eingerichteten Mailversand ist das
der Weg zum neuen Kollegen.

Die Datei gibt es **nur in diesem Moment**. Danach steht im Server wieder nur
der Hash. Verlorene Zugänge laufen über den Einzel-Reset in der
Benutzerverwaltung.

Der reguläre Export ist im Gegenzug passwortfrei und damit gefahrlos
herumzureichen.

## Spalten

| Spalte | Export | Import |
|---|---|---|
| `email` | ja | **Pflicht** – der Schlüssel, an dem ein Konto erkannt wird |
| `name` | ja | nur beim Anlegen verwendet |
| `rolle` | ja | `Admin` oder `Lehrer`; nur beim Anlegen verwendet |
| `initialpasswort_offen` | ja (`ja`/`nein`) | wird ignoriert |
| `passwort` | **nein** | optional; leer = Server erzeugt eines |
| *Gruppenname* | je Gruppe eine Spalte | Häkchen = Mitglied |

Als Häkchen zählt `x`, `ja`, `j`, `1`, `true`, `✓`. Alles andere, auch eine
leere Zelle, bedeutet *kein Mitglied*.

Die Spalte `passwort` steht bewusst **nicht** im Export: Sonst trüge eine Datei,
die man zur Gruppenpflege herumreicht, plötzlich Klartextpasswörter. Beim
Import wird sie ausgewertet, wenn sie da ist – dann hast du die Liste ohnehin
selbst geschrieben. Mindestens 8 Zeichen; geändert werden muss das Passwort
beim ersten Anmelden trotzdem.

## Zwei Regeln, die Ärger ersparen

**Nur Gruppen, die als Spalte vorkommen, werden verändert.** Fehlt eine Gruppe
in der Datei, bleibt die Mitgliedschaft unberührt. Sonst würde eine gekürzte
Tabelle stillschweigend Zugehörigkeiten löschen, an die niemand gedacht hat.

**Bestehende Konten behalten Name und Rolle.** Wer umbenennen oder jemanden zum
Admin machen will, tut das bewusst in der Benutzerverwaltung – nicht als
Nebenwirkung einer hochgeladenen Datei. Beim Import ändern sich an vorhandenen
Konten ausschließlich die Gruppen.

Ein unveränderter Reimport ist damit folgenlos: nichts angelegt, nichts
geändert.

## Der Bericht

Nach dem Einlesen erscheint eine Übersicht: angelegte Konten, geänderte
Gruppenzuordnungen (mit `+` und `−`), übersprungene Zeilen samt Grund und
Zeilennummer. Unbekannte Spalten werden ausdrücklich genannt – meist steckt ein
Tippfehler im Gruppennamen dahinter, und stillschweigend zu übergehen wäre die
schlechtere Antwort.

Fehlerhafte Zeilen brechen den Import **nicht** ab. Eine ungültige Adresse oder
ein zu kurzes Passwort lässt genau diese Zeile liegen; der Rest läuft durch.

## Technik

| Endpunkt | Zweck |
|---|---|
| `GET` `/api/admin/users/export.ods` | Tabelle herunterladen (Admin) |
| `POST` `/api/admin/users/import` | Tabelle einlesen, liefert Bericht + Zugangsdaten (Admin) |

Gelesen und geschrieben wird mit `src/core/interchange/ods/ods.ts` – ohne
zusätzliche Abhängigkeit. Eine `.ods`-Datei ist ein ZIP mit einer `content.xml`
darin, und `adm-zip` liegt für den H5P-Import ohnehin bei. Für eine Tabelle aus
Text braucht es keine Tabellenkalkulations-Bibliothek.

Der Leser kommt mit Dateien zurecht, die LibreOffice zwischendurch gespeichert
hat: Das Programm fasst gleiche Zellen zu `table:number-columns-repeated`
zusammen und verpackt Text in Formatierungs-Tags. Beides wird aufgelöst,
nachlaufende Leerzellen werden verworfen. Geprüft wurde der volle Weg –
Export → in LibreOffice geöffnet und gespeichert → Reimport.

Die Zugangsdaten-Tabelle kommt als base64 in der JSON-Antwort und wird erst im
Browser zur Datei. Sie wird nirgends zwischengespeichert.
