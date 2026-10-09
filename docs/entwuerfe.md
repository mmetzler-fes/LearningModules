# Entwürfe im Modul-Editor

Was du im Modul-Editor änderst, sichert die App laufend als **Entwurf** auf
dem Server – alle paar Sekunden, solange sich etwas vom gespeicherten Modul
unterscheidet. Unter den Knöpfen steht dann „💾 Entwurf gesichert 14:32 – noch
nicht veröffentlicht“.

- Der Entwurf gehört nur dir. Schüler und Kolleginnen mit Nutzungsrecht sehen
  weiter das **gespeicherte** Modul – halbfertige Zwischenstände landen nicht
  im Unterricht.
- Erst **Modul speichern** veröffentlicht die Änderungen. Danach ist der
  Entwurf weg.

## Weitermachen – auch an einem anderen Gerät

Öffnest du ein Modul, zu dem es einen Entwurf gibt, fragt die App:
„Wiederherstellen? Mit ‚Abbrechen‘ wird er verworfen.“ Das gilt auf jedem
Gerät, mit dem du dich anmeldest – am Schul-PC anfangen, zu Hause
weitermachen.

- Module mit offenem Entwurf tragen in der Modulliste und in den Notebooks
  das Zeichen **📝 Entwurf**.
- Ein **neues**, noch nie gespeichertes Modul erscheint in der Modulliste
  seines Lernthemas als Hinweis „Nicht gespeicherter neuer Modul-Entwurf“ mit
  **Fortsetzen**. Auch **➕ Neues Modul** bietet ihn an.

## Editor verlassen

- **Anderer Menüpunkt:** Der letzte Stand wird gesichert; eine Meldung sagt,
  dass du beim nächsten Öffnen weitermachen kannst.
- **Abbrechen:** Gibt es Änderungen, fragt die App, ob sie verworfen werden
  sollen – dann wird auch der Entwurf gelöscht.
- **Tab schließen oder neu laden:** Der Browser fragt nach, wenn der letzte
  Stand noch nicht gesichert ist.

Entwürfe, die 90 Tage lang nicht angefasst wurden, und Entwürfe zu
gelöschten Modulen räumt die App selbst weg.

## Technik

Tabelle `module_drafts` (je Lehrkraft und Modul bzw. `new:<id>` ein
Entwurf), Endpunkte `GET/PUT/DELETE /api/drafts/:key`, `GET /api/drafts?topicId=`.
Gesichert wird alle 4 Sekunden, wenn sich der Editor-Stand geändert hat.

Code: `src/drafts/`, Editor in `src/renderer/js/views/modules.js`
(`_beginDraft`, `_tickDraft`, `leaveEditor`).
