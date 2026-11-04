// ==================== DOKUMENT: KNÖPFE IN DER TITELLEISTE ====================
//
// Der große Kopf und die Knöpfe im Blatt wandern mit und kosten Platz. Notebook-Vorschau und Vollansicht
// (Klassennotizbuch) holen sie deshalb in ihre feste Titelleiste.

/**
 * `host`: hier wurde das Modul aufgebaut, `bar`: die Leiste, `before`: Knopf, vor dem eingefügt wird.
 * `stiftKnopf`: Die Leiste hat schon ✍️ Stift, der Knopf im Blatt entfällt; sonst zieht er kurz benannt mit um.
 */
export function moveDocumentControls(host, mod, bar, { before = null, stiftKnopf = false } = {}) {
  host.querySelector('.module-preview-header')?.remove();
  const actions = host.querySelector('.ds-actions');
  const moved = [...(actions?.children || []), host.querySelector('.ds-solutions-toggle')].filter(Boolean);
  actions?.remove();
  for (const btn of moved) {
    if (btn.classList.contains('ds-ink-btn')) {
      if (stiftKnopf) { btn.remove(); continue; }
      btn.textContent = '✍️ Stift';
    }
    // lm-host.js findet den Knopf der Beschriftung darüber wieder.
    btn.dataset.module = mod.id;
    bar.insertBefore(btn, before);
  }
}
