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

## Rollen

Es gibt **Lehrer** und **Admin + Lehrer**. Ein Admin besitzt sämtliche
Lehrerfunktionen zusätzlich: eigene Lernthemen, Module, Quick-Links und
Ergebnisse. Die Rechteprüfungen im Code sind durchgehend als
`if (user.role === 'teacher')` formuliert – Admins sind also nie
eingeschränkt, sondern nur zusätzlich berechtigt.

Die Rolle lässt sich in der Benutzerliste über das Auswahlfeld ändern
(`PATCH /api/admin/users/:id/role`). Zwei Sperren verhindern das Aussperren:

- Man kann sich **nicht selbst** die Admin-Rechte entziehen – das muss ein
  anderer Admin tun.
- Der letzte verbleibende Admin kann nicht herabgestuft werden.

**Achtung:** Eine Rollenänderung wirkt erst, wenn der Betroffene sich neu
anmeldet. Sein bestehendes Token trägt die alte Rolle bis zu 24 Stunden.

## Whitelist / Blacklist

Erlaubte Schreibweisen für Einträge:

| Muster | Bedeutung |
|---|---|
| `@fes-es.de` | alle Adressen genau dieser Domain |
| `fes-es.de` | dasselbe |
| `*.fes-es.de` | Domain und alle Subdomains |
| `chef@fes-es.de` | genau diese eine Adresse |

Leere Whitelist = alles erlaubt. Die Blacklist hat Vorrang.

Die Prüfung gilt für die Selbstregistrierung von Lehrkräften **und** für
Konten, die ein Admin anlegt.

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

## Benutzer löschen: die Inhalte gehen an einen Admin

Beim Löschen einer Lehrkraft wechselt vorher alles, was ihr gehört, zum
handelnden Admin: Themen, Themen-Links, Quick-Links, Tags, hochgeladene
Dateien und Ergebnisse. Erst danach verschwindet das Konto.

**Warum nicht einfach löschen?** Vorher blieb genau das zurück, was niemand
gebrauchen kann: Themen mit einer `ownerId`, die auf niemanden mehr zeigte.
Für alle unsichtbar, von niemandem zu bearbeiten oder zu löschen – aber
Kolleginnen mit einer Nutzungsfreigabe behielten sie, weil `accessLevel()` nur
IDs vergleicht. Ihre Themen-Links liefen also weiter und lieferten Inhalte
aus, an die niemand mehr herankam. Ein Konto zu löschen sollte mitten im
Schuljahr keinen Unterricht abschalten und keine Karteileichen hinterlassen.

Was dabei passiert:

| | |
|---|---|
| Themen, Links, Quick-Links, Tags, Dateien, Ergebnisse | gehen an den Admin |
| Freigaben an Kolleginnen | bleiben bestehen, ihre Links laufen weiter |
| Die gelöschte Person in fremden Freigabelisten | wird entfernt |
| Namensgleiche Tags beim Admin | bekommen den Zusatz „(von …)" |
| Herkunft von Kopien (`copiedFrom*`) | bleibt **unverändert** |

Die Herkunft bleibt bewusst stehen: Sie hält fest, wer etwas verfasst hat, und
daran ändert das Ausscheiden nichts. Genau dafür stehen dort Name und Titel
als Text und nicht nur als Verweis.

Wer übernimmt, ist der Admin, der löscht. Löscht ein Admin sich selbst, ist es
der dienstälteste andere. Ohne Nachfolger geht es nicht – der letzte Admin
lässt sich ohnehin nicht löschen.

Aufräumen ist danach eine eigene, bewusste Entscheidung des Admins und keine
Nebenwirkung des Löschens. Umgesetzt in `src/admin/handover.service.ts`.

## Beteiligte Dateien

| Datei | Zweck |
|---|---|
| `src/core/mail/mail.service.ts` | Schnittstelle, die die Anwendung aufruft |
| `src/core/mail/console-mail.service.ts` | Kein Versand, `delivered: false` |
| `src/core/mail/smtp-mail.service.ts` | SMTP-Versand über nodemailer |
| `src/core/mail/mail.module.ts` | Auswahl über `MAIL_TRANSPORT` |
| `src/auth/auth.service.ts` | `createUser`, `resetUserPassword`, `generatePassword` |
| `src/auth/guards/jwt-auth.guard.ts` | Sperre bei offenem Initialpasswort |
| `src/admin/handover.service.ts` | Übergabe der Inhalte beim Löschen eines Kontos |

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/admin/users` | Benutzer anlegen (Admin) |
| `POST` | `/api/admin/users/:id/reset-password` | Passwort neu setzen (Admin) |
| `POST` | `/api/auth/change-password` | Eigenes Passwort ändern, liefert neues Token |
| `DELETE` | `/api/admin/users/:id` | Konto löschen; Inhalte gehen an einen Admin, Antwort nennt Empfänger und Anzahl |

`POST /api/admin/admins` gibt es nicht mehr – ersetzt durch
`POST /api/admin/users` mit `role: "admin"`.
