#!/usr/bin/env bash
# Holt die H5P-Bibliotheken für den H5P-Export vom offiziellen H5P-Hub und
# legt sie gesammelt in assets/h5p/libraries.zip ab. Der Export packt daraus
# die nötigen Bibliotheken in jede .h5p-Datei – so läuft sie auch auf
# Plattformen, die diese Inhaltstypen (noch) nicht installiert haben.
#
# Nach dem Aktualisieren die Tests laufen lassen: Ändert sich die Version
# eines Inhaltstyps, muss H5P.QuestionSet sie auch akzeptieren.
set -euo pipefail
cd "$(dirname "$0")/.."
LIBS="H5P.QuestionSet H5P.MultiChoice H5P.TrueFalse H5P.Blanks H5P.DragText H5P.MarkTheWords H5P.DragQuestion H5P.Essay"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/libs"
for lib in $LIBS; do
  echo "Lade $lib …"
  curl -fsSL -o "$TMP/$lib.h5p" "https://api.h5p.org/v1/content-types/$lib"
  # Nur die Bibliotheken, nicht den Beispielinhalt des Pakets
  unzip -oq "$TMP/$lib.h5p" -d "$TMP/libs" -x h5p.json 'content/*'
done
rm -f assets/h5p/libraries.zip
(cd "$TMP/libs" && zip -qr9 - .) > assets/h5p/libraries.zip
echo "Fertig: $(ls "$TMP/libs" | wc -l) Bibliotheken in assets/h5p/libraries.zip"
ls "$TMP/libs"
