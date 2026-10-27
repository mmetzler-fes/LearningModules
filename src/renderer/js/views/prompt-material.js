import { escapeHtml, escapeAttr } from '../utils.js';
import { docSpecToText } from '../ai-prompt.js';

// ==================== KI-PROMPT: MATERIAL AUS DEM NOTIZBUCH ====================
//
// Beide KI-Prompts (Quiz-Thema, Dokument) können den Inhalt eigener Dokumente
// mitnehmen: Book, Bereich, Abschnitt oder Lernthema wählen, die Dokumente
// darunter ankreuzen – ihr Text kommt in den Prompt (ai-prompt.js,
// docSpecToText). So braucht der KI-Chat keine Anhänge.

const STORAGE_KEY = 'lm_prompt_material';
const MAX_DOCS = 80;
const ICON = { book: '📓', area: '📂', section: '📑', topic: '📘' };

/** Gewählte Quelle merken – auch für „⋯ → 🤖 KI-Prompt“ im Notizbuch. */
export function presetPromptMaterial(source) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, off: [] })); } catch (_) { /* egal */ }
}

export class PromptMaterial {
  constructor(app, box) {
    this.app = app;
    this.box = box;
    this.docs = [];
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  _save() {
    const off = [...this.box.querySelectorAll('input[name="pmDoc"]:not(:checked)')].map((b) => b.value);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ source: this.box.querySelector('.pm-source').value, off })); } catch (_) { /* egal */ }
  }

  /** Auswahl zeichnen; wird auch nach „⋯ → 🤖 KI-Prompt“ erneut gerufen. */
  async render() {
    const tree = await this.app.api.getNotebooks().catch(() => null);
    this.tree = tree && !tree.message ? tree : { nodes: [], placements: [], topics: [] };
    const nodes = this.tree.nodes || [];
    const topics = new Map((this.tree.topics || []).filter((t) => t.isOwn !== false).map((t) => [t.id, t]));
    const kids = new Map();
    for (const n of nodes) {
      const k = n.parentId || '';
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(n);
    }
    const placed = new Map();
    for (const p of this.tree.placements || []) {
      if (!topics.has(p.topicId)) continue;
      const k = p.nodeId || '';
      if (!placed.has(k)) placed.set(k, []);
      placed.get(k).push(p);
    }
    const byOrder = (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    const docCount = (t) => (t.modules || []).filter((m) => m.type === 'document').length;
    // Quellen in Baumreihenfolge; je Eintrag die Lernthemen darunter (mit Pfad).
    this.sources = [];
    const walk = (parent, depth, path) => {
      const here = [];
      for (const n of (kids.get(parent) || []).sort(byOrder)) {
        const entry = { key: `n:${n.id}`, label: n.title, icon: ICON[n.kind] || '📂', depth, topics: [] };
        this.sources.push(entry);
        entry.topics = walk(n.id, depth + 1, [...path, n.title]);
        here.push(...entry.topics);
      }
      for (const p of (placed.get(parent) || []).sort(byOrder)) {
        const t = topics.get(p.topicId);
        if (!docCount(t)) continue;
        const item = { topic: t, path: path.join(' › ') };
        this.sources.push({ key: `t:${t.id}`, label: t.title, icon: ICON.topic, depth, topics: [item] });
        here.push(item);
      }
      return here;
    };
    walk('', 0, []);
    this.sources = this.sources.filter((s) => s.topics.some((x) => docCount(x.topic)));

    const saved = this._load();
    this.box.innerHTML = `
      <label>📓 Inhalte aus dem Notizbuch <span class="hint">– der Text eigener Dokumente kommt in den Prompt; keine Anhänge nötig</span>
        <select class="pm-source"><option value="">– keine –</option>
          ${this.sources.map((s) => `<option value="${escapeAttr(s.key)}" ${s.key === saved.source ? 'selected' : ''}>${'  '.repeat(s.depth)}${s.icon} ${escapeHtml(s.label)}</option>`).join('')}
        </select></label>
      <div class="pm-docs ai-prompt-types"></div>
      <span class="hint pm-size"></span>`;
    const select = this.box.querySelector('.pm-source');
    if (saved.source && select.value !== saved.source) select.value = '';
    select.addEventListener('change', () => { this._renderDocs([]); this._save(); });
    this._renderDocs(saved.off || []);
  }

  _renderDocs(off) {
    const key = this.box.querySelector('.pm-source').value;
    const src = this.sources.find((s) => s.key === key);
    this.docs = [];
    for (const { topic, path } of src?.topics || []) {
      const mods = (topic.modules || []).filter((m) => m.type === 'document').sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      for (const m of mods) this.docs.push({ id: m.id, title: m.title, path: [path, topic.title].filter(Boolean).join(' › ') });
    }
    const skip = new Set(off);
    const list = this.box.querySelector('.pm-docs');
    list.innerHTML = this.docs.map((d) => `
      <label class="tag-filter-option"><input type="checkbox" name="pmDoc" value="${escapeAttr(d.id)}" ${skip.has(d.id) ? '' : 'checked'} />
        ${d.path ? `<span class="hint">${escapeHtml(d.path)} ›</span> ` : ''}${escapeHtml(d.title || 'Dokument')}</label>`).join('');
    list.querySelectorAll('input').forEach((b) => b.addEventListener('change', () => { this._save(); this._hint(); }));
    this._hint();
  }

  /** Gewähltes Lernthema (Quelle „t:…“) – dorthin gehören die Quizze. */
  topic() {
    const key = this.box.querySelector('.pm-source')?.value || '';
    return key.startsWith('t:') ? this.sources.find((s) => s.key === key)?.topics[0]?.topic || null : null;
  }

  _chosen() {
    const on = new Set([...this.box.querySelectorAll('input[name="pmDoc"]:checked')].map((b) => b.value));
    return this.docs.filter((d) => on.has(d.id));
  }

  _hint() {
    const n = this._chosen().length;
    const hint = this.box.querySelector('.pm-size');
    hint.textContent = !this.docs.length ? ''
      : n > MAX_DOCS ? `Höchstens ${MAX_DOCS} Dokumente auf einmal – bitte weniger ankreuzen.`
        : `${n} von ${this.docs.length} Dokumenten gewählt.`;
  }

  /** Text der gewählten Dokumente für den Prompt: [{ title, path, text }]. */
  async collect() {
    const chosen = this._chosen();
    if (!chosen.length) return [];
    if (chosen.length > MAX_DOCS) throw new Error(`Höchstens ${MAX_DOCS} Dokumente auf einmal – bitte weniger ankreuzen.`);
    const res = await this.app.api.getDocPromptExamples(chosen.map((d) => d.id)).catch(() => null);
    if (!res?.examples) throw new Error(res?.message || 'Dokumente nicht abrufbar');
    const byId = new Map(res.examples.map((e) => [e.id, e]));
    return chosen.filter((d) => byId.has(d.id)).map((d) => ({ title: d.title, path: d.path, text: docSpecToText(byId.get(d.id).spec) }));
  }
}
