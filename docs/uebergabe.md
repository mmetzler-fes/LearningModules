# Inhalte übergeben und abgleichen

Drei Fälle, drei Wege:

| Fall | Weg |
|---|---|
| Neue E-Mail-Adresse, gleicher Server | 🏠 LernModule → **✉️ E-Mail ändern** – alles zieht mit um (siehe [Shop und Rechte](shop-und-rechte.md#konten)) |
| Material an eine **andere Lehrkraft** geben, z. B. beim Ausscheiden | 🏠 LernModule → **🎁 Inhalte übergeben** |
| Das **eigene Konto auf einem anderen Server** mit Inhalten versorgen | 🏠 LernModule → **🔗 Andere Server** |

## Inhalte an eine andere Lehrkraft übergeben

**🎁 Inhalte übergeben** → E-Mail-Adresse der Lehrkraft, die übernimmt →
**Übergabe anfragen**. Die andere Lehrkraft sieht oben unter 🏠 LernModule
„… möchte dir … Lernthemen übergeben“ und nimmt an oder lehnt ab. Erst dann
geht etwas über; bis dahin lässt sich die Anfrage zurückziehen.

| geht mit | bleibt beim Absender |
|---|---|
| alle eigenen Lernthemen mit allen Modulen | Ergebnisse, Klassen, Themen- und Quick-Links – sie hängen an Schülerdaten |
| die Notebooks: Books heißen dann „… (von Name)“ | die eigenen Tags |
| die dabei verwendeten Tags – gleichnamige der Empfängerseite werden verwendet, sonst als Kopie angelegt | was der Absender selbst aus dem Shop nutzt |
| die Angebote im Shop – wer etwas nutzt, behält es | |

**Urheberschaft:** Ohne Häkchen bleibt der Absender Creator der Module. Die
übernehmende Lehrkraft kann sie dann nur zur Nutzung anbieten – Angebote mit
Copy werden zu Use-Angeboten (nur Copy: Das Angebot ruht). Mit **„Auch die
Urheberschaft übergeben“** wird sie Creator: Sie darf die Module zum Kopieren
anbieten und offen exportieren, und unter **📈 Geteilt & genutzt** zählt es
für sie.

Quick-Links des Absenders auf diese Lernthemen gelten danach nicht mehr.

## Mein Konto auf anderen Servern

Wer an zwei Schulen mit eigenem Server unterrichtet, kann seine Konten
**verknüpfen** und die eigenen Inhalte vom einen auf den anderen holen.
Voraussetzung: Die beiden Server sind [verbunden](vernetzung.md).

### Verknüpfen

Die gleiche E-Mail-Adresse genügt nicht – ein Admin könnte sie für jedes
Konto eintragen. Deshalb mit einem Code:

1. Auf dem einen Server: **🔗 Andere Server** → *Code hier erzeugen* für den
   anderen Server. Der Code (z. B. `HWKV-GF6M`) gilt 15 Minuten.
2. Auf dem anderen Server: **🔗 Andere Server** → *oder Code von dort
   eingeben* → **Verknüpfen**.

Beide Seiten zeigen danach „Name @ Server“.

### Holen

**⬇ Jetzt holen** bringt alles, was du drüben **selbst verfasst** hast,
hierher – als deine eigenen Lernthemen: Du bist hier Creator, kannst sie
anbieten, exportieren und bearbeiten.

- **Notebooks:** Books, Bereiche und Abschnitte, in denen etwas liegt, kommen
  mit („… (Servername)“). Was du hier umsortierst, bleibt so.
- **Kategorien** kommen mit, Tags nicht – sie sind deine Ordnung je Server.
- Neue Lernthemen starten **gesperrt**, wie jede Kopie.
- **Fremde Module** (die du drüben selbst erworben hast) bleiben drüben.

Ein späteres Holen bringt Änderungen nach:

| drüben | hier | Ergebnis |
|---|---|---|
| geändert | unverändert | übernommen – die Module behalten ihre Kennung, Links und Ergebnisse hier bleiben gültig |
| geändert | **geändert** | **nicht überschrieben**; die Meldung nennt das Lernthema |
| gelöscht | – | bleibt hier; die Meldung nennt es |

**Stündlich automatisch holen** schaltet das für diese Verknüpfung ein.

Holst du auch in die andere Richtung, kommt nichts zurück, was ursprünglich
von dort stammt – so entstehen keine Doppel.

**Lösen** geht jederzeit auf einer Seite; die andere erfährt es. Was schon
geholt wurde, bleibt.

## Technik

| Datei | Zweck |
|---|---|
| `src/handover/content-handover.service.ts` | Übergabe an eine andere Lehrkraft, in einer Transaktion |
| `src/handover/handover-rules.ts` | Tags zuordnen, Angebote anpassen, Book-Namen |
| `src/core/entities/content-handover.entity.ts` | Anfragen (`pending`, `accepted`, `declined`, `withdrawn`) |
| `src/federation/account-sync.service.ts` | Verknüpfen, Ausliefern, Holen |
| `src/federation/sync-rules.ts` | Prüfsumme, Entscheidung (neu, unverändert, übernehmen, Konflikt), Abgleich der Module |
| `src/core/entities/account-link.entity.ts`, `link-code.entity.ts` | Verknüpfungen und Einmal-Codes |

**Abgleich:** Ein geholtes Lernthema trägt `syncSource` =
`remote:<Server>:<Lernthema dort>`, `syncHash` (Prüfsumme über Titel,
Beschreibung und Module beim letzten Holen) und `syncedAt`; seine Module
`originId` = `remote:<Server>:<Modul dort>`. Weicht die jetzige Prüfsumme hier
von `syncHash` ab, wurde hier geändert. Knoten tragen `syncSource` ebenso.
Duplikate in den Notebooks übernehmen diese Felder nicht.

### Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/handovers` | eigene und an mich gerichtete Übergaben |
| `POST` | `/api/handovers` | `{email, withCreator, note}` |
| `POST` | `/api/handovers/:id/accept` · `/decline` | annehmen, ablehnen |
| `DELETE` | `/api/handovers/:id` | zurückziehen |
| `GET` | `/api/federation/links` | Verknüpfungen, verbundene Server, offener Code |
| `POST` | `/api/federation/links/code` | `{peerId}` – Code erzeugen |
| `POST` | `/api/federation/links` | `{peerId, code}` – Code eingeben |
| `POST` | `/api/federation/links/:id/sync` | jetzt holen |
| `POST` | `/api/federation/links/:id` | `{autoSync}` |
| `DELETE` | `/api/federation/links/:id` | lösen |

Zwischen Servern (signiert): `POST /api/federation/link/confirm` (Code
prüfen), `/link/export` (eigene Inhalte des verknüpften Kontos),
`/link/unlink`.
