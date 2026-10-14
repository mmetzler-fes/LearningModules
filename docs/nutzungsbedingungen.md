# Nutzungsbedingungen

*Fassung 1 · Stand: Oktober 2026*

Bevor du LearningModules nutzt, bestätige bitte einmalig die folgenden
Punkte. Ohne Zustimmung ist keine Anmeldung möglich. Ändern sich die
Bedingungen wesentlich, wirst du erneut gefragt.

## 1. Freie Software

LearningModules ist **freie Software** unter der GNU Affero General Public
License, Version 3 oder neuer (AGPL-3.0-or-later) – derselben Lizenz wie
Nextcloud. Der Quelltext ist öffentlich:
[github.com/mmetzler-fes/LearningModules](https://github.com/mmetzler-fes/LearningModules).

Betrieben wird dieser Server in der Regel von deiner Schule oder ihrem
Träger. Er kann auch von einer Person oder Stelle betrieben werden, der die
Schule vertraut und die sie dafür freigegeben hat – etwa von einer Lehrkraft
auf einem eigenen Server. Wer ihn betreibt, ist in jedem Fall verantwortlich
für den Betrieb, nicht die Entwicklung der Software als solche. Fragen zum
Betrieb, zum Datenschutz und zu deinem Konto richtest du an den Admin dieses
Servers.

## 2. Einsatz an der Schule

Der Einsatz von LearningModules an deiner Schule erfolgt **mit Zustimmung der
Schulleitung**. Mit deiner Zustimmung bestätigst du, dass die Schulleitung die
Nutzung für deinen Unterricht erlaubt hat und dass du dabei die Vorgaben
deiner Schule und deines Dienstherrn einhältst – insbesondere zum Datenschutz
und zum Umgang mit Schülerdaten. Bist du dir nicht sicher, klärst du das vor
der Nutzung mit der Schulleitung.

## 3. Was die Software für die Sicherheit deiner Daten tut

- **Passwörter** werden nie im Klartext gespeichert, sondern nur als
  gesalzener Hash (scrypt).
- **Zwei-Faktor-Anmeldung** mit einer Authenticator-App ist für jedes Konto
  möglich; nach mehreren falschen Codes wird für einige Minuten gesperrt.
- **Deaktivierte Konten** sind sofort gesperrt, nicht erst nach Ablauf einer
  Sitzung.
- **Schüler brauchen kein Konto.** Sie starten über Links; in Klassen mit
  strikter Anmeldung kommt nur hinein, wer in der Schülerliste steht.
- **Exporte fremder Inhalte und Backups** sind mit einem Masterkey
  verschlüsselt (AES-256-GCM). Masterkeys und andere Geheimnisse liegen
  ihrerseits verschlüsselt auf dem Server.
- **Automatische Backups** (etwa in eine Nextcloud) – sofern der Admin sie
  eingerichtet hat –, und vor jedem Einspielen eines Backups bleibt der
  bisherige Stand erhalten.
- **Entwürfe** werden beim Bearbeiten laufend gesichert, damit nichts verloren
  geht, wenn das Speichern vergessen wird oder der Browser abstürzt.
- **Löschregel**: Schülerergebnisse werden nach einer festen Frist
  automatisch gelöscht.
- **Rechte an Inhalten**: Wer ein Modul verfasst hat, bleibt verzeichnet; offen
  exportieren lässt sich nur, was man selbst verfasst hat.
- **Verbundene Server** sprechen nur signiert miteinander;
  Schülernamen und Ergebnisse verlassen den Server nie.

Die verschlüsselte Übertragung (https), Updates und die Sicherung des Servers
selbst liegen beim Betreiber.

## 4. Keine Gewährleistung

Die Software wird so bereitgestellt, wie sie ist – **ohne jede Gewährleistung**,
soweit das gesetzlich zulässig ist. Trotz der oben genannten Vorkehrungen
können Fehler in der Software, beim Betrieb oder bei Updates nicht
ausgeschlossen werden. Sie können im schlimmsten Fall zu **Datenverlust**
führen oder dazu, dass Inhalte zeitweise nicht verfügbar sind.

Weder die Entwickler noch der Betreiber haften für solche Schäden, soweit
das gesetzlich zulässig ist; unberührt bleibt die Haftung für Vorsatz und
grobe Fahrlässigkeit sowie für Verletzungen von Leben, Körper und Gesundheit.

**Sichere deshalb wichtige Inhalte zusätzlich selbst**, zum Beispiel über den
Export als Datei.

## 5. Verantwortung für deine Inhalte

Du bist für die Inhalte verantwortlich, die du in LearningModules
erstellst, hochlädst, einbindest oder mit anderen teilst – Texte, Aufgaben,
Bilder, Ton, Arbeitsblätter und Links.

- **Urheberrecht:** Verwende nur Inhalte, die du selbst erstellt hast, die
  unter einer freien Lizenz stehen (deren Bedingungen, etwa die
  Namensnennung, du einhältst) oder deren Nutzung dir gesetzlich erlaubt
  ist. Was im eigenen Unterricht erlaubt sein kann – etwa Ausschnitte nach
  dem Unterrichtsprivileg (§ 60a UrhG) –, darf nicht automatisch im Shop oder
  an andere Schulen weitergegeben werden. Scans aus Schulbüchern und fremde
  Bilder gehören in der Regel nicht in geteilte Inhalte.
- **Persönlichkeitsrechte und Datenschutz:** Keine Fotos, Namen oder andere
  personenbezogenen Daten von Schülern oder anderen Personen in Inhalten, die
  andere sehen, ohne deren Einwilligung. Ergebnisse von Schülern sind
  vertraulich.
- **Geltendes Recht:** Keine rechtswidrigen, beleidigenden, diskriminierenden
  oder jugendgefährdenden Inhalte.
- **Teilen:** Was du im Shop anbietest, dürfen andere Lehrkräfte – auch auf
  verbundenen Servern – so nutzen, wie du es freigibst (Use oder Copy). Dein
  Name wird als Verfasser genannt.

Der Betreiber darf Inhalte sperren oder entfernen, die gegen diese Regeln
oder gegen geltendes Recht verstoßen.

## 6. Zustimmung

Mit **„Ich stimme zu“** bestätigst du, diese Bedingungen gelesen zu haben und
einzuhalten, und dass deine Schulleitung die Nutzung erlaubt hat. Der
Zeitpunkt deiner Zustimmung wird gespeichert.

## Erlaubnis der Schulleitung

*Dieser Abschnitt gehört nicht zu den Bedingungen – er ist für Admins.*

Zur Absicherung lässt sich der Einsatz von der Schulleitung schriftlich
erlauben, gerade wenn der Server nicht von der Schule selbst betrieben wird.
**Administration → 🛡 Shop & Sicherheit → 🖨 Erlaubnis der Schulleitung
drucken** (Schuladmins: unter **🏫 Meine Schule**) öffnet ein Blatt zum
Ausdrucken:

- Schule, Adresse und Name des Servers, Betreiber und Ansprechperson,
- die Erklärung der Schulleitung, dass sie den Einsatz erlaubt und – falls
  nicht Schule oder Träger den Server betreiben – mit dem Betreiber
  einverstanden ist,
- Ankreuzfelder zum Datenschutz (Datenschutzbeauftragte informiert,
  Auftragsverarbeitung) und zur Vernetzung mit anderen Servern,
- Unterschriften von Schulleitung und Betreiber,
- als Anlage die Nutzungsbedingungen in der aktuellen Fassung.

Gespeichert wird dabei nichts. Das unterschriebene Original bleibt bei der
Schule, eine Kopie beim Betreiber. Bei einer neuen Fassung der Bedingungen
die Erlaubnis erneuern. Die Vorlage ersetzt keine rechtliche Prüfung.

## Technik

Die Zustimmung ist ein eigener Schritt der Anmeldung – nach Passwort und
gegebenenfalls Zwei-Faktor-Code, vor der Sitzung. Gespeichert werden die
bestätigte Fassung (`users.termsVersion`) und der Zeitpunkt
(`users.termsAcceptedAt`). Eine Sitzung ohne Zustimmung zur aktuellen Fassung
wird abgelehnt; wer noch angemeldet ist, muss sich einmal neu anmelden.

Neue Fassung: Text hier ändern und `TERMS_VERSION` in `src/auth/terms.ts`
erhöhen – dann fragt die App alle erneut.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/auth/terms` | aktuelle Fassung (Nummer und Text) |
| `POST` | `/api/auth/login/terms` | `{challenge, accept: true}` – Zustimmung bei der Anmeldung, liefert die Sitzung |
