// ==================== SYMBOLE STATT EMOJIS IN DER BEDIENOBERFLÄCHE ====================
//
// Feedback: Emojis wirken auf dem iPad unruhig und verschieden groß. Statt rund 2000 Stellen im Code
// einzeln umzuschreiben, ersetzt dieser Umsetzer bekannte Emojis beim Anzeigen durch gezeichnete
// Symbole (lm-editor/src/util/icons.js) – im Startbild und in allem, was die App später einfügt.
//
// Nicht angefasst werden Inhalte: Arbeitsblätter, Quizfragen, Editoren, Eingabefelder, der
// Stift-Editor – dort bleiben Emojis, die Lehrkräfte bewusst verwenden (z. B. 🇬🇧). Unbekannte Emojis
// bleiben ebenfalls stehen. In Auswahllisten (<option>) geht nur Text: Dort fällt das Emoji weg.
// Abschalten für einen Bereich: Attribut data-no-iconize.

import { ICONS, EMOJI_ICON, EMOJI_TONE, icon } from '../lm-editor/src/util/icons.js';

/** Inhalte und Eingaben – hier bleibt alles, wie es ist. */
const SKIP = [
  '[data-no-iconize]', '.docspec', '.ProseMirror', '[contenteditable="true"]', 'textarea', 'input', 'script', 'style',
  'code', 'pre', '.ink-overlay', '.ds-quiz-live', '.quiz-module', '#quizModuleContainer', '.h5p-native', '.py-block',
  '.module-description-content', '.notebook-preview-body', '.md-render',
].join(', ');

// Längste zuerst, damit „⚠️“ vor „⚠“ greift.
const KEYS = Object.keys(EMOJI_ICON).filter((e) => ICONS[EMOJI_ICON[e]]).sort((a, b) => b.length - a.length);
const PATTERN = new RegExp(`(${KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\uFE0F?`, 'gu');
const QUICK = new RegExp(PATTERN.source, 'u');

const TEXT_ONLY = new Set(['OPTION', 'TITLE', 'TEXTAREA']);

function convertText(node) {
  const text = node.nodeValue;
  if (!text || !QUICK.test(text)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  if (parent.namespaceURI === 'http://www.w3.org/2000/svg') return;
  if (TEXT_ONLY.has(parent.tagName)) {
    node.nodeValue = text.replace(PATTERN, '').replace(/^\s+/, '');
    return;
  }
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tpl = document.createElement('template');
    const emoji = m[1];
    tpl.innerHTML = icon(EMOJI_ICON[emoji], `lm-ico-auto${EMOJI_TONE[emoji] ? ` ${EMOJI_TONE[emoji]}` : ''}`);
    const svg = tpl.content.firstChild;
    if (svg) {
      svg.setAttribute('data-emoji', emoji);
      frag.appendChild(svg);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  node.replaceWith(frag);
}

/** Alle Textknoten unter `root` umsetzen (ohne Inhalte, siehe SKIP). */
export function iconize(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) { convertText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE && root.closest(SKIP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (QUICK.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const hits = [];
  while (walker.nextNode()) hits.push(walker.currentNode);
  hits.forEach(convertText);
}

let observer = null;

/** Einmal beim Start: Startbild umsetzen und alles beobachten, was später dazukommt. */
export function startIconize() {
  if (observer || typeof MutationObserver === 'undefined') return;
  iconize(document.body);
  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const nodes = [...pending];
    pending.clear();
    observer.disconnect();
    for (const n of nodes) if (n.isConnected) iconize(n);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') pending.add(r.target);
      else r.addedNodes.forEach((n) => pending.add(n));
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
