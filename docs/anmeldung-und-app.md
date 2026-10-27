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
