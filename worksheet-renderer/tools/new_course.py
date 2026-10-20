#!/usr/bin/env python3
"""Legt einen neuen Kurs mit einem ersten Arbeitsblatt an.

    python3 tools/new_course.py elektrotechnik "Elektrotechnik"
    python3 tools/new_course.py mathe "Mathematik" --blatt "Bruchrechnen"

Erzeugt:

    kurse/<kuerzel>/kurs.yaml          Vorlage, Titelmuster, Kursname
    kurse/<kuerzel>/CLAUDE.md          fachliche Regeln für diesen Kurs
    kurse/<kuerzel>/quellen/           hier das Skript / Material ablegen
    kurse/<kuerzel>/01_<blatt>/arbeitsblatt.yaml
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Das Projekt mit kurse/ – wie bei make_worksheet.py.
REPO = Path(os.environ.get("ARBEITSBLATT_ROOT") or Path.cwd()).resolve()

KURS_YAML = """\
# Kurskonfiguration – gilt für alle Arbeitsblätter in diesem Ordner.
# Einzelne Blätter können jeden Wert in ihrer arbeitsblatt.yaml überschreiben.

kurs: {name}
kuerzel: {kuerzel}                     # Unterordner in build/
template: {template}
titelmuster: "{{kurs}} {{nummer}} – {{titel}}"

meta: {{}}                              # weitere Platzhalter der Vorlage
"""

CLAUDE_MD = """\
# Kurs {name}

Fachliche Vorgaben für die Arbeitsblätter in diesem Ordner. Die allgemeinen
Regeln (Aufbau, Umfang, Spec-Format) stehen in der CLAUDE.md der Repo-Wurzel.

## Quellen

* `quellen/` – Skript und Material dieses Kurses
* Musterlösungen: mit `file:` auf die Originaldateien verweisen, nicht neu erfinden

## Zielgruppe und Sprache

* Klasse/Bildungsgang: TODO
* Vorkenntnisse: TODO
* Ansprache: TODO (in den anderen Kursen: geduzt)
"""

BLATT_YAML = """\
nummer: 1
titel: {blatt}

content:
  - type: section
    text: Worum es geht

  - type: text
    text: |-
      TODO: Einstieg – warum brauchen die Schüler das?

  - type: text
    text: "Am Ende dieser Stunde kannst du:"

  - type: list
    items:
      - TODO Lernziel 1,
      - TODO Lernziel 2.

  # ------------------------------------------------------------------
  - type: section
    text: Schritt 1 – TODO

  - type: text
    text: |-
      TODO: erklären, dann Beispiel zeigen.

  - type: task
    title: TODO
    text: TODO Arbeitsauftrag
    blocks:
      - type: karo
        lines: 6
      - type: solution
        blocks:
          - type: text
            text: TODO Musterlösung mit Begründung.
"""


def slugify(text: str) -> str:
    text = text.lower()
    for old, new in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(old, new)
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kuerzel", help="Ordner- und Build-Name, z. B. elektrotechnik")
    ap.add_argument("name", help="Kursname für den Titel, z. B. Elektrotechnik")
    ap.add_argument("--blatt", default="Einstieg", help="Titel des ersten Arbeitsblatts")
    ap.add_argument("--template", default="templates/Grundvorlage.ott",
                    help="Vorlage des Kurses (Standard: Grundvorlage des Generators)")
    args = ap.parse_args()

    kuerzel = slugify(args.kuerzel)
    course = REPO / "kurse" / kuerzel
    if course.exists():
        print(f"Kurs existiert bereits: {course.relative_to(REPO)}", file=sys.stderr)
        return 1

    blatt = course / f"01_{slugify(args.blatt)}"
    blatt.mkdir(parents=True)
    (course / "quellen").mkdir()
    (course / "quellen" / ".gitkeep").touch()

    (course / "kurs.yaml").write_text(
        KURS_YAML.format(name=args.name, kuerzel=kuerzel, template=args.template), encoding="utf-8")
    (course / "CLAUDE.md").write_text(CLAUDE_MD.format(name=args.name), encoding="utf-8")
    (blatt / "arbeitsblatt.yaml").write_text(
        BLATT_YAML.format(blatt=args.blatt), encoding="utf-8")

    print(f"✓ {course.relative_to(REPO)} angelegt")
    print(f"  {(blatt / 'arbeitsblatt.yaml').relative_to(REPO)}")
    print("\nNächste Schritte:")
    print(f"  1. Material nach {(course / 'quellen').relative_to(REPO)} legen")
    print(f"  2. {(course / 'CLAUDE.md').relative_to(REPO)} ausfüllen")
    print("  3. make pdf")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
