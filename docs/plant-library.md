# Bibliothek der Anlagen (SPS-Labor)

Anlagen des SPS-Labors (lm-editor/src/labs/plant-core.js) lassen sich ablegen und in anderen
Arbeitsblättern wieder einsetzen.

- **Mitgeliefert** (`PLANT_EXAMPLES`): Zylinder schiebt Teile, Biegewerkzeug, Torsteuerung, Bördelvorrichtung.
- **Eigene**: ⚙ Anlage → „📚 In der Bibliothek ablegen“ (Name, Beschreibung, wahlweise mit Schrittkette).
  Gespeichert wird die Anlage mit den Einträgen der Zuordnungstabelle, die sie verwendet (mit Kette: alle).
- **Geteilt**: Schalter „👥 geteilt“ – für alle Lehrkräfte dieses Servers sichtbar (zum Einsetzen, nicht zum Ändern).
- **Einsetzen**: „📚 Anlage aus der Bibliothek“. Vorhandene Symbole werden übernommen (auch xSF1 für SF1),
  fehlende kommen an ihren Platz in der Tabelle (Adresse und Kontaktart aus dem Eintrag).

Server: Tabelle `plant_template` (ownerId, title, description, data, shared), `GET/POST /api/plant-library`,
`PATCH /api/plant-library/:id` (`{ shared }`), `DELETE /api/plant-library/:id` – nur Lehrkräfte.
Im Browser hängt die Ablage an `window.lmPlantLibrary` (lm-host.js); der eigenständige lm-editor
speichert im Browser (localStorage).

Später denkbar: Teilen über den Shop bzw. verbundene Server wie andere Lernmodule.
