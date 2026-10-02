# Schulen und Schuladmins

Mehrere Schulen auf einem Server: Jede Lehrkraft gehört zu höchstens einer
Schule. Der Hauptadmin legt Schulen an; Lehrkräfte mit dem Zusatzrecht
**Schuladmin** verwalten ihre eigene Schule.

## Zuordnung

- Jede Schule hat eine **Whitelist** (`*@fes-es.de`, `@schule.de`,
  `*.schule.de` inkl. Subdomains, einzelne Adressen).
- Beim Registrieren, beim Anlegen durch den Admin und bei jedem Login wird
  eine Lehrkraft **ohne Schule** zugeordnet, wenn ihre Adresse auf genau eine
  Whitelist passt. „Jetzt zuordnen“ macht das sofort für alle bestehenden
  Konten – mit Vorschau.
- Passt eine Adresse auf mehrere Whitelists, wird nicht zugeordnet; das Konto
  steht unter „Schulen“ als Konflikt und der Hauptadmin entscheidet.
- Von Hand gesetzt oder entzogen (Hauptadmin oder Schuladmin) gilt fest: Die
  Whitelist ändert es danach nicht mehr (`schoolManual`).
- Eine Whitelist zieht nie jemanden aus einer anderen Schule ab.

Die globale Whitelist/Blacklist unter „Whitelist / Blacklist“ bleibt davon
getrennt: Sie regelt nur, wer sich überhaupt registrieren darf.

## Rollen

| | Hauptadmin | Schuladmin | Lehrkraft |
|---|---|---|---|
| Schulen anlegen/löschen, Schuladmins bestimmen | ✔ | | |
| Whitelist der Schule pflegen | ✔ | ✔ ¹ | |
| Lehrkräfte aus der Schule entfernen, (de)aktivieren | ✔ | ✔ ¹ | |
| Gruppen der Schule pflegen | ✔ | ✔ | |
| Tag-Struktur der Schule pflegen | | ✔ | nutzen |
| Schulübergreifende Gruppen pflegen | ✔ | | |

¹ Der Hauptadmin kann diese Rechte je Schule entziehen.

Schuladmins können weder sich selbst noch den Hauptadmin ändern. Deaktivieren
wirkt wie beim Hauptadmin: Das Konto kann sich nicht anmelden, selbst
verfasste Inhalte stehen kostenlos im Shop; Reaktivieren macht das rückgängig.

## Auswirkungen für Lehrkräfte

- Die Auswahl von Kolleginnen, Kollegen und Gruppen (z. B. im Shop-Dialog)
  zeigt nur die eigene Schule plus schulübergreifende Gruppen.
- Der Shop selbst („alle Kolleginnen und Kollegen“) bleibt schulübergreifend.
- Wer die Schule wechselt oder verlässt, fällt aus den Gruppen der alten Schule.

## Tag-Struktur der Schule

Der Schuladmin pflegt unter „Meine Schule“ Themengebiete und Tags für alle
Lehrkräfte der Schule – mit derselben Oberfläche wie unter „Tags“.

- Technisch ein normaler Tag mit `schoolId`; Eigentümer ist `school:<id>`,
  damit Abfragen nach den Tags einer Lehrkraft ihn nicht erfassen.
- Lehrkräfte sehen die Vorgaben in Filtern, Tag-Auswahl und Gliederung
  (gestrichelter Rand, 🏫) und vergeben sie wie eigene Tags. Ändern oder
  löschen können sie sie nicht.
- Eigene Tags dürfen unter Schul-Themengebiete gehängt werden. Ein eigener
  Tag darf nicht so heißen wie eine Vorgabe der Schule.
- Löscht der Schuladmin eine Vorgabe, verschwindet sie aus den Themen, Modulen
  und Links aller Lehrkräfte der Schule.
- Wer die Schule verlässt, sieht deren Vorgaben nicht mehr; Themen mit diesen
  Tags stehen dann unter „Ohne Themengebiet“. Wird die Schule gelöscht,
  entfallen ihre Vorgaben.
