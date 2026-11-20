# Anmeldung mit dem Schulkonto (Microsoft)

Lehrkräfte und Schüler melden sich mit ihrem **Microsoft-Schulkonto** an (Microsoft Entra ID, früher Azure AD) –
ohne eigenes Passwort bzw. ohne PIN. Die **bisherige Anmeldung bleibt immer möglich**: Passwort für Lehrkräfte,
Name und PIN für Schüler – etwa für Schüler, die noch kein Schulkonto haben, oder wenn Microsoft nicht erreichbar ist.

## Einrichten (Schuladmin)

**🏫 Meine Schule → 🔐 Anmeldung mit Microsoft.** Dort steht auch die Umleitungs-URI zum Kopieren.

1. Im **Microsoft Entra Admin Center** → *Anwendungen → App-Registrierungen → Neue Registrierung*:
   Name „LearningModules“, *Nur Konten in diesem Organisationsverzeichnis*.
2. **Umleitungs-URI**, Plattform *Web*: `https://<eure-adresse>/api/sso/callback`.
3. *Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel*: den **Wert** kopieren (er wird nur einmal angezeigt).
4. In LearningModules eintragen: **Mandant** (Verzeichnis-ID oder Domäne), **Anwendungs-ID (Client)**, **Schlüssel**.
5. Einschalten: **für Lehrkräfte**, **für Schüler** oder beides. **🔎 Mandant prüfen** fragt Microsoft, ob es den Mandanten gibt.

Der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt. Er läuft in Entra ID nach der gewählten Zeit ab –
dann einen neuen anlegen und hier eintragen.

## Lehrkräfte

Auf der Anmeldeseite steht **„Mit Microsoft anmelden“**. Zugeordnet wird über die **E-Mail-Adresse** des Schulkontos
(bzw. den Anmeldenamen): Es muss ein Lehrer-Konto mit dieser Adresse geben, das zur Schule gehört (oder noch zu keiner).
Die Zwei-Faktor-Prüfung übernimmt Microsoft; die Nutzungsbedingungen werden wie sonst einmal bestätigt.

## Schüler

Im Klassennotizbuch steht über Name und PIN **„Mit Microsoft anmelden“** (nur, wenn die Schule der Lehrkraft es eingeschaltet hat).

- **Beim ersten Mal** wird das Schulkonto über den **Namen** dem Eintrag der Klassenliste zugeordnet – mit denselben Regeln wie
  bei der Namenseingabe. In einer offenen Klasse entsteht für einen unbekannten Namen ein unbestätigter Eintrag.
- **Danach** ist das Konto fest mit dem Eintrag verknüpft; eine Namensänderung in der Liste stört nicht mehr.
- Ist ein Eintrag schon mit einem anderen Schulkonto verknüpft, lehnt die App ab – dann Name und PIN nehmen und die Lehrkraft informieren.
- Die PIN bleibt gültig und ist der Rückfallweg.

## Datenschutz

Aus dem Schulkonto übernimmt LearningModules nur Name, E-Mail-Adresse (Lehrkräfte) und eine feste Kennung (Schüler, zur Verknüpfung).
Es werden keine Postfächer, Dateien oder Teams-Daten gelesen; die App fragt nur `openid profile email` an.

## Technik

OpenID Connect mit Autorisierungscode und PKCE (`src/sso`). Das ID-Token wird über die öffentlichen Schlüssel des Mandanten
geprüft (Signatur RS256, Aussteller, Empfänger, Ablauf, nonce). In der Adresse steht danach nur ein Einlöse-Code, der zwei Minuten
gilt und einmal verwendet werden kann. Dieselbe Prüfung dient später LTI 1.3 (Moodle).
