/**
 * Kleiner XML-Leser für Moodle-XML. Moodle schreibt einfaches, gut
 * geformtes XML (Elemente, Attribute, CDATA, Entities) – dafür lohnt keine
 * zusätzliche Abhängigkeit. Namensräume, DTDs und Verarbeitungsanweisungen
 * werden überlesen.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text direkt in diesem Element (inkl. CDATA), ohne den der Kinder. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Liest das Dokument und liefert das Wurzelelement. Wirft bei grobem Unsinn. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { top().text += decodeEntities(src.slice(i)); break; }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top().text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? src.length : end + 1;
    } else if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt + 2);
      const name = src.slice(lt + 2, end).trim();
      // Bis zum passenden Element schließen – fehlerhaftes XML bricht so nicht ab.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      i = end === -1 ? src.length : end + 1;
    } else {
      // Start-Tag; ">" in Attributwerten in Anführungszeichen überspringen.
      let j = lt + 1;
      let quote = '';
      while (j < src.length) {
        const c = src[j];
        if (quote) { if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      const raw = src.slice(lt + 1, j);
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const m = /^\s*([^\s/>]+)/.exec(body);
      if (!m) throw new Error('Ungültiges XML');
      const node: XmlNode = { name: m[1], attrs: {}, children: [], text: '' };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const rest = body.slice(m[0].length);
      while ((a = attrRe.exec(rest))) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
      top().children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  const el = root.children.find((c) => c.name);
  if (!el) throw new Error('Leeres XML');
  return el;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Text eines Kindelements, z. B. textOf(q, 'name', 'text'). */
export function textOf(node: XmlNode | undefined, ...path: string[]): string {
  let cur = node;
  for (const p of path) cur = child(cur, p);
  return (cur?.text ?? '').trim();
}
