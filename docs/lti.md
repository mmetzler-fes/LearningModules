# Moodle (LTI 1.3)

LearningModules lässt sich als **Externes Tool** in Moodle einbinden (LTI 1.3 Advantage):

- **Lehrkräfte** legen in Moodle eine Aktivität an und wählen darin ein **Lernthema** (Deep Linking) – dazu die Klasse:
  **neue Klasse für den Moodle-Kurs** oder **mit bestehender Klasse verbinden** (Schüler werden dann über ihren Namen den
  vorhandenen Einträgen zugeordnet, Ergebnisse bleiben).
- **Schüler** öffnen die Aktivität in Moodle und landen **ohne Name und PIN** im Lernthema. Beim ersten Mal wird ihr
  Moodle-Konto mit dem Eintrag der Klassenliste verknüpft (Name; gibt es ihn nicht, legt die App ihn an).
- **Noten:** Das **beste Ergebnis** (Prozent) geht nach jedem Durchlauf ins **Moodle-Notenbuch**.
- Alles andere bleibt: Klassennotizbuch, Quick-Links, Name und PIN.

## Einrichten (Schuladmin und Moodle-Admin)

**🏫 Meine Schule → 🎓 Moodle (LTI 1.3)** zeigt die Adressen zum Kopieren.

1. In Moodle: *Website-Administration → Plugins → Aktivitäten → Externes Tool → Tools verwalten → Tool manuell konfigurieren*
   - Tool-URL, Schlüsselsatz-URL, URL für Login-Initiierung, Weiterleitungs-URI: aus LearningModules übernehmen
   - LTI-Version **LTI 1.3**, Public-Key-Typ **Schlüsselsatz-URL**
   - **Unterstützt Deep Linking** anhaken
   - Dienste: **IMS LTI Assignment and Grade Services** → „Nur für Bewertungsübergabe“
   - Datenschutz: **Name** und **E-Mail** immer weitergeben (E-Mail ordnet Lehrkräfte ihrem Konto zu)
   - „Im Aktivitätsauswahl-Menü anzeigen“
2. Nach dem Speichern zeigt Moodle die **Konfigurationsdetails**: Plattform-ID, Client-ID, Deployment-ID,
   Öffentlicher Schlüsselsatz-URL, Zugriffstoken-URL, Authentifizierungsanfrage-URL → in LearningModules eintragen.

## In Moodle nutzen (Lehrkraft)

Im Kurs **Aktivität anlegen → LearningModules → Inhalt auswählen**. LearningModules öffnet sich (Anmeldung über die
E-Mail-Adresse aus Moodle), Lernthema und Klasse wählen, **✅ In Moodle übernehmen**. Moodle legt eine Bewertung mit
100 Punkten an. Die Lehrkraft braucht ein Lehrer-Konto in LearningModules mit derselben E-Mail-Adresse wie in Moodle.

## Datenschutz

Moodle übergibt Vor- und Nachname (Schüler) bzw. Name und E-Mail (Lehrkräfte), die Rolle, den Kurs und eine feste
Moodle-Kennung. Ob das so gewünscht ist, entscheidet die Schule beim Einschalten. LearningModules schickt nur die
Prozentzahl des besten Ergebnisses zurück.

## Technik

OIDC-Login (Third-Party Initiated Login), Ausweis `id_token` per `form_post`, Prüfung über die Schlüssel der Plattform
(dieselbe Prüfung wie bei der [Anmeldung mit dem Schulkonto](sso.md)). LearningModules hat ein eigenes Schlüsselpaar
(`/api/lti/jwks`) für die Deep-Linking-Antwort und den Zugriff auf die Noten (OAuth 2 client credentials mit JWT-Nachweis).
Unterstützt: LtiResourceLinkRequest, LtiDeepLinkingRequest, AGS-Scores.
