#!/usr/bin/env python3
"""Fasst mehrere Arbeitsblätter zu einem Skript (Kompendium) zusammen.

    python3 tools/make_script.py kurse/arduino_einfuehrung/skripte/grundlagen.yaml --loesung --pdf

Das Skript enthält denselben Stoff wie die Arbeitsblätter, nur ohne Karopapier
zum Eintragen – gedacht zum Nachlesen und Lernen. Die Gliederung rutscht dabei
eine Ebene tiefer:

    Ebene 1   Thema des Arbeitsblatts   (dessen `titel`)
    Ebene 2   „Schritt n – …"           (Ebene 1 im Arbeitsblatt)
    Ebene 3   Aufgabe                   (Ebene 2 im Arbeitsblatt)
    Ebene 4   Teilaufgabe               (Ebene 3 im Arbeitsblatt)

Musterlösungen sind wie im Arbeitsblatt enthalten, aber ausgeblendet; mit
--loesung entsteht zusätzlich `…_Lösung.odt`, in dem sie rot sichtbar sind.

Die Spec eines Skripts liegt in `kurse/<kurs>/skripte/<name>.yaml`:

    titel: Grundlagen der Mikrocontroller-Programmierung
    autor: Martin Metzler
    blaetter: [01_mikrocontroller_erste_led, 02_digitale_ausgaenge]   # oder: alle

Alles Weitere (Vorlage, Kürzel, Kursname) kommt aus der `kurs.yaml`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml
from odf import teletype
from odf.element import Element
from odf.opendocument import load
from odf.style import ParagraphProperties, Style, TabStop, TabStops, TextProperties
from odf.text import A, Bookmark, BookmarkRef, H, IndexBody, P, Tab

sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_worksheet import (  # noqa: E402  (Pfad muss vorher stehen)
    CONTENT_TOKEN,
    ROOT,
    as_document,
    convert_to_pdf,
    ensure_bullet_list_style,
    ensure_karo_styles,
    ensure_overlay_styles,
    ensure_pagebreak_style,
    ensure_subscript_style,
    ensure_table_styles,
    existing_styles,
    find_template,
    fix_mimetype,
    set_inline_context,
    iter_text_elements,
    load_course,
    merge_spec,
    rel,
    render_blocks,
    replace_in_element,
    resolve_styles,
    unresolved_placeholders,
)


# Im Skript liegen die Überschriften eine Ebene tiefer als im Arbeitsblatt.
SCRIPT_STYLES = {
    "section": "Heading_20_2",
    "task": "Heading_20_3",
    "subtask": "Heading_20_4",
}
# Blöcke, die nur auf dem Arbeitsblatt Sinn haben.
SKIP_BLOCKS = ("karo", "spacer", "pagebreak")

SPEC_FILE = "arbeitsblatt.yaml"


def ensure_script_styles(doc, present: set[str]) -> dict[str, str]:
    """Automatische Vorlagen für Themenüberschrift und Verzeichniseinträge.

    Die Themenüberschrift beginnt eine neue Seite. Die Verzeichniseinträge
    erben von Contents 1/2 der Vorlage und bekommen einen rechten Tabulator
    mit Punktführung, damit die Seitenzahl am Rand steht.
    """
    names = {"start": "SkriptAnfang", "thema": "SkriptThema",
             "toc1": "SkriptVerzeichnis1", "toc2": "SkriptVerzeichnis2",
             "loesung": "SkriptLoesung", "loesung_code": "SkriptLoesungCode"}

    # Sichtbare Musterlösung im Lösungs-Skript: dieselbe Vorlage wie im
    # Arbeitsblatt (rot), nur eingeblendet statt ausgeblendet.
    for key, parent in (("loesung", "Lösung"), ("loesung_code", "LösungQuelltext")):
        if names[key] in present:
            continue
        style = Style(name=names[key], family="paragraph", parentstylename=parent)
        style.addElement(TextProperties(display="true"))
        doc.automaticstyles.addElement(style)
        present.add(names[key])

    # Titelseite und Inhaltsverzeichnis liegen auf der Seitenvorlage "Index"
    # (ohne Kopfzeile). Das erste Thema wechselt auf "Standard" – damit
    # beginnen Kopfzeile und Seitenzählung, genau wie im Original-Kompendium.
    if names["start"] not in present:
        style = Style(name=names["start"], family="paragraph",
                      parentstylename="Heading_20_1", masterpagename="Standard")
        style.addElement(ParagraphProperties(pagenumber="1"))
        doc.automaticstyles.addElement(style)
        present.add(names["start"])

    if names["thema"] not in present:
        style = Style(name=names["thema"], family="paragraph", parentstylename="Heading_20_1")
        style.addElement(ParagraphProperties(breakbefore="page"))
        doc.automaticstyles.addElement(style)
        present.add(names["thema"])

    for key, parent in (("toc1", "Contents_20_1"), ("toc2", "Contents_20_2")):
        if names[key] in present:
            continue
        style = Style(name=names[key], family="paragraph", parentstylename=parent)
        props = ParagraphProperties()
        tabs = TabStops()
        tabs.addElement(TabStop(position="17cm", type="right", leaderstyle="dotted", leadertext="."))
        props.addElement(tabs)
        style.addElement(props)
        doc.automaticstyles.addElement(style)
        present.add(names[key])
    return names


def heading_text(el: Element) -> str:
    return teletype.extractText(el).strip()


def number_headings(elements: list[Element], names: dict[str, str]) -> list[tuple[int, str, str]]:
    """Nummeriert Ebene 1 und 2 durch und setzt in jede Überschrift ein Lesezeichen.

    Rückgabe: (Ebene, "1.2  Titel", Lesezeichenname) je Eintrag – daraus baut
    build_toc() das Inhaltsverzeichnis. Die Nummer wird nur für den
    Verzeichniseintrag gebraucht; im Text erzeugt sie LibreOffice selbst aus
    der Gliederungsnummerierung.
    """
    entries: list[tuple[int, str, str]] = []
    n1 = n2 = 0
    for el in elements:
        if el.qname[1] != "h":
            continue
        level = int(el.getAttribute("outlinelevel") or 0)
        if level == 1:
            n1 += 1
            n2 = 0
            nummer = f"{n1}"
        elif level == 2:
            n2 += 1
            nummer = f"{n1}.{n2}"
        else:
            continue
        mark = f"skript_{len(entries) + 1}"
        marke = Bookmark(name=mark)
        if el.firstChild is not None:
            el.insertBefore(marke, el.firstChild)
        else:
            el.addElement(marke)
        entries.append((level, f"{nummer}\t{heading_text(el)}", mark))
    return entries


def build_toc(doc, entries: list[tuple[int, str, str]], names: dict[str, str]) -> int:
    """Füllt das Inhaltsverzeichnis der Vorlage mit Ebene 1 und 2.

    Die Seitenzahl ist ein Querverweis auf das Lesezeichen der Überschrift
    (`text:bookmark-ref`). LibreOffice berechnet solche Felder beim Laden und
    beim PDF-Export neu – die hier eingetragene 0 ist nur ein Startwert.
    """
    bodies = doc.text.getElementsByType(IndexBody)
    if not bodies:
        print("  ! Kein Inhaltsverzeichnis in der Vorlage", file=sys.stderr)
        return 0
    body = bodies[0]
    for child in list(body.childNodes):
        body.removeChild(child)

    for level, label, mark in entries:
        nummer, _, titel = label.partition("\t")
        para = P(stylename=names["toc1"] if level == 1 else names["toc2"])
        para.addElement(A(type="simple", href=f"#{mark}",
                          stylename="Index_20_Link", visitedstylename="Index_20_Link",
                          text=f"{nummer}  {titel}"))
        para.addElement(Tab())
        para.addElement(BookmarkRef(referenceformat="page", refname=mark, text="0"))
        body.addElement(para)
    return len(entries)


def sheet_specs(spec: dict[str, Any], course_dir: Path) -> list[Path]:
    """Die Arbeitsblätter des Skripts in der angegebenen Reihenfolge."""
    blaetter = spec.get("blaetter") or "alle"
    if isinstance(blaetter, str):
        if blaetter.strip().lower() != "alle":
            blaetter = [blaetter]
        else:
            return sorted(course_dir.glob(f"*/{SPEC_FILE}"))
    paths = []
    for name in blaetter:
        path = course_dir / str(name) / SPEC_FILE
        if not path.exists():
            raise SystemExit(f"Arbeitsblatt nicht gefunden: {rel(path)}")
        paths.append(path)
    return paths


def render_sheets(doc, spec: dict[str, Any], course: dict[str, Any], course_dir: Path,
                  styles: dict[str, str], mode: str, names: dict[str, str]) -> list[Element]:
    """Alle Arbeitsblätter hintereinander rendern, je Blatt eine Ebene-1-Überschrift."""
    present = existing_styles(doc)
    ensure_karo_styles(doc, present)
    ensure_subscript_style(doc, present)
    ensure_table_styles(doc, present)
    frame_style = ensure_overlay_styles(doc, present)
    set_inline_context(doc, present, styles)

    elements: list[Element] = []
    for nummer, path in enumerate(sheet_specs(spec, course_dir), start=1):
        sheet = merge_spec(yaml.safe_load(path.read_text(encoding="utf-8")) or {}, course)
        titel = str(sheet.get("titel") or path.parent.name)
        print(f"  · {path.parent.name}: {titel}")
        thema_style = names["start"] if nummer == 1 else names["thema"]
        elements.append(H(outlinelevel=1, stylename=thema_style, text=titel))

        ctx: dict[str, Any] = {
            "doc": doc,
            "mode": mode,
            "search": [path.resolve().parent, course_dir, ROOT],
            "image_index": nummer * 1000,   # Rahmennamen bleiben über alle Blätter eindeutig
            "table_index": nummer * 1000,
            "frame_style": frame_style,
            "solution": False,
            "in_overlay": False,
            "karo_index": 0,
            "list_style": ensure_bullet_list_style(doc),
            "pagebreak_style": ensure_pagebreak_style(doc, present),
            "present": present,
            "level_shift": 1,
            "skip": SKIP_BLOCKS,
        }
        elements.extend(render_blocks(sheet.get("content"), styles, ctx))
    return elements


def insert(doc, elements: list[Element]) -> None:
    """Ersetzt den {{INHALT}}-Absatz durch die gerenderten Elemente."""
    anchor = None
    for el in doc.text.getElementsByType(P) + doc.text.getElementsByType(H):
        if CONTENT_TOKEN in teletype.extractText(el):
            anchor = el
            break
    if anchor is None:
        raise SystemExit(f"Kein {{{{{CONTENT_TOKEN}}}}}-Platzhalter in der Vorlage")

    parent = anchor.parentNode
    for el in elements:
        parent.insertBefore(el, anchor)
    parent.removeChild(anchor)


def build(spec_path: Path, out_dir: Path | None, template_override: Path | None,
          mode: str = "skript") -> Path:
    course, course_dir = load_course(spec_path)
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8")) or {}

    template = template_override or find_template(
        spec.get("template", course.get("skript_template", "templates/Grundvorlage-Skript.ott"))
    )
    if not template.exists():
        raise SystemExit(f"Vorlage nicht gefunden: {template}")

    label = spec.get("slug") or f"Skript_{spec_path.stem}"
    print(f"→ {label}  ({mode}, Vorlage: {template.name})")

    doc = load(str(template))
    titel = str(spec.get("titel") or spec_path.stem)
    autor = str(spec.get("autor") or course.get("autor", ""))
    meta = {
        "TITEL": titel if mode != "loesung" else f"{titel} – Lösungen",
        "AUTOR": autor,
        "AUTOR_KURZ": str(spec.get("autor_kurz") or kurz(autor)),
        "KOPFZEILE": str(spec.get("kopfzeile") or f"{course.get('kurs', '')} – {titel}").strip(" –"),
    }
    meta.update({k: str(v) for k, v in (spec.get("meta") or {}).items()})
    as_document(doc, {"meta": {"TITEL": meta["TITEL"]}})

    styles = resolve_styles(doc, {"styles": {**SCRIPT_STYLES, **(spec.get("styles") or {})}})
    for el in iter_text_elements(doc):
        replace_in_element(el, meta)

    names = ensure_script_styles(doc, existing_styles(doc))
    if mode == "loesung":
        styles = {**styles, "overlay_text": names["loesung"],
                  "overlay_code": names["loesung_code"]}
    elements = render_sheets(doc, spec, course, course_dir, styles, mode, names)
    entries = number_headings(elements, names)
    insert(doc, elements)
    anzahl = build_toc(doc, entries, names)

    if left := unresolved_placeholders(doc):
        print(f"  ! Nicht gefüllte Platzhalter: {', '.join(left)}", file=sys.stderr)

    target = out_dir or (ROOT / "build" / str(course.get("kuerzel", "")))
    target.mkdir(parents=True, exist_ok=True)
    suffix = "_Lösung" if mode == "loesung" else ""
    out_path = target / f"{label}{suffix}.odt"
    doc.save(str(out_path))
    fix_mimetype(out_path, getattr(doc, "formeln", []))
    print(f"  ✓ {rel(out_path)}  ({anzahl} Verzeichniseinträge)")
    return out_path


def kurz(autor: str) -> str:
    """„Martin Metzler" -> „M. Metzler" für die Kopfzeile."""
    teile = autor.split()
    return f"{teile[0][0]}. {teile[-1]}" if len(teile) > 1 else autor


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("specs", nargs="+", type=Path, help="Skript-Specs (YAML)")
    ap.add_argument("-o", "--out", type=Path, default=None,
                    help="Ausgabeverzeichnis (Standard: build/<kuerzel>/)")
    ap.add_argument("-t", "--template", type=Path, help="Vorlage überschreiben")
    ap.add_argument("--pdf", action="store_true", help="zusätzlich PDF erzeugen")
    ap.add_argument("--loesung", action="store_true",
                    help="zusätzlich ein Skript mit sichtbaren Lösungen")
    args = ap.parse_args()

    created: list[Path] = []
    for spec_path in args.specs:
        created.append(build(spec_path, args.out, args.template))
        if args.loesung:
            created.append(build(spec_path, args.out, args.template, mode="loesung"))

    if args.pdf:
        convert_to_pdf(created)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
