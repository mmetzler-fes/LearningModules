# Anmeldung, Geräte und App-Symbol

## Als App starten

LernModule lässt sich wie eine App mit eigenem Symbol starten – ohne
Adressleiste und Browserleisten, mit mehr Platz (z. B. für den Stift-Editor).

- **PC (Chrome, Chromium, Edge):** In der Seitenleiste unten **📲 LernModule
  als App installieren**. Bietet der Browser die Installation gerade nicht an (schon
  installiert, Dialog einmal abgebrochen), erklärt der Knopf den Weg über das
  Browsermenü: Chrome ⋮ → „Streamen, speichern und teilen → LernModule
  installieren“, Edge … → „Apps → LernModule installieren“. Danach liegt das
  Symbol auf dem Desktop bzw. im Startmenü. **Firefox** (unter Ubuntu der
  Standardbrowser) kann keine Web-Apps installieren. In der installierten App
  ist der Knopf ausgeblendet.
- **iPad, iPhone (Safari):** Teilen-Knopf → **Zum Home-Bildschirm**.

Die App hat auf dem iPad ihren eigenen Speicher, getrennt von Safari – dort
einmal neu anmelden (mit „Angemeldet bleiben“).

### LernModule oder lm-editor?

Es gibt zwei Apps zum Installieren – nebeneinander, mit eigenem Symbol:

| | 📲 LernModule | ✍️ lm-editor |
|---|---|---|
| Wofür | alles: Lernthemen, Notizbuch, Klassen, Abgaben | Arbeitsblätter mit dem Stift bearbeiten, `.zlm` öffnen und speichern |
| Netz | braucht den Server (Anmeldung) | läuft auch **offline**, ohne Anmeldung |
| Dateien | liegen auf dem Server | bleiben als `.zlm` auf dem eigenen Rechner |
| Symbol | Bücherstapel | Bücherstapel mit Stift |
| Installieren | Seitenleiste → **📲 LernModule als App installieren** | Seitenleiste → **✍️ lm-editor installieren (offline)** → im Browser **⬇️ Auf diesem Gerät installieren** |

Der lm-editor öffnet sich dafür in einem Browser-Tab, nicht im Fenster der
LernModule-App – dort ließe er sich nicht installieren. Läuft LernModule
schon als App, zeigt der Knopf die Adresse (`/lm-editor/` auf diesem
Server) zum Öffnen im Browser. Die `.zlm`-Dateien aus dem
[GitHub-Backup](github-backup.md) öffnet der lm-editor direkt.

Sind beide installiert, bieten sich unter „Öffnen mit“ beide an: zum
Ansehen und Ablegen im Notizbuch LernModule, zum Bearbeiten auf dem eigenen
Rechner der lm-editor.

### Dateien mit LernModule öffnen (PC)

Ist LernModule am PC als App installiert (Chrome oder Edge), öffnet sie
Dateien direkt aus dem Explorer: **rechte Maustaste → „Öffnen mit“ →
LernModule** (oder LernModule als Standard festlegen, dann genügt ein
Doppelklick). Beim ersten Mal fragt der Browser, ob die App die Datei öffnen
darf.

- **.zlm** (lm-editor): wird gleich angezeigt – ohne Anmeldung, die Datei
  verlässt den PC nicht.
- **.odt, .docx, .pdf** und Folien (**.odp, .odg, .pptx, .ppt**): werden wie beim Import umgewandelt (bei PDFs fragt die
  App nach der Art) und angezeigt.
- **.xopp** (Xournal++): mit ihrem PDF – beide markieren und zusammen öffnen.
  Öffnest du nur die .xopp, sucht die App das PDF im selben Ordner: Beim
  ersten Mal öffnet sich die Ordnerauswahl schon in diesem Ordner – nur
  „Auswählen“ und die Leseerlaubnis bestätigen; danach findet die App PDFs in
  diesem Ordner ohne Nachfrage (höchstens fragt der Browser kurz nach der
  Erlaubnis). Liegt das PDF dort nicht, öffnet sich die Dateiauswahl im selben
  Ordner. Angezeigt wird das Dokument mit deiner Handschrift darüber.

Für diese Umwandlung braucht es die Anmeldung; bist du nicht angemeldet,
öffnet sich die Datei gleich nach der Anmeldung. Gespeichert ist zunächst
nichts. **📓 Im Notizbuch ablegen…** macht daraus ein Modul „Dokument“: ein
eigenes Lernthema wählen (das Dokument kommt dazu) oder einen Ordner bzw.
„Unsortiert“ (dort entsteht ein neues Lernthema, Name änderbar). Die
Handschrift einer .xopp wird dabei deine Beschriftung (nur für dich). Danach
lässt es sich gleich bearbeiten.

Auf dem iPad geht das nicht – Web-Apps können dort keine Dateien übernehmen.
Hast du die App schon vor diesem Update installiert: einmal deinstallieren
und neu installieren, damit Windows die neuen Dateitypen kennt.

## Angemeldet bleiben

Mit dem Häkchen **Angemeldet bleiben** (nur am eigenen Gerät) bleibt die
Anmeldung auch nach dem Schließen des Browsers erhalten – bis **90 Tage nach
der letzten Nutzung**. Solange du die App nutzt, verlängert sie sich von
selbst. Ohne Häkchen endet die Anmeldung nach 12 Stunden bzw. mit dem
Schließen des Browsers.

Das Passwort selbst speichert die App nicht. Der Passwort-Speicher des
Browsers bzw. der iCloud-Schlüsselbund kann es aber anbieten.

## 📱 Geräte

Unter **LernModule → 📱 Geräte** steht, wo dein Konto angemeldet ist: Gerät
und Browser, seit wann, zuletzt aktiv und bis wann.

- **Abmelden** neben einem Gerät beendet die Anmeldung dort sofort – etwa wenn
  ein iPad verloren gegangen ist.
- **Überall sonst abmelden** – dieses Gerät bleibt angemeldet.
- **Überall abmelden** – auch hier.

Wer das **Passwort ändert**, ist auf allen anderen Geräten abgemeldet.
**🚪 Abmelden** in der Seitenleiste beendet die Anmeldung auch beim Server.

## Technik

- Sitzungen: `src/auth/sessions.service.ts`, Tabelle `auth_sessions`. Das Token
  trägt die Sitzung (`sid`); die JWT-Strategie prüft sie bei jeder Anfrage.
- `POST /api/auth/refresh` (die App höchstens einmal am Tag), `POST /api/auth/logout`,
  `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/end-all`.
- App-Symbol: `src/renderer/manifest.webmanifest`, `src/renderer/icons/`.
- Dateien öffnen: `file_handlers` im Manifest, `launchQueue` in `app.js`, `js/views/file-open.js`, Anzeige `js/views/zlm-viewer.js`.
