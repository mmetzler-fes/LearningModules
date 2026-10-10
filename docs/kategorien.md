# Kategorien: Fach und Bildungsstufe

Tags sind deine persönliche Ordnung – jede Lehrkraft vergibt eigene. Damit
Material auch bei anderen gefunden wird, im Shop und später über verbundene
Server hinweg, gibt es zusätzlich **Kategorien**, die für alle gleich sind:

| Facette | Ebenen | Beispiel |
|---|---|---|
| 📚 **Fach** | bis 3 | Elektrotechnik › Automatisierungstechnik › SPS-Programmierung |
| 🎓 **Bildungsstufe** | bis 2 | Berufliche Bildung › Fachschule |

- **Ebene 1** stammt aus den offenen Vokabularen von OpenEduHub
  (WirLernenOnline): 70 Fächer und 12 Bildungsstufen, mit festen Kennungen,
  die auch andere Bildungsplattformen verwenden.
- **Darunter** kommt eine gemeinsame Ergänzung, die mit der App ausgeliefert
  wird – auf jedem Server gleich, etwa die Teilgebiete der Elektrotechnik oder
  die Schularten der beruflichen Bildung.
- **Fehlt etwas**, schlägst du es vor (siehe unten).

Ein Lernthema kann mehrere Fächer und Stufen tragen. Die Suche im Shop findet
mit einem Oberbegriff auch alles darunter: „Elektrotechnik“ findet auch
„SPS-Programmierung“.

## Einordnen

- **🏠 LernModule → ✏️** an einem Lernthema: *Einordnung – Fach und
  Bildungsstufe*.
- **Notebooks → ⋯ → 🗂 Einordnen…** an einem Lernthema, oder im Dialog
  *✏️ Umbenennen / Beschreibung*.
- **Notebooks → ⋯ → 🗂 Alles darin einordnen…** an einem Book, Bereich oder
  Abschnitt: Die gewählten Kategorien kommen zu allen eigenen Lernthemen darin
  dazu, auch in Unterordnern. **➖ Entfernen** nimmt sie wieder weg. Was die
  Lernthemen sonst tragen, bleibt.
- **Beim Anbieten im Shop** (siehe unten).

In der Auswahl wechselst du oben zwischen 📚 Fach und 🎓 Bildungsstufe. ▸ klappt
eine Ebene auf, die Suche zeigt Treffer samt ihren Oberbegriffen. Was gewählt
ist, steht oben als Chip; ✕ nimmt es wieder heraus.

### Begriff vorschlagen

Unten in der Auswahl: **Fehlt ein Begriff? Vorschlagen …** – Oberbegriff
wählen, Namen eingeben, *Vorschlagen*.

- Du kannst ihn **sofort selbst verwenden** (gestrichelter Rand,
  „vorgeschlagen“).
- Für alle anderen erscheint er, sobald der Admin ihn bestätigt hat.
- Gibt es unter demselben Oberbegriff schon einen gleichnamigen Begriff, wird
  dieser gewählt statt eines doppelten.
- Neue Fächer oder Stufen der **obersten** Ebene legt nur der Admin an.
- Unter der untersten Ebene (Fach: Ebene 3, Stufe: Ebene 2) geht nichts mehr.

## Tags und Kategorien

Ein Tag kann für Kategorien **stehen**: Unter **🏷 Tags → bearbeiten → Steht
für Kategorie(n)** z. B. den Tag „TIA-Portal“ mit *SPS-Programmierung*
verbinden. Jedes Lernthema mit diesem Tag gilt dann als so eingeordnet – auch,
wenn es den Tag über ein Book oder einen Bereich in den
[Notebooks](notebooks.md) erbt. So lässt sich eine bestehende Tag-Ordnung mit
wenigen Klicks übertragen.

Schuladmins können das ebenso für Schul-Tags festlegen.

## Im Shop

- Oben stehen **📚 Alle Fächer** und **🎓 Alle Stufen** zur Auswahl – nur, was
  in den Angeboten vorkommt.
- Jede Karte zeigt ihre Kategorien. Steht ein Begriff und sein Oberbegriff
  beide da, genügt der genauere; der Tooltip zeigt den ganzen Pfad.
- **Beim Anbieten ist mindestens ein Fach nötig.** Der Dialog zeigt nach dem
  „+“, was schon aus den Lernthemen (oder ihren Tags) kommt – das zählt mit.
  Für einen Bereich oder eine Auswahl von Modulen lässt sich das Angebot auch
  als Ganzes einordnen.
- Ältere Angebote ohne Fach bleiben im Shop; unter *Meine Angebote* steht
  dann „📚 noch kein Fach“, und beim nächsten Speichern ist eins nötig.
- Bei einer **Kopie** aus dem Shop kommen die Kategorien mit (anders als die
  Tags, die dem Anbieter gehören).

## Für Admins

**Administration → 🗂 Kategorien**

- **📝 Vorschläge** der Lehrkräfte, mit Pfad, Namen und wie oft schon
  zugeordnet:
  - **✅ Übernehmen** – für alle wählbar.
  - **✏️ Umbenennen** – etwa einen Tippfehler beheben.
  - **⤵ Zusammenführen** – in einem vorhandenen Begriff aufgehen lassen; alle
    Zuordnungen wandern mit.
  - **🗑 Ablehnen** – was damit eingeordnet war, gilt danach als eingeordnet
    unter dem Oberbegriff.
- **Alle Kategorien** je Facette als Baum, mit Herkunft (*OpenEduHub*,
  *gemeinsam*, *hier ergänzt*) und Zahl der Zuordnungen.
  - **🙈 Ausblenden** – nicht mehr wählbar, z. B. Fächer, die an der Schule
    keine Rolle spielen. Bestehende Zuordnungen bleiben. Geht bei allen.
  - Umbenennen, Zusammenführen und Löschen gehen nur bei hier ergänzten
    Begriffen. Ausgelieferte behalten Namen und Platz, damit sie auf allen
    Servern dasselbe bedeuten.
- **➕ Anlegen** – ein Begriff unter einem Oberbegriff, sofort für alle; mit
  „ganz oben“ auch ein neues Fach bzw. eine neue Stufe.

Soll ein hier ergänzter Begriff auf alle Server, gehört er in die gemeinsame
Liste (`src/categories/vocab/lm-shared.json`) und kommt mit dem nächsten
Update.

## Technik

| Datei | Zweck |
|---|---|
| `src/core/entities/category.entity.ts` | Tabelle `categories`: Kennung, Facette, Oberbegriff, Name, Herkunft, URI, Status (`active`, `proposed`, `hidden`) |
| `src/categories/vocab/oeh-discipline.json`, `oeh-educational-context.json` | OpenEduHub, Ebene 1 (CC0-1.0) |
| `src/categories/vocab/lm-shared.json` | gemeinsame Ergänzung, Ebene 2–3 |
| `src/categories/category-rules.ts` | Regeln ohne Datenbank: Ebenen, Auswahl bereinigen, Kategorien eines Lernthemas, Vorschlagsprüfung |
| `src/categories/categories.service.ts` | Übernahme beim Start, Vorschlagen, Pflegen, Zusammenführen, Einordnen eines Notebook-Knotens |
| `src/renderer/js/views/categories.js` | Auswahl, Chips, Filter |
| `src/renderer/js/views/categories-admin.js` | Admin-Seite |

**Kennungen:** `oeh-d:<id>` (Fach) und `oeh-c:<id>` (Bildungsstufe) mit der
OpenEduHub-URI, `lm:…` für die gemeinsame Liste, `local:<uuid>` für hier
Ergänztes. Kennungen ändern sich nie und werden nie neu vergeben; aus der
gemeinsamen Liste Entferntes bleibt mit `"retired": true` stehen und wird beim
Start ausgeblendet.

**Übernahme:** Bei jedem Start gleicht der Server die Tabelle mit den drei
Dateien ab – neue Einträge kommen dazu, Name, Oberbegriff und Reihenfolge
werden angeglichen. Den Status behält er: Was der Admin ausgeblendet hat,
bleibt ausgeblendet. Die Dateien kopiert der Build nach `dist/categories/vocab`
(`nest-cli.json`, `assets`).

**OpenEduHub aktualisieren:** `node scripts/update-oeh-vocabs.mjs` lädt die
aktuellen Listen und schreibt die beiden JSON-Dateien neu. Was dort wegfällt,
bleibt hier stehen.

**Zuordnung:** `categoryIds` an Lernthemen, Tags und Angeboten (je höchstens
20). Die Kategorien eines Lernthemas sind seine eigenen und die seiner Tags
(`effectiveOf`); die eines Angebots zusätzlich seine eigenen. Nur der
Eigentümer ordnet ein Lernthema ein; der Server nimmt nur bekannte, für den
Benutzer wählbare Kennungen an – Zugeordnetes, das inzwischen ausgeblendet
ist, bleibt beim Speichern erhalten.

### Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/categories` | alle Kategorien mit `selectable` für mich |
| `POST` | `/api/categories` | `{parentId, label}` – Vorschlag (Admin: sofort aktiv, auch `{facet, label}` ganz oben) |
| `PATCH` | `/api/categories/:id` | Admin: `{label?, status?: 'active' \| 'hidden'}` |
| `POST` | `/api/categories/:id/merge` | Admin: `{into}` |
| `DELETE` | `/api/categories/:id` | Admin bzw. eigener Vorschlag: löschen, Zuordnungen an den Oberbegriff |
| `GET` | `/api/categories/usage` | Admin: Zahl der Zuordnungen je Kategorie |
| `POST` | `/api/categories/nodes/:nodeId` | `{categoryIds, mode: 'add' \| 'remove'}` für alle eigenen Lernthemen eines Notebook-Knotens |

Lernthemen (`PATCH /api/topics/:id`), Tags (`POST`/`PATCH /api/tags`) und
Angebote (`POST /api/shop/offers`) nehmen `categoryIds` mit.
