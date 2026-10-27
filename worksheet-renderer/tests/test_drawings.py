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



class Clusters(unittest.TestCase):
    def test_lose_linien_eines_schaltzeichens(self):
        """Die Kontakte aus der Tabelle „Geberkontakte“: Linien an verschiedenen
        Absätzen (Lage im Layout), dazu eine weit entfernte und eine aus einer anderen Spalte."""
        boxes = {
            15: ("T1:A", (3533, 9557, 3533, 10298)),
            17: ("T1:A", (3004, 10212, 3501, 10699)),
            16: ("T1:A", (3501, 10748, 3501, 11462)),
            12: ("T1:A", (3537, 12695, 3537, 13436)),
            11: ("T1:A", (3507, 13407, 3777, 14137)),
            10: ("T1:A", (3538, 13508, 3861, 13508)),
            9: ("T1:A", (3508, 14254, 3508, 14968)),
            30: ("T1:B", (3510, 10300, 3510, 10900)),
        }
        self.assertEqual(sorted(export_drawings.clusters(boxes)), [[9, 10, 11, 12], [15, 16, 17]])

    def test_einzelne_formen_bleiben(self):
        self.assertEqual(export_drawings.clusters({1: ("body", (0, 0, 100, 100)), 2: ("body", (5000, 5000, 5100, 5100))}), [])


if __name__ == "__main__":
    unittest.main()
