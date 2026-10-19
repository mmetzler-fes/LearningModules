# LearningModules

Lernplattform für Schulen, im Browser und auf dem eigenen Server.

Lehrkräfte bauen **Lernthemen** aus Modulen: Quiz, Lückentext, Zuordnen,
Drag and Drop, Diktat, Arbeitsblatt und weitere H5P-artige Aufgaben.
Schüler brauchen kein Konto, sie starten über einen Link oder QR-Code.
Ergebnisse und Namen bleiben auf dem Server der Schule.

> **Material teilen & Wirkung schenken.** Lehrkräfte geben Lernthemen im
> Shop weiter, zum Nutzen oder als eigene Kopie, und sehen, wo ihr Material
> im Unterricht ankommt. Verbundene Server tauschen ihre Angebote aus.

## Funktionen

- **Lernthemen und Module** mit Editor, Vorschau und laufend gesicherten Entwürfen
- **Import** von Moodle-Fragen (XML), H5P-Dateien und JSON; Export als H5P und JSON
- **Notebooks** zum Ordnen (Book › Bereich › Abschnitt), Tags und einheitliche
  Kategorien (Fach, Bildungsstufe; Ebene 1 aus den OpenEduHub-Vokabularen)
- **Klassen** je Schuljahr mit Schülerliste, strikte Anmeldung, Testschüler
- **Links für Schüler**: Quick-Link, Klassenlink, QR-Code, Klassenarbeit,
  Lernen mit Lösungen, Lernbegleiter, Quiz-Arena
- **Ergebnisse** je Schüler und Aufgabe, Klassenergebnisse, Löschregel
- **Shop** zum Teilen (Use oder Copy), Bewertungen, „Geteilt & genutzt“
- **Vernetzung** mehrerer Server mit signiertem Handshake; Konten über Server
  hinweg verknüpfen und Inhalte abgleichen
- **Sicherheit**: Zwei-Faktor-Anmeldung, verschlüsselte Exporte und Backups
  (Masterkey), automatisches Backup per WebDAV/Nextcloud
- **Nextcloud für Bilder**: Ordner der Schule (aus dem automatischen Backup)
  oder eigene Ordnerfreigabe mit Passwort – je Thema ein Unterordner, kein
  Nextcloud-Konto nötig; dazu tägliches Backup je Lehrkraft

Die Anleitungen stehen in [`docs/`](docs/). Die App zeigt sie auch selbst unter
**📖 Hilfe**.

## Betrieb mit Docker

Ein fertiges Image baut GitHub bei jedem Push:
`ghcr.io/mmetzler-fes/learningmodules-server:latest`.

1. [`docker-compose.example.yaml`](docker-compose.example.yaml) als
   `docker-compose.yaml` kopieren und anpassen (Adresse, Mailversand).
2. Daneben eine `.env` mit eigenen Geheimnissen anlegen:
   ```bash
   printf 'JWT_SECRET=%s\nAPP_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
   chmod 600 .env
   ```
3. `docker compose up -d` und die App hinter einen Reverse Proxy mit https
   stellen (Port 3000 im Container).
4. **Sofort** anmelden: Eine leere Datenbank legt den Admin
   `admin@localhost` / `admin123` an. Das Passwort muss beim ersten Anmelden
   geändert werden.

Die Daten liegen in `./data` (SQLite-Datenbank, verschlüsselte Schlüssel).
Ordner mit `chmod 700`, Dateien mit `600`.

## Entwicklung

```bash
npm install
npm run start:dev      # http://localhost:3000
npm test               # Unit-Tests (jest)
npx tsc --noEmit       # Typprüfung
```

Backend: NestJS mit TypeORM und SQLite (`src/`). Frontend: ES-Module ohne
Build-Schritt (`src/renderer/`).

## Lizenz

Copyright © 2026 Martin Metzler

LearningModules ist freie Software: Sie dürfen sie unter den Bedingungen der
**GNU Affero General Public License** weitergeben und verändern, wie von der
Free Software Foundation veröffentlicht, entweder Version 3 der Lizenz oder
(nach Ihrer Wahl) jede spätere Version
([`AGPL-3.0-or-later`](https://spdx.org/licenses/AGPL-3.0-or-later.html)).
Das ist dieselbe Lizenz wie bei Nextcloud.

Die Software wird ohne jede Gewährleistung bereitgestellt, siehe
[`LICENSE`](LICENSE).

**Was die AGPL für Schulen bedeutet:** Einsetzen, auf dem eigenen Server
betreiben und verändern ist erlaubt. Wer eine **veränderte** Fassung für
andere über das Netz betreibt, muss deren Nutzern den Quelltext dieser
Fassung anbieten. Die Anmeldeseite verlinkt dafür auf dieses Repository. Bei
einer eigenen Fassung gehört dort der Link zu deren Quelltext hin.

**Nicht von der Lizenz erfasst** sind die Inhalte, die Lehrkräfte in der App
erstellen. Sie gehören ihren Urhebern, die über ihre Weitergabe selbst
entscheiden.

**Bestandteile Dritter** behalten ihre eigenen Lizenzen, unter anderem die
H5P-Bibliotheken in `assets/h5p` und die OpenEduHub-Vokabulare in
`src/categories/vocab` (CC0-1.0).
