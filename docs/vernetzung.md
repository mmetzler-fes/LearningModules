# Vernetzung mehrerer Server

> **Material teilen & Wirkung schenken – auch über die eigene Schule hinaus.**

Mehrere LearningModules-Server lassen sich verbinden. Dann erscheinen im Shop
auch die Angebote der anderen, und Lehrkräfte können sie **kopieren**. Die
Creator bleiben mit „Name @ Server“ verzeichnet, und ihr Server erfährt, dass
kopiert wurde – das erscheint dort unter **📈 Geteilt & genutzt**.

Was über die Leitung geht:

| geht hinaus | geht nie hinaus |
|---|---|
| Angebote mit 🌐 – Titel, Beschreibung, Modultitel, Kategorien, Bewertung (Durchschnitt) | Schülernamen, Ergebnisse, Klassen |
| bei einem Copy: die **eigenen** Module des Anbieters | fremde Module (die der Anbieter selbst erworben hat) |
| Namen von Creator und kopierender Lehrkraft | E-Mail-Adressen, Passwörter, Konten |

## Verbinden

Beide Admins brauchen **Administration → 🌐 Vernetzung**.

1. **Dieser Server:** Name, wie ihn andere sehen (z. B. „FES Esslingen“), und
   die öffentliche Adresse (z. B. `https://lm.schule.de`). Die Adresse ist
   mit `APP_URL` vorbelegt. Speichern.
2. **Admin A** trägt unter *Verbundene Server* die Adresse von B ein und klickt
   **Verbindung anfragen**. Bei A steht B dann als „angefragt“.
3. **Admin B** sieht unter *📨 Anfragen* den Server A. Vor dem Annehmen den
   **Fingerabdruck** vergleichen – bei A steht er oben unter *Dieser Server*,
   bei B neben dem Namen von A. Stimmt er, **✅ Annehmen**.
4. Beide sind verbunden. Die Kataloge werden sofort und danach stündlich
   abgeglichen; **🔄 Jetzt abgleichen** holt ihn sofort.

Fragen beide sich gegenseitig an, sind sie ohne weiteren Klick verbunden.
**Trennen** geht jederzeit einseitig; der andere erfährt es. Danach
verschwinden die Angebote aus dem Shop – was schon kopiert wurde, bleibt auf
beiden Seiten. Verbindungen gelten nur direkt: Ist A mit B und B mit C
verbunden, sieht A die Angebote von C nicht.

## Anbieten

Im Dialog **🛒 Im Shop anbieten** gibt es, sobald ein Server verbunden ist,
**🌐 Auch für verbundene Server**. Es geht nur zusammen mit „Alle Kolleginnen
und Kollegen“ – was hier im Haus nur bestimmte Personen sehen, geht auch nicht
hinaus.

- Hinaus gehen nur die **eigenen** Module des Anbieters. Hat er Module anderer
  erworben, bleiben sie hier; ein Angebot nur aus erworbenen Modulen erscheint
  drüben gar nicht.
- Drüben gibt es vorerst nur **Copy**. *Use* über Server hinweg kommt später.
- Unter *Meine Angebote* trägt das Angebot „🌐 verbundene Server“.

## Übernehmen

Im Shop stehen die Angebote verbundener Server unter **🌐 Von verbundenen
Servern**, mit dem Namen des Servers. Suche und Filter nach Fach und Stufe
gelten auch für sie; „🌐 andere Server“ blendet sie aus.

**📥 Copy** legt eine eigene Kopie unter deinen Lernthemen an – gesperrt, bis
du sie freigibst, wie jede Kopie aus dem Shop:

- Creator bleibt die Lehrkraft drüben („Carla Creator @ Schule A“), auch nach
  dem Bearbeiten. Weiterkopieren lassen sich ihre Module deshalb nicht; zur
  Nutzung anbieten geht.
- Die **Kategorien** kommen mit. Hat der andere Server einen Begriff selbst
  ergänzt, den es hier nicht gibt, gilt der nächste gemeinsame Oberbegriff.
- Der andere Server erfährt deinen **Namen** (nie die E-Mail-Adresse), damit
  die Creator sehen, wo ihr Material ankommt.

## Voraussetzungen für den Betrieb

- **https** mit gültigem Zertifikat. Server sprechen nur über https
  miteinander.
- **Die Uhr** muss stimmen (NTP): Ein signierter Aufruf gilt fünf Minuten.
- Der Reverse Proxy reicht `/api/federation/…` unverändert durch – Pfad,
  Inhalt und die Kopfzeilen `X-LM-Server`, `X-LM-Date`, `X-LM-Signature`.
  Mit der üblichen nginx-Konfiguration für `/api/` ist das so.
- **Eigenes `JWT_SECRET`** je Server (wie ohnehin empfohlen).
- Das **App-Secret** schützt den privaten Schlüssel. Wird ein Backup auf einem
  Server mit anderem App-Secret eingespielt, erzeugt dieser eine neue
  Kennung; seine Verbindungen müssen dann neu angefragt werden. So gibt es nie
  zwei Server mit derselben Identität.

Zum Ausprobieren ohne https (zwei Server auf einem Rechner):
`FEDERATION_ALLOW_HTTP=1` – nie im Betrieb.

## Vertrauen

Wer einen Server verbindet, vertraut dessen Admin: Inhalte von dort erscheinen
hier wie Material von Kolleginnen und Kollegen. Verbindet nur Server, deren
Betreiber ihr kennt. Jede Verbindung lässt sich jederzeit trennen.

## Technik

| Datei | Zweck |
|---|---|
| `src/federation/federation-rules.ts` | Signatur (Ed25519), Zeitfenster, Adressen, Abbildung der Kategorien |
| `src/federation/federation.service.ts` | Identität, Handshake, signierte Aufrufe, Katalogabgleich, Copy |
| `src/shop/shop.service.ts` | `federatedCatalog()`, `federatedCopyPayload()` – was hinausgeht |
| `src/core/entities/federation-peer.entity.ts` | verbundene Server (`outgoing`, `incoming`, `active`, `ended`) |
| `src/core/entities/remote-offer.entity.ts` | Angebote der anderen, Stand des letzten Abgleichs |
| `src/core/entities/remote-person.entity.ts` | Lehrkräfte drüben (`remote:<server>:<id>`), nur Name |
| `src/core/entities/federation-copy.entity.ts` | wer drüben was von hier kopiert hat |
| `src/renderer/js/views/federation-admin.js` | Admin-Seite |

**Identität:** Kennung (UUID) und Ed25519-Schlüsselpaar, beim ersten Aufruf
erzeugt, in `system_config` unter `federation_identity`; der private Schlüssel
mit dem App-Secret verschlüsselt. Der Fingerabdruck sind die ersten 8 Byte des
SHA-256 über den öffentlichen Schlüssel.

**Signatur:** Jeder Aufruf zwischen Servern trägt `X-LM-Server` (Kennung),
`X-LM-Date` (ISO-Zeit) und `X-LM-Signature` – Ed25519 über
`METHODE\nPfad?Abfrage\nZeit\nsha256(Inhalt)`. Geprüft wird gegen die rohen
Bytes des Inhalts (`main.ts` merkt sie sich), gegen den gespeicherten Schlüssel
des Servers und gegen ein Zeitfenster von fünf Minuten.

**Handshake:** A holt `GET /api/federation/info` von B, legt B als `outgoing`
an und schickt `POST /api/federation/hello` mit Kennung, Name, Adresse und
Schlüssel, signiert mit genau diesem Schlüssel. B ruft seinerseits die
genannte Adresse ab und prüft, dass dort derselbe Schlüssel antwortet – so
kann sich niemand für einen fremden Server ausgeben. Nimmt Admin B an, schickt
B `POST /api/federation/accept`. Ändert sich der Schlüssel eines verbundenen
Servers, steht er wieder unter *Anfragen*.

**Herkunft kopierter Inhalte:** Lernthema `copiedFromId` =
`remote:<server>:<Lernthema dort>`, Module `creatorId` =
`remote:<server>:<Creator dort>` und `originId` = `remote:<server>:<Original
dort>`. Übernommen werden nur bekannte Felder (Art, Titel, Beschreibung,
Inhalt, Reihenfolge, Untermodule).

### Endpunkte

Zwischen Servern (signiert, außer `info` und `hello`):

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/federation/info` | Kennung, Name, Adresse, öffentlicher Schlüssel |
| `POST` | `/api/federation/hello` | Anfrage (signiert mit dem mitgeschickten Schlüssel) |
| `POST` | `/api/federation/accept` | angenommen |
| `POST` | `/api/federation/goodbye` | getrennt bzw. abgelehnt |
| `GET` | `/api/federation/catalog` | Angebote mit 🌐 und die darin vorkommenden Kategorien |
| `POST` | `/api/federation/serve/:offerId/copy` | `{person: {id, name}}` – Inhalt für ein Copy |

Für Lehrkräfte und Admins (angemeldet):

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/federation/offers` | Angebote verbundener Server für den Shop |
| `POST` | `/api/federation/offers/:peerId/:offerId/copy` | Copy übernehmen |
| `GET` | `/api/admin/federation` | Identität und Verbindungen |
| `POST` | `/api/admin/federation/settings` | `{name, url}` |
| `POST` | `/api/admin/federation/peers` | `{url}` – Verbindung anfragen |
| `POST` | `/api/admin/federation/peers/:id/accept` | annehmen |
| `POST` | `/api/admin/federation/peers/:id/end` | ablehnen, zurückziehen, trennen |
| `POST` | `/api/admin/federation/peers/:id/sync` | Katalog jetzt abgleichen |

## Was noch kommt

- **Use über Server hinweg** als schreibgeschützte Spiegelkopie, die sich vom
  Original aktualisiert.
- **Nutzungsmeldungen:** Bearbeitungen kopierter Inhalte drüben werden
  gesammelt an den Ursprungsserver gemeldet (nur Zahlen).
- **Bewerten** von Angeboten anderer Server.
