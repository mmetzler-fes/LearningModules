#!/usr/bin/env python3
"""Zeigt den Aufbau einer LibreOffice-Vorlage (.ott/.odt).

Ausgabe: Absatz-/Zeichen-/Listenformatvorlagen, gefundene Platzhalter der Form
{{NAME}} und die Absatzfolge des Dokumentkörpers. Damit wird der Renderer
(tools/make_worksheet.py) auf die tatsächlichen Formatvorlagen der Vorlage
konfiguriert.

    python3 tools/inspect_ott.py templates/arbeitsblatt.ott
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from odf.opendocument import load
from odf.style import Style
from odf.text import H, ListStyle, P
from odf import teletype

PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


def style_names(doc) -> dict[str, list[str]]:
    """Formatvorlagen nach Familie gruppiert, aus styles.xml und content.xml."""
    found: dict[str, set[str]] = {}
    for container in (doc.styles, doc.automaticstyles):
        for style in container.getElementsByType(Style):
            name = style.getAttribute("name")
            family = style.getAttribute("family") or "?"
            display = style.getAttribute("displayname") or name
            if name:
                found.setdefault(family, set()).add(
                    name if display == name else f"{name}  (Anzeige: {display})"
                )
    for ls in doc.styles.getElementsByType(ListStyle):
        name = ls.getAttribute("name")
        if name:
            found.setdefault("list", set()).add(name)
    return {family: sorted(names) for family, names in sorted(found.items())}


def body_outline(doc) -> list[tuple[str, str, str]]:
    """(Elementtyp, Formatvorlage, Text) je Absatz/Überschrift im Textkörper."""
    rows = []
    for el in doc.text.childNodes:
        if el.qname[1] in ("p", "h"):
            rows.append(
                (
                    el.qname[1],
                    el.getAttribute("stylename") or "-",
                    teletype.extractText(el).strip(),
                )
            )
        else:
            rows.append((el.qname[1], "-", ""))
    return rows


def placeholders(doc) -> list[str]:
    seen: list[str] = []
    for el in doc.getElementsByType(P) + doc.getElementsByType(H):
        for name in PLACEHOLDER_RE.findall(teletype.extractText(el)):
            if name not in seen:
                seen.append(name)
    return seen


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = Path(argv[1])
    if not path.exists():
        print(f"Vorlage nicht gefunden: {path}", file=sys.stderr)
        return 1
    doc = load(str(path))

    print(f"# Vorlage: {path}\n")

    print("## Formatvorlagen")
    for family, names in style_names(doc).items():
        print(f"\n### {family}")
        for name in names:
            print(f"  - {name}")

    print("\n## Platzhalter {{...}}")
    found = placeholders(doc)
    print("  (keine gefunden)" if not found else "")
    for name in found:
        print(f"  - {{{{{name}}}}}")

    print("\n## Dokumentkörper (Absatzfolge)")
    for i, (kind, style, text) in enumerate(body_outline(doc)):
        preview = (text[:70] + "…") if len(text) > 70 else text
        print(f"  {i:3d}  {kind:12s}  style={style:24s}  {preview}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
