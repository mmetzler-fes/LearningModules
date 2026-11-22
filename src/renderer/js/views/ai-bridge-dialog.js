/**
 * 🤖 KI-Assistent („Bring Your Own AI“): Die eigene KI der Lehrkraft arbeitet im Notizbuch.
 * Hauptweg: einmal als Connector verbinden (MCP-Server /api/mcp, Anmeldung per OAuth –
 * src/ai-bridge/mcp.ts, oauth.*), dann im KI-Chat arbeiten. Hier: Zugang ein/aus, verbundene
 * KIs, was sie dürfen, offene KI-Änderungen annehmen oder ablehnen. Rückfall für KIs ohne
 * Connector und „Mit KI neu aufbereiten“: zeitlich begrenztes Token mit kopierter Anleitung.
 * Es entstehen keine Server-API-Kosten.
 */
import { escapeHtml, escapeAttr } from '../utils.js';
import { copyWhenReady } from './ai-answer.js';

const ICON = { book: '📕', plan: '📋', folder: '📁', area: '📂', section: '📑' };
const bad = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);

function parseBatchJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  const parsed = JSON.parse(candidate);
  if (Array.isArray(parsed)) return { operations: parsed };
  if (parsed && Array.isArray(parsed.operations)) return parsed;
  throw new Error('Erwartet wird ein JSON-Objekt mit "operations": [ ... ].');
}

/**
 * `regenerate`: `[{ id, title }]` – Dokumente mit der KI neu aufbereiten. Dann gibt es keine
 * Bereichsauswahl: Die KI darf nur diese Dokumente überarbeiten. `quizzes`: Es sind Quizze
 * (überarbeiten statt neu aufbereiten – ohne Original als Anhang).
 */
export async function openAiBridgeDialog(app, { onDone = null, regenerate = null, quizzes = false } = {}) {
  const [nb, plans, sessionsRes, connsRes] = await Promise.all([
    app.api.getNotebooks(),
    app.api.getPlans(),
    app.api.getAiBridgeSessions().catch(() => ({ sessions: [] })),
    app.api.getAiBridgeConnections().catch(() => ({ connections: [] })),
  ]);
  if (bad(nb) || bad(plans)) {
    app.showToast((nb && nb.message) || (plans && plans.message) || 'Daten nicht abrufbar.', 'error');
    return;
  }

  const books = (nb.nodes || []).filter((n) => !n.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
  const topPlans = (plans.nodes || []).filter((n) => !n.parentId && n.kind !== 'include').sort((a, b) => a.orderIndex - b.orderIndex);

  const main = !regenerate;
  const persistent0 = (sessionsRes?.sessions || []).find((x) => x.persistent) || null;
  const connected0 = (connsRes?.connections || []).length > 0;
  const mcpUrl = `${window.location.origin}/api/mcp`;
  const mcpCli = `claude mcp add --transport http learningmodules ${mcpUrl}`;
  // Was im Chat zu schreiben ist, wenn die KI schon verbunden ist (Neu aufbereiten / Überarbeiten).
  const chatAsk = regenerate
    ? (quizzes
      ? `Überarbeite in LearningModules ${regenerate.length === 1 ? 'das Quiz' : 'die Quizze'} ${regenerate.map((d) => `„${d.title}“ (ID ${d.id})`).join(', ')}: …`
      : `Bereite in LearningModules ${regenerate.length === 1 ? 'das Dokument' : 'die Dokumente'} ${regenerate.map((d) => `„${d.title}“ (ID ${d.id})`).join(', ')} neu auf – das Original hängt an. Inhalte und Reihenfolge wie im Original.`)
    : '';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay pl-dialog';
  overlay.innerHTML = `<div class="import-modules-card si-card aib-card" role="dialog" aria-modal="true" aria-labelledby="aibTitle">
    <h3 id="aibTitle">🤖 ${regenerate ? `${quizzes ? 'Mit KI überarbeiten' : 'Mit KI neu aufbereiten'}: ${escapeHtml(regenerate.length === 1 ? `„${regenerate[0].title}“` : `${regenerate.length} ${quizzes ? 'Quizze' : 'Dokumente'}`)}` : 'KI-Assistent'}</h3>
    ${main ? `<p class="hint">Deine eigene KI (Claude, ChatGPT …) arbeitet direkt in deinem Notizbuch: Du schreibst ihr im
      <strong>KI-Chat</strong>, was sie tun soll. Jede Änderung landet hier zum <strong>Annehmen oder Ablehnen</strong>;
      was Schüler gerade sehen, ändert sich erst beim Annehmen. Schülerdaten sieht die KI nie.</p>` : ''}
    ${regenerate && (connected0 || persistent0) ? `<div class="aib-chat-ask">
      <p><strong>🔌 Deine KI ist verbunden – einfach im KI-Chat schreiben</strong>${quizzes ? '' : ' und das Original anhängen'}:</p>
      <div class="aib-token-bar"><code class="aib-chat-ask-text">${escapeHtml(chatAsk)}</code>
        <button type="button" class="btn btn-secondary btn-sm" data-copy=".aib-chat-ask-text">📋 Kopieren</button></div>
      <p class="hint">Vorher den Zugang einschalten (KI-Assistent im Notizbuch). Ohne Verbindung geht es weiter unten mit kopierter Anleitung.</p>
    </div>` : ''}

    <div class="aib-status ${main ? '' : 'hidden'}"></div>
    <div class="aib-connections ${main ? '' : 'hidden'}"></div>
    <div class="aib-runs"></div>

    <details class="aib-setup ${main ? '' : 'hidden'}"${connected0 ? '' : ' open'}>
      <summary><strong>🔌 ${connected0 ? 'Weitere KI verbinden' : 'KI verbinden (einmalig)'}</strong></summary>
      <ol class="aib-steps">
        <li>Adresse des Connectors kopieren:
          <div class="aib-token-bar"><code class="aib-mcp-addr">${escapeHtml(mcpUrl)}</code>
            <button type="button" class="btn btn-secondary btn-sm" data-copy=".aib-mcp-addr">📋 Kopieren</button></div></li>
        <li>In deiner KI eintragen:
          <ul>
            <li><strong>Claude.ai:</strong> Einstellungen → Connectors → <em>Benutzerdefinierten Connector hinzufügen</em> → Adresse einfügen → <em>Verbinden</em>.</li>
            <li><strong>ChatGPT:</strong> Einstellungen → Apps &amp; Connectors → <em>Erstellen</em> (Entwicklermodus) → Adresse einfügen, Authentifizierung <em>OAuth</em>.</li>
            <li><strong>Claude Code:</strong> im Terminal
              <div class="aib-token-bar"><code class="aib-mcp-cli">${escapeHtml(mcpCli)}</code>
                <button type="button" class="btn btn-secondary btn-sm" data-copy=".aib-mcp-cli">📋 Kopieren</button></div>
              dann in Claude Code <code>/mcp</code> → <em>learningmodules</em> → anmelden.</li>
          </ul></li>
        <li>Es öffnet sich LearningModules: anmelden (falls nötig) und <strong>✅ Zulassen</strong>. Die KI erscheint oben unter „Verbundene KIs“.</li>
      </ol>
      <p class="hint">Kein Passwort und kein Token gehen an die KI – sie bekommt nur einen kurzlebigen Schlüssel, den du jederzeit mit „Trennen“ ungültig machst.</p>
    </details>

    <details class="aib-scope-box ${main ? '' : 'hidden'}">
      <summary><strong>⚙️ Was die KI darf</strong> <span class="hint aib-scope-summary"></span></summary>
      <div class="aib-grid">
        <fieldset class="si-group">
          <legend>📓 Lernnotizbuch</legend>
          <label class="share-flag"><input type="checkbox" class="aib-nb-all" checked /> <span>Alle eigenen Books</span></label>
          <div class="aib-nb-list hidden">
            ${books.map((b) => `<label class="share-flag"><input type="checkbox" name="aibNb" value="${escapeAttr(b.id)}" checked /> <span>${ICON[b.kind] || '📕'} ${escapeHtml(b.title)}</span></label>`).join('') || '<span class="hint">Noch keine Books vorhanden.</span>'}
          </div>
          <label class="share-flag"><input type="checkbox" class="aib-unsorted" checked /> <span>„Unsortiert“ einschließen</span></label>
        </fieldset>
        <fieldset class="si-group">
          <legend>🗂 Planung</legend>
          <label class="share-flag"><input type="checkbox" class="aib-pl-all" checked /> <span>Alle Pläne &amp; Ordner</span></label>
          <div class="aib-pl-list hidden">
            ${topPlans.map((p) => `<label class="share-flag"><input type="checkbox" name="aibPl" value="${escapeAttr(p.id)}" checked /> <span>${ICON[p.kind] || '📋'} ${escapeHtml(p.title)}</span></label>`).join('') || '<span class="hint">Noch keine Pläne vorhanden.</span>'}
          </div>
        </fieldset>
      </div>
      <label class="aib-ttl-label">Die KI darf:
        <select class="aib-perm">
          <option value="read">👁 Nur lesen (ansehen, Vorschläge machen)</option>
          <option value="organize">🗂 Lesen und ordnen (Bereiche anlegen, Lernthemen verschieben, in Pläne eintragen)</option>
          <option value="all" selected>✍️ Lesen, ordnen und Inhalte anlegen (Arbeitsblätter und Quizze anlegen und überarbeiten)</option>
        </select>
      </label>
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary btn-sm aib-btn-scope">💾 Für verbundene KIs speichern</button>
      </div>
    </details>

    <details class="aib-chat-tips ${main ? '' : 'hidden'}">
      <summary><strong>💬 Im KI-Chat – Beispiele</strong></summary>
      <ul class="aib-log-list">
        <li>„Sieh dir in LearningModules mein Book <em>Elektrotechnik</em> an und schlag eine bessere Gliederung vor.“</li>
        <li>„Lege in LearningModules im Abschnitt <em>Gleichstrommotor</em> ein Arbeitsblatt zur Drehzahlsteuerung mit drei Aufgaben und Musterlösung an.“</li>
        <li>„Erstelle zu jedem Blatt im Abschnitt <em>PWM und H-Brücke</em> ein Quiz mit fünf Fragen und bette es ins Blatt ein.“</li>
        <li>„Bereite das Dokument <em>Motorschutz</em> neu auf – das Original hängt an.“ (Datei im Chat anhängen)</li>
      </ul>
      <p class="hint">Ist der Zugang ausgeschaltet, sagt dir die KI Bescheid – dann oben einschalten.</p>
    </details>

    <details class="aib-legacy"${regenerate ? ' open' : ''}>
      <summary><strong>📋 ${regenerate ? 'Mit kopierter Anleitung' : 'Ohne Connector: Anleitung kopieren (zeitlich begrenzt)'}</strong></summary>
      ${regenerate && quizzes
        ? `<p class="hint">So geht es: <strong>1.</strong> Anleitung erzeugen (wird kopiert) – darin stehen der jetzige Stand und das Format.
            <strong>2.</strong> In deiner KI einfügen und dazuschreiben, was sich ändern soll (z.&nbsp;B. „bessere Ablenker“, „schwieriger“).
            <strong>3.</strong> Mit Webzugriff schreibt die KI selbst; sonst gibt sie einen JSON-Block aus, den du unten einfügst.
            Die KI darf nur ${regenerate.length === 1 ? 'dieses Quiz' : 'diese Quizze'} ändern, der Typ bleibt.</p>`
        : regenerate
          ? `<p class="hint">So geht es: <strong>1.</strong> Anleitung erzeugen (wird kopiert). <strong>2.</strong> In deiner KI einfügen und
              <strong>das Original als PDF/Word/Bild anhängen</strong>. <strong>3.</strong> Hat deine KI Webzugriff, schreibt sie
              das Dokument selbst; sonst gibt sie einen JSON-Block aus, den du unten einfügst. Die KI darf nur
              ${regenerate.length === 1 ? 'dieses Dokument' : 'diese Dokumente'} überarbeiten.</p>`
          : `<p class="hint">Für KIs ohne Connector: ein Token mit Anleitung zum Einfügen in den Chat. Es gilt nur eine Weile und
              nutzt die Einstellungen unter „Was die KI darf“. Die Änderungen erscheinen oben zum Annehmen oder Ablehnen.</p>`}
      <div class="aib-create-box">
        <div class="aib-perms">
          <label class="share-flag aib-quiz-formats ${regenerate ? 'hidden' : ''}" title="Nur nötig, wenn deine KI keinen Webzugriff hat (normaler Chat) und Quizze anlegen soll – sonst holt sie sich das Format selbst">
            <input type="checkbox" class="aib-with-quiz" /> <span>🧠 Quiz-Formate gleich in die Anleitung (für KIs ohne Webzugriff, etwa 7.000 Zeichen mehr)</span></label>
          <label class="aib-ttl-label">Gültigkeit:
            <select class="aib-ttl">
              <option value="30">30 Minuten</option>
              <option value="60" selected>60 Minuten</option>
              <option value="120">2 Stunden</option>
              <option value="240">4 Stunden</option>
            </select>
          </label>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-primary aib-btn-generate">🤖 Anleitung erzeugen &amp; kopieren</button>
        </div>
      </div>

      <div class="aib-output hidden">
        <p class="aib-copied-msg"></p>
        <div class="aib-token-bar">
          <span>Token: <code class="aib-token-code"></code></span>
          <button type="button" class="btn btn-secondary btn-sm aib-btn-copy-token">📋 Nur Token</button>
          <button type="button" class="btn btn-secondary btn-sm aib-btn-copy-prompt">📋 Ganze KI-Anleitung kopieren</button>
        </div>
        <details class="aib-prompt-details">
          <summary>KI-Anleitung ansehen</summary>
          <textarea class="aib-prompt-text" rows="10" readonly></textarea>
        </details>
        <div class="aib-manual-box">
          <label><strong>📥 Optional: JSON-Antwort der KI hier einfügen</strong>
            <span class="hint">(falls deine KI keinen Web-Zugriff hat und stattdessen einen <code>{"operations": [...]}</code>-Codeblock ausgibt)</span>
            <textarea class="aib-batch-input" rows="5" spellcheck="false" placeholder='{"operations": [ ... ]}'></textarea>
          </label>
          <div class="aib-batch-preview"></div>
          <div class="confirm-actions">
            <button type="button" class="btn btn-secondary aib-btn-dryrun" disabled>🔍 Vorschau prüfen</button>
            <button type="button" class="btn btn-primary aib-btn-apply" disabled>✅ Änderungen ausführen</button>
          </div>
        </div>
      </div>
      <div class="aib-sessions"></div>
    </details>

    <div class="confirm-actions">
      <button type="button" class="btn btn-secondary aib-close">Schließen</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  let activeSessionId = null;
  let lastToken = '';
  let changed = false;

  const close = async () => {
    overlay.remove();
    if (changed && onDone) await onDone();
  };
  $('.aib-close').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') void close(); });

  $('.aib-nb-all').addEventListener('change', (e) => {
    $('.aib-nb-list').classList.toggle('hidden', e.target.checked);
  });
  $('.aib-pl-all').addEventListener('change', (e) => {
    $('.aib-pl-list').classList.toggle('hidden', e.target.checked);
  });

  // ---- Dauerhafter Zugang und offene KI-Änderungen ----
  const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  /** Zugang an/aus – gilt für alle verbundenen KIs (dauerhafter Zugang, src/ai-bridge). */
  const renderPersistent = (sessions, connections = currentConnections) => {
    const box = $('.aib-status');
    const p = (sessions || []).find((x) => x.persistent);
    if (!p && !(connections || []).length) {
      box.innerHTML = '<p class="hint">Noch keine KI verbunden – unten unter <strong>🔌 KI verbinden</strong> einmalig einrichten.</p>';
      return;
    }
    if (!p) { box.innerHTML = ''; return; }
    const mins = Math.ceil((p.remainingSeconds || 0) / 60);
    box.innerHTML = `<div class="aib-session-item aib-persistent-item">
      <div class="aib-session-head">
        <strong>KI-Zugang</strong> ·
        ${p.active ? `<span class="pl-in">🟢 eingeschaltet (noch ca. ${mins} Min.)</span>` : '<span class="hint">⚪ ausgeschaltet – die KI kann gerade nichts lesen oder ändern</span>'}
        <span class="aib-session-actions">
          <select class="aib-activate-min" aria-label="Wie lange">
            <option value="30">30 Min.</option><option value="60" selected>1 Std.</option><option value="120">2 Std.</option><option value="240">4 Std.</option>
          </select>
          <button type="button" class="btn btn-primary btn-sm" data-activate="${escapeAttr(p.id)}">▶ ${p.active ? 'Neu stellen' : 'Einschalten'}</button>
          ${p.active ? `<button type="button" class="btn btn-secondary btn-sm" data-revoke="${escapeAttr(p.id)}">⏹ Ausschalten</button>` : ''}
        </span>
      </div>
    </div>`;
  };

  const renderRuns = (sessions) => {
    const box = $('.aib-runs');
    const runs = (sessions || []).flatMap((x) => (x.openRuns || []).map((r) => ({ ...r, sessionId: x.id })))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    if (!runs.length) { box.innerHTML = ''; return; }
    // Ablehnen geht je Sitzung nur für den neuesten offenen Lauf (spätere können darauf aufbauen).
    const newest = new Map();
    for (const r of runs) if (!newest.has(r.sessionId)) newest.set(r.sessionId, r.id);
    box.innerHTML = `<div class="aib-session-list"><h4>🤖 Offene KI-Änderungen (${runs.length})</h4>
      ${runs.map((r) => {
        const list = r.summaries.slice(0, 8).map((t) => `<li>${escapeHtml(t)}</li>`).join('')
          + (r.summaries.length > 8 ? `<li class="hint">… und ${r.summaries.length - 8} weitere</li>` : '');
        const canReject = newest.get(r.sessionId) === r.id;
        return `<div class="aib-session-item aib-run" data-session="${escapeAttr(r.sessionId)}" data-run="${escapeAttr(r.id)}">
          <div class="aib-session-head"><strong>${escapeHtml(fmt(r.at))}</strong> · ${r.summaries.length} Änderung${r.summaries.length === 1 ? '' : 'en'}
            ${r.drafts?.length ? ` · <span title="Schüler sehen bis zum Annehmen den bisherigen Stand">📝 ${r.drafts.length} als Entwurf</span>` : ''}
            <span class="aib-session-actions">
              <button type="button" class="btn btn-primary btn-sm" data-accept>✅ Annehmen</button>
              <button type="button" class="btn btn-secondary btn-sm" data-reject ${canReject ? '' : 'disabled title="Erst die neueren Änderungen dieser Sitzung annehmen oder ablehnen"'}>⏪ Ablehnen</button>
            </span></div>
          <ul class="aib-log-list">${list}</ul>
        </div>`;
      }).join('')}
    </div>`;
  };

  let currentConnections = connsRes?.connections || [];

  const renderConnections = (connections) => {
    const box = $('.aib-connections');
    if (!box) return;
    const list = Array.isArray(connections) ? connections : [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="aib-session-list">
      <h4>🔌 Verbundene KIs (${list.length})</h4>
      ${list.map((c) => `<div class="aib-session-item aib-conn-item" data-conn-id="${escapeAttr(c.id)}">
        <div class="aib-session-head">
          <strong>${escapeHtml(c.clientName)}</strong> ·
          <span class="hint">verbunden am ${escapeHtml(fmt(c.createdAt))}, zuletzt aktiv: ${escapeHtml(fmt(c.lastActiveAt))}</span>
          <span class="aib-session-actions">
            <button type="button" class="btn btn-secondary btn-sm aib-btn-disconnect" data-disconnect="${escapeAttr(c.id)}" title="Verbindung sofort ungültig machen">Trennen</button>
          </span>
        </div>
      </div>`).join('')}
    </div>`;
  };

  const refresh = async () => {
    const [freshSessions, freshConns] = await Promise.all([
      app.api.getAiBridgeSessions().catch(() => ({ sessions: [] })),
      app.api.getAiBridgeConnections().catch(() => ({ connections: [] })),
    ]);
    currentConnections = freshConns?.connections || [];
    renderAll(freshSessions.sessions, currentConnections);
  };

  $('.aib-connections').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-disconnect]');
    if (!btn) return;
    const id = btn.dataset.disconnect;
    if (!await app.appConfirm('Verbindung zu dieser KI wirklich trennen? Die KI verliert sofort den Zugriff und muss dich bei der nächsten Benutzung erneut um Erlaubnis bitten.')) return;
    btn.disabled = true;
    const res = await app.api.disconnectAiBridgeConnection(id);
    if (bad(res)) {
      btn.disabled = false;
      app.showToast(res?.message || 'Trennen fehlgeschlagen.', 'error');
    } else {
      app.showToast('🔌 Verbindung getrennt.', 'info');
      await refresh();
    }
  });

  $('.aib-runs').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-accept],[data-reject]');
    if (!btn) return;
    const item = btn.closest('.aib-run');
    const { session: sid, run } = item.dataset;
    btn.disabled = true;
    if (btn.hasAttribute('data-accept')) {
      const res = await app.api.acceptAiBridgeRun(sid, run);
      if (bad(res)) app.showToast(res?.message || 'Annehmen ging nicht.', 'error');
      else app.showToast(`✅ Angenommen.${res.notes?.length ? ` ${res.notes.join(' · ')}` : ''}`, 'success');
    } else {
      let res = await app.api.rejectAiBridgeRun(sid, run);
      if (res?.statusCode === 409 && await app.appConfirm(`${res.message}\n\nTrotzdem ablehnen?`)) res = await app.api.rejectAiBridgeRun(sid, run, true);
      if (res?.statusCode === 409) { btn.disabled = false; return; }
      if (bad(res)) app.showToast(res?.message || (res?.errors || []).join(' · ') || 'Ablehnen ging nicht.', 'error');
      else app.showToast('⏪ Abgelehnt – die Änderungen sind zurückgenommen.', 'success');
    }
    changed = true;
    await refresh();
  });

  $('.aib-status').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-activate]');
    if (act) {
      act.disabled = true;
      const res = await app.api.activateAiBridgeSession(act.dataset.activate, Number($('.aib-activate-min').value) || 60);
      if (bad(res)) app.showToast(res?.message || 'Einschalten ging nicht.', 'error');
      else app.showToast('🟢 KI-Zugang eingeschaltet.', 'success');
      await refresh();
      return;
    }
    const rev = e.target.closest('[data-revoke]');
    if (rev) {
      rev.disabled = true;
      await app.api.revokeAiBridgeSession(rev.dataset.revoke);
      app.showToast('⚪ KI-Zugang ausgeschaltet.', 'info');
      await refresh();
    }
  });

  let pastOpen = false;
  const renderSession = (s) => {
    const mins = Math.ceil((s.remainingSeconds || 0) / 60);
    const statusBadge = s.active
      ? `<span class="pl-in">🟢 aktiv (noch ca. ${mins} Min.)</span>`
      : `<span class="hint">⏹ abgelaufen ${escapeHtml(new Date(s.expiresAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</span>`;
    const logs = (s.log || []).slice(-5).map((l) => `<li>${escapeHtml(l.summary)}</li>`).join('');
    return `<div class="aib-session-item" data-id="${escapeAttr(s.id)}">
      <div class="aib-session-head">
        <strong>Token <code>${escapeHtml(s.tokenPreview)}</code></strong> · ${statusBadge}
        · <strong>${s.opsCount || 0}</strong> rückgängig machbare Änderung${s.opsCount === 1 ? '' : 'en'}
        <span class="aib-session-actions">
          ${s.active ? `<button type="button" class="btn btn-secondary btn-sm" data-extend="${escapeAttr(s.id)}" title="Zugriff 30 Minuten länger">⏱ +30 Min.</button>` : ''}
          ${s.canRollback ? `<button type="button" class="btn btn-secondary btn-sm" data-rollback="${escapeAttr(s.id)}">⏪ Rückgängig (${s.opsCount})</button>` : ''}
          ${s.active ? `<button type="button" class="btn btn-secondary btn-sm" data-revoke="${escapeAttr(s.id)}">⏹ Zugriff beenden</button>` : ''}
        </span>
      </div>
      ${logs ? `<ul class="aib-log-list">${logs}</ul>` : ''}
    </div>`;
  };

  // Laufende Sitzungen stehen offen da; abgelaufene nur zugeklappt
  // (Rückgängig bleibt dort möglich, bis der Server sie aufräumt).
  const renderSessions = (sessions) => {
    const box = $('.aib-sessions');
    const prev = box.querySelector('.aib-past');
    if (prev) pastOpen = prev.open;
    const all = (sessions || []).filter((s) => !s.persistent);
    const active = all.filter((s) => s.active);
    const past = all.filter((s) => !s.active && s.canRollback)
      .sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt));
    if (!active.length && !past.length) {
      box.innerHTML = '';
      return;
    }
    if (!activeSessionId && active[0]) activeSessionId = active[0].id;
    if (!activeSessionId) activeSessionId = (sessions || []).find((s) => s.persistent && s.active)?.id || null;
    box.innerHTML = `<div class="aib-session-list">
      ${active.length ? `<h4>Aktive KI-Sitzungen</h4>${active.map(renderSession).join('')}` : ''}
      ${past.length ? `<details class="aib-past"${pastOpen ? ' open' : ''}>
        <summary>🕘 Abgelaufene KI-Sitzungen (${past.length}) – Änderungen rückgängig machen</summary>
        ${past.map(renderSession).join('')}
      </details>` : ''}
    </div>`;
  };

  const renderAll = (sessions, connections = currentConnections) => {
    renderPersistent(sessions, connections);
    renderConnections(connections);
    renderRuns(sessions);
    renderSessions(sessions);
  };
  renderAll(sessionsRes?.sessions || [], currentConnections);

  $('.aib-sessions').addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-rollback]');
    if (rb) {
      const id = rb.dataset.rollback;
      rb.disabled = true;
      const res = await app.api.rollbackAiBridgeSession(id);
      if (bad(res)) {
        app.showToast(res?.message || 'Rückgängig fehlgeschlagen.', 'error');
        rb.disabled = false;
        return;
      }
      changed = true;
      app.showToast(`⏪ ${res.reverted} Änderung${res.reverted === 1 ? '' : 'en'} rückgängig gemacht.`, 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderAll(fresh.sessions);
      return;
    }
    const ext = e.target.closest('[data-extend]');
    if (ext) {
      ext.disabled = true;
      const res = await app.api.extendAiBridgeSession(ext.dataset.extend, 30);
      if (bad(res)) app.showToast(res?.message || 'Verlängern ging nicht.', 'error');
      else app.showToast('KI-Zugriff um 30 Minuten verlängert.', 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderAll(fresh.sessions);
      return;
    }
    const rev = e.target.closest('[data-revoke]');
    if (rev) {
      const id = rev.dataset.revoke;
      rev.disabled = true;
      await app.api.revokeAiBridgeSession(id);
      app.showToast('KI-Token wurde sofort gesperrt.', 'info');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderAll(fresh.sessions);
    }
  });

  $('.aib-btn-generate').addEventListener('click', async () => {
    const btn = $('.aib-btn-generate');
    btn.disabled = true;
    const notebookNodeIds = $('.aib-nb-all').checked
      ? ['*']
      : [...overlay.querySelectorAll('input[name="aibNb"]:checked')].map((x) => x.value);
    const planNodeIds = $('.aib-pl-all').checked
      ? ['*']
      : [...overlay.querySelectorAll('input[name="aibPl"]:checked')].map((x) => x.value);

    const job = app.api.createAiBridgeSession(regenerate ? {
      ttlMinutes: Number($('.aib-ttl').value) || 60,
      regenerateModuleIds: regenerate.map((d) => d.id),
    } : {
      ttlMinutes: Number($('.aib-ttl').value) || 60,
      notebookNodeIds,
      planNodeIds,
      includeUnsorted: $('.aib-unsorted').checked,
      withQuizFormats: $('.aib-with-quiz').checked && $('.aib-perm').value === 'all',
      permissions: {
        organize: $('.aib-perm').value !== 'read',
        writeDocs: $('.aib-perm').value === 'all',
      },
    });
    const copied = copyWhenReady(job.then((r) => {
      if (bad(r)) throw new Error(r?.message || 'Fehler');
      return r.prompt;
    }));
    const res = await job;
    btn.disabled = false;
    if (bad(res)) {
      app.showToast(res?.message || 'Token konnte nicht erzeugt werden.', 'error');
      return;
    }
    activeSessionId = res.session.id;
    lastToken = res.token;
    $('.aib-token-code').textContent = res.token;
    $('.aib-prompt-text').value = res.prompt;
    $('.aib-output').classList.remove('hidden');
    const ok = await copied;
    $('.aib-copied-msg').textContent = ok
      ? (regenerate
        ? '✅ Anleitung kopiert! Jetzt in deiner KI einfügen und das Original als Anhang dazugeben.'
        : '✅ KI-Anleitung samt Token ist in die Zwischenablage kopiert! Jetzt in deiner KI einfügen und deinen Wunsch ergänzen.')
      : '⚠️ Bitte auf „📋 Ganze KI-Anleitung kopieren“ klicken und in deiner KI einfügen.';
    const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [res.session] }));
    renderAll(fresh.sessions);
  });

  // 📋 Adresse, Befehl, Chat-Satz kopieren
  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    const value = btn ? $(btn.dataset.copy)?.textContent : '';
    if (value && await copyWhenReady(Promise.resolve(value))) app.showToast('Kopiert.', 'success');
  });

  // ⚙️ Was die KI darf: vom dauerhaften Zugang übernehmen, dort speichern.
  const scopeOf = () => ({
    notebookNodeIds: $('.aib-nb-all').checked ? ['*'] : [...overlay.querySelectorAll('input[name="aibNb"]:checked')].map((x) => x.value),
    planNodeIds: $('.aib-pl-all').checked ? ['*'] : [...overlay.querySelectorAll('input[name="aibPl"]:checked')].map((x) => x.value),
    includeUnsorted: $('.aib-unsorted').checked,
    permissions: { organize: $('.aib-perm').value !== 'read', writeDocs: $('.aib-perm').value === 'all' },
  });
  const PERM = { read: 'nur lesen', organize: 'lesen und ordnen', all: 'lesen, ordnen, Inhalte anlegen' };
  const showScopeSummary = () => {
    const sc = scopeOf();
    const nb = sc.notebookNodeIds.includes('*') ? 'alle Books' : `${sc.notebookNodeIds.length} Book${sc.notebookNodeIds.length === 1 ? '' : 's'}`;
    const pl = sc.planNodeIds.includes('*') ? 'alle Pläne' : `${sc.planNodeIds.length} Plan/Pläne`;
    $('.aib-scope-summary').textContent = `– ${nb}, ${pl}, ${PERM[$('.aib-perm').value]}`;
  };
  if (persistent0?.scope) {
    const sc = persistent0.scope;
    const pick = (allSel, name, ids) => {
      const all = (ids || []).includes('*');
      $(allSel).checked = all;
      overlay.querySelectorAll(`input[name="${name}"]`).forEach((x) => { x.checked = all || ids.includes(x.value); });
    };
    pick('.aib-nb-all', 'aibNb', sc.notebookNodeIds);
    pick('.aib-pl-all', 'aibPl', sc.planNodeIds);
    $('.aib-nb-list').classList.toggle('hidden', $('.aib-nb-all').checked);
    $('.aib-pl-list').classList.toggle('hidden', $('.aib-pl-all').checked);
    $('.aib-unsorted').checked = sc.includeUnsorted !== false;
    $('.aib-perm').value = sc.permissions?.writeDocs ? 'all' : sc.permissions?.organize ? 'organize' : 'read';
  }
  showScopeSummary();
  $('.aib-scope-box').addEventListener('change', showScopeSummary);
  $('.aib-btn-scope').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await app.api.updateAiBridgeScope(scopeOf());
    e.target.disabled = false;
    if (bad(res)) { app.showToast(res?.message || 'Speichern ging nicht.', 'error'); return; }
    app.showToast('⚙️ Gespeichert – gilt für alle verbundenen KIs.', 'success');
    await refresh();
  });

  $('.aib-btn-copy-token').addEventListener('click', async () => {
    if (lastToken && await copyWhenReady(Promise.resolve(lastToken))) {
      app.showToast('Token kopiert.', 'success');
    }
  });
  $('.aib-btn-copy-prompt').addEventListener('click', async () => {
    const text = $('.aib-prompt-text').value;
    if (text && await copyWhenReady(Promise.resolve(text))) {
      app.showToast('KI-Anleitung kopiert – jetzt im KI-Chat einfügen.', 'success');
    }
  });

  const batchInput = $('.aib-batch-input');
  const batchPreview = $('.aib-batch-preview');
  const btnDry = $('.aib-btn-dryrun');
  const btnApply = $('.aib-btn-apply');

  batchInput.addEventListener('input', () => {
    const hasText = !!batchInput.value.trim();
    btnDry.disabled = !hasText || !activeSessionId;
    btnApply.disabled = !hasText || !activeSessionId;
  });

  const runBatch = async (dryRun) => {
    if (!activeSessionId) return;
    let parsed;
    try {
      parsed = parseBatchJson(batchInput.value);
    } catch (err) {
      batchPreview.innerHTML = `<p class="login-error">❌ ${escapeHtml(err.message)}</p>`;
      return;
    }
    btnDry.disabled = true;
    btnApply.disabled = true;
    const res = await app.api.runAiBridgeBatch(activeSessionId, { ...parsed, dryRun });
    btnDry.disabled = false;
    btnApply.disabled = false;
    if (bad(res)) {
      batchPreview.innerHTML = `<p class="login-error">❌ ${escapeHtml(res?.message || 'Ausführung fehlgeschlagen.')}</p>`;
      return;
    }
    const itemsHtml = (res.results || []).map((r) => `<li>${escapeHtml(r.summary)}</li>`).join('');
    batchPreview.innerHTML = `<p><strong>${dryRun ? '🔍 Vorschau gültig' : '✅ Ausgeführt'}: ${res.count} Schritt${res.count === 1 ? '' : 'e'}</strong></p>
      <ul class="si-preview">${itemsHtml}</ul>`;
    if (!dryRun) {
      changed = true;
      batchInput.value = '';
      btnDry.disabled = true;
      btnApply.disabled = true;
      app.showToast(`${res.count} KI-Änderung${res.count === 1 ? '' : 'en'} ausgeführt.`, 'success');
      const fresh = await app.api.getAiBridgeSessions().catch(() => ({ sessions: [] }));
      renderAll(fresh.sessions);
    }
  };

  btnDry.addEventListener('click', () => void runBatch(true));
  btnApply.addEventListener('click', () => void runBatch(false));
}

