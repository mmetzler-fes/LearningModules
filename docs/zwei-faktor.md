# Zwei-Faktor-Anmeldung (2FA)

Freiwillig für jedes Lehrer- und Admin-Konto: Nach dem Passwort fragt die
Anmeldung nach einem 6-stelligen Code aus einer Authenticator-App
(TOTP nach RFC 6238: SHA-1, 6 Ziffern, 30 Sekunden – passt zu Microsoft/Google
Authenticator, FreeOTP, Aegis, 2FAS, Bitwarden …).

## Für Lehrkräfte

Dashboard → **🔐 Zwei-Faktor** → *Einrichten*: QR-Code scannen, ersten Code
eingeben. Danach erscheinen **10 Wiederherstellungscodes** – nur dieses eine
Mal. Jeder gilt einmal und ersetzt den Code aus der App, wenn das Handy fehlt.

Im selben Dialog: neue Wiederherstellungscodes erzeugen (braucht einen
aktuellen Code) oder 2FA ausschalten (braucht Passwort und Code).

## Handy verloren

Der Hauptadmin (Benutzerverwaltung) oder der Schuladmin (Meine Schule, sofern
er Lehrkräfte verwalten darf) setzt die 2FA zurück. Danach genügt wieder das
Passwort; die Person richtet 2FA neu ein.

## Technik

- Anmeldung in zwei Schritten: `POST /api/auth/login` liefert bei aktiver 2FA
  nur `{ twoFactorRequired, challenge }` – ein 5 Minuten gültiges Token mit
  eigenem Schlüssel, das nie als Sitzung taugt. `POST /api/auth/login/2fa`
  mit `{ challenge, code }` liefert die Sitzung.
- Jeder Code gilt nur einmal (zuletzt genutzter Zeitschritt wird gespeichert);
  ±30 Sekunden Toleranz für abweichende Uhren.
- Nach 5 falschen Codes ist das Konto 15 Minuten für 2FA-Versuche gesperrt
  (im Speicher; ein Neustart setzt die Zählung zurück).
- Das Geheimnis liegt **mit dem Masterkey verschlüsselt** in der Datenbank.
  Wer ein Backup einspielen kann, hat den Masterkey – die Codes gelten dann
  auch auf dem neuen Server. Wiederherstellungscodes werden nur als Hash
  gespeichert.

## Heikle Admin-Aktionen

Masterkey setzen, Backup herunterladen und Backup einspielen (Datei oder
Cloud) verlangen eine erneute Bestätigung: das eigene Passwort und – bei
aktiver 2FA – einen aktuellen Code. Eine offen gelassene Admin-Sitzung reicht
dafür nicht. Hintergrund: Wer den Masterkey selbst setzt und danach ein Backup
lädt, könnte den gesamten Datenbestand außerhalb der App entschlüsseln.

Bei Masterkey-Wechsel und Restore bekommen alle anderen aktiven Admins eine
Mail (sofern Mailversand eingerichtet ist); jede dieser Aktionen und jeder
Backup-Download steht außerdem als Warnung im Server-Log.
