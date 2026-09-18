# Benutzer aufnehmen und Passwörter

## Ablauf ohne E-Mail-Versand (Standard)

1. Als Admin anmelden → **Benutzerverwaltung** → *Neuen Benutzer anlegen*.
2. E-Mail-Adresse, Anzeigename und Rolle (Lehrer/Admin) eintragen.
3. Das System erzeugt ein Initialpasswort und zeigt es **einmalig** an
   (Format `nUpY-xNTZ-TFr4` – keine verwechselbaren Zeichen wie `0/O` oder `1/l`).
   Über *Kopieren* oder *Drucken* an den Benutzer weitergeben.
4. Der Benutzer meldet sich damit an und wird sofort zum Vergeben eines
   eigenen Passworts aufgefordert. Bis dahin sind alle übrigen Funktionen
   gesperrt (HTTP 403).

Das Initialpasswort steht nur in dieser einen Antwort. Ist es verloren, setzt
der Admin es über das 🔑-Symbol in der Benutzerliste neu.

Konten mit offenem Initialpasswort sind in der Liste mit
„🔑 Initialpasswort offen" markiert.

**Whitelist/Blacklist** gelten auch hier: Adressen außerhalb der Whitelist
werden beim Anlegen abgewiesen.

## Später auf echten Mailversand umstellen

Es ist kein Codeumbau nötig – nur Paket installieren und Umgebung setzen:

```bash
bun add nodemailer      # oder: npm i nodemailer
```

```bash
MAIL_TRANSPORT=smtp
SMTP_HOST=mail.schule.de
SMTP_PORT=587
SMTP_SECURE=false            # true bei Port 465
SMTP_REQUIRE_TLS=true        # Vorgabe: ohne Verschlüsselung wird nicht versandt
SMTP_USER=lernmodule@schule.de
SMTP_PASS=geheim
MAIL_FROM="LearningModules <lernmodule@schule.de>"
APP_URL=https://lernmodule.schule.de
```

Danach verschickt das System Initialpasswörter und Passwort-Resets per Mail und
zeigt sie **nicht mehr** im Admin-UI an. Schlägt der Versand fehl, fällt die
Anzeige automatisch auf den bisherigen Weg zurück, inklusive Fehlermeldung im
Dialog – es geht also kein Konto verloren.

`MAIL_TRANSPORT` nicht gesetzt oder `console` → kein Versand, Passwort wird
angezeigt und zusätzlich ins Server-Log geschrieben.

## Rollout auf den Server (Docker)

Das Image kommt aus der GHCR und wird von `.github/workflows/docker-build.yml`
bei jedem Push auf **master** gebaut. Reihenfolge deshalb:

1. Änderungen nach `master` mergen und pushen → CI baut das Image (linux/arm64).
2. Auf dem Server die `docker-compose.yaml` um die `environment:`-Werte
   ergänzen (siehe `docker-compose.example.yaml` im Repo).
3. Passwort in eine `.env` neben der compose-Datei legen, nicht in die YAML:

   ```bash
   echo 'SMTP_PASS=geheim' > .env
   chmod 600 .env
   ```

4. `docker compose pull && docker compose up -d`

Erst nach Schritt 1 ist `nodemailer` im Image – vorher greift `MAIL_TRANSPORT=smtp`
zwar, der Versand scheitert aber und fällt auf die Passwortanzeige zurück.

Prüfen, ob der Versand läuft:

```bash
docker compose logs -f learningmodules-server | grep -i mail
```

`Mail an ... versandt` = zugestellt. `Mailversand ... fehlgeschlagen` = der Admin
bekommt das Passwort weiterhin im Dialog angezeigt.

## Beteiligte Dateien

| Datei | Zweck |
|---|---|
| `src/core/mail/mail.service.ts` | Schnittstelle, die die Anwendung aufruft |
| `src/core/mail/console-mail.service.ts` | Kein Versand, `delivered: false` |
| `src/core/mail/smtp-mail.service.ts` | SMTP-Versand über nodemailer |
| `src/core/mail/mail.module.ts` | Auswahl über `MAIL_TRANSPORT` |
| `src/auth/auth.service.ts` | `createUser`, `resetUserPassword`, `generatePassword` |
| `src/auth/guards/jwt-auth.guard.ts` | Sperre bei offenem Initialpasswort |

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/admin/users` | Benutzer anlegen (Admin) |
| `POST` | `/api/admin/users/:id/reset-password` | Passwort neu setzen (Admin) |
| `POST` | `/api/auth/change-password` | Eigenes Passwort ändern, liefert neues Token |

`POST /api/admin/admins` gibt es nicht mehr – ersetzt durch
`POST /api/admin/users` mit `role: "admin"`.
