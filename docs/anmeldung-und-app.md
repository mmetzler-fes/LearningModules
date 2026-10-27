# Anmeldung, Geräte und App-Symbol

## Als App starten

LernModule lässt sich wie eine App mit eigenem Symbol starten – ohne
Adressleiste und Browserleisten, mit mehr Platz (z. B. für den Stift-Editor).

- **PC (Chrome, Edge):** In der Seitenleiste **📲 Als App installieren** (erscheint,
  wenn der Browser es anbietet) – oder im Browsermenü „App installieren“ bzw.
  „Apps → Diese Seite als App installieren“. Danach liegt das Symbol auf dem
  Desktop bzw. im Startmenü.
- **iPad, iPhone (Safari):** Teilen-Knopf → **Zum Home-Bildschirm**.

Die App hat auf dem iPad ihren eigenen Speicher, getrennt von Safari – dort
einmal neu anmelden (mit „Angemeldet bleiben“).

### Dateien mit LernModule öffnen (PC)

Ist LernModule am PC als App installiert (Chrome oder Edge), öffnet sie
Dateien direkt aus dem Explorer: **rechte Maustaste → „Öffnen mit“ →
LernModule** (oder LernModule als Standard festlegen, dann genügt ein
Doppelklick). Beim ersten Mal fragt der Browser, ob die App die Datei öffnen
darf.

- **.zlm** (lm-editor): wird gleich angezeigt – ohne Anmeldung, die Datei
  verlässt den PC nicht.
- **.odt, .docx, .pdf**: werden wie beim Import umgewandelt (bei PDFs fragt die
  App nach der Art) und angezeigt.
- **.xopp** (Xournal++): mit ihrem PDF – beide markieren und zusammen öffnen;
  fehlt das PDF, fragt die App danach. Angezeigt wird das Dokument mit deiner
  Handschrift darüber.

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
