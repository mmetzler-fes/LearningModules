# Rechtemodell, Lernmodule-Shop und Verschlüsselung

## Gedanke dahinter

Material soll häufiger getauscht werden. Dafür gibt es einen **Shop** mit
einem **Punktekonto**: Wer teilt, bekommt Punkte, und wer nimmt, gibt welche ab.
Punkte zu horten lohnt sich nicht, weil jedes Konto zum Jahreswechsel einen Teil
verliert und danach etwas geschenkt bekommt. So bleibt genug im Umlauf.

Zugleich gilt: Nur was jemand **selbst verfasst** hat, darf die App
unverschlüsselt verlassen. Alles andere geht nur verschlüsselt mit dem
Masterkey hinaus.

## Rollen je Modul

Die Rechte hängen am einzelnen **Modul**, nicht am Thema. Ein Thema kann eigene
und fremde Module mischen.

| Rolle | Wer | Bedeutung |
|---|---|---|
| **Creator** | hat das Modul verfasst | bleibt für immer verzeichnet, auch in Kopien und nach jeder Bearbeitung |
| **Owner** | dem das Thema gehört, oder wer ein Nutzungsrecht hat | darf die Module benutzen |
| **Buyer** | hat eine Kopie erworben | darf sie bearbeiten und zur Nutzung weitergeben |

Was daraus folgt:

| | anbieten (Shop) | weitergeben | bearbeiten | offen exportieren |
|---|---|---|---|---|
| Creator + Owner | ✅ Copy/Use, mit Punkten oder frei | ✅ | ✅ | ✅ |
| Owner + Buyer (Copy erworben) | – | nur **Use**, kostenlos, an höchstens N Personen | ✅ | – (nur verschlüsselt) |
| nur Owner (Use erworben) | – | – | – | – |

Bearbeitet ein Buyer seine Kopie, bleiben die vorhandenen Module auf ihren
Creator verzeichnet. Legt er neue Module an, ist er deren Creator und kann
**diese** wiederum im Shop anbieten.

Gesetzt wird der Creator ausschließlich vom Server: beim Anlegen auf den
Anlegenden, danach nie wieder. Was der Client als `creatorId` mitschickt, wird
verworfen. Module **verschieben** oder **duplizieren** ändert den Creator
nicht, sonst ließe sich die Kennung mit einem Klick abstreifen.

## Der Shop

Jede Weitergabe läuft über den Shop. Das gilt auch für das Teilen mit einer
Gruppe: Es ist ein Angebot, das nur diese Gruppe sieht.

**Anbieten:** Auf der Themenkarte → **👥**. Der Knopf führt direkt in den Shop
zum Angebot für dieses Thema. Angeboten werden nur die selbst verfassten Module.
Fremde Module im selben Thema gehören nie dazu.

- **Use**: Der Käufer verwendet das Original in eigenen Themen- und
  Quick-Links. Änderungen des Creators wirken sofort. Die Ergebnisse landen
  beim Käufer, denn dafür zählt, wer den Link verteilt.
- **Copy**: Der Käufer bekommt eine eigene Kopie und wird Owner und Buyer.
  Spätere Änderungen am Original wandern nicht mit. Die Kopie startet gesperrt:
  erst ansehen, dann für Schüler freigeben.

Je Modus gibt es einen eigenen Preis. 0 heißt frei. Die Zielgruppe ist „alle“
oder eine Auswahl aus Personen und Gruppen.

**Erwerben:** Der Shop zeigt alle Angebote anderer, die man sehen darf.
„👥 an dich geteilt“ kennzeichnet gezielte Angebote. Gekauft werden kann nur,
wer genug Punkte hat. Die Punkte gehen in derselben Transaktion vom Käufer an
den Anbieter, in der Kopie bzw. Nutzungsrecht entstehen.

**Zurückziehen:** Das Angebot verschwindet aus dem Shop. Wer schon gekauft hat,
behält Kopie bzw. Nutzungsrecht. Kostenlose Nutzungsrechte kann der Anbieter
einzeln entziehen, bezahlte nicht.

**Weitergabe als Buyer:** Im selben Dialog, Abschnitt „Zur Nutzung
weitergeben“. Nur Personen und Gruppen, nicht „alle“. Höchstens so viele
Personen, wie der Admin erlaubt (Vorgabe 10). Gruppen zählen mit ihren
Mitgliedern. Wer abgewählt wird, verliert die Nutzung sofort. Punkte gibt es
dafür nicht.

**Zur Nutzung erworben:** Unter der eigenen Themenliste stehen die Themen mit
Nutzungsrecht, jeweils mit *Ansehen*, eigenem *Quick-Link* und *Zurückgeben*.
Beim Zurückgeben gibt es keine Erstattung.

**Löschen durch den Creator:** Ein Thema oder Modul, das andere per Use
verwenden, ist danach auch bei ihnen weg. Die Oberfläche nennt vorher die
Anzahl.

## Punkte

| Einstellung (Admin → Shop & Sicherheit) | Vorgabe |
|---|---|
| Startguthaben neuer Konten | 200 |
| Abzug am 1.1. in Prozent | 10 |
| Geschenk am 1.1. (nach dem Abzug) | 100 |
| Weitergabe durch Buyer: höchstens Personen | 10 |

- Ein Konto wird beim ersten Zugriff eröffnet (`users.points` ist bis dahin
  `null`). Damit bekommen auch Konten aus der Zeit vor dem Shop ihr
  Startguthaben.
- Der Jahreswechsel prüft beim Start und danach alle sechs Stunden, ob ein
  1.1. ansteht. Verpasste Jahre werden nachgeholt. Beim allerersten Lauf wird
  nur das Jahr vermerkt (`system_config.points_last_yearly`); rückwirkend wird
  nichts abgezogen.
- Deaktivierte Konten ruhen: kein Abzug, kein Geschenk.
- Ins Minus geht kein Konto. Jede Buchung steht in `points_entries` und ist
  im Shop unter *Punktekonto* sichtbar.

## Export und Verschlüsselung

| Export | Inhalt | Wer |
|---|---|---|
| JSON / H5P | nur die selbst verfassten Module | jeder mit Lesezugriff |
| 🔒 verschlüsselt (`.lmenc`) | das ganze Thema mit Creator-Angaben | nur der Eigentümer des Themas |
| 💾 Backup (`.lmbak`) | ganze Datenbank (Inhalte samt Bildern, Konten, Ergebnisse) | nur Admins |

Enthält ein Thema eigene und fremde Module, warnt der Export-Dialog, dass
unverschlüsselt nur die eigenen hinausgehen.

Ein verschlüsselter Themen-Export lässt sich nur in einer App mit demselben
Masterkey einlesen, und dort nur von der Person, die ihn erstellt hat. Das
schließt auch Konten ein, in die ihres zusammengeführt wurde. Sonst wäre die
Datei ein Weg am Shop vorbei. Beim Einlesen bleiben die Creator erhalten. Offen
importierte Dateien (JSON, H5P) gelten dagegen als neues Material: Creator wird,
wer importiert.

**Grenze des Schutzes:** Wer Inhalte benutzen darf, sieht sie, und Schüler
sehen sie auch. Abschreiben verhindert die Verschlüsselung nicht. Sie
verhindert, dass sich fremde Inhalte als Datei aus der App ziehen lassen.

### Masterkey

- Verfahren: Für jede Datei wird mit **scrypt** und einem zufälligen Salz ein
  Schlüssel aus dem Masterkey abgeleitet. Verschlüsselt wird mit
  **AES-256-GCM**, das jede Veränderung erkennt.
- Dateiformat: `LMENC1` · Fingerabdruck (8 Byte) · Salz · Nonce · Prüfsumme ·
  Chiffrat von `gzip(JSON)`.
- Aufbewahrung: `data/masterkeys.json`, verschlüsselt mit dem App-Secret.
  Das App-Secret kommt aus der Umgebungsvariable **`APP_SECRET`** (mind. 16
  Zeichen). Fehlt sie, legt die App einmalig `data/.app-secret` an (Rechte
  0600). Für den Betrieb ist `APP_SECRET` besser, weil dann Schlüssel und
  Schlüsseldatei nicht im selben Verzeichnis liegen.
- Der Admin kann den Masterkey setzen, aber nie wieder auslesen. Angezeigt
  werden nur Fingerabdruck und Datum. **Bitte sicher notieren.**
- Ein neuer Masterkey ersetzt den alten nur fürs Verschlüsseln. Frühere bleiben
  gespeichert, damit ältere Dateien lesbar bleiben.
- Fehlt beim ersten Start ein Masterkey, erzeugt die App einen zufälligen.
  Wer Backups auf einem anderen Server einspielen will, setzt auf beiden
  denselben eigenen.

### Backup und Restore

Die Datenbank wird mit `VACUUM INTO` kopiert. Das liefert einen konsistenten
Stand, auch während andere Anfragen laufen. Der Restore **ersetzt alles**. Der
vorherige Stand bleibt als `data/database.sqlite.before-restore` liegen.
Dateien legt die App nicht ab – Bilder und Arbeitsblätter stehen in der
Datenbank und sind damit im Backup. Masterkeys und App-Secret gehören nicht
zum Backup: Sie gehören zum Server, nicht zu den Daten.

### Automatisches Backup in die Cloud (WebDAV / Nextcloud)

Unter Administration → Shop & Sicherheit → *Automatisches Backup* stellt der
Admin ein:

| Einstellung | Vorgabe |
|---|---|
| WebDAV-Adresse des Ordners | – (nur `https://`, außer `localhost`) |
| Benutzername und App-Passwort | – (Passwort verschlüsselt mit `APP_SECRET`, nie wieder angezeigt) |
| Zeitplan | wöchentlich, Sonntag 03:00 Uhr (oder täglich) |
| Aufbewahren | 4 Backups |

**Nextcloud:** Die WebDAV-Adresse steht in der Dateiansicht unten links unter
„Dateieinstellungen“, z. B. `https://cloud.schule.de/remote.php/dav/files/BENUTZER/`.
Dahinter kommt der Ordnername. Fehlt der Ordner, legt die App ihn an (eine
Ebene). Als Passwort ein **App-Passwort** verwenden (Nextcloud → Einstellungen →
Sicherheit). Es lässt sich jederzeit widerrufen, ohne das Login zu ändern.

Je Lauf: Backup erzeugen, hochladen, prüfen, ob es vollständig angekommen ist.
**Erst danach** werden die ältesten gelöscht, bis nur noch die eingestellte
Anzahl übrig ist. Schlägt etwas fehl, wird nichts gelöscht. Angefasst werden
nur Dateien nach dem Muster `lernmodule-backup-JJJJ-MM-TT-HHMM.lmbak`; alles
andere im Ordner bleibt liegen.

- **Zeitplan:** Ein verpasster Termin, etwa weil der Server aus war, wird
  beim nächsten Start nachgeholt. Nach einem Fehler versucht die App es
  stündlich erneut. Gleich nach dem ersten Einschalten läuft ein Backup.
- **Uhrzeit:** Es zählt die Zeitzone des Servers; die Admin-Seite zeigt sie
  an. Im Docker-Container ist das ohne weitere Angabe UTC, deshalb
  `TZ: Europe/Berlin` in der `docker-compose.yaml` setzen.
- **Fehler:** In der Admin-Navigation steht dann ein rotes „!“ an
  „Shop & Sicherheit“, beim Anmelden als Admin erscheint eine Meldung, und
  der Abschnitt nennt Zeitpunkt und Grund. Ist Mailversand eingerichtet,
  bekommen alle aktiven Admins beim ersten Fehler einer Serie eine Mail.
- **Knöpfe:** *Verbindung testen* (schreibt und löscht eine Testdatei),
  *Jetzt sichern*, *Backups in der Cloud* (Liste mit *Einspielen*).
- **Masterkey** nicht im selben Ordner ablegen. Ohne ihn ist das Backup
  wertlos, mit ihm daneben ungeschützt.

## Konten

**Löschen:** Wer Creator ist, also mindestens ein noch existierendes Modul
verfasst hat (auch in der Kopie eines anderen), wird **nur deaktiviert**. Das
gilt beim Löschen durch den Benutzer selbst wie durch den Admin.

- Das Konto kann sich nicht anmelden, bestehende Tokens sind sofort ungültig,
  und seine Themen- und Quick-Links sind gesperrt.
- Alle Themen mit eigenen Modulen stehen für **0 Punkte** zum Kopieren und
  Verwenden für alle im Shop. Ein vorher bestehendes Angebot wird gesichert.
- Nutzungsrechte anderer an seinen Themen bleiben bestehen.
- **Reaktivieren** (Admin → Benutzerverwaltung) stellt die Angebote wieder so
  her wie vor der Deaktivierung. Was andere in der Zwischenzeit kostenlos
  erworben haben, behalten sie.

Wer nichts verfasst hat, wird **wirklich gelöscht**. Erworbene Kopien und
Nutzungsrechte verfallen. Themen-Links, Quick-Links, Ergebnisse und Tags
gehen an einen Admin.

Der letzte aktive Admin lässt sich weder löschen noch deaktivieren noch
herabstufen.

**E-Mail-Adresse ändern** (Dashboard → ✉️ E-Mail ändern):

- **Neue Adresse gibt es noch nicht:** Dort wird ein Konto mit Initialpasswort
  angelegt, und das Passwort geht an die neue Adresse. Erst wenn sich der
  Benutzer damit anmeldet und ein eigenes Passwort vergibt, wird das alte
  Konto übernommen. So ist bewiesen, dass die neue Adresse ihm gehört. Ohne
  Mailversand zeigt der Dialog das Initialpasswort an.
- **Neue Adresse gibt es schon:** Nach Eingabe ihres Passworts werden die
  Konten zusammengeführt.

Beim Zusammenführen gehen Themen, Creator-Kennung, Angebote, Nutzungsrechte,
Links, Ergebnisse, Tags, Gruppen und Punkte (addiert) an das Konto mit der
neuen Adresse. Admin ist, wer es in einem der beiden war. Das alte Konto wird
gelöscht, seine ID bleibt in `users.formerIds` vermerkt.

Whitelist und Blacklist gelten auch für die neue Adresse.

## Umstellung bestehender Daten

`RightsMigrationService` läuft bei jedem Start und tut nur etwas, solange es
Altlasten gibt:

1. Module ohne Creator bekommen den Eigentümer ihres Themas. Bei einer Kopie
   ist es der Eigentümer der Quelle, sofern es ihn noch gibt.
2. Alte Freigaben (`topics.sharedWith`, `topics.sharedAccess`) werden zu
   kostenlosen Angeboten für dieselben Personen und Gruppen. Wer ein
   freigegebenes Thema schon in eigenen Themen- oder Quick-Links einsetzt,
   bekommt das Nutzungsrecht direkt, damit seine Links weiterlaufen. Danach
   werden die alten Felder geleert.

Das persönliche Ausblenden bzw. Entfernen fremder Freigaben entfällt. An seine
Stelle tritt *Zurückgeben*.

## Technisch

| Datei | Zweck |
|---|---|
| `src/core/entities/shop-offer.entity.ts` | Angebot (`creator`/`buyer`), Preise, Zielgruppe |
| `src/core/entities/use-grant.entity.ts` | Nutzungsrecht; `scope` legt fest, welche Module sichtbar sind |
| `src/core/entities/points-entry.entity.ts` | Buchungen auf dem Punktekonto |
| `src/shop/shop.service.ts` | Anbieten, Erwerben, Weitergeben, Entziehen |
| `src/shop/rights-migration.service.ts` | Umstellung der Bestandsdaten |
| `src/accounts/points.service.ts` | Punktekonto, Einstellungen, Jahreswechsel |
| `src/accounts/accounts.service.ts` | Deaktivieren, Reaktivieren, Löschen, Zusammenführen |
| `src/core/crypto/master-key.service.ts` | Masterkey, Ver- und Entschlüsselung |
| `src/core/interchange/export/export.service.ts` | Export mit Rechteprüfung, verschlüsselter Import |
| `src/admin/backup.service.ts` | Backup und Restore |
| `src/admin/cloud-backup.service.ts` | Automatisches Backup per WebDAV, Zeitplan, Aufbewahrung |

Der Zugriff auf ein Thema hängt weiter an einer Stelle: `accessLevel()` in
`topics.service.ts` kennt `owner` (eigenes Thema; Admins immer) und `read`
(Nutzungsrecht). Welche Module bei `read` sichtbar sind, entscheidet
`visibleModules()`:

- Nutzungsrecht aus einem Creator-Angebot: nur die Module dieses Creators,
  samt Untermodulen.
- Nutzungsrecht aus der Weitergabe eines Buyers: alle Module.

Das gilt überall, wo Module ausgeliefert werden: Modulliste, Themen-Link-
Editor, Themen-Link und Quick-Link beim Schülerstart.

Nutzungsrechte werden wie die Gruppen einmal pro Anfrage in der JWT-Strategie
geladen (`req.user.grants`). Außerhalb einer Anfrage, etwa für den Eigentümer
eines Links beim Schülerstart, liefert `GroupsService.asUser()` dasselbe. Die
JWT-Strategie schlägt außerdem das Konto nach, damit ein deaktiviertes Konto
sofort draußen ist.

### Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/shop/offers` | Angebote, die ich sehe, und mein Kontostand |
| `GET` | `/api/shop/my-offers` | meine Angebote samt Nutzern |
| `GET` | `/api/shop/points` | Kontostand, Buchungen, Regeln |
| `GET` | `/api/shop/topics/:topicId` | Zustand des Anbieten-Dialogs |
| `POST` | `/api/shop/topics/:topicId/creator-offer` | `{allowCopy, allowUse, priceCopy, priceUse, audience, active}` |
| `POST` | `/api/shop/topics/:topicId/buyer-share` | `{audience}`; leer beendet die Weitergabe |
| `DELETE` | `/api/shop/offers/:id` | Angebot zurückziehen bzw. Weitergabe beenden |
| `POST` | `/api/shop/offers/:id/acquire` | `{mode: 'copy' \| 'use'}` |
| `DELETE` | `/api/shop/grants/:id` | Nutzungsrecht zurückgeben oder kostenloses entziehen |
| `GET` | `/api/topics/granted` | Themen mit Nutzungsrecht |
| `GET` | `/api/interchange/topics/:id/export-info` | eigene/fremde Module, darf verschlüsselt? |
| `GET` | `/api/interchange/topics/:id/export-json` | nur eigene Module |
| `GET` | `/api/interchange/topics/:id/export-h5p` | nur eigene Module |
| `GET` | `/api/interchange/topics/:id/export-encrypted` | ganzes Thema, verschlüsselt |
| `POST` | `/api/interchange/import-json` | JSON oder `.lmenc`, wird erkannt |
| `POST` | `/api/auth/change-email` | `{newEmail, password, targetPassword?}` |
| `DELETE` | `/api/auth/account` | eigenes Konto entfernen (Creator: deaktivieren) |
| `DELETE` | `/api/admin/users/:id` | Konto entfernen (Creator: deaktivieren) |
| `POST` | `/api/admin/users/:id/reactivate` | Konto wieder freischalten |
| `GET`/`POST` | `/api/admin/points-settings` | Punkteregeln |
| `GET`/`POST` | `/api/admin/master-key` | Status bzw. neuen Masterkey setzen |
| `GET` | `/api/admin/backup` | verschlüsseltes Backup |
| `POST` | `/api/admin/restore` | Backup einspielen (ersetzt alles) |
| `GET`/`POST` | `/api/admin/cloud-backup` | Status bzw. Einstellungen des automatischen Backups |
| `POST` | `/api/admin/cloud-backup/test` | Verbindung testen |
| `POST` | `/api/admin/cloud-backup/run` | Jetzt sichern |
| `GET` | `/api/admin/cloud-backup/files` | Backups im Cloud-Ordner |
| `POST` | `/api/admin/cloud-backup/restore` | `{name}` – Backup aus der Cloud einspielen |

Entfallen sind `POST /api/topics/:id/sharing`, `POST /api/topics/:id/copy`,
`GET /api/topics/shared-with-me` sowie `POST /api/topics/:id/hidden` und
`POST /api/topics/:id/removed`.
