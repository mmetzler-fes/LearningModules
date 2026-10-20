#!/usr/bin/env python3
"""Erzeugt aus der Original-Schulvorlage eine Renderer-Vorlage mit Platzhaltern.

    python3 tools/prepare_template.py templates/AB_Vorlage3.ott templates/AB_Vorlage3.vorbereitet.ott

Was geändert wird, steht in einer Patch-Datei neben der Vorlage
(z. B. templates/AB_Vorlage3.patch.yaml): Platzhalter `{{TITEL}}` in der
Kopfzeile, Ankerabsatz `{{INHALT}}` im Textkörper, Aufräumarbeiten. Dabei
wirft `entfernen:` Archiveinträge weg und `behalten:` nimmt einzelne davon
wieder aus (z. B. das Schullogo in der Kopfzeile). `dateien:` legt eigene
Dateien ins Archiv – etwa ein Logo als PNG anstelle des eingebetteten PDFs.
Für eine andere Schulvorlage genügt eine neue Patch-Datei – ohne Änderung an
diesem Skript.

Zusätzlich ergänzt das Skript die Formatvorlagen, die der Renderer braucht und
die Schulvorlagen üblicherweise nicht mitbringen (Quelltext, Hinweis, …).

Alles andere – Seitenränder, Logos, Kopf-/Fußzeile, Gliederungsnummerierung,
vorhandene Formatvorlagen wie "Lösung" – bleibt unverändert.
"""

from __future__ import annotations

import re
import shutil
import sys
import zipfile
from fnmatch import fnmatch
from pathlib import Path

import yaml

_MONO = (
    'style:font-name="DejaVu Sans Mono" '
    'fo:font-family="&apos;DejaVu Sans Mono&apos;" style:font-family-generic="modern" '
    'style:font-pitch="fixed" fo:font-size="9pt"'
)

# Ergänzende Formatvorlagen, die die Schulvorlage nicht mitbringt.
# "LösungQuelltext" erbt von "Lösung" und damit auch text:display="none",
# d.h. Musterlösungen sind im Dokument enthalten, aber ausgeblendet.
EXTRA_STYLES = {
    "Quelltext": (
        '<style:style style:name="Quelltext" style:family="paragraph" '
        'style:parent-style-name="Standard">'
        '<style:paragraph-properties fo:margin-left="0.5cm" fo:margin-top="0cm" '
        'fo:margin-bottom="0cm" fo:background-color="#f2f2f2" '
        'fo:padding="0.1cm"/>'
        f'<style:text-properties {_MONO}/>'
        "</style:style>"
    ),
    "LösungQuelltext": (
        '<style:style style:name="LösungQuelltext" style:family="paragraph" '
        'style:parent-style-name="Lösung">'
        '<style:paragraph-properties fo:margin-left="0.5cm" fo:margin-top="0cm" '
        'fo:margin-bottom="0cm"/>'
        f'<style:text-properties {_MONO} fo:color="#ff0000" text:display="none"/>'
        "</style:style>"
    ),
    "Hinweis": (
        '<style:style style:name="Hinweis" style:family="text">'
        '<style:text-properties fo:font-style="italic" '
        'style:font-style-asian="italic"/>'
        "</style:style>"
    ),
    "Abbildung": (
        '<style:style style:name="Abbildung" style:family="text">'
        '<style:text-properties style:font-name="Arial" fo:font-family="Arial" '
        'style:font-family-generic="swiss" fo:font-size="8pt" fo:font-weight="bold"/>'
        "</style:style>"
    ),
    "Codewort": (
        '<style:style style:name="Codewort" style:family="text">'
        f'<style:text-properties {_MONO}/>'
        "</style:style>"
    ),
}


def apply_patches(xml: str, patches: list[dict], datei: str) -> str:
    """Ersetzungen aus der Patch-Datei anwenden und jede einzeln quittieren."""
    for patch in patches or []:
        flags = re.S if patch.get("punkt") else 0
        xml, n = re.subn(patch["suchen"], patch["ersetzen"], xml, flags=flags)
        beschreibung = patch.get("beschreibung", patch["suchen"][:40])
        if n:
            print(f"  ✓ {datei}: {beschreibung} ({n}x)")
        else:
            print(f"  ! {datei}: {beschreibung} – kein Treffer", file=sys.stderr)
    return xml


def add_styles(xml: str) -> str:
    """Formatvorlagen ergänzen, die der Renderer braucht."""
    for name, definition in EXTRA_STYLES.items():
        if f'style:name="{name}"' not in xml:
            xml = xml.replace("</office:styles>", definition + "</office:styles>", 1)
            print(f"  ✓ Formatvorlage '{name}' ergänzt")
    return xml


def matches(name: str, muster: list[str]) -> bool:
    """Trifft ein Archiveintrag eines der Muster aus `entfernen:`?"""
    return any(fnmatch(name, m) for m in muster)


def clean_manifest(xml: str, behalten: set[str]) -> str:
    """Einträge des Manifests entfernen, deren Datei nicht mehr im Archiv ist.

    Ordnereinträge (Pfad endet auf /) bleiben nur, wenn darunter noch etwas
    liegt – sonst beanstandet LibreOffice das Manifest.
    """
    def keep(match: re.Match) -> str:
        path = re.search(r'manifest:full-path="([^"]*)"', match.group(0))
        if not path:
            return match.group(0)
        p = path.group(1)
        if p in ("/", *behalten):
            return match.group(0)
        if p.endswith("/") and any(f.startswith(p) for f in behalten):
            return match.group(0)
        return ""

    return re.sub(r"<manifest:file-entry\b[^>]*/>", keep, xml)


def load_files(patches: dict, src: Path) -> list[tuple[str, bytes, str]]:
    """Dateien aus `dateien:` einlesen: (Ziel im Archiv, Inhalt, Medientyp).

    `quelle:` steht relativ zur Vorlage, also neben der Patch-Datei.
    """
    dateien = []
    for eintrag in patches.get("dateien") or []:
        quelle = src.parent / eintrag["quelle"]
        if not quelle.exists():
            print(f"  ! {quelle} fehlt – {eintrag['ziel']} nicht ersetzt", file=sys.stderr)
            continue
        dateien.append((eintrag["ziel"], quelle.read_bytes(), eintrag["medientyp"]))
        beschreibung = eintrag.get("beschreibung", eintrag["ziel"])
        print(f"  ✓ {eintrag['ziel']}: {beschreibung}")
    return dateien


def add_manifest(xml: str, dateien: list[tuple[str, bytes, str]]) -> str:
    """Neue Dateien im Manifest anmelden – sonst öffnet LibreOffice sie nicht."""
    for ziel, _, medientyp in dateien:
        if f'manifest:full-path="{ziel}"' in xml:
            continue
        eintrag = (f'<manifest:file-entry manifest:full-path="{ziel}" '
                   f'manifest:media-type="{medientyp}"/>')
        xml = xml.replace("</manifest:manifest>", eintrag + "</manifest:manifest>", 1)
    return xml


def load_patches(src: Path) -> dict:
    """Patch-Datei neben der Vorlage: <vorlage>.patch.yaml"""
    path = src.with_suffix(".patch.yaml")
    if not path.exists():
        print(f"  ! Keine Patch-Datei {path.name} – nur Formatvorlagen werden ergänzt",
              file=sys.stderr)
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    src, dst = Path(argv[1]), Path(argv[2])
    if not src.exists():
        print(f"Vorlage nicht gefunden: {src}", file=sys.stderr)
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)

    print(f"→ {src} → {dst}")
    patches = load_patches(src)
    with zipfile.ZipFile(src) as zin:
        items = [(info, zin.read(info.filename)) for info in zin.infolist()]

    drop = patches.get("entfernen") or []
    keep_patterns = patches.get("behalten") or []
    items = [
        (info, data) for info, data in items
        if matches(info.filename, keep_patterns) or not matches(info.filename, drop)
    ]
    if drop:
        print(f"  ✓ {len(drop)} Muster entfernt – {len(items)} Einträge bleiben")
    if keep_patterns:
        print(f"  ✓ {len(keep_patterns)} Muster von der Entfernung ausgenommen")

    dateien = load_files(patches, src)
    ersetzt = {ziel for ziel, _, _ in dateien}
    items = [(info, data) for info, data in items if info.filename not in ersetzt]
    items += [(zipfile.ZipInfo(ziel), data) for ziel, data, _ in dateien]

    behalten = {info.filename for info, _ in items}
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, data in items:
            if info.filename == "META-INF/manifest.xml" and (drop or dateien):
                xml = data.decode("utf-8")
                if drop:
                    xml = clean_manifest(xml, behalten)
                data = add_manifest(xml, dateien).encode("utf-8")
            if info.filename in ("styles.xml", "content.xml"):
                xml = apply_patches(data.decode("utf-8"), patches.get(info.filename), info.filename)
                if info.filename == "styles.xml":
                    xml = add_styles(xml)
                data = xml.encode("utf-8")
            # mimetype muss als erster Eintrag unkomprimiert im Archiv stehen
            compress = zipfile.ZIP_STORED if info.filename == "mimetype" else zipfile.ZIP_DEFLATED
            zout.writestr(info.filename, data, compress_type=compress)
    shutil.move(tmp, dst)
    print(f"  ✓ {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
