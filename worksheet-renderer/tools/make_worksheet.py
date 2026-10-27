#!/usr/bin/env python3
"""Erzeugt Arbeitsblatt und Lösungsblatt (.odt) aus einer Spec und einer Vorlage.

    python3 tools/make_worksheet.py kurse/javascript/06_verzweigungen/arbeitsblatt.yaml
    python3 tools/make_worksheet.py kurse/*/*/arbeitsblatt.yaml --loesung --pdf

Das Layout (Seitenformat, Kopf-/Fußzeile, Schriften, Formatvorlagen) kommt
vollständig aus der Vorlage. Dieses Skript füllt nur Inhalte ein:

1. Vorgaben kommen aus der nächstgelegenen `kurs.yaml` (Vorlage, Titelmuster,
   Kursname); die Spec überschreibt sie.
2. Platzhalter `{{NAME}}` überall im Dokument (auch Kopf-/Fußzeile und Tabellen)
   werden durch die Werte aus `meta:` ersetzt.
3. Der Absatz mit `{{INHALT}}` wird durch die gerenderten Blöcke aus `content:`
   ersetzt.

Mit --loesung entsteht zusätzlich ein Lösungsblatt, in dem die Musterlösungen
sichtbar in einem Rahmen über dem Karoraster stehen.

Formatvorlagen-Namen sind über `styles:` in der Spec oder in
templates/styles.yaml überschreibbar. Fehlt eine Vorlage in der Datei, wird
eine schlichte Ersatzvorlage angelegt, damit der Lauf nicht scheitert.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import math
import struct
import subprocess
import sys
import zipfile
from xml.sax.saxutils import escape
from pathlib import Path
from typing import Any

import yaml
from odf import teletype
from odf.element import Element
from odf.dc import Title
from odf.opendocument import load
from odf.style import (
    GraphicProperties,
    ListLevelLabelAlignment,
    ListLevelProperties,
    ParagraphProperties,
    Style,
    TableCellProperties,
    TableColumnProperties,
    TableProperties,
    TableRowProperties,
    TextProperties,
)
from odf.draw import Frame, Image, Object, TextBox
from odf.table import CoveredTableCell, Table, TableCell, TableColumn, TableRow
from odf.text import A, H, LineBreak, List, ListItem, ListLevelStyleBullet, ListLevelStyleNumber, ListStyle, P, S, Span

# Zwei Wurzeln: GEN ist dieser Generator (Code, Grundvorlage, styles.yaml),
# ROOT das Projekt mit kurse/, eigenen Vorlagen und build/ – beim CLI-Aufruf
# das aktuelle Verzeichnis, im Renderer-Dienst das Temp-Verzeichnis des Auftrags.
GEN = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("ARBEITSBLATT_ROOT") or Path.cwd()).resolve()
DEFAULT_TEMPLATE = "templates/Grundvorlage.ott"
PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")
CONTENT_TOKEN = "INHALT"

# Karopapier (nach examples/Karopapier.odt), Kantenlänge 0,5 cm.
# 33 Spalten ergeben exakt die Textbreite der Vorlage (21,0 - 2,5 - 2,0 = 16,5 cm).
KARO_CELL = 0.5
KARO_COLUMNS = 33
KARO_BORDER = "0.002cm"
# Bis zu dieser Höhe wächst das Raster im Lösungsblatt mit, damit die Lösung
# darüber Platz hat. Längere Lösungen (ganze Programme) stehen darunter.
KARO_MAX_ROWS = 22
# Muster eines Schreibfelds (Block `karo`): Karo, Linien (alle 1 cm), leer (Rahmen) oder frei (unsichtbar).
KARO_PATTERNS = ("karo", "linien", "leer", "frei")
LINE_GAP_CELLS = 2
KARO_COLOR = "#808080"

# Tiefgestellte Indizes im Fließtext: `n_S`, `M_A`, `P_{Schlupf}` -> n_S mit
# tiefgestelltem S. Die Basis ist genau ein Buchstabe, dem kein Wortzeichen
# vorausgeht – so bleiben Bezeichner wie `to_line` oder `AB_Vorlage` unberührt.
# `\_` schreibt einen gewöhnlichen Unterstrich (z. B. `c\_str()`).
SUBSCRIPT_STYLE = "Tiefgestellt"
SUBSCRIPT_RE = re.compile(
    r"(?<![0-9A-Za-zÄÖÜäöüß_\\])([A-Za-zΑ-Ωα-ω])_(?:\{([^}]{1,24})\}|([A-Za-z0-9ÄÖÜäöü]{1,8}))"
)

# Zeilenumbrüche im Fließtext: Die Specs sind von Hand bei rund 100 Zeichen
# umbrochen, ein einfacher Umbruch ist also meist nur Satzspiegel der Quelle.
# Er bleibt aber erhalten, wo er gewollt ist – bei Rechenzeilen, Aufzählungen
# wie „a) … b) …" und Zuweisungen untereinander (siehe `text_lines`).
HARD_BREAK_BELOW = 70
LIST_START_RE = re.compile(r"\s*(?:\(?[a-z]\)|\d+[.)]|[–•-])\s")
GAP_RE = re.compile(r"\S {2,}\S")
# „U_N = …", „xT2_3 := …", „xWORKPOS_1 (QM11) := …" am Zeilenanfang
ASSIGN_START_RE = re.compile(r"\s*[^\s=:]+(?: \([^)]*\))? ?:?= ")

# Auszeichnung im Fließtext (SPEC.md): **fett**, *kursiv*, ++unterstrichen++,
# ~~durchgestrichen~~, `code`, ^{hoch}, _{tief} (nach jedem Zeichen),
# [Text](https://…). Die Zeichen wirken nur am Wortrand („8*7“ bleibt eine
# Rechnung). Ein Backslash davor schreibt das Zeichen selbst. Zeilen
# ohne diese Zeichen laufen unverändert über den bisherigen Weg.
INLINE_RE = re.compile(
    r"\\(?P<esc>[\\*`\[\]^~+{}])"
    r"|`(?P<code>[^`\n]+)`"
    r"|(?<![\w*])\*\*\*(?P<bi>\S(?:.*?\S)?)\*\*\*(?![\w*])"
    r"|(?<![\w*])\*\*(?P<b>\S(?:.*?\S)?)\*\*(?![\w*])"
    r"|(?<![\w*])\*(?P<i>[^\s*](?:.*?[^\s*])?)\*(?![\w*])"
    r"|(?<![\w+])\+\+(?P<u>\S(?:.*?\S)?)\+\+(?![\w+])"
    r"|(?<![\w~])~~(?P<s>\S(?:.*?\S)?)~~(?![\w~])"
    r"|\^\{(?P<sup>[^}]{1,40})\}"
    r"|_\{(?P<sub>[^}]{1,24})\}"
    r"|\[(?P<atext>[^\]\n]+)\]\((?P<href>(?:https?://|mailto:)[^)\s]+)\)"
    r"|\[(?P<ctext>[^\]\n]+)\]\{(?P<color>[a-z-]+(?:,[a-z-]+)?)\}"
)
# Farben im Text ([Text]{blau,hl-gelb}) – wie docspec.js; kein Rot (rot = Lösung).
TEXT_COLORS = {"blau": "#1d4ed8", "gruen": "#15803d", "orange": "#c2410c", "lila": "#7e22ce", "grau": "#6b7280"}
HIGHLIGHTS = {"gelb": "#fef08a", "gruen": "#bbf7d0", "blau": "#bfdbfe", "rosa": "#fbcfe8"}
# Rahmenfarbe einer Tabelle (lineColor) und Hintergrund einer Zelle (background) – wie docspec.js.
LINE_COLORS = {"schwarz": "#000000", "grau": "#9ca3af", "blau": "#1d4ed8", "gruen": "#15803d", "orange": "#c2410c", "lila": "#7e22ce"}
CELL_BACKGROUNDS = {"grau": "#e5e7eb", "gelb": "#fef08a", "gruen": "#bbf7d0", "blau": "#bfdbfe", "rosa": "#fbcfe8"}
INLINE_HINT_RE = re.compile(r"\\[\\*`\[\]^~+{}]|`|\*|\+\+|~~|\^\{|_\{|\]\(|\]\{")
INLINE_STYLES = {
    "b": ("AB_Fett", {"fontweight": "bold", "fontweightasian": "bold", "fontweightcomplex": "bold"}),
    "i": ("AB_Kursiv", {"fontstyle": "italic", "fontstyleasian": "italic", "fontstylecomplex": "italic"}),
    "u": ("AB_Unterstrichen", {"textunderlinestyle": "solid", "textunderlinewidth": "auto", "textunderlinecolor": "font-color"}),
    "s": ("AB_Durchgestrichen", {"textlinethroughstyle": "solid", "textlinethroughtype": "single"}),
    "sup": ("AB_Hoch", {"textposition": "super 58%"}),
}
# Dokument, in dem gerade gerendert wird – für Zeichenvorlagen, die erst bei
# Bedarf entstehen (set_inline_context).
_inline: dict[str, Any] = {}

TEXT_MIMETYPE = "application/vnd.oasis.opendocument.text"
TEMPLATE_MIMETYPE = "application/vnd.oasis.opendocument.text-template"
MATH_MIMETYPE = "application/vnd.oasis.opendocument.formula"

# Formeln (`type: formula`) werden als eingebettete Formeleditor-Objekte
# abgelegt: je Formel ein Unterordner "Object n" im Archiv, im Text ein
# draw:object darauf. Die Größe des Rahmens wird bewusst nicht gesetzt –
# LibreOffice rechnet sie beim Laden aus der Formel aus. Steht dort eine
# falsche Größe, wird die Formel darauf verzerrt.
FORMULA_FRAME_STYLE = "AB_Formelrahmen"

# Standard-Zuordnung Blocktyp -> Formatvorlagenname in der .ott (AB_Vorlage3).
# Per `styles:` in der Spec oder templates/styles.yaml überschreibbar.
# Die Nummerierung (1., 1.1, 1.1.1) kommt aus der Gliederungsnummerierung der
# Vorlage und hängt an der Gliederungsebene der Überschrift, nicht am Text.
DEFAULT_STYLES = {
    "section": "Heading_20_1",       # Themenabschnitt   -> "1."
    "task": "Heading_20_2",          # Aufgabe           -> "1.1"
    "subtask": "Heading_20_3",       # Teilaufgabe       -> "1.1.1"
    "text": "Standard",
    "code": "Quelltext",
    "list": "List",
    "solution_text": "Lösung",       # rot + ausgeblendet
    "solution_code": "LösungQuelltext",
    "karo": "Table_20_Contents",  # Absatzvorlage in den Karo-Zellen
    "table_head": "Table_20_Heading",
    "table_cell": "Table_20_Contents",
    "overlay_text": "LoesungSichtbar",       # nur im Lösungsblatt
    "overlay_code": "LoesungSichtbarCode",
    "emphasis": "Hinweis",
    "caption": "Abbildung",          # Zeichenvorlage für Bildunterschriften
    "code_inline": "Codewort",
}

# Gliederungsebene je Überschriftenart.
OUTLINE_LEVEL = {"section": 1, "task": 2, "subtask": 3}


# --------------------------------------------------------------------------
# Formatvorlagen
# --------------------------------------------------------------------------

def existing_styles(doc) -> set[str]:
    names = set()
    for container in (doc.styles, doc.automaticstyles):
        for style in container.getElementsByType(Style):
            name = style.getAttribute("name")
            if name:
                names.add(name)
    return names


def ensure_style(doc, name: str, family: str, present: set[str]) -> None:
    """Legt eine schlichte Ersatzvorlage an, falls die Vorlage sie nicht kennt."""
    if name in present:
        return
    style = Style(name=name, family=family)
    if any(k in name.lower() for k in ("quelltext", "code", "preformatted")):
        style.addElement(
            TextProperties(fontfamily="DejaVu Sans Mono", fontname="DejaVu Sans Mono", fontsize="9pt")
        )
    if family == "paragraph":
        style.addElement(ParagraphProperties(margintop="0.2cm", marginbottom="0.2cm"))
    doc.styles.addElement(style)
    present.add(name)
    print(f"  ! Formatvorlage '{name}' fehlt in der Vorlage – Ersatz angelegt", file=sys.stderr)


def ensure_pagebreak_style(doc, present: set[str], name: str = "AB_Seitenumbruch") -> str:
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename="Standard")
        style.addElement(ParagraphProperties(breakbefore="page"))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def ensure_keep_style(doc, present: set[str], base: str) -> str:
    """Absatzvorlage wie `base`, die aber am folgenden Element klebt.

    Damit landen Beschriftungen nie allein am Seitenende, während Tabelle,
    Bild oder Codeblock erst auf der nächsten Seite folgen.
    """
    name = f"AB_Zusammenhalten_{base}"
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(ParagraphProperties(keepwithnext="always"))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def keep_style(ctx: dict[str, Any], base: str) -> str:
    """ensure_keep_style mit den Angaben aus dem Render-Kontext."""
    return ensure_keep_style(ctx["doc"], ctx["present"], base)


def ensure_abstand_style(doc, present: set[str], base: str) -> str:
    """Absatzvorlage wie `base`, aber mit etwas Luft nach oben.

    Für Absätze direkt hinter einer Aufzählung: Sie gehören nicht zu ihr und
    sollen sich davon absetzen, statt wie ein weiterer Punkt zu wirken.
    """
    name = f"AB_AbstandOben_{base}"
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(ParagraphProperties(margintop="0.35cm"))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def abstand_style(ctx: dict[str, Any], base: str) -> str:
    """ensure_abstand_style mit den Angaben aus dem Render-Kontext."""
    return ensure_abstand_style(ctx["doc"], ctx["present"], base)


def resolve_styles(doc, spec: dict[str, Any]) -> dict[str, str]:
    styles = dict(DEFAULT_STYLES)
    # Erst die Zuordnung des Generators, dann eine eigene des Projekts.
    for shared in dict.fromkeys([GEN / "templates" / "styles.yaml", ROOT / "templates" / "styles.yaml"]):
        if shared.exists():
            styles.update(yaml.safe_load(shared.read_text(encoding="utf-8")) or {})
    styles.update(spec.get("styles") or {})

    present = existing_styles(doc)
    for key, name in styles.items():
        # Karo- und Overlay-Vorlagen legen ensure_karo_styles/ensure_overlay_styles an.
        if key in ("karo", "overlay_text", "overlay_code", "table_head", "table_cell"):
            continue
        family = "text" if key in ("code_inline", "emphasis", "caption") else "paragraph"
        ensure_style(doc, name, family, present)
    return styles


# --------------------------------------------------------------------------
# Platzhalter im vorhandenen Dokument
# --------------------------------------------------------------------------

def iter_text_elements(doc):
    """Alle Absätze/Überschriften des Dokuments inkl. Kopf-/Fußzeilen.

    Kopf- und Fußzeilen hängen unter office:master-styles (doc.masterstyles),
    nicht unter office:styles – deshalb werden beide Bäume durchlaufen.
    """
    for root in (doc.text, doc.styles, doc.masterstyles):
        for kind in (P, H):
            for el in root.getElementsByType(kind):
                yield el


def text_nodes(el: Element):
    """Alle reinen Textknoten unterhalb von el, auch in Spans und Feldern."""
    for child in el.childNodes:
        if isinstance(child, Element):
            yield from text_nodes(child)
        elif child.nodeType == child.TEXT_NODE:
            yield child


def replace_in_element(el: Element, values: dict[str, str]) -> None:
    """Ersetzt {{NAME}} im Absatz, auch wenn der Text über mehrere Nodes verteilt ist.

    Zuerst wird knotenweise ersetzt. Das ist der Normalfall und der einzige,
    der Felder überlebt: Die Kopfzeile enthält neben dem Titel die Felder
    text:page-number und text:page-count. Würde man den Absatz flach
    zusammenschreiben, blieben nur deren zwischengespeicherte Werte stehen –
    auf jeder Seite stünde „(1/1)".

    Nur wenn danach noch ein Platzhalter offen ist (er verteilt sich dann über
    mehrere Knoten), wird der Absatztext eingesammelt und als ein Textknoten
    zurückgeschrieben. Inline-Formatierung und Felder gehen dabei verloren.

    Grafische Kinder (Bildrahmen, Zeichenformen – etwa das Schullogo in der
    Kopfzeile) tragen keinen Text und bleiben erhalten: Sie werden vor dem Text
    wieder eingehängt.
    """
    text = teletype.extractText(el)
    if "{{" not in text:
        return

    def sub(match: re.Match) -> str:
        name = match.group(1)
        if name == CONTENT_TOKEN:
            return match.group(0)  # wird separat behandelt
        return str(values.get(name, match.group(0)))

    for node in text_nodes(el):
        ersetzt = PLACEHOLDER_RE.sub(sub, node.data)
        if ersetzt != node.data:
            node.data = ersetzt

    text = teletype.extractText(el)
    new_text = PLACEHOLDER_RE.sub(sub, text)
    if new_text == text:
        return                      # knotenweise erledigt oder nichts zu tun
    grafik = []
    for child in list(el.childNodes):
        if isinstance(child, Element):
            if child.qname[0] == "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0":
                grafik.append(child)
            el.removeChild(child)
        else:
            # Reine Textknoten kennt removeChild() nicht (es pflegt die
            # Element-Caches des Dokuments) – sie werden direkt ausgehängt.
            el.childNodes.remove(child)
            child.parentNode = None
    for frame in grafik:
        el.addElement(frame)
    teletype.addTextToElement(el, new_text)


def unresolved_placeholders(doc) -> list[str]:
    left = []
    for el in iter_text_elements(doc):
        for name in PLACEHOLDER_RE.findall(teletype.extractText(el)):
            if name != CONTENT_TOKEN and name not in left:
                left.append(name)
    return left


# --------------------------------------------------------------------------
# Inhaltsblöcke -> ODF
# --------------------------------------------------------------------------

# Zeichen der Aufzählung (`marker`): Strich, Pfeil, Quadrat, Checkliste.
LIST_MARKERS = {"dash": "–", "arrow": "➤", "square": "■", "check": "☐"}


def ensure_bullet_list_style(doc, name: str = "AB_Aufzaehlung", char: str = "•") -> str:
    """Aufzählungsliste mit Punkt-Symbol (oder `char`), falls noch nicht vorhanden."""
    for ls in doc.styles.getElementsByType(ListStyle):
        if ls.getAttribute("name") == name:
            return name
    ls = ListStyle(name=name)
    for level in range(1, 4):
        bullet = ListLevelStyleBullet(level=str(level), bulletchar=char)
        props = ListLevelProperties()
        props.setAttribute("listlevelpositionandspacemode", "label-alignment")
        align = ListLevelLabelAlignment(labelfollowedby="listtab")
        align.setAttribute("listtabstopposition", f"{0.6 * level:.2f}cm")
        align.setAttribute("textindent", "-0.4cm")
        align.setAttribute("marginleft", f"{0.6 * level:.2f}cm")
        props.addElement(align)
        bullet.addElement(props)
        ls.addElement(bullet)
    doc.styles.addElement(ls)
    return name


def ensure_subscript_style(doc, present: set[str]) -> str:
    """Zeichenvorlage für tiefgestellte Indizes.

    Muss eine automatische Vorlage sein, damit sie auch im Lösungsrahmen über
    dem Karoraster greift (benannte Vorlagen wendet LibreOffice dort nicht an).
    """
    if SUBSCRIPT_STYLE not in present:
        style = Style(name=SUBSCRIPT_STYLE, family="text")
        # -7 % ist die tiefste Stellung, bei der auch ein Index mit Unterlänge
        # ("Schlupf") noch über der normalen Unterlänge der Zeile bleibt. Tiefer
        # gestellt wächst in LibreOffice das Zeilenkästchen, und die um wenige
        # Zehntelmillimeter höheren Zeilen verschieben am Ende die Seitenumbrüche.
        style.addElement(TextProperties(textposition="-7% 61%"))
        doc.automaticstyles.addElement(style)
        present.add(SUBSCRIPT_STYLE)
    return SUBSCRIPT_STYLE


def set_inline_context(doc, present: set[str], styles: dict[str, str]) -> None:
    """Vor dem Rendern: wohin Zeichenvorlagen der Auszeichnung gehören."""
    _inline.update(doc=doc, present=present, code=styles.get("code_inline", "Codewort"))


def inline_style(kind: str) -> str:
    """Automatische Zeichenvorlage für fett, kursiv … – erst bei Bedarf."""
    name, props = INLINE_STYLES[kind]
    if name not in _inline["present"]:
        style = Style(name=name, family="text")
        style.addElement(TextProperties(**props))
        _inline["doc"].automaticstyles.addElement(style)
        _inline["present"].add(name)
    return name


def color_spec(spec: str) -> tuple[str | None, str | None]:
    """„blau,hl-gelb“ → (Schriftfarbe, Hintergrund) als #hex – unbekannte Namen fallen weg."""
    color = hl = None
    for part in spec.split(","):
        if part.startswith("hl-") and part[3:] in HIGHLIGHTS:
            hl = HIGHLIGHTS[part[3:]]
        elif part in TEXT_COLORS:
            color = TEXT_COLORS[part]
    return (color, hl) if color or hl else None


def color_style(spec: tuple[str | None, str | None]) -> str:
    """Zeichenvorlage für Farbe und Hervorhebung – erst bei Bedarf."""
    color, hl = spec
    name = "AB_Farbe_" + (color or "x").lstrip("#") + "_" + (hl or "x").lstrip("#")
    if name not in _inline["present"]:
        props = {}
        if color:
            props["color"] = color
        if hl:
            props["backgroundcolor"] = hl
        style = Style(name=name, family="text")
        style.addElement(TextProperties(**props))
        _inline["doc"].automaticstyles.addElement(style)
        _inline["present"].add(name)
    return name


def parse_inline(text: str) -> list[tuple[str, Any]]:
    """Text → Knoten: ("text", s), ("b"|"i"|"u"|"s", [...]), ("sup"|"sub"|"code", s), ("a", (href, [...]))."""
    nodes: list[tuple[str, Any]] = []
    def add_text(t: str) -> None:
        if not t:
            return
        if nodes and nodes[-1][0] == "text":
            nodes[-1] = ("text", nodes[-1][1] + t)
        else:
            nodes.append(("text", t))
    pos = 0
    for m in INLINE_RE.finditer(text):
        add_text(text[pos:m.start()])
        pos = m.end()
        kind = m.lastgroup if m.lastgroup != "href" else "a"
        if m.group("esc") is not None:
            add_text(m.group("esc"))
        elif m.group("href") is not None:
            nodes.append(("a", (m.group("href"), parse_inline(m.group("atext")))))
        elif m.group("color") is not None:
            spec = color_spec(m.group("color"))
            if spec:
                nodes.append(("color", (spec, parse_inline(m.group("ctext")))))
            else:
                add_text(m.group(0))
        elif kind == "bi":
            nodes.append(("b", [("i", parse_inline(m.group("bi")))]))
        elif kind in ("b", "i", "u", "s"):
            nodes.append((kind, parse_inline(m.group(kind))))
        else:
            nodes.append((kind, m.group(kind)))
    add_text(text[pos:])
    return nodes


def add_inline(el: Element, nodes: list[tuple[str, Any]], line_start: bool) -> None:
    for kind, value in nodes:
        if kind == "text":
            add_subscripted(el, value, line_start)
        elif kind in ("b", "i", "u", "s"):
            span = Span(stylename=inline_style(kind))
            add_inline(span, value, False)
            el.addElement(span)
        elif kind == "sup":
            el.addElement(Span(stylename=inline_style("sup"), text=value))
        elif kind == "sub":
            el.addElement(Span(stylename=SUBSCRIPT_STYLE, text=value))
        elif kind == "code":
            el.addElement(Span(stylename=_inline.get("code", "Codewort"), text=value))
        elif kind == "a":
            link = A(href=value[0], type="simple")
            add_inline(link, value[1], False)
            el.addElement(link)
        elif kind == "color":
            span = Span(stylename=color_style(value[0]))
            add_inline(span, value[1], False)
            el.addElement(span)
        line_start = False


def text_lines(text: str) -> list[str]:
    """Zeilen, die im Dokument einzeln stehen sollen.

    Ein Umbruch der Quelle bleibt, wenn
    * die Folgezeile mit einer Aufzählung beginnt („b) …", „2. …"),
    * beide Zeilen mit einer Zuweisung beginnen (Gleichungen untereinander),
    * die Zeile mit „:" endet und die Folgezeile eingerückt ist (abgesetzte
      Rechnung),
    * eine der beiden Zeilen Lücken aus mehreren Leerzeichen hat (Formel und
      Einheit nebeneinander, Umformungsschritte) oder
    * die Zeile deutlich kürzer ist als der Fließtext der Specs.
    Sonst ist er nur Satzspiegel – auch ein hängender Einzug („a) … / …
    Fortsetzung") –, und die Zeilen laufen als Absatz weiter.
    """
    lines = text.split("\n")
    out = [lines[0]]
    for prev, line in zip(lines, lines[1:]):
        # Ein Backslash am Zeilenende erzwingt den Umbruch (und verschwindet).
        if prev.rstrip().endswith("\\"):
            out[-1] = out[-1].rstrip()[:-1].rstrip()
            out.append(line)
            continue
        hard = (LIST_START_RE.match(line)
                or (ASSIGN_START_RE.match(prev) and ASSIGN_START_RE.match(line))
                or (prev.rstrip().endswith(":") and line[:1] == " ")
                or GAP_RE.search(prev) or GAP_RE.search(line)
                or len(prev.rstrip()) < HARD_BREAK_BELOW)
        if hard:
            out.append(line)
        else:
            out[-1] = out[-1].rstrip() + " " + line.lstrip()
    return out


def add_spaced_text(el: Element, text: str, line_start: bool = False) -> None:
    """Text anhängen; Lücken aus mehreren Leerzeichen bleiben erhalten.

    ODF fasst Leerzeichen zu einem zusammen – Lücken zwischen Formel und
    Einheit („J = I / A,   [J] = A/mm²") verschwänden sonst. Sie werden als
    <text:s> geschrieben, am Zeilenanfang auch ein einzelnes.
    """
    first = line_start
    for part in re.split(r"( {2,})", text):
        if not part:
            continue
        if first and part.startswith(" "):
            # Einrückung am Zeilenanfang: ganz als <text:s>, sonst fiele das
            # erste Leerzeichen nach dem Umbruch weg.
            indent = len(part) - len(part.lstrip(" "))
            el.addElement(S(c=indent))
            if part[indent:]:
                el.addText(part[indent:])
        elif part.startswith("  ") and not part.strip():
            el.addText(" ")
            el.addElement(S(c=len(part) - 1))
        else:
            el.addText(part)
        first = False


def add_rich_text(el: Element, text: str) -> None:
    """Text an el anhängen und dabei `n_S` als n mit tiefgestelltem S setzen.

    Gewollte Zeilenumbrüche werden zu <text:line-break/> (siehe text_lines),
    Lücken aus mehreren Leerzeichen bleiben erhalten.
    """
    for n, line in enumerate(text_lines(text)):
        if n:
            el.addElement(LineBreak())
        if INLINE_HINT_RE.search(line) and _inline:
            add_inline(el, parse_inline(line), True)
        else:
            add_subscripted(el, line, True)


def add_subscripted(el: Element, line: str, line_start: bool) -> None:
    """Text mit `n_S`-Indizes und erhaltenen Lücken anhängen."""
    pos = 0
    for match in SUBSCRIPT_RE.finditer(line):
        add_spaced_text(el, (line[pos:match.start()] + match.group(1)).replace("\\_", "_"),
                        line_start=line_start and pos == 0)
        el.addElement(Span(stylename=SUBSCRIPT_STYLE,
                           text=match.group(2) or match.group(3)))
        pos = match.end()
    add_spaced_text(el, line[pos:].replace("\\_", "_"), line_start=line_start and pos == 0)


def rich_p(stylename: str, text: str) -> Element:
    p = P(stylename=stylename)
    add_rich_text(p, str(text))
    return p


def rich_span(stylename: str, text: str) -> Element:
    span = Span(stylename=stylename)
    add_rich_text(span, str(text))
    return span


def ensure_karo_styles(doc, present: set[str]) -> None:
    """Formatvorlagen für Karopapier (nach examples/Karopapier.odt).

    Kantenlänge 0,5 cm, graue Haarlinien. Die Zellen haben rechts keinen
    Rahmen – die senkrechten Linien kommen jeweils vom linken Rahmen der
    nächsten Zelle. Nur die letzte Spalte schließt das Raster rechts ab.
    """
    if "Karo" in present:
        return
    border = f"{KARO_BORDER} solid {KARO_COLOR}"

    table = Style(name="Karo", family="table")
    table.addElement(
        # maybreakbetweenrows: Das Raster wird nie über zwei Seiten zerrissen –
        # passt es nicht mehr aufs Blatt, rückt es geschlossen auf die nächste Seite.
        TableProperties(width=f"{KARO_CELL * KARO_COLUMNS:.3f}cm", margintop="0.2cm",
                        marginbottom="0.2cm", align="margins",
                        maybreakbetweenrows="false")
    )
    column = Style(name="Karo.A", family="table-column")
    column.addElement(TableColumnProperties(columnwidth=f"{KARO_CELL}cm"))
    row = Style(name="Karo.1", family="table-row")
    row.addElement(TableRowProperties(rowheight=f"{KARO_CELL}cm"))

    cell = Style(name="Karo.A1", family="table-cell")
    cell.addElement(
        TableCellProperties(padding="0cm", borderleft=border, borderright="none",
                            bordertop=border, borderbottom=border)
    )
    last = Style(name="Karo.Z1", family="table-cell")
    last.addElement(
        TableCellProperties(padding="0cm", borderleft=border, borderright=border,
                            bordertop=border, borderbottom=border)
    )

    for style in (table, column, row, cell, last):
        doc.automaticstyles.addElement(style)
        present.add(style.getAttribute("name"))


def solution_overlay(elements: list[Element], index: int, frame_style: Style) -> Element:
    """Textrahmen, der über dem Karoraster liegt (nur im Lösungsblatt).

    Der Rahmen wird im ersten Karo des Rasters verankert und liegt mit
    Durchlauf-Umlauf und transparentem Hintergrund darüber – die Karos bleiben
    also sichtbar, die Lösung steht in roter Schrift darauf.
    """
    frame = Frame(
        stylename=frame_style,
        name=f"Loesung{index}",
        anchortype="paragraph",
        zindex="5",
        width=f"{KARO_CELL * KARO_COLUMNS:.2f}cm",
        x="0cm",
        y="0.05cm",
    )
    box = TextBox(minheight="0.4cm")
    for el in elements:
        box.addElement(el)
    frame.addElement(box)
    return frame


def ensure_overlay_styles(doc, present: set[str]) -> Style:
    """Vorlagen für die eingeblendeten Lösungen des Lösungsblatts.

    Gibt die Rahmenvorlage als Element zurück – odfpy erwartet beim Frame das
    Style-Objekt, nicht dessen Namen.

    Wichtig: Die Absatzvorlagen für den Rahmeninhalt müssen automatische
    Vorlagen (content.xml) sein. Benannte Vorlagen aus styles.xml wendet
    LibreOffice innerhalb von Textrahmen nicht an.
    """
    frame = Style(name="Loesungsrahmen", family="graphic")
    frame.addElement(
        GraphicProperties(
            wrap="run-through", runthrough="foreground",
            verticalpos="from-top", verticalrel="paragraph",
            horizontalpos="from-left", horizontalrel="paragraph",
            backgroundcolor="transparent", fill="none",
            stroke="none", border="none", padding="0cm",
            autogrowheight="true",
        )
    )
    doc.automaticstyles.addElement(frame)

    text = Style(name="LoesungSichtbar", family="paragraph", parentstylename="Standard")
    text.addElement(ParagraphProperties(margintop="0cm", marginbottom="0cm"))
    text.addElement(
        TextProperties(color="#ff0000", fontsize="9pt", fontweight="bold",
                       fontfamily="Liberation Sans", fontname="Liberation Sans")
    )

    code = Style(name="LoesungSichtbarCode", family="paragraph", parentstylename="Standard")
    code.addElement(ParagraphProperties(margintop="0cm", marginbottom="0cm"))
    code.addElement(
        TextProperties(color="#ff0000", fontsize="8.5pt",
                       fontfamily="DejaVu Sans Mono", fontname="DejaVu Sans Mono")
    )

    for style in (text, code):
        doc.automaticstyles.addElement(style)
        present.add(style.getAttribute("name"))
    present.add("Loesungsrahmen")
    return frame


def karo_columns(block: dict[str, Any]) -> int:
    """Spalten zu 0,5 cm aus `width` (z. B. "8cm"); ohne Angabe die volle Satzbreite."""
    width = str(block.get("width") or "").strip()
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*cm", width)
    if not match:
        return KARO_COLUMNS
    return max(2, min(KARO_COLUMNS, round(float(match.group(1)) / KARO_CELL)))


def ensure_field_style(doc, present: set[str], columns: int, pattern: str) -> tuple[str, str]:
    """Tabellen- und Zellvorlage für ein schmaleres Raster bzw. Linien/leeres Feld.

    Liefert (Tabellenvorlage, Zellvorlage). Linien: nur unten ein Strich, die
    Zeile ist LINE_GAP_CELLS Karos hoch. Leer: ein einziges Feld mit Rahmen;
    frei: dasselbe ohne Rahmen (nur Platz).
    """
    width = KARO_CELL * columns
    name = f"Feld{pattern.capitalize()}{columns}"
    if name not in present:
        border = f"{KARO_BORDER} solid {KARO_COLOR}"
        table = Style(name=name, family="table")
        table.addElement(TableProperties(
            width=f"{width:.3f}cm", margintop="0.2cm", marginbottom="0.2cm",
            align="margins" if columns == KARO_COLUMNS else "left", maybreakbetweenrows="false"))
        cell = Style(name=f"{name}.A1", family="table-cell")
        if pattern == "linien":
            cell.addElement(TableCellProperties(padding="0cm", borderleft="none", borderright="none",
                                                bordertop="none", borderbottom=border))
        elif pattern == "frei":
            cell.addElement(TableCellProperties(padding="0cm", border="none"))
        else:
            cell.addElement(TableCellProperties(padding="0cm", border=border))
        column = Style(name=f"{name}.A", family="table-column")
        column.addElement(TableColumnProperties(columnwidth=f"{width:.3f}cm"))
        for style in (table, cell, column):
            doc.automaticstyles.addElement(style)
            present.add(style.getAttribute("name"))
    return name, f"{name}.A1"


def ensure_row_style(doc, present: set[str], cells: int) -> str:
    """Zeilenvorlage mit fester Höhe (Vielfaches eines Karos)."""
    name = f"Feld.Zeile{cells}"
    if name not in present:
        row = Style(name=name, family="table-row")
        row.addElement(TableRowProperties(rowheight=f"{KARO_CELL * cells:.3f}cm"))
        doc.automaticstyles.addElement(row)
        present.add(name)
    return name


def karo_table(rows: int, para_style: str, index: int,
               overlay: list[Element] | None = None,
               frame_style: Style | None = None,
               columns: int = KARO_COLUMNS, pattern: str = "karo",
               ctx: dict[str, Any] | None = None) -> Element:
    """Schreibfeld mit `rows` Karozeilen zum handschriftlichen Eintragen.

    `pattern`: Karo (Vorgabe), Linien (alle 1 cm) oder leer; `columns`: Breite
    in Karos. `overlay` legt eine Musterlösung als Textrahmen über das Feld.
    """
    if pattern not in KARO_PATTERNS:
        pattern = "karo"
    if pattern == "karo" and columns == KARO_COLUMNS:
        table_style, row_style, cell_styles, cols = "Karo", "Karo.1", ("Karo.A1", "Karo.Z1"), KARO_COLUMNS
        column_style = "Karo.A"
    elif pattern == "karo":
        # Schmaler: eigene Tabellenvorlage, Zellen wie beim vollen Raster.
        table_style = f"Karo{columns}"
        if table_style not in ctx["present"]:
            table = Style(name=table_style, family="table")
            table.addElement(TableProperties(width=f"{KARO_CELL * columns:.3f}cm", margintop="0.2cm",
                                             marginbottom="0.2cm", align="left", maybreakbetweenrows="false"))
            ctx["doc"].automaticstyles.addElement(table)
            ctx["present"].add(table_style)
        row_style, cell_styles, cols, column_style = "Karo.1", ("Karo.A1", "Karo.Z1"), columns, "Karo.A"
    else:
        table_style, cell = ensure_field_style(ctx["doc"], ctx["present"], columns, pattern)
        cell_styles, cols, column_style = (cell, cell), 1, f"{table_style}.A"
        if pattern == "linien":
            row_style = ensure_row_style(ctx["doc"], ctx["present"], LINE_GAP_CELLS)
            rows = max(1, round(rows / LINE_GAP_CELLS))
        else:
            row_style = ensure_row_style(ctx["doc"], ctx["present"], rows)
            rows = 1

    # Der Name beginnt mit „Karo“: keep_karo_with_question hält die Frage davor beim Feld.
    table = Table(name=f"Karo{index}", stylename=table_style)
    table.addElement(TableColumn(numbercolumnsrepeated=str(cols), stylename=column_style))
    for row in range(rows):
        tr = TableRow(stylename=row_style)
        for col in range(cols):
            cell = TableCell(valuetype="string",
                             stylename=cell_styles[1] if col == cols - 1 else cell_styles[0])
            para = P(stylename=para_style)
            if overlay and row == 0 and col == 0:
                para.addElement(solution_overlay(overlay, index, frame_style))
            cell.addElement(para)
            tr.addElement(cell)
        table.addElement(tr)
    return table


def image_size(path: Path, width_cm: float) -> tuple[float, float]:
    """Höhe zur gewünschten Breite aus dem Seitenverhältnis der Bilddatei.

    Unterstützt PNG, JPEG und SVG ohne Zusatzbibliothek. Ist das Verhältnis
    nicht ermittelbar, wird 3:2 angenommen.
    """
    data = path.read_bytes()
    ratio = 2 / 3
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", data[16:24])
            ratio = h / w
        elif data[:2] == b"\xff\xd8":  # JPEG: SOFn-Segment suchen
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
                if marker in range(0xC0, 0xCF) and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    ratio = h / w
                    break
                i += 2 + length
        elif b"<svg" in data[:1024]:
            head = data[:2048].decode("utf-8", "replace")
            box = re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"', head)
            if box:
                ratio = float(box.group(2)) / float(box.group(1))
    except Exception:  # defektes Bild soll den Lauf nicht abbrechen
        print(f"  ! Bildmaße von {path.name} nicht lesbar – 3:2 angenommen", file=sys.stderr)
    return width_cm, width_cm * ratio


def ensure_line_middle_style(doc) -> Style:
    """Rahmenvorlage: Bild wie ein Zeichen, mittig zur Zeile."""
    style = getattr(doc, "bildmitte", None)
    if style is None:
        style = Style(name="AB_BildMitte", family="graphic")
        style.addElement(GraphicProperties(verticalpos="middle", verticalrel="line", border="none", padding="0cm"))
        doc.automaticstyles.addElement(style)
        doc.bildmitte = style
    return style


def image_frame(doc, block: dict[str, Any], search: list[Path], index: int, middle: bool = False) -> Element:
    """Bild als Rahmen im Textfluss (draw:frame mit eingebettetem Bild);
    `middle`: mittig zur Textzeile statt auf der Grundlinie (Bild neben Text)."""
    path = resolve_path(block["file"], search)
    width = float(str(block.get("width", "12")).removesuffix("cm"))
    if "height" in block:
        height = float(str(block["height"]).removesuffix("cm"))
    else:
        width, height = image_size(path, width)

    href = doc.addPicture(str(path))
    extra: dict[str, Any] = {}
    if block.get("border"):
        extra["stylename"] = ensure_image_border_style(doc)
    elif middle:
        extra["stylename"] = ensure_line_middle_style(doc)
    frame = Frame(
        name=f"Bild{index}",
        anchortype="as-char",
        width=f"{width:.2f}cm",
        height=f"{height:.2f}cm",
        zindex="0",
        **extra,
    )
    frame.addElement(Image(href=href))
    return frame


# --------------------------------------------------------------------------
# Formeln
# --------------------------------------------------------------------------

# Inhalt eines eingebetteten Formeldokuments. LibreOffice liest die Formel aus
# der StarMath-Anmerkung und baut daraus die Darstellung; der MathML-Rumpf
# bleibt deshalb leer.
MATH_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
 <semantics>
  <mrow/>
  <annotation encoding="StarMath 5.0">{formel}</annotation>
 </semantics>
</math>
"""


def ensure_formula_frame_style(doc, present: set[str]) -> Style:
    """Rahmenvorlage für Formelobjekte: mittig zur Zeile, ohne Rand.

    Gibt wie ensure_overlay_styles das Style-Element zurück – odfpy erwartet
    beim Frame das Objekt, nicht dessen Namen.
    """
    style = getattr(doc, "formelrahmen", None)
    if style is None:
        style = Style(name=FORMULA_FRAME_STYLE, family="graphic")
        style.addElement(
            GraphicProperties(verticalpos="middle", verticalrel="text",
                              wrap="none", padding="0cm", border="none")
        )
        doc.automaticstyles.addElement(style)
        present.add(FORMULA_FRAME_STYLE)
        doc.formelrahmen = style
    return style


def ensure_center_style(doc, present: set[str], base: str) -> str:
    """Absatzvorlage wie `base`, aber zentriert – für freistehende Formeln."""
    name = f"AB_Mittig_{base}"
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(ParagraphProperties(textalign="center", margintop="0.2cm",
                                             marginbottom="0.2cm"))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def formula_frame(ctx: dict[str, Any], math_text: str) -> Element:
    """Formel als eingebettetes Formeleditor-Objekt im Textfluss.

    Die Formel selbst wandert erst beim Schreiben des Archivs als eigener
    Ordner "Object n" hinein (siehe fix_mimetype); hier entsteht nur der
    Verweis darauf. Der Rahmen bekommt absichtlich keine Größe.
    """
    doc = ctx["doc"]
    formeln = getattr(doc, "formeln", None)
    if formeln is None:
        formeln = doc.formeln = []
    formeln.append(math_text)
    frame = Frame(
        stylename=ensure_formula_frame_style(doc, ctx["present"]),
        name=f"Formel{len(formeln)}",
        anchortype="as-char",
        zindex="0",
    )
    frame.addElement(Object(href=f"./Object {len(formeln)}", type="simple",
                            show="embed", actuate="onLoad"))
    return frame


def brace_group(text: str, start: int) -> tuple[str, int]:
    """Inhalt der geschweiften Klammer ab `start` und Position dahinter."""
    if start >= len(text) or text[start] != "{":
        ende = start
        while ende < len(text) and (text[ende].isalnum() or text[ende] in "_%\\"):
            ende += 1
        return text[start:ende], ende
    tiefe = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            tiefe += 1
        elif text[i] == "}":
            tiefe -= 1
            if tiefe == 0:
                return text[start + 1:i], i + 1
    return text[start + 1:], len(text)


def starmath_as_text(math_text: str) -> str:
    """StarMath -> lesbarer Fließtext, z. B. `sqrt{R^2}` -> `√(R²)`.

    Gebraucht überall dort, wo ein Formelobjekt nicht dargestellt würde –
    im Lösungsrahmen über dem Karoraster (dort zeigt LibreOffice weder
    Bilder noch Objekte).
    """
    text = re.sub(r"\b(?:color\s+\w+|size\s+[*/]?[\d.]+)\s*", "", math_text)
    # Wurzeln von innen nach außen auflösen.
    while (i := text.find("sqrt")) >= 0:
        rumpf = text[i + 4:]
        start = i + 4 + len(rumpf) - len(rumpf.lstrip())
        inhalt, ende = brace_group(text, start)
        text = f"{text[:i]}√({inhalt}){text[ende:]}"
    text = re.sub(r"\s*\bover\b\s*", " over ", text)
    # Nenner mit mehreren Faktoren bekommen Klammern: `1 over {2 cdot f}` -> `1 / (2 · f)`
    while (i := text.find(" over ")) >= 0:
        nenner, ende = brace_group(text, i + 6)
        klammer = f"({nenner})" if " " in nenner.strip() else nenner
        text = f"{text[:i]} / {klammer}{text[ende:]}"
    text = re.sub(r"\s*\bcdot\b\s*", " · ", text)
    text = re.sub(r"\b(?:left|right|alignl|alignc|alignr)\b", "", text)
    text = text.replace("~", " ").replace("`", " ")
    text = text.replace("%pi", "π").replace("%OMEGA", "Ω").replace("%alpha", "α")
    text = re.sub(r"\^\s*2\b", "²", text)
    text = re.sub(r"\^\s*3\b", "³", text)
    text = re.sub(r'"([^"]*)"', r"\1", text)
    text = text.replace("{", "").replace("}", "")
    return re.sub(r"\s{2,}", " ", text).strip()


def code_paragraphs(code: str, style: str) -> list[Element]:
    """Codezeilen als eigene Absätze; Leerzeichenkolonnen bleiben erhalten."""
    paragraphs = []
    for line in code.rstrip("\n").expandtabs(4).split("\n"):
        # Mehrere Leerzeichen hintereinander würden in ODF zusammenfallen und
        # müssen als <text:s> ausgezeichnet werden – sonst verrutschen
        # Einrückung und ausgerichtete Kommentarspalten.
        p = P(stylename=style)
        pos = 0
        for run in re.finditer(" {2,}", line):
            p.addText(line[pos:run.start()])
            count = len(run.group())
            if run.start() == 0:
                p.addElement(S(c=count))
            else:
                # Das erste Leerzeichen darf Text bleiben, der Rest nicht.
                p.addText(" ")
                p.addElement(S(c=count - 1))
            pos = run.end()
        p.addText(line[pos:])
        paragraphs.append(p)
    return paragraphs


def bullet_list(items: list[Any], para_style: str, list_style: str) -> Element:
    """Aufzählung; ein Punkt darf {text, items} sein und Unterpunkte haben."""
    lst = List(stylename=list_style)
    for item in items:
        li = ListItem()
        if isinstance(item, dict):
            li.addElement(rich_p(para_style, str(item.get("text", ""))))
            if item.get("items"):
                li.addElement(bullet_list(item["items"], para_style, list_style))
        else:
            li.addElement(rich_p(para_style, item))
        lst.addElement(li)
    return lst


def ensure_number_list_style(doc, name: str = "AB_Nummerierung", numbering: str = "1") -> str:
    """Nummerierte Liste 1. 2. 3. (Unterpunkte a) b) c)), erst bei Bedarf.
    `numbering` „a“: a) b) c), „i“: i. ii. iii. auf der ersten Ebene."""
    for ls in doc.styles.getElementsByType(ListStyle):
        if ls.getAttribute("name") == name:
            return name
    ls = ListStyle(name=name)
    first = {"a": ("a", ")"), "i": ("i", ".")}.get(numbering, ("1", "."))
    for level in range(1, 4):
        fmt, suffix = first if level == 1 else ("1", ".") if level != 2 else ("a", ")")
        num = ListLevelStyleNumber(level=str(level), numformat=fmt, numsuffix=suffix)
        props = ListLevelProperties()
        props.setAttribute("listlevelpositionandspacemode", "label-alignment")
        align = ListLevelLabelAlignment(labelfollowedby="listtab")
        align.setAttribute("listtabstopposition", f"{0.7 * level:.2f}cm")
        align.setAttribute("textindent", "-0.5cm")
        align.setAttribute("marginleft", f"{0.7 * level:.2f}cm")
        props.addElement(align)
        num.addElement(props)
        ls.addElement(num)
    doc.styles.addElement(ls)
    return name


def para_variant(ctx: dict[str, Any], base: str, block: dict[str, Any]) -> str:
    """Absatzvorlage wie `base` mit Einzug (`indent` in cm) und Zeilenabstand
    (`lineHeight` 1, 1.15, 1.5, 2) – ohne Angaben `base`."""
    indent = block.get("indent") if isinstance(block.get("indent"), int) and 1 <= block.get("indent") <= 6 else None
    lh = block.get("lineHeight") if block.get("lineHeight") in (1, 1.15, 1.5, 2) else None
    if not indent and not lh:
        return base
    name = f"AB_Abs_{indent or 0}_{str(lh or 0).replace('.', '_')}_{base}"
    if name not in ctx["present"]:
        props: dict[str, str] = {}
        if indent:
            props["marginleft"] = f"{indent}cm"
        if lh:
            props["lineheight"] = f"{round(lh * 100)}%"
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(ParagraphProperties(**props))
        ctx["doc"].automaticstyles.addElement(style)
        ctx["present"].add(name)
    return name


def ensure_align_style(doc, present: set[str], base: str, align: str) -> str:
    """Absatzvorlage wie `base`, aber zentriert, rechtsbündig oder im Blocksatz."""
    name = f"AB_{align.capitalize()}_{base}"
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(ParagraphProperties(textalign=align))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def ensure_box_styles(doc, present: set[str], shaded: bool) -> str:
    """Kasten: einzellige Tabelle mit Rahmen, auf Wunsch grau hinterlegt."""
    if "ABKasten" not in present:
        table = Style(name="ABKasten", family="table")
        table.addElement(TableProperties(width=f"{TABLE_WIDTH_CM}cm", margintop="0.2cm",
                                         marginbottom="0.2cm", align="margins"))
        col = Style(name="ABKasten.Sp", family="table-column")
        col.addElement(TableColumnProperties(columnwidth=f"{TABLE_WIDTH_CM}cm"))
        for style in (table, col):
            doc.automaticstyles.addElement(style)
            present.add(style.getAttribute("name"))
    name = "ABKasten.ZG" if shaded else "ABKasten.Z"
    if name not in present:
        cell = Style(name=name, family="table-cell")
        props = {"padding": "0.2cm", "border": "0.5pt solid #000000"}
        if shaded:
            props["backgroundcolor"] = "#eeeeee"
        cell.addElement(TableCellProperties(**props))
        doc.automaticstyles.addElement(cell)
        present.add(name)
    return name


def ensure_image_border_style(doc) -> Style:
    """Rahmenvorlage für umrandete Bilder (Style-Objekt für den Frame)."""
    style = getattr(doc, "bildrahmen", None)
    if style is None:
        style = Style(name="AB_Bild_Rahmen", family="graphic")
        style.addElement(GraphicProperties(border="0.5pt solid #000000", padding="0.05cm"))
        doc.automaticstyles.addElement(style)
        doc.bildrahmen = style
    return style


def ensure_float_styles(doc, present: set[str]) -> None:
    """Randlose Tabelle für Bild neben Text (float_group)."""
    if "ABNeben" in present:
        return
    table = Style(name="ABNeben", family="table")
    table.addElement(TableProperties(width=f"{TABLE_WIDTH_CM}cm", margintop="0.1cm",
                                     marginbottom="0.1cm", align="margins"))
    cell = Style(name="ABNeben.Z", family="table-cell")
    cell.addElement(TableCellProperties(padding="0cm", border="none", verticalalign="top"))
    for style in (table, cell):
        doc.automaticstyles.addElement(style)
        present.add(style.getAttribute("name"))


def float_group(image: dict[str, Any], texts: list[Any], styles: dict[str, str], ctx: dict[str, Any]) -> list[Element]:
    """Bild mit float: left/right samt den folgenden Text-, Listen- und
    Hinweisblöcken als zweispaltige, randlose Tabelle – so fließt der Text
    neben dem Bild, und nichts darunter kann es überdecken."""
    doc, present = ctx["doc"], ctx["present"]
    ensure_float_styles(doc, present)
    width = min(float(str(image.get("width", "6")).removesuffix("cm")), TABLE_WIDTH_CM - 4)
    gap = 0.4
    side = image.get("float")
    widths = [width + gap, TABLE_WIDTH_CM - width - gap]
    if side == "right":
        widths.reverse()
    index = ctx["float_index"] = ctx.get("float_index", 0) + 1
    table = Table(name=f"Neben{index}", stylename="ABNeben")
    for col, w in enumerate(widths):
        name = f"ABNeben.Sp{index}.{col}"
        style = Style(name=name, family="table-column")
        style.addElement(TableColumnProperties(columnwidth=f"{w:.3f}cm"))
        doc.automaticstyles.addElement(style)
        present.add(name)
        table.addElement(TableColumn(stylename=name))
    picture = TableCell(valuetype="string", stylename="ABNeben.Z")
    for el in render_block({k: v for k, v in image.items() if k != "float"}, styles, ctx):
        picture.addElement(el)
    text = TableCell(valuetype="string", stylename="ABNeben.Z")
    for el in render_blocks(texts, styles, ctx) or [P(stylename=styles["text"])]:
        text.addElement(el)
    tr = TableRow()
    for cell in ([picture, text] if side != "right" else [text, picture]):
        tr.addElement(cell)
    table.addElement(tr)
    return [table]


def columns_table(block: dict[str, Any], children, ctx: dict[str, Any]) -> Element:
    """Spalten (`type: columns`) nebeneinander: randlose Tabelle, je Spalte eine
    Zelle mit ihren Bausteinen. Feste Breiten aus `width`, der Rest teilt sich
    die Satzbreite; zwischen den Spalten 0,4 cm Luft."""
    doc, present = ctx["doc"], ctx["present"]
    ensure_float_styles(doc, present)
    cols = [c for c in block.get("blocks") or [] if isinstance(c, dict) and c.get("type") == "column"][:4] or [{"blocks": []}]
    gap = 0.4
    room = TABLE_WIDTH_CM - gap * (len(cols) - 1)
    fixed = [length_cm(c.get("width")) for c in cols]
    fixed_sum = sum(f for f in fixed if f)
    autos = sum(1 for f in fixed if not f)
    scale = min(1.0, (room - 2.0 * autos) / fixed_sum) if fixed_sum else 1.0
    rest = room - fixed_sum * scale
    widths = [(f * scale if f else rest / autos) for f in fixed]
    if not autos and rest > 0.05:   # alle fest und schmaler: Rest an die letzte Spalte
        widths[-1] += rest
    index = ctx["float_index"] = ctx.get("float_index", 0) + 1
    table = Table(name=f"Neben{index}", stylename="ABNeben")
    for col, w in enumerate(widths):
        name = f"ABNeben.Sp{index}.{col}"
        style = Style(name=name, family="table-column")
        style.addElement(TableColumnProperties(columnwidth=f"{w + (gap if col < len(widths) - 1 else 0):.3f}cm"))
        doc.automaticstyles.addElement(style)
        present.add(name)
        table.addElement(TableColumn(stylename=name))
    tr = TableRow()
    for c in cols:
        cell = TableCell(valuetype="string", stylename="ABNeben.Z")
        for el in children(c.get("blocks")) or [P(stylename="Standard")]:
            cell.addElement(el)
        tr.addElement(cell)
    table.addElement(tr)
    return table


def overlay_rows(elements: list[Element]) -> int:
    """Geschätzte Karozeilen (0,5 cm), die die eingeblendete Lösung braucht.

    Eine Zeile Lösungstext (9 pt) bzw. Quelltext (8,5 pt) ist gut 0,4 cm hoch,
    also etwa 0,8 Karozeilen. Lange Absätze werden anhand der Zeichenzahl
    umgebrochen (rund 100 Zeichen je Zeile bei 16,5 cm Breite).
    """
    rows = 0.0
    for el in elements:
        per_line = 95 if "Code" in str(el.getAttribute("stylename") or "") else 105
        # Gewollte Zeilenumbrüche (<text:line-break/>) zählen je für sich.
        for line in teletype.extractText(el).split("\n"):
            rows += max(1, -(-len(line) // per_line)) * 0.8
    return int(rows + 0.999)


def ensure_table_styles(doc, present: set[str]) -> None:
    """Schlichte Tabelle mit dünnen Linien für Übersichten im Text.

    Die Tabelle wird nicht über einen Seitenumbruch getrennt
    (`may-break-between-rows="false"`): Eine halb abgeschnittene Übersicht ist
    im Unterricht wertlos, und mit den berechneten Spaltenbreiten passt sie
    fast immer am Stück auf die Seite.
    """
    if "ABTabelle" in present:
        return
    border = "0.05pt solid #000000"
    # Ohne Linien (`border: false`), z. B. Abbildungen nebeneinander mit Unterschrift.
    plain = Style(name="ABTabelle.ZR", family="table-cell")
    plain.addElement(TableCellProperties(padding="0.1cm", border="none", verticalalign="bottom"))
    doc.automaticstyles.addElement(plain)
    present.add("ABTabelle.ZR")

    table = Style(name="ABTabelle", family="table")
    table.addElement(TableProperties(width=f"{TABLE_WIDTH_CM}cm", margintop="0.2cm",
                                     marginbottom="0.2cm", align="margins",
                                     maybreakbetweenrows="false"))
    cell = Style(name="ABTabelle.Z", family="table-cell")
    cell.addElement(TableCellProperties(padding="0.1cm", border=border))
    for style in (table, cell):
        doc.automaticstyles.addElement(style)
        present.add(style.getAttribute("name"))


# --------------------------------------------------------------------------
# Tabellenlayout: Spaltenbreiten aus dem Inhalt
# --------------------------------------------------------------------------
#
# Gleich breite Spalten verschenken Platz: Die Spalte mit "Cat 5e" ist dann
# genauso breit wie die mit einem ganzen Satz, der dafür über vier Zeilen
# umbricht. Der Renderer schätzt deshalb die Textbreite selbst und verteilt
# die 16,5 cm nach Bedarf.

# Zeichenbreiten von Arial in 1/1000 em. Arial ist metrikkompatibel zu
# Helvetica, deshalb sind es deren Werte. Nicht aufgeführte Zeichen zählen mit
# ARIAL_DEFAULT – das reicht für eine Schätzung, die nur auf ein paar Prozent
# genau sein muss.
ARIAL_WIDTH = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
    "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584,
    "?": 556, "@": 1015, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556,
    "`": 333, "{": 334, "|": 260, "}": 334, "~": 584,
    "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722,
    "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
    "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556,
    "h": 556, "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556,
    "o": 556, "p": 556, "q": 556, "r": 333, "s": 500, "t": 278, "u": 556,
    "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
    "ä": 556, "ö": 556, "ü": 556, "Ä": 667, "Ö": 778, "Ü": 722, "ß": 556,
    "–": 556, "—": 1000, "…": 1000, "„": 333, "“": 333, "”": 333, "·": 278,
}
ARIAL_DEFAULT = 556              # Ziffern und alles Unbekannte

# Arial Bold (Helvetica-Bold), ebenfalls in 1/1000 em. Ein pauschaler Zuschlag
# auf die normale Breite reicht nicht: Er trifft die Kopfzeile je nach Wort um
# ein paar Prozent zu knapp, und genau die entscheiden darüber, ob eine
# Überschrift wie "Schicht" noch in ihre Spalte passt oder umbricht.
ARIAL_BOLD_WIDTH = {
    " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722,
    "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, ":": 333, ";": 333, "<": 584, "=": 584, ">": 584,
    "?": 611, "@": 975, "[": 333, "\\": 278, "]": 333, "^": 584, "_": 556,
    "`": 333, "{": 389, "|": 280, "}": 389, "~": 584,
    "A": 722, "B": 722, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 556, "K": 722, "L": 611, "M": 833, "N": 722,
    "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
    "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
    "a": 556, "b": 611, "c": 556, "d": 611, "e": 556, "f": 333, "g": 611,
    "h": 611, "i": 278, "j": 278, "k": 556, "l": 278, "m": 889, "n": 611,
    "o": 611, "p": 611, "q": 611, "r": 389, "s": 556, "t": 333, "u": 611,
    "v": 556, "w": 778, "x": 556, "y": 556, "z": 500,
    "ä": 556, "ö": 611, "ü": 611, "Ä": 722, "Ö": 778, "Ü": 722, "ß": 611,
    "–": 556, "—": 1000, "…": 1000, "„": 500, "“": 500, "”": 500, "·": 278,
}
ARIAL_BOLD_DEFAULT = 611

PT_IN_CM = 0.0352778

TABLE_WIDTH_CM = 16.5            # nutzbare Textbreite der Vorlage
TABLE_PADDING_CM = 0.24          # Zellrand links und rechts plus Linien
# Reserve auf die Mindestbreite: Ohne sie bekommt eine schmale Spalte exakt die
# Breite ihres längsten Wortes. Jede Rundung in LibreOffice lässt das Wort dann
# umbrechen – die Spalte sieht zu schmal aus, obwohl sie rechnerisch passt.
TABLE_SAFETY_CM = 0.06
TABLE_SIZES_PT = (11, 10, 9)     # Schriftgröße der Vorlage, dann Ausweichgrößen
TABLE_MAX_LINES = 1.6            # mehr Umbruch je Zeile -> kleinere Schrift


def text_width_cm(text: str, size_pt: float, bold: bool = False) -> float:
    """Geschätzte Breite eines Textes in einer Zeile."""
    table, default = ((ARIAL_BOLD_WIDTH, ARIAL_BOLD_DEFAULT) if bold
                      else (ARIAL_WIDTH, ARIAL_DEFAULT))
    em = sum(table.get(c, default) for c in text) / 1000
    return em * size_pt * PT_IN_CM


def word_width_cm(text: str, size_pt: float, bold: bool = False) -> float:
    """Breite des längsten Wortes – schmaler darf eine Spalte nicht werden,
    sonst zerreißt LibreOffice das Wort oder schiebt die Tabelle über den Rand."""
    return max([text_width_cm(w, size_pt, bold) for w in text.split()] or [0.0])


def column_widths(columns: list[list[tuple[str, bool]]], size_pt: float) -> list[float] | None:
    """Spaltenbreiten nach dem üblichen Auto-Layout-Verfahren.

    Je Spalte werden zwei Werte gebildet: die Wunschbreite (längster Text in
    einer Zeile) und die Mindestbreite (längstes Wort). Passen alle
    Wunschbreiten nebeneinander, wird der Rest proportional verteilt; sonst
    bekommt jede Spalte ihre Mindestbreite und der verbleibende Platz wird nach
    dem Bedarf aufgeteilt. `None` heißt: Nicht einmal die Mindestbreiten passen,
    die Schrift ist zu groß.
    """
    wish, least = [], []
    for cells in columns:
        wish.append(max([text_width_cm(t, size_pt, b) for t, b in cells] or [0.0])
                    + TABLE_PADDING_CM + TABLE_SAFETY_CM)
        least.append(max([word_width_cm(t, size_pt, b) for t, b in cells] or [0.0])
                     + TABLE_PADDING_CM + TABLE_SAFETY_CM)
    if sum(least) > TABLE_WIDTH_CM:
        return None
    if sum(wish) <= TABLE_WIDTH_CM:
        rest = TABLE_WIDTH_CM - sum(wish)
        total = sum(wish) or 1.0
        return [w + rest * w / total for w in wish]
    free = TABLE_WIDTH_CM - sum(least)
    span = [max(w - m, 0.0) for w, m in zip(wish, least)]
    total = sum(span) or 1.0
    return [m + free * s / total for m, s in zip(least, span)]


def estimated_lines(rows: list[list[tuple[str, bool]]], widths: list[float],
                    size_pt: float) -> int:
    """Wie viele Textzeilen die Tabelle mit diesen Breiten ungefähr braucht."""
    total = 0
    for row in rows:
        high = 1
        for (text, bold), width in zip(row, widths):
            usable = max(width - TABLE_PADDING_CM, 0.1)
            high = max(high, math.ceil(text_width_cm(text, size_pt, bold) / usable))
        total += high
    return total


def table_layout(rows: list[list[tuple[str, bool]]]) -> tuple[float, list[float]]:
    """Schriftgröße und Spaltenbreiten für eine Tabelle wählen.

    Gerechnet wird zuerst mit der Schriftgröße der Vorlage. Bricht der Text
    dabei im Schnitt öfter als TABLE_MAX_LINES je Zeile um, wird die
    nächstkleinere Größe geprüft: Eine dichte Tabelle wird dadurch kompakt und
    übersichtlich, statt über eine halbe Seite zu laufen. Tabellen, die ohnehin
    passen, bleiben unverändert.
    """
    columns = [[row[i] for row in rows] for i in range(len(rows[0]))]
    fallback: tuple[float, list[float]] | None = None
    for size in TABLE_SIZES_PT:
        widths = column_widths(columns, size)
        if widths is None:
            continue
        fallback = fallback or (size, widths)
        if estimated_lines(rows, widths, size) <= len(rows) * TABLE_MAX_LINES:
            return size, widths
        fallback = (size, widths)
    if fallback is None:                      # extrem lange Wörter: gleich verteilen
        gleich = TABLE_WIDTH_CM / len(columns)
        return TABLE_SIZES_PT[-1], [gleich] * len(columns)
    return fallback


def ensure_table_size_style(doc, present: set[str], base: str, size_pt: float) -> str:
    """Absatzvorlage wie `base`, aber mit kleinerer Schrift für dichte Tabellen."""
    name = f"AB_Tab{str(size_pt).replace('.', '_')}_{base}"
    if name not in present:
        style = Style(name=name, family="paragraph", parentstylename=base)
        style.addElement(TextProperties(fontsize=f"{size_pt}pt"))
        doc.automaticstyles.addElement(style)
        present.add(name)
    return name


def content_table(block: dict[str, Any], styles: dict[str, str],
                  ctx: dict[str, Any]) -> Element:
    """Tabelle aus `header:` (optional) und `rows:`.

    Spaltenbreiten und Schriftgröße kommen aus table_layout(), richten sich
    also nach dem Inhalt.
    """
    index = ctx["table_index"]
    if any(isinstance(c, dict) for row in [block.get("header") or []] + list(block.get("rows") or []) for c in row):
        return spanned_table(block, styles, ctx)
    rows = [list(map(str, row)) for row in block.get("rows") or []]
    header = [str(c) for c in block.get("header") or []]
    columns = max([len(header)] + [len(r) for r in rows] or [1])

    def fill(cells: list[str], bold: bool) -> list[tuple[str, bool]]:
        return [(cells[c] if c < len(cells) else "", bold) for c in range(columns)]

    gemessen = ([fill(header, True)] if header else []) + [fill(r, False) for r in rows]
    size, widths = table_layout(gemessen or [[("", False)]])

    head_style, cell_style = styles["table_head"], styles["table_cell"]
    if size != TABLE_SIZES_PT[0]:
        head_style = ensure_table_size_style(ctx["doc"], ctx["present"], head_style, size)
        cell_style = ensure_table_size_style(ctx["doc"], ctx["present"], cell_style, size)

    cell_name, head_style, cell_style = plain_table_styles(block, ctx, head_style, cell_style)
    table, widths = table_with_columns(block, ctx, index, widths)

    def add_row(cells: list[str], style: str) -> None:
        tr = TableRow(**row_style(block, ctx, len(table.getElementsByType(TableRow))))
        for col in range(columns):
            tc = TableCell(valuetype="string", stylename=cell_name)
            tc.addElement(rich_p(style, cells[col] if col < len(cells) else ""))
            tr.addElement(tc)
        table.addElement(tr)

    if header:
        add_row(header, head_style)
    for row in rows:
        add_row(row, cell_style)
    return table


def spanned_table(block: dict[str, Any], styles: dict[str, str], ctx: dict[str, Any]) -> Element:
    """Tabelle mit verbundenen Zellen: Eine Zelle darf {text, colspan, rowspan}
    sein. Die Zeilen nennen nur die sichtbaren Zellen (wie in HTML); verdeckte
    Stellen ergänzt diese Funktion."""
    index = ctx["table_index"]
    def cell_of(c: Any) -> tuple[str, int, int]:
        if isinstance(c, dict):
            return (str(c.get("text", "")), max(1, int(c.get("colspan") or 1)), max(1, int(c.get("rowspan") or 1)))
        return (str(c), 1, 1)
    def images_of(c: Any) -> list[dict[str, Any]]:
        return [i for i in (c.get("images") or []) if isinstance(i, dict) and i.get("file")] if isinstance(c, dict) else []
    raw = ([list(block.get("header") or [])] if block.get("header") else []) + [list(row) for row in block.get("rows") or []]
    header = [cell_of(c) for c in block.get("header") or []]
    source = ([header] if header else []) + [[cell_of(c) for c in row] for row in block.get("rows") or []]
    # Raster: start[(r, c)] = (text, colspan, rowspan); covered = verdeckte Stellen
    start: dict[tuple[int, int], tuple[str, int, int]] = {}
    pictures: dict[tuple[int, int], list[dict[str, Any]]] = {}
    beside: set[tuple[int, int]] = set()   # Bilder neben dem Text (`beside: true`)
    inner_blocks: dict[tuple[int, int], list[Any]] = {}   # Bausteine in der Zelle (Tabelle in der Tabelle)
    cell_align: dict[tuple[int, int], str] = {}            # eigene Ausrichtung der Zelle
    cell_bg: dict[tuple[int, int], str] = {}               # Hintergrund der Zelle (#hex)
    covered: set[tuple[int, int]] = set()
    columns = 1
    for r, row in enumerate(source):
        c = 0
        for k, (text, cs, rs) in enumerate(row):
            while (r, c) in covered:
                c += 1
            start[(r, c)] = (text, cs, rs)
            if isinstance(raw[r][k], dict) and raw[r][k].get("background") in CELL_BACKGROUNDS:
                cell_bg[(r, c)] = CELL_BACKGROUNDS[raw[r][k]["background"]]
            if isinstance(raw[r][k], dict) and raw[r][k].get("align") in ("left", "center", "right"):
                cell_align[(r, c)] = raw[r][k]["align"]
            if isinstance(raw[r][k], dict) and isinstance(raw[r][k].get("blocks"), list) and raw[r][k]["blocks"]:
                inner_blocks[(r, c)] = raw[r][k]["blocks"]
            if images_of(raw[r][k]):
                pictures[(r, c)] = images_of(raw[r][k])
                if isinstance(raw[r][k], dict) and raw[r][k].get("beside"):
                    beside.add((r, c))
            for dr in range(rs):
                for dc in range(cs):
                    if dr or dc:
                        covered.add((r + dr, c + dc))
            c += cs
            columns = max(columns, c)
    nrows = max([r for r, _ in list(start) + list(covered)] + [len(source) - 1]) + 1
    gemessen = [[(start[(r, c)][0] if (r, c) in start and start[(r, c)][1] == 1 else "", bool(header) and r == 0)
                 for c in range(columns)] for r in range(nrows)]
    size, widths = table_layout(gemessen)
    widths = widths_for_pictures(widths, pictures, start, beside)
    head_style, cell_style = styles["table_head"], styles["table_cell"]
    if size != TABLE_SIZES_PT[0]:
        head_style = ensure_table_size_style(ctx["doc"], ctx["present"], head_style, size)
        cell_style = ensure_table_size_style(ctx["doc"], ctx["present"], cell_style, size)
    cell_name, head_style, cell_style = plain_table_styles(block, ctx, head_style, cell_style)
    table, widths = table_with_columns(block, ctx, index, widths)
    for r in range(nrows):
        tr = TableRow(**row_style(block, ctx, r))
        for c in range(columns):
            if (r, c) in start:
                text, cs, rs = start[(r, c)]
                attrs: dict[str, Any] = {}
                if cs > 1:
                    attrs["numbercolumnsspanned"] = cs
                if rs > 1:
                    attrs["numberrowsspanned"] = rs
                tc = TableCell(valuetype="string",
                               stylename=cell_with_background(ctx, cell_name, cell_bg[(r, c)]) if (r, c) in cell_bg else cell_name,
                               **attrs)
                style = head_style if header and r == 0 else cell_style
                own = cell_align.get((r, c))
                if own:
                    base = styles["table_head"] if header and r == 0 else styles["table_cell"]
                    style = base if own == "left" else ensure_align_style(ctx["doc"], ctx["present"], base, own)
                room = sum(widths[c:c + cs]) - TABLE_PADDING_CM
                if (r, c) in beside:
                    # Text und Bilder in einer Zeile, Bilder mittig zur Zeile.
                    para = rich_p(style, text)
                    for picture in pictures[(r, c)]:
                        ctx["image_index"] += 1
                        width = min(float(str(picture.get("width", "12")).removesuffix("cm")), max(room, 1.0))
                        para.addElement(S())
                        para.addElement(image_frame(ctx["doc"], {**picture, "width": f"{width:.2f}cm"}, ctx["search"],
                                                    ctx["image_index"], middle=True))
                    tc.addElement(para)
                    for el in render_blocks(inner_blocks.get((r, c)), styles, ctx):
                        tc.addElement(el)
                    tr.addElement(tc)
                    continue
                if text or ((r, c) not in pictures and (r, c) not in inner_blocks):
                    tc.addElement(rich_p(style, text))
                for picture in pictures.get((r, c), []):
                    ctx["image_index"] += 1
                    width = min(float(str(picture.get("width", "12")).removesuffix("cm")), max(room, 1.0))
                    para = P(stylename=style)
                    para.addElement(image_frame(ctx["doc"], {**picture, "width": f"{width:.2f}cm"}, ctx["search"], ctx["image_index"]))
                    tc.addElement(para)
                for el in render_blocks(inner_blocks.get((r, c)), styles, ctx):
                    tc.addElement(el)
                tr.addElement(tc)
            elif (r, c) in covered:
                tr.addElement(CoveredTableCell())
            else:
                tc = TableCell(valuetype="string", stylename=cell_name)
                tc.addElement(P(stylename=cell_style))
                tr.addElement(tc)
        table.addElement(tr)
    return table


def length_cm(value: Any) -> float | None:
    """„3.5cm“ (auch „35mm“) als Zahl in cm – sonst None (= automatisch)."""
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(cm|mm)\s*", str(value or ""))
    if not m:
        return None
    return float(m.group(1)) / (10 if m.group(2) == "mm" else 1)


def fixed_widths(widths: list[float], block: dict[str, Any]) -> tuple[list[float], float | None]:
    """Spaltenbreiten aus `widths:` übernehmen (cm; leer = automatisch).

    Automatische Spalten teilen sich den Rest der Satzbreite im Verhältnis der
    berechneten Breiten (je mindestens 1 cm). Sind alle Spalten fest, wird die
    Tabelle so breit wie ihre Summe (höchstens die Satzbreite) – die zweite
    Rückgabe ist dann diese Breite, sonst None.
    """
    wanted = list(block.get("widths") or [])
    fixed = [length_cm(wanted[i]) if i < len(wanted) else None for i in range(len(widths))]
    if not any(fixed):
        return widths, None
    auto = [i for i, f in enumerate(fixed) if f is None]
    fixed_sum = sum(f for f in fixed if f)
    room = TABLE_WIDTH_CM - 1.0 * len(auto)
    scale = min(1.0, room / fixed_sum) if fixed_sum else 1.0
    out = [(f * scale if f else 0.0) for f in fixed]
    if not auto:
        return out, sum(out)
    rest = TABLE_WIDTH_CM - sum(out)
    auto_sum = sum(widths[i] for i in auto) or 1.0
    for i in auto:
        out[i] = rest * widths[i] / auto_sum
    return out, None


def table_with_columns(block: dict[str, Any], ctx: dict[str, Any], index: int,
                       widths: list[float]) -> tuple[Element, list[float]]:
    """Tabelle samt Spalten; feste Breiten aus `widths:` (siehe fixed_widths)."""
    widths, total = fixed_widths(widths, block)
    style_name = "ABTabelle"
    if total is not None and total < TABLE_WIDTH_CM - 0.05:
        style_name = f"ABTabelle.B{index}"
        if style_name not in ctx["present"]:
            style = Style(name=style_name, family="table")
            style.addElement(TableProperties(width=f"{total:.3f}cm", margintop="0.2cm", marginbottom="0.2cm",
                                             align="left", maybreakbetweenrows="false"))
            ctx["doc"].automaticstyles.addElement(style)
            ctx["present"].add(style_name)
    table = Table(name=f"Tab{index}", stylename=style_name)
    for col, width in enumerate(widths):
        name = f"ABTabelle.Sp{index}.{col}"
        if name not in ctx["present"]:
            style = Style(name=name, family="table-column")
            style.addElement(TableColumnProperties(columnwidth=f"{width:.3f}cm"))
            ctx["doc"].automaticstyles.addElement(style)
            ctx["present"].add(name)
        table.addElement(TableColumn(stylename=name))
    return table, widths


def row_style(block: dict[str, Any], ctx: dict[str, Any], r: int) -> dict[str, Any]:
    """Mindesthöhe der Zeile r aus `heights:` (Kopfzeile zählt mit) – als Argumente für TableRow."""
    heights = list(block.get("heights") or [])
    h = length_cm(heights[r]) if r < len(heights) else None
    if not h:
        return {}
    name = f"ABTabelle.H{h:.2f}".replace(".", "_", 1)
    if name not in ctx["present"]:
        style = Style(name=name, family="table-row")
        style.addElement(TableRowProperties(minrowheight=f"{h:.2f}cm"))
        ctx["doc"].automaticstyles.addElement(style)
        ctx["present"].add(name)
    return {"stylename": name}


def plain_table_styles(block: dict[str, Any], ctx: dict[str, Any], head_style: str, cell_style: str) -> tuple[str, str, str]:
    """Zellvorlage und Absatzvorlagen einer Tabelle: mit `border: false` ohne
    Linien und – ohne eigene Ausrichtung – zentriert (Abbildungen nebeneinander).
    `align` (left, center, right) richtet alle Zellen aus."""
    doc, present = ctx["doc"], ctx["present"]
    align = block.get("align") if block.get("align") in ("left", "center", "right") else None
    plain = block.get("border") is False
    if plain and not align:
        align = "center"
    if align and align != "left":
        head_style = ensure_align_style(doc, present, head_style, align)
        cell_style = ensure_align_style(doc, present, cell_style, align)
    if plain:
        return "ABTabelle.ZR", head_style, cell_style
    return table_line_cell_style(block, ctx), head_style, cell_style


def cell_with_background(ctx: dict[str, Any], base: str, color: str) -> str:
    """Zellvorlage wie `base` (Linien, Innenabstand), dazu der Hintergrund `color`."""
    name = f"{base}.bg{color.lstrip('#')}"
    if name not in ctx["present"]:
        props: dict[str, str] = {}
        for root in (ctx["doc"].automaticstyles, ctx["doc"].styles):
            for st in root.getElementsByType(Style):
                if st.getAttribute("name") == base:
                    for child in st.childNodes:
                        if child.qname[1] == "table-cell-properties":
                            for (_ns, attr), value in child.attributes.items():
                                props[attr.replace("-", "")] = value
        props["backgroundcolor"] = color
        cell = Style(name=name, family="table-cell")
        cell.addElement(TableCellProperties(**props))
        ctx["doc"].automaticstyles.addElement(cell)
        ctx["present"].add(name)
    return name


def table_line_cell_style(block: dict[str, Any], ctx: dict[str, Any]) -> str:
    """Zellvorlage mit den Linien der Tabelle (`lineWidth` in pt, `lineStyle`
    solid/dashed/dotted) – ohne Angaben die gewohnte (ABTabelle.Z)."""
    width = block.get("lineWidth")
    style = block.get("lineStyle") if block.get("lineStyle") in ("solid", "dashed", "dotted") else None
    color = LINE_COLORS.get(block.get("lineColor"))
    if not isinstance(width, (int, float)) or not 0.25 <= width <= 6:
        width = None
    if width is None and style is None and color is None:
        return "ABTabelle.Z"
    width = width if width is not None else 0.75
    style = style or "solid"
    color = color or "#000000"
    name = f"ABTabelle.Z{str(width).replace('.', '_')}{style}{color.lstrip('#')}"
    if name not in ctx["present"]:
        cell = Style(name=name, family="table-cell")
        cell.addElement(TableCellProperties(padding="0.1cm", border=f"{width}pt {style} {color}"))
        ctx["doc"].automaticstyles.addElement(cell)
        ctx["present"].add(name)
    return name


def widths_for_pictures(widths: list[float], pictures: dict[tuple[int, int], list[dict[str, Any]]],
                        start: dict[tuple[int, int], tuple[str, int, int]],
                        beside: set[tuple[int, int]] = frozenset()) -> list[float]:
    """Spalten mit Bildern so breit wie ihr breitestes Bild (Zellen ohne Verbund),
    mindestens aber wie das längste Wort darin; bei Bildern neben dem Text
    (`beside`) Text und Bilder zusammen. Höchstens die Satzbreite; die übrigen
    Spalten teilen sich den Rest."""
    def cm(picture: dict[str, Any]) -> float:
        try:
            return float(str(picture.get("width", "0")).removesuffix("cm"))
        except ValueError:
            return 0.0
    size = TABLE_SIZES_PT[0]
    need = [0.0] * len(widths)
    for (r, c), items in pictures.items():
        text, cs, _rs = start[(r, c)]
        if cs != 1:
            continue
        words = max((text_width_cm(w, size, False) for w in text.split()), default=0.0)
        if (r, c) in beside:
            wanted = text_width_cm(text, size, False) + sum(cm(p) + 0.2 for p in items)
        else:
            wanted = max([words] + [cm(p) for p in items])
        need[c] = max(need[c], wanted + TABLE_PADDING_CM)
    if not any(need):
        return widths
    wanted = sum(need)
    if wanted >= TABLE_WIDTH_CM:          # Bilder breiter als die Seite: anteilig stauchen
        return [n * TABLE_WIDTH_CM / wanted if n else 0.8 for n in need]
    rest = TABLE_WIDTH_CM - wanted
    text_cols = [i for i, n in enumerate(need) if not n]
    if not text_cols:                     # nur Bildspalten: den Rest anteilig dazugeben
        return [n + rest * n / wanted for n in need]
    share = sum(widths[i] for i in text_cols) or len(text_cols)
    return [n if n else rest * (widths[i] or 1) / share for i, n in enumerate(need)]


def render_blocks(blocks: Any, styles: dict[str, str], ctx: dict[str, Any]) -> list[Element]:
    """Rendert eine Blockliste.

    Im Lösungsblatt wird jeder `solution`-Block dem davorstehenden `karo`-Block
    als Overlay zugeordnet: Die Lösung erscheint dann in roter Schrift über dem
    Karoraster statt darunter. Lösungen ohne vorangehendes Karo bleiben an
    ihrem Platz.
    """
    blocks = list(blocks or [])
    # Ohne Karoraster (Skript) gibt es nichts zu überlagern: Dort bleiben die
    # Lösungen an ihrem Platz und werden dort sichtbar gerendert.
    if ctx.get("mode") == "loesung" and "karo" not in ctx.get("skip", ()):
        karo_at: int | None = None
        for i, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "karo":
                karo_at = i
            elif kind == "solution" and karo_at is not None:
                ctx["in_overlay"] = True
                ctx["solution"] = True
                overlay = [P(stylename=styles["overlay_text"], text=block.get("title", "Lösung:"))]
                if block.get("text"):
                    overlay.extend(
                        render_block({"type": "text", "text": block["text"]}, styles, ctx)
                    )
                for sub in block.get("blocks") or []:
                    overlay.extend(render_block(sub, styles, ctx))
                ctx["solution"] = False
                ctx["in_overlay"] = False
                needed = overlay_rows(overlay)
                have = int(blocks[karo_at].get("lines", 4))
                if needed <= KARO_MAX_ROWS:
                    # Raster ggf. vergrößern, damit die Lösung darüber passt.
                    blocks[karo_at] = dict(blocks[karo_at],
                                           lines=max(have, needed), _overlay=overlay)
                    blocks[i] = None
                else:
                    # Zu lang zum Überlagern: Lösung bleibt stehen und wird
                    # sichtbar unter dem Raster ausgegeben.
                    ctx.setdefault("below", []).append(needed)
                karo_at = None

    result: list[Element] = []
    vorheriger = None
    i = 0
    while i < len(blocks):
        block = blocks[i]
        i += 1
        if block is None:
            continue
        if isinstance(block, dict) and block.get("type") == "image" and block.get("float") in ("left", "right"):
            texts = []
            while i < len(blocks) and (isinstance(blocks[i], str) or (isinstance(blocks[i], dict)
                                       and blocks[i].get("type", "text") in ("text", "list", "note"))):
                texts.append(blocks[i])
                i += 1
            if texts:
                result.extend(float_group(block, texts, styles, ctx))
                vorheriger = "image"
                continue
        # Der Vorgängertyp entscheidet z. B. über den Abstand nach einer Aufzählung.
        ctx["prev_kind"] = vorheriger
        result.extend(render_block(block, styles, ctx))
        vorheriger = block.get("type", "text") if isinstance(block, dict) else "text"
    ctx["prev_kind"] = None
    return result


def keep_karo_with_question(elements: list[Element], doc, present: set[str]) -> None:
    """Aufgabentext und sein Karoraster nicht über zwei Seiten trennen.

    Das Raster selbst wird nie zerrissen (`may-break-between-rows`). Damit es
    aber nicht allein auf die nächste Seite rutscht, während die Frage auf der
    vorigen stehen bleibt, bekommen die Absätze davor `keep-with-next`.
    """
    def kwn(name: str) -> str:
        """Klon der Absatzvorlage `name`, der den Umbruch nach sich verbietet."""
        klon = f"{name}_MitFolgendem"
        if klon not in present:
            style = Style(name=klon, family="paragraph", parentstylename=name)
            style.addElement(ParagraphProperties(keepwithnext="always"))
            doc.automaticstyles.addElement(style)
            present.add(klon)
        return klon

    for i, el in enumerate(elements):
        if el.qname[1] != "table" or not str(el.getAttribute("name") or "").startswith("Karo"):
            continue
        # Rückwärts über Überschrift und Fragetext, aber nicht über Bilder,
        # Tabellen oder ein vorangehendes Raster hinweg.
        for j in range(i - 1, max(i - 4, -1), -1):
            vor = elements[j]
            if vor.qname[1] not in ("p", "h") or vor.hasChildNodes() is False:
                break
            name = str(vor.getAttribute("stylename") or "")
            if not name or name.endswith("_MitFolgendem"):
                break
            vor.setAttribute("stylename", kwn(name))


def ensure_ink_styles(doc, present: set[str]) -> Style:
    """Anker für Beschriftungen: ein winziger Absatz (bleibt beim folgenden
    Baustein) und ein Rahmen ohne Rand, den der Text nicht umfließt. Gibt die
    Rahmenvorlage zurück (odfpy will für draw:frame das Style-Element)."""
    if "AB_Stift" in present:
        return doc.stiftrahmen
    para = Style(name="AB_Stift", family="paragraph")
    para.addElement(ParagraphProperties(margintop="0cm", marginbottom="0cm", lineheight="0.02cm",
                                        keepwithnext="always"))
    para.addElement(TextProperties(fontsize="1pt"))
    frame = Style(name="AB_StiftRahmen", family="graphic")
    frame.addElement(GraphicProperties(wrap="run-through", runthrough="foreground",
                                       verticalpos="from-top", verticalrel="paragraph",
                                       horizontalpos="from-left", horizontalrel="paragraph",
                                       flowwithtext="false", padding="0cm", border="none",
                                       marginleft="0cm", marginright="0cm", margintop="0cm", marginbottom="0cm",
                                       stroke="none", fill="none"))
    # Bei den festen Vorlagen: Automatische, die nur als Eltern einer anderen
    # (…_MitFolgendem) vorkommen, ließe odfpy beim Speichern weg.
    doc.styles.addElement(para)
    doc.automaticstyles.addElement(frame)
    present.update({"AB_Stift", "AB_StiftRahmen"})
    doc.stiftrahmen = frame
    return frame


def top_margin_cm(element: Element, doc) -> float:
    """Oberer Abstand (fo:margin-top) eines Absatzes bzw. einer Tabelle aus seiner
    Vorlage samt Eltern – in der Ansicht zählt er nicht zum Baustein."""
    name = element.getAttribute("stylename") if element.qname[1] in ("p", "h", "table") else None
    styles = {}
    for root in (doc.styles, doc.automaticstyles):
        for st in root.getElementsByType(Style):
            styles.setdefault(st.getAttribute("name"), st)
    for _ in range(8):
        st = styles.get(name) if name else None
        if st is None:
            return 0.0
        for props in st.childNodes:
            value = props.getAttribute("margintop") if props.qname[1] in ("paragraph-properties", "table-properties") else None
            if value:
                m = re.fullmatch(r"([\d.]+)(cm|mm|in|pt)", value)
                return float(m.group(1)) * {"cm": 1, "mm": 0.1, "in": 2.54, "pt": 2.54 / 72}[m.group(2)] if m else 0.0
        name = st.getAttribute("parentstylename")
    return 0.0


def ink_anchor(ink: dict[str, Any], ctx: dict[str, Any], shift: float = 0.0) -> Element | None:
    """Beschriftung aus dem Stift-Editor (`ink`: file, x, y, width, height in cm;
    x ab dem Satzspiegel, y ab der Oberkante des Bausteins) als Rahmen an einem
    Absatz direkt vor dem Baustein."""
    try:
        path = resolve_path(ink["file"], ctx["search"])
        x, y, w, h = (float(ink[k]) for k in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError, FileNotFoundError, SystemExit):
        return None
    doc, present = ctx["doc"], ctx["present"]
    frame_style = ensure_ink_styles(doc, present)
    ctx["ink_index"] = ctx.get("ink_index", 0) + 1
    frame = Frame(name=f"Stift{ctx['ink_index']}", stylename=frame_style, anchortype="paragraph",
                  x=f"{x:.3f}cm", y=f"{y + shift:.3f}cm", width=f"{max(w, 0.05):.3f}cm", height=f"{max(h, 0.05):.3f}cm",
                  zindex=str(100 + ctx["ink_index"]))
    frame.addElement(Image(href=doc.addPicture(str(path))))
    para = P(stylename="AB_Stift")
    para.addElement(frame)
    return para


def render_block(block: Any, styles: dict[str, str], ctx: dict[str, Any]) -> list[Element]:
    """Ein Baustein – mit Beschriftung aus dem Stift-Editor (`ink`) darüber gelegt."""
    out = render_block_content(block, styles, ctx)
    if isinstance(block, dict) and isinstance(block.get("ink"), dict) and out and not ctx.get("in_overlay"):
        anchor = ink_anchor(block["ink"], ctx, top_margin_cm(out[0], ctx["doc"]))
        if anchor is not None:
            out = [anchor, *out]
    return out


def render_block_content(block: Any, styles: dict[str, str], ctx: dict[str, Any]) -> list[Element]:
    """Ein Spec-Block -> Liste von ODF-Elementen.

    `ctx["solution"]` steuert, ob mit den ausgeblendeten Lösungs-Formatvorlagen
    gerendert wird; `ctx["list_style"]` hält den Namen der Aufzählungsliste.
    """
    if isinstance(block, str):
        block = {"type": "text", "text": block}
    if not isinstance(block, dict):
        raise ValueError(f"Unbekannter Block: {block!r}")

    in_solution = ctx.get("solution", False)
    if in_solution:
        # Lösungsblatt: sichtbar rot (im Rahmen über den Karos oder darunter).
        # Arbeitsblatt: ausgeblendet an Ort und Stelle.
        visible = ctx.get("mode") == "loesung"
        text_style = styles["overlay_text"] if visible else styles["solution_text"]
        code_style = styles["overlay_code"] if visible else styles["solution_code"]
    else:
        text_style = styles["text"]
        code_style = styles["code"]

    kind = block.get("type", "text")
    out: list[Element] = []

    # Das Skript kennt kein Karopapier zum Eintragen (ctx["skip"]).
    if kind in ctx.get("skip", ()):
        return out

    def children(blocks) -> list[Element]:
        return render_blocks(blocks, styles, ctx)

    if kind in ("section", "task", "subtask"):
        # Im Skript rutschen die Überschriften eine Ebene tiefer, weil
        # Ebene 1 das Thema des Arbeitsblatts ist (ctx["level_shift"]).
        heading = H(outlinelevel=OUTLINE_LEVEL[kind] + ctx.get("level_shift", 0),
                    stylename=styles[kind])
        add_rich_text(heading, str(block["title"] if "title" in block else block["text"]))
        out.append(heading)
        if block.get("text") and "title" in block:
            out.extend(render_block({"type": "text", "text": block["text"]}, styles, ctx))
        out.extend(children(block.get("blocks")))

    elif kind == "heading":
        # Überschrift ohne Nummer: gleiche Vorlage wie section/task/subtask,
        # aber als Listenkopf – die Gliederungsnummer zählt nicht mit.
        level = min(3, max(1, int(block.get("level", 1))))
        heading = H(outlinelevel=level + ctx.get("level_shift", 0),
                    stylename=styles[("section", "task", "subtask")[level - 1]], islistheader="true")
        add_rich_text(heading, str(block.get("text", block.get("title", ""))))
        out.append(heading)

    elif kind == "box":
        index = ctx["box_index"] = ctx.get("box_index", 0) + 1
        cell_style = ensure_box_styles(ctx["doc"], ctx["present"], bool(block.get("shaded")))
        table = Table(name=f"Kasten{index}", stylename="ABKasten")
        table.addElement(TableColumn(stylename="ABKasten.Sp"))
        tr = TableRow()
        tc = TableCell(valuetype="string", stylename=cell_style)
        if block.get("title"):
            tc.addElement(rich_p(text_style, f"**{block['title']}**"))
        inner = children(block.get("blocks"))
        if block.get("text"):
            inner = render_block({"type": "text", "text": block["text"]}, styles, ctx) + inner
        for el in inner or [P(stylename=text_style)]:
            tc.addElement(el)
        tr.addElement(tc)
        table.addElement(tr)
        out.append(table)

    elif kind == "columns":
        out.append(columns_table(block, children, ctx))

    elif kind == "text":
        # Direkt hinter einer Aufzählung etwas Luft, damit der Absatz sich
        # sichtbar von den Punkten absetzt.
        if block.get("align") in ("center", "right", "justify"):
            text_style = ensure_align_style(ctx["doc"], ctx["present"], text_style, block["align"])
        text_style = para_variant(ctx, text_style, block)
        erster_style = (abstand_style(ctx, text_style)
                        if ctx.get("prev_kind") == "list" else text_style)
        for i, para in enumerate(str(block["text"]).split("\n\n")):
            out.append(rich_p(erster_style if i == 0 else text_style, para.strip()))

    elif kind == "code":
        if block.get("caption"):
            p = P(stylename=keep_style(ctx, text_style))
            p.addElement(rich_span(styles["emphasis"], block["caption"]))
            out.append(p)
        out.extend(code_paragraphs(read_code(block, ctx["search"]), code_style))

    elif kind == "list":
        numbering = block.get("numbering") if block.get("numbering") in ("a", "i") else None
        marker = LIST_MARKERS.get(block.get("marker"))
        if block.get("ordered"):
            style = ensure_number_list_style(ctx["doc"], f"AB_Nummerierung_{numbering}", numbering) if numbering \
                else ensure_number_list_style(ctx["doc"])
        else:
            style = ensure_bullet_list_style(ctx["doc"], f"AB_Aufzaehlung_{block['marker']}", marker) if marker \
                else ctx["list_style"]
        out.append(bullet_list(block["items"], para_variant(ctx, text_style, block), style))

    elif kind == "note":
        p = P(stylename=text_style)
        p.addElement(rich_span(styles["emphasis"], block["text"]))
        out.append(p)

    elif kind == "solution":
        # Alles innerhalb dieses Blocks wird mit "Lösung"-Vorlagen gerendert
        # (rot, im Dokument vorhanden, aber ausgeblendet).
        ctx["solution"] = True
        label_style = (styles["overlay_text"] if ctx.get("mode") == "loesung"
                       else styles["solution_text"])
        label = block.get("title", "Lösung:")
        out.append(rich_p(label_style, label))
        if block.get("text"):
            out.extend(render_block({"type": "text", "text": block["text"]}, styles, ctx))
        out.extend(children(block.get("blocks")))
        ctx["solution"] = in_solution

    elif kind == "image":
        ctx["image_index"] += 1
        # Bild und Unterschrift bleiben zusammen auf einer Seite
        para_style = text_style
        if block.get("float") == "center":
            para_style = ensure_align_style(ctx["doc"], ctx["present"], text_style, "center")
        para = P(stylename=keep_style(ctx, para_style) if block.get("caption") else para_style)
        para.addElement(image_frame(ctx["doc"], block, ctx["search"], ctx["image_index"]))
        out.append(para)
        if block.get("caption"):
            cap = P(stylename=text_style)
            cap.addElement(rich_span(styles["caption"], block["caption"]))
            out.append(cap)

    elif kind == "formula":
        # Freistehende Formel als Formeleditor-Objekt. Im Lösungsrahmen über
        # dem Karoraster stellt LibreOffice keine Objekte dar – dort tritt der
        # Fließtext an seine Stelle.
        math_text = str(block.get("math") or "")
        fallback = str(block.get("text") or starmath_as_text(math_text))
        if ctx.get("in_overlay"):
            out.append(rich_p(text_style, fallback))
        else:
            if in_solution and ctx.get("mode") == "loesung":
                math_text = f"color red {{{math_text}}}"
            stil = text_style
            if block.get("align", "center") == "center":
                stil = ensure_center_style(ctx["doc"], ctx["present"], text_style)
            para = P(stylename=stil)
            para.addElement(formula_frame(ctx, math_text))
            out.append(para)

    elif kind == "table":
        ctx["table_index"] += 1
        if block.get("caption"):
            cap = P(stylename=keep_style(ctx, text_style))
            cap.addElement(rich_span(styles["emphasis"], block["caption"]))
            out.append(cap)
        out.append(content_table(block, styles, ctx))

    elif kind == "karo":
        ctx["karo_index"] += 1
        out.append(
            karo_table(
                int(block.get("lines", 4)),
                styles["karo"],
                ctx["karo_index"],
                overlay=block.get("_overlay"),
                frame_style=ctx.get("frame_style"),
                columns=karo_columns(block),
                pattern=str(block.get("pattern") or "karo"),
                ctx=ctx,
            )
        )

    elif kind == "spacer":
        for _ in range(int(block.get("lines", 3))):
            out.append(P(stylename=text_style, text=""))

    elif kind == "pagebreak":
        out.append(P(stylename=ctx["pagebreak_style"], text=""))

    elif kind == "quiz":
        # Quiz aus LearningModules: Die App setzt vor dem Druck QR-Code und
        # Adresse ein. Hier (Kurs-Projekt) bleibt nur ein Hinweis.
        p = P(stylename=text_style)
        p.addElement(rich_span(styles["emphasis"], f"[Quiz: {block.get('title') or 'Quiz'} – online in LearningModules]"))
        out.append(p)

    else:
        raise ValueError(f"Unbekannter Blocktyp: {kind!r}")

    return out


def read_code(block: dict[str, Any], search: list[Path]) -> str:
    """Code inline aus `code:` oder aus einer Datei unter `file:`.

    Dateipfade werden relativ zum Ordner der Spec, dann zum Kursordner und
    zuletzt zur Repo-Wurzel gesucht.
    """
    if "file" in block:
        path = resolve_path(block["file"], search)
        text = path.read_text(encoding="utf-8")
        lines = text.split("\n")
        start = block.get("from_line")
        end = block.get("to_line")
        if start or end:
            text = "\n".join(lines[(start - 1 if start else 0):(end if end else len(lines))])
        return text
    return str(block["code"])


# --------------------------------------------------------------------------
# Zusammenbau
# --------------------------------------------------------------------------

def insert_content(doc, spec: dict[str, Any], styles: dict[str, str], mode: str,
                   search: list[Path]) -> None:
    """Ersetzt den {{INHALT}}-Absatz durch die gerenderten Blöcke."""
    anchor = None
    for el in doc.text.getElementsByType(P) + doc.text.getElementsByType(H):
        if CONTENT_TOKEN in teletype.extractText(el):
            anchor = el
            break

    present = existing_styles(doc)
    ensure_karo_styles(doc, present)
    ensure_subscript_style(doc, present)
    ensure_table_styles(doc, present)
    frame_style = ensure_overlay_styles(doc, present)
    set_inline_context(doc, present, styles)
    ctx: dict[str, Any] = {
        "doc": doc,
        "mode": mode,
        "search": search,
        "image_index": 0,
        "table_index": 0,
        "frame_style": frame_style,
        "solution": False,
        "in_overlay": False,
        "karo_index": 0,
        "list_style": ensure_bullet_list_style(doc),
        "pagebreak_style": ensure_pagebreak_style(doc, present),
        "present": present,
    }
    elements = render_blocks(spec.get("content"), styles, ctx)
    keep_karo_with_question(elements, doc, present)
    if below := ctx.get("below"):
        print(f"  · {len(below)} lange Lösung(en) unter statt über dem Raster", file=sys.stderr)

    if anchor is None:
        print(
            f"  ! Kein {{{{{CONTENT_TOKEN}}}}}-Platzhalter in der Vorlage – "
            "Inhalt wird am Dokumentende angehängt",
            file=sys.stderr,
        )
        for el in elements:
            doc.text.addElement(el)
        return

    parent = anchor.parentNode
    for el in elements:
        parent.insertBefore(el, anchor)
    parent.removeChild(anchor)


def as_document(doc, spec: dict[str, Any], mode: str = "arbeitsblatt") -> None:
    """Setzt Mimetype und Dokumenttitel für ein normales Textdokument.

    Beim Laden einer .ott bleibt der Mimetype "…text-template" erhalten. Eine so
    gespeicherte Datei behandelt LibreOffice weiterhin als Vorlage: Beim Öffnen
    entsteht eine neue, unbenannte Kopie ("Unbenannt 2") statt der Datei selbst.
    """
    doc.mimetype = TEXT_MIMETYPE

    # Titel in den Dokumenteigenschaften (Datei → Eigenschaften).
    titel = (spec.get("meta") or {}).get("TITEL")
    if titel and mode == "loesung":
        titel = f"{titel} – Lösungen"
    if titel:
        for existing in doc.meta.getElementsByType(Title):
            doc.meta.removeChild(existing)
        doc.meta.addElement(Title(text=str(titel)))


def manifest_with_objects(manifest: bytes, anzahl: int) -> bytes:
    """Trägt die Formelordner "Object n" in das Manifest ein."""
    eintraege = "".join(
        f'<manifest:file-entry manifest:full-path="Object {i}/" '
        f'manifest:media-type="{MATH_MIMETYPE}"/>'
        f'<manifest:file-entry manifest:full-path="Object {i}/content.xml" '
        f'manifest:media-type="text/xml"/>'
        for i in range(1, anzahl + 1)
    )
    return manifest.replace(b"</manifest:manifest>",
                            eintraege.encode("utf-8") + b"</manifest:manifest>")


def fix_mimetype(path: Path, formeln: list[str] | None = None) -> None:
    """Schreibt das gespeicherte Archiv einmal neu.

    Zwei Dinge fehlen odfpy: Der Vorlagen-Mimetype bleibt beim Speichern einer
    geladenen .ott im Manifest stehen (LibreOffice öffnet die Datei dann als
    Vorlage), und die eingebetteten Formeldokumente müssen als eigene Ordner
    "Object n" mit Manifesteintrag hinein. Der Eintrag "mimetype" muss dabei
    als erster und unkomprimiert im ZIP stehen.
    """
    formeln = formeln or []
    with zipfile.ZipFile(path) as zin:
        items = [(info.filename, zin.read(info.filename)) for info in zin.infolist()]

    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in sorted(items, key=lambda i: i[0] != "mimetype"):
            if name == "mimetype":
                data = TEXT_MIMETYPE.encode("ascii")
            elif name == "META-INF/manifest.xml":
                data = data.replace(TEMPLATE_MIMETYPE.encode(), TEXT_MIMETYPE.encode())
                data = manifest_with_objects(data, len(formeln))
            compress = zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
            zout.writestr(name, data, compress_type=compress)
        for i, formel in enumerate(formeln, start=1):
            zout.writestr(f"Object {i}/content.xml",
                          MATH_CONTENT.format(formel=escape(formel)))
    shutil.move(tmp, path)


COURSE_FILE = "kurs.yaml"


def load_course(spec_path: Path) -> tuple[dict[str, Any], Path]:
    """Nächstgelegene kurs.yaml oberhalb der Spec suchen.

    Gibt die Kurskonfiguration und das Kursverzeichnis zurück. Ohne kurs.yaml
    gilt das Verzeichnis der Spec als Kurs (Einzelblatt ohne Kurs).
    """
    for folder in spec_path.resolve().parents:
        candidate = folder / COURSE_FILE
        if candidate.exists():
            return yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}, folder
        if folder == ROOT:
            break
    return {}, spec_path.resolve().parent


def merge_spec(spec: dict[str, Any], course: dict[str, Any]) -> dict[str, Any]:
    """Kurswerte als Vorgabe unter die Spec legen; die Spec gewinnt.

    Der Titel entsteht aus dem `titelmuster` des Kurses, sofern die Spec nicht
    ausdrücklich `meta.TITEL` setzt.
    """
    merged = dict(course)
    merged.update(spec)

    meta = dict(course.get("meta") or {})
    meta.update(spec.get("meta") or {})
    if "TITEL" not in meta:
        muster = merged.get("titelmuster", "{titel}")
        meta["TITEL"] = muster.format(
            kurs=merged.get("kurs", ""),
            nummer=merged.get("nummer", ""),
            titel=merged.get("titel", ""),
        ).strip()
    merged["meta"] = meta
    return merged


def resolve_path(name: str, search: list[Path]) -> Path:
    """Datei in Spec-, Kurs- und Projektverzeichnis suchen (in dieser Reihenfolge).

    Der letzte Eintrag von `search` ist die Wurzel: Nichts außerhalb davon wird
    gelesen – im Renderer-Dienst das Temp-Verzeichnis des Auftrags.
    """
    candidate = Path(name)
    root = search[-1].resolve()
    for base in search:
        path = (base / candidate).resolve()
        if path.exists():
            if not path.is_relative_to(root):
                raise ValueError(f"Pfad liegt außerhalb des Projekts: {name}")
            return path
    raise SystemExit(f"Datei nicht gefunden: {name} (gesucht in {', '.join(map(str, search))})")


def convert_to_pdf(paths: list[Path]) -> None:
    """Alle erzeugten Dokumente in einem einzigen soffice-Aufruf nach PDF.

    Einzelaufrufe je Datei sind unzuverlässig: Läuft bereits eine
    LibreOffice-Instanz, delegiert der zweite Aufruf an sie und kehrt zurück,
    ohne konvertiert zu haben – ohne Fehlercode.
    """
    if not paths:
        return
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        print("  ! soffice nicht gefunden – PDF übersprungen", file=sys.stderr)
        return

    # Eigenes Profil (Renderer-Dienst: eines je Arbeitsplatz), damit parallele
    # Aufträge nicht an dieselbe LibreOffice-Instanz delegiert werden.
    profile = os.environ.get("SOFFICE_PROFILE")
    extra = [f"-env:UserInstallation={Path(profile).resolve().as_uri()}"] if profile else []
    for out_dir in sorted({p.parent for p in paths}):
        group = [p for p in paths if p.parent == out_dir]
        subprocess.run(
            [soffice, *extra, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir),
             *map(str, group)],
            check=True, stdout=subprocess.DEVNULL,
        )
    missing = [p for p in paths if not p.with_suffix(".pdf").exists()]
    for path in missing:
        print(f"  ! PDF nicht erzeugt: {rel(path.with_suffix('.pdf'))}", file=sys.stderr)
    print(f"  ✓ {len(paths) - len(missing)} PDF(s)")


def find_template(name: str) -> Path:
    """Vorlage im Projekt suchen, sonst beim Generator (Grundvorlage)."""
    for base in (ROOT, GEN):
        path = base / name
        if path.exists():
            return path
    raise SystemExit(f"Vorlage nicht gefunden: {name} (gesucht in {ROOT} und {GEN})")


def rel(path: Path) -> str:
    """Pfad relativ zum Projekt, falls möglich."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def build(spec_path: Path, out_dir: Path | None, template_override: Path | None,
          mode: str = "arbeitsblatt") -> Path:
    course, course_dir = load_course(spec_path)
    spec = merge_spec(yaml.safe_load(spec_path.read_text(encoding="utf-8")) or {}, course)

    # Dateiverweise: erst neben der Spec, dann im Kurs, zuletzt ab Projektwurzel.
    search = [spec_path.resolve().parent, course_dir, ROOT]

    template = template_override or find_template(spec.get("template", DEFAULT_TEMPLATE))
    if not template.exists():
        raise SystemExit(f"Vorlage nicht gefunden: {template}")

    label = spec.get("slug") or spec_path.resolve().parent.name
    print(f"→ {label}  ({mode}, Vorlage: {template.name})")
    doc = load(str(template))
    as_document(doc, spec, mode)
    styles = resolve_styles(doc, spec)

    meta = {k: str(v) for k, v in (spec.get("meta") or {}).items()}
    if mode == "loesung" and meta.get("TITEL"):
        meta["TITEL"] = meta["TITEL"] + " – Lösungen"
    for el in iter_text_elements(doc):
        replace_in_element(el, meta)

    insert_content(doc, spec, styles, mode, search)

    left = unresolved_placeholders(doc)
    if left:
        print(f"  ! Nicht gefüllte Platzhalter: {', '.join(left)}", file=sys.stderr)

    # Ohne -o landet jeder Kurs in seinem eigenen Unterordner von build/.
    target = out_dir or (ROOT / "build" / str(spec.get("kuerzel", "")))
    target.mkdir(parents=True, exist_ok=True)
    suffix = "_Lösung" if mode == "loesung" else ""
    out_path = target / f"{label}{suffix}.odt"
    doc.save(str(out_path))
    fix_mimetype(out_path, getattr(doc, "formeln", []))
    print(f"  ✓ {rel(out_path)}")

    return out_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("specs", nargs="+", type=Path, help="Spec-Dateien (YAML)")
    ap.add_argument("-o", "--out", type=Path, default=None,
                    help="Ausgabeverzeichnis (Standard: build/<kuerzel>/)")
    ap.add_argument("-t", "--template", type=Path, help="Vorlage überschreiben (.ott)")
    ap.add_argument("--pdf", action="store_true", help="zusätzlich PDF erzeugen")
    ap.add_argument("--loesung", action="store_true",
                    help="zusätzlich ein Lösungsblatt (…_Lösung.odt) erzeugen")
    ap.add_argument("--nur-loesung", action="store_true", dest="nur_loesung",
                    help="nur das Lösungsblatt erzeugen")
    args = ap.parse_args()

    created: list[Path] = []
    for spec_path in args.specs:
        if not args.nur_loesung:
            created.append(build(spec_path, args.out, args.template))
        if args.loesung or args.nur_loesung:
            created.append(build(spec_path, args.out, args.template, mode="loesung"))

    if args.pdf:
        convert_to_pdf(created)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
