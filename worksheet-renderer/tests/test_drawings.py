"""Nachbesserung der SVGs aus LibreOffice (tools/export_drawings.py), ohne LibreOffice."""
import sys
import types
import unittest
from pathlib import Path

# export_drawings.py importiert uno – für die reine Textfunktion genügt ein Platzhalter.
sys.modules.setdefault("uno", types.ModuleType("uno"))
beans = types.ModuleType("com.sun.star.beans")
beans.PropertyValue = object
for name in ("com", "com.sun", "com.sun.star"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules.setdefault("com.sun.star.beans", beans)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import export_drawings  # noqa: E402


class FixRotatedText(unittest.TestCase):
    def test_dreht_um_den_textanfang(self):
        svg = ('<text class="SVGTextShape" transform="rotate(-89.9 9359 6620)"><tspan class="TextParagraph">'
               '<tspan class="TextPosition" x="7916" y="3514"><tspan>Druckleiste</tspan></tspan></tspan></text>')
        fixed = export_drawings.fix_rotated_text(svg)
        self.assertIn('transform="rotate(-89.9 7916 3514)"', fixed)
        self.assertIn(">Druckleiste<", fixed)

    def test_anderes_bleibt(self):
        svg = '<text><tspan x="1" y="2">gerade</tspan></text><path transform="rotate(30 1 1)"/>'
        self.assertEqual(export_drawings.fix_rotated_text(svg), svg)


if __name__ == "__main__":
    unittest.main()
