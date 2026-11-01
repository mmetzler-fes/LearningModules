"""MathML (von Temml, aus LaTeX) -> StarMath für die Formelobjekte der .odt.

LibreOffice liest MathML nur eingeschränkt: Akzente geraten zu klein, Unter-
klammern und Durchstreichen fehlen, `|x|` und leere Elemente werden zu „¿“.
Seine eigene Sprache StarMath kann all das – deshalb übersetzt der Renderer das
MathML, das die App mitschickt, in StarMath (das Formelobjekt lässt sich dann
in LibreOffice wie gewohnt bearbeiten). Was hier unbekannt ist, meldet
NoStarMath; der Aufrufer nimmt dann das MathML selbst.
"""

from __future__ import annotations

import re
import unicodedata
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/1998/Math/MathML}"


class NoStarMath(Exception):
    """Das MathML enthält etwas, das hier nicht übersetzt wird."""


# Rechenzeichen: Relationen brauchen links und rechts etwas, Vorzeichen nicht.
RELATIONS = {
    "=": "=", "≠": "<>", "<": "<", ">": ">", "≤": "<=", "≥": ">=", "⩽": "leslant", "⩾": "geslant",
    "≈": "approx", "≡": "equiv", "∼": "sim", "≃": "simeq", "∝": "prop", "≝": "def",
    "→": "toward", "⇒": "drarrow", "⇐": "dlarrow", "⇔": "dlrarrow",
    "∈": "in", "∉": "notin", "⊂": "subset", "⊆": "subseteq", "⊃": "supset", "⊇": "supseteq",
    "∥": "parallel", "⊥": "ortho", "≪": "ll", "≫": "gg", "∣": "divides",
}
BINARY = {"⋅": "cdot", "·": "cdot", "×": "times", "÷": "div", "/": "/", "∗": "*", "*": "*", "∘": "circ",
          "∪": "union", "∩": "intersection", "∧": "and", "∨": "or"}
SIGNS = {"+": "+", "-": "-", "−": "-", "±": "+-", "∓": "-+", "¬": "neg"}
LARGE = {"∑": "sum", "∏": "prod", "∐": "coprod", "∫": "int", "∬": "iint", "∭": "iiint", "∮": "lint"}
LIMITS = {"lim", "liminf", "limsup", "max", "min", "sup", "inf"}
SYMBOLS = {"∞": "infinity", "∂": "partial", "∇": "nabla", "∅": "emptyset", "∀": "forall", "∃": "exists",
           "…": "dotslow", "⋯": "dotsaxis", "⋮": "dotsvert", "ℝ": "setR", "ℕ": "setN", "ℤ": "setZ",
           "ℚ": "setQ", "ℂ": "setC", "ℏ": "hbar", "ℓ": "ell", "°": "circ"}
PUNCT = {",": ",", ";": ";", ":": ":", "!": "!", "'": "'", "′": "'", ".": "."}
# Klammern für left/right; "" ist die leere Seite (\left. bzw. \right.).
FENCES = {"(": "(", ")": ")", "[": "[", "]": "]", "{": "lbrace", "}": "rbrace", "|": "lline", "‖": "ldline",
          "⟨": "langle", "⟩": "rangle", "⌊": "lfloor", "⌋": "rfloor", "⌈": "lceil", "⌉": "rceil", "": "none"}
RIGHT_FENCES = {"|": "rline", "‖": "rdline"}
GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "varepsilon", "ϵ": "epsilon", "ζ": "zeta",
    "η": "eta", "θ": "theta", "ϑ": "vartheta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu",
    "ξ": "xi", "ο": "omicron", "π": "pi", "ϖ": "varpi", "ρ": "rho", "ϱ": "varrho", "σ": "sigma", "ς": "varsigma",
    "τ": "tau", "υ": "upsilon", "φ": "varphi", "ϕ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "GAMMA", "Δ": "DELTA", "Θ": "THETA", "Λ": "LAMBDA", "Ξ": "XI", "Π": "PI", "Σ": "SIGMA",
    "Υ": "UPSILON", "Φ": "PHI", "Ψ": "PSI", "Ω": "OMEGA",
}
FUNCTIONS = {"sin", "cos", "tan", "cot", "arcsin", "arccos", "arctan", "arccot", "sinh", "cosh", "tanh",
             "coth", "log", "ln", "exp", "lg"}
# Akzente über einem Zeichen bzw. (wide…/overline) über mehreren.
ACCENTS = {
    "¯": ("bar", "overline"), "‾": ("bar", "overline"), "ˉ": ("bar", "overline"), "_": ("bar", "overline"),
    "˙": ("dot", None), "̇": ("dot", None), "¨": ("ddot", None), "̈": ("ddot", None),
    "⃛": ("dddot", None), "ˆ": ("hat", "widehat"), "^": ("hat", "widehat"), "̂": ("hat", "widehat"),
    "˜": ("tilde", "widetilde"), "~": ("tilde", "widetilde"), "̃": ("tilde", "widetilde"),
    "→": ("vec", "widevec"), "⃗": ("vec", "widevec"), "⃗": ("vec", "widevec"),
    "˘": ("breve", None), "ˇ": ("check", None), "´": ("acute", None), "`": ("grave", None),
    "˚": ("circle", None), "∘": ("circle", None),
}
INVISIBLE = {"⁡", "⁢", "⁣", "⁤", "​"}
COLOR_NAMES = {"black", "blue", "green", "red", "cyan", "magenta", "yellow", "gray", "lime", "maroon",
               "navy", "olive", "purple", "silver", "teal", "white", "orange"}
# Wörter, die StarMath als Befehl liest – als Variable deshalb in Anführungszeichen.
KEYWORDS = {"over", "sub", "sup", "from", "to", "abs", "fact", "sqrt", "nroot", "color", "size", "font", "bold",
            "ital", "italic", "nitalic", "nbold", "left", "right", "none", "matrix", "stack", "binom", "func",
            "in", "notin", "and", "or", "neg", "def", "lim", "sum", "int", "prod", "times", "cdot", "div",
            "approx", "sim", "equiv", "prop", "toward", "union", "intersection", "circ", "phantom", "underbrace",
            "overbrace", "overline", "underline", "overstrike", "bar", "dot", "hat", "tilde", "vec", "csub",
            "csup", "lsub", "lsup", "alignl", "alignr", "alignc", "newline", "infinity", "partial", "nabla"}


def tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def kids(el: ET.Element) -> list[ET.Element]:
    return [k for k in el if tag(k) not in ("annotation", "annotation-xml")]


def text_of(el: ET.Element) -> str:
    return "".join(ch for ch in (el.text or "") if ch not in INVISIBLE).strip()


def quote(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def group(s: str) -> str:
    return "{" + (s or '""') + "}"


def color_value(value: str) -> str:
    """`red`, `#0000FF`, `#00f` → StarMath (`color red`, `color hex 0000FF`)."""
    v = value.strip().lower()
    if v in COLOR_NAMES:
        return v
    m = re.fullmatch(r"#([0-9a-f]{6}|[0-9a-f]{3})", v)
    if not m:
        raise NoStarMath(f"Farbe {value}")
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return f"hex {h.upper()}"


def css_color(el: ET.Element) -> str | None:
    m = re.search(r"(?:^|;)\s*color\s*:\s*([^;]+)", el.get("style") or "")
    return m.group(1).strip() if m else None


class Converter:
    def convert(self, root: ET.Element) -> str:
        body = root
        sem = root.find(f"{NS}semantics")
        if sem is not None:
            body = sem
        return self.seq(kids(body)).strip()

    # ---- Folgen (mrow): Klammern paaren, Rechenzeichen ohne Operand auffüllen ----

    def seq(self, items: list[ET.Element]) -> str:
        parts: list[tuple[str, str]] = []  # (Art, StarMath): term | rel | bin | sign | large
        i = 0
        while i < len(items):
            el = items[i]
            t = tag(el)
            txt = text_of(el) if t in ("mo", "mi") else None
            # \left( … \right) – Klammer mit Gegenstück in derselben Folge
            if t == "mo" and el.get("fence") == "true" and el.get("form") == "prefix":
                j = self.partner(items, i)
                if j is not None:
                    open_, close = text_of(el), text_of(items[j])
                    if open_ in FENCES and (close in FENCES or close in RIGHT_FENCES):
                        right = RIGHT_FENCES.get(close, FENCES.get(close))
                        parts.append(("term", f"left {FENCES[open_]} {self.seq(items[i + 1:j]) or chr(34) * 2} right {right}"))
                        i = j + 1
                        continue
            # |x| aus zwei einzelnen Strichen
            if txt in ("|", "‖") and t in ("mi", "mo") and el.get("form") != "postfix":
                j = next((k for k in range(i + 1, len(items))
                          if tag(items[k]) in ("mi", "mo") and text_of(items[k]) == txt), None)
                if j is not None:
                    left, right = ("lline", "rline") if txt == "|" else ("ldline", "rdline")
                    parts.append(("term", f"left {left} {self.seq(items[i + 1:j]) or chr(34) * 2} right {right}"))
                    i = j + 1
                    continue
            # Einzelbuchstaben hintereinander (f_{Tick}, RC): wie in LaTeX ohne Abstand – ein Wort.
            if self.plain_letter(el):
                j = i
                while j < len(items) and self.plain_letter(items[j]):
                    j += 1
                if j - i > 1:
                    word = "".join(text_of(x) for x in items[i:j])
                    parts.append(("term", f"ital {quote(word)}" if word.lower() in KEYWORDS else word))
                    i = j
                    continue
            if (t == "mo" and txt == "") or (t in ("mrow", "mstyle", "mpadded") and not kids(el) and not el.get("mathcolor")):
                i += 1  # leer (Hilfselemente von Temml)
                continue
            parts.append(self.classify(el))
            i += 1
        return self.join(parts)

    @staticmethod
    def plain_letter(el: ET.Element) -> bool:
        return (tag(el) == "mi" and not el.get("mathvariant") and not el.get("mathcolor")
                and not css_color(el) and re.fullmatch(r"[A-Za-z]", text_of(el)) is not None)

    @staticmethod
    def partner(items: list[ET.Element], i: int) -> int | None:
        depth = 0
        for k in range(i, len(items)):
            el = items[k]
            if tag(el) == "mo" and el.get("fence") == "true":
                if el.get("form") == "prefix":
                    depth += 1
                elif el.get("form") == "postfix":
                    depth -= 1
                    if depth == 0:
                        return k
        return None

    def join(self, parts: list[tuple[str, str]]) -> str:
        # Klammern ( ) [ ] nur, wenn sie in dieser Folge aufgehen – sonst als Text.
        balance = []
        for kind, s in parts:
            if kind == "open":
                balance.append(s)
            elif kind == "close":
                if balance and {"(": ")", "[": "]"}[balance[-1]] == s:
                    balance.pop()
                else:
                    balance.append("x")
        ok = not balance
        out: list[str] = []
        prev = None
        for n, (kind, s) in enumerate(parts):
            if kind in ("open", "close"):
                kind, s = ("term", s if ok else quote(s))
            if kind in ("rel", "bin") and prev in (None, "rel", "bin", "sign"):
                out.append('""')
            if kind == "sign" and prev not in (None, "rel", "bin", "sign"):
                kind = "bin"
            out.append(s)
            prev = kind
        if prev in ("rel", "bin", "sign", "large"):
            out.append('""')
        return " ".join(out)

    def classify(self, el: ET.Element) -> tuple[str, str]:
        t = tag(el)
        # Summe, Integral, lim mit Grenzen – auch in einer eigenen Gruppe (so setzt Temml sie):
        # der Operand folgt erst dahinter, die Gruppe darf ihn nicht abschneiden.
        inner = el
        while tag(inner) == "mrow" and len(kids(inner)) == 1 and not inner.get("mathcolor"):
            inner = kids(inner)[0]
        if tag(inner) in ("msub", "msup", "msubsup", "munder", "mover", "munderover") and kids(inner) \
                and self.large_base(kids(inner)[0]):
            return ("large", self.node(inner))
        if tag(inner) == "mo" and text_of(inner) in LARGE and inner is not el:
            return ("large", LARGE[text_of(inner)])
        if t == "mo":
            txt = text_of(el)
            if txt in RELATIONS:
                return ("rel", RELATIONS[txt])
            if txt in BINARY:
                return ("bin", BINARY[txt])
            if txt in SIGNS:
                return ("sign", SIGNS[txt])
            if txt in ("(", "["):
                return ("open", txt)
            if txt in (")", "]"):
                return ("close", txt)
            if txt in LARGE:
                return ("large", LARGE[txt])
            if txt in LIMITS:
                return ("large", txt)
        return ("term", self.node(el))

    # ---- Einzelne Elemente ----

    def node(self, el: ET.Element) -> str:
        out = self.node_plain(el)
        color = el.get("mathcolor") or css_color(el)
        if color:
            out = f"color {color_value(color)} {group(out)}"
        return out

    def node_plain(self, el: ET.Element) -> str:
        t = tag(el)
        k = kids(el)
        if t in ("mrow", "mstyle", "mpadded", "semantics", "math"):
            inner = self.seq(k)
            if t == "mstyle" and el.get("mathvariant") == "bold":
                inner = f"bold {group(inner)}"
            return group(inner)
        if t == "mi":
            return self.identifier(el)
        if t == "mn":
            s = text_of(el)
            return s if re.fullmatch(r"\d+(\.\d+)?", s) else quote(s)
        if t == "mtext":
            return quote(el.text or "") if (el.text or "").strip() else '""'
        if t == "ms":
            return quote(el.text or "")
        if t == "mspace":
            width = el.get("width") or "0"
            m = re.match(r"([\d.]+)em", width)
            em = float(m.group(1)) if m else 0.0
            return "~~" if em >= 0.9 else "~" if em >= 0.4 else "`" if em > 0 else ""
        if t == "mo":
            return self.operator(text_of(el))
        if t == "mfrac":
            a, b = k
            if (el.get("linethickness") or "").strip() in ("0", "0px", "0em"):
                return f"binom {group(self.node(a))} {group(self.node(b))}"
            return f"{group(self.node(a))} over {group(self.node(b))}"
        if t == "msqrt":
            return f"sqrt {group(self.seq(k))}"
        if t == "mroot":
            return f"nroot {group(self.node(k[1]))} {group(self.node(k[0]))}"
        if t in ("msub", "msup", "msubsup"):
            return self.scripts(t, k)
        if t in ("munder", "mover", "munderover"):
            return self.under_over(t, k)
        if t == "mtable":
            return self.table(el)
        if t == "menclose":
            inner = group(self.seq(k))
            notation = el.get("notation") or ""
            if "strike" in notation:
                return f"overstrike {inner}"
            if notation == "top":
                return f"overline {inner}"
            if notation == "bottom":
                return f"underline {inner}"
            return inner
        if t == "mphantom":
            return f"phantom {group(self.seq(k))}"
        if t == "mfenced":
            open_, close = el.get("open", "("), el.get("close", ")")
            if open_ not in FENCES or (close not in FENCES and close not in RIGHT_FENCES):
                raise NoStarMath(f"mfenced {open_}{close}")
            right = RIGHT_FENCES.get(close, FENCES.get(close))
            return f"left {FENCES[open_]} {self.seq(k) or chr(34) * 2} right {right}"
        raise NoStarMath(t)

    def identifier(self, el: ET.Element) -> str:
        s = text_of(el)
        variant = el.get("mathvariant") or ""
        # Temml schreibt \mathit{Alarm}, \mathbf{F} … als Mathe-Buchstaben (𝐴𝑙𝑎𝑟𝑚) – zurück zu A–Z, Art aus dem Namen.
        if any(0x1D400 <= ord(ch) <= 0x1D7FF for ch in s):
            name = unicodedata.name(s[0], "")
            bold, italic = "BOLD" in name, "ITALIC" in name
            variant = "bold-italic" if bold and italic else "bold" if bold else "italic" if italic else "normal"
            s = unicodedata.normalize("NFKC", s)
        if not s:
            return '""'
        if s in GREEK:
            out = f"%{GREEK[s]}"
            if s.islower() and variant != "normal":
                out = f"%i{GREEK[s]}"  # kursiv wie in LaTeX
            return out
        if s in FUNCTIONS:
            return s
        if s in LIMITS:
            return s
        if s in SYMBOLS:
            return SYMBOLS[s]
        if re.fullmatch(r"[A-Za-zÄÖÜäöüß]+", s):
            # Mehrere Buchstaben sind in MathML ohne Angabe steil (Funktionsname, \mathrm), einer kursiv.
            upright = variant in ("normal", "bold") or (len(s) > 1 and not variant)
            if s.lower() in KEYWORDS or not s.isascii():
                word = quote(s)
            elif upright and len(s) > 1 and variant != "bold":
                return f"func {s}"
            else:
                word = f"nitalic {s}" if upright else s
            if variant.startswith("bold"):
                word = f"bold {group(word)}"
            return word
        if s in PUNCT:
            return PUNCT[s]
        return quote(s)

    def operator(self, s: str) -> str:
        if not s:
            return ""
        for table in (RELATIONS, BINARY, SIGNS, LARGE, SYMBOLS, PUNCT):
            if s in table:
                return table[s]
        if s in LIMITS or s in FUNCTIONS:
            return s
        if s in ("{", "}"):
            return {"{": "lbrace", "}": "rbrace"}[s]
        if s in ("(", ")", "[", "]"):
            return quote(s)
        return quote(s)

    def large_base(self, base: ET.Element) -> str | None:
        txt = text_of(base) if tag(base) in ("mo", "mi") else None
        if txt in LARGE:
            return LARGE[txt]
        if txt in LIMITS:
            return txt
        return None

    def scripts(self, t: str, k: list[ET.Element]) -> str:
        base = k[0]
        sub = k[1] if t in ("msub", "msubsup") else None
        sup = k[-1] if t in ("msup", "msubsup") else None
        op = self.large_base(base)
        if op:
            out = op
            if sub is not None:
                out += f" from {group(self.node(sub))}"
            if sup is not None:
                out += f" to {group(self.node(sup))}"
            return out
        out = group(self.node(base))
        if sub is not None:
            out += f"_{group(self.node(sub))}"
        if sup is not None:
            out += f"^{group(self.node(sup))}"
        return out

    def under_over(self, t: str, k: list[ET.Element]) -> str:
        base = k[0]
        op = self.large_base(base)
        if op:
            out = op
            if t in ("munder", "munderover"):
                out += f" from {group(self.node(k[1]))}"
            if t in ("mover", "munderover"):
                out += f" to {group(self.node(k[-1]))}"
            return out
        mark = k[-1]
        mark_text = text_of(mark) if tag(mark) == "mo" else None
        single = tag(base) in ("mi", "mn") and len(text_of(base)) == 1
        if t == "mover" and mark_text in ACCENTS:
            narrow, wide = ACCENTS[mark_text]
            if single or wide is None:
                return f"{narrow} {group(self.node(base))}"
            return f"{wide} {group(self.node(base))}"
        if t == "munder" and mark_text in ("_", "‾", "¯", "̲"):
            return f"underline {group(self.node(base))}"
        # Unterklammer mit Beschriftung: munder(munder(x, ⏟), Text)
        if t == "munder" and tag(base) == "munder" and text_of(kids(base)[-1]) == "⏟":
            return f"{group(self.node(kids(base)[0]))} underbrace {group(self.node(mark))}"
        if t == "mover" and tag(base) == "mover" and text_of(kids(base)[-1]) == "⏞":
            return f"{group(self.node(kids(base)[0]))} overbrace {group(self.node(mark))}"
        if t == "munder" and mark_text == "⏟":
            return f'{group(self.node(base))} underbrace {{""}}'
        if t == "mover" and mark_text == "⏞":
            return f'{group(self.node(base))} overbrace {{""}}'
        # \overset, \underset: Zeichen über bzw. unter beliebigem Inhalt
        center = self.node(base)
        if tag(base) == "mo" and text_of(base) in {**RELATIONS, **BINARY, **SIGNS}:
            center = quote(text_of(base))
        out = group(center)
        if t in ("munder", "munderover"):
            out += f" csub {group(self.node(k[1]))}"
        if t in ("mover", "munderover"):
            out += f" csup {group(self.node(k[-1]))}"
        return out

    def table(self, el: ET.Element) -> str:
        rows = []
        for tr in kids(el):
            if tag(tr) not in ("mtr", "mlabeledtr"):
                raise NoStarMath(tag(tr))
            cells = []
            for td in kids(tr):
                align = td.get("columnalign") or ""
                cls = td.get("class") or ""
                align = "right" if "tml-right" in cls else "left" if "tml-left" in cls else align
                content = self.seq(kids(td)) if tag(td) == "mtd" else self.node(td)
                content = content or '""'
                prefix = {"right": "alignr ", "left": "alignl ", "center": "alignc "}.get(align, "")
                cells.append(f"{prefix}{group(content)}")
            rows.append(" # ".join(cells))
        return "matrix{" + " ## ".join(rows) + "}"


def mathml_to_starmath(root: ET.Element) -> str:
    """MathML-Baum → StarMath; NoStarMath, wenn etwas nicht übersetzbar ist."""
    try:
        out = Converter().convert(root)
    except (ValueError, IndexError) as e:
        raise NoStarMath(str(e)) from e
    if not out:
        raise NoStarMath("leer")
    return out
