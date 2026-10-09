import { escapeHtml, escapeAttr } from '../utils.js';

// ==================== LERNMODULE-SHOP ====================
//
// Jede Weitergabe von Inhalten läuft über den Shop (siehe
// docs/shop-und-rechte.md):
//
//   Copy – eigene Kopie. Man wird Owner und Buyer: bearbeiten erlaubt, die
//          Module bleiben auf ihren Creator verzeichnet.
//   Use  – das Original in eigenen Links verwenden. Änderungen des Creators
//          wirken sofort; bearbeiten und weitergeben geht nicht.
//
// Angeboten werden ein Lernthema, ein Book/Bereich/Abschnitt aus den
// Notebooks (wächst mit) oder eine Auswahl von Modulen. Eigene Module lassen
// sich kopieren und nutzen, erworbene nur nutzen. Die Punkte gehen anteilig
// an die Creator.

const TABS = ['offers', 'mine', 'points'];

const REASON_LABELS = {
  start: 'Startguthaben',
  purchase: 'Kauf',
  sale: 'Verkauf',
  refund: 'Erstattung',
  // Gibt es nicht mehr – ältere Buchungen sollen aber lesbar bleiben.
  'yearly-decay': 'Jahresabzug',
  'yearly-bonus': 'Jahresgeschenk',
  merge: 'Konto übernommen',
  admin: 'Admin',
};

const points = (n) => `${n} Punkt${n === 1 ? '' : 'e'}`;

/** Was ein Angebot umfasst – für Karten und Dialog. */
const SCOPE_LABEL = {
  topic: { icon: '📘', label: 'Lernthema' },
  book: { icon: '📓', label: 'Book' },
  area: { icon: '📂', label: 'Bereich' },
  section: { icon: '📑', label: 'Abschnitt' },
  node: { icon: '📂', label: 'Bereich' },
  modules: { icon: '🧩', label: 'Auswahl von Modulen' },
};

export class ShopView {
  constructor(app) {
    this.app = app;
    this._tab = 'offers';
    this._content = document.getElementById('shopContent');
    this._balance = document.getElementById('shopBalance');
    this._search = document.getElementById('shopSearch');
    this._onlyShared = document.getElementById('shopOnlyShared');
    this._filterBar = document.getElementById('shopFilterBar');

    document.querySelectorAll('#view-teacher-shop .admin-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._showTab(btn.dataset.tab));
    });
    this._search?.addEventListener('input', () => this._renderOffers());
    this._onlyShared?.addEventListener('change', () => this._renderOffers());
  }

  async refresh() {
    await this._showTab(this._tab);
  }

  /** Aus der Themenliste: Shop öffnen und direkt das Angebot für dieses Thema bearbeiten. */
  async openForTopic(topicId) {
    this._tab = 'mine';
    this.app.navigateToView('teacher-shop');
    await this.openOfferDialog({ type: 'topic', id: topicId });
  }

  /** Aus den Notebooks: Angebot für ein Book, einen Bereich oder Abschnitt – der Dialog öffnet über den Notebooks. */
  openForNode(nodeId) {
    return this.openOfferDialog({ type: 'node', id: nodeId });
  }

  /** Aus den Notebooks: neue Auswahl von Modulen anbieten. */
  openForModules(moduleIds) {
    return this.openOfferDialog({ type: 'modules', moduleIds });
  }

  async _showTab(tab) {
    this._tab = TABS.includes(tab) ? tab : 'offers';
    document.querySelectorAll('#view-teacher-shop .admin-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this._tab);
    });
    this._filterBar?.classList.toggle('hidden', this._tab !== 'offers');
    this._content.innerHTML = '<p class="hint">Wird geladen…</p>';
    try {
      if (this._tab === 'offers') {
        this._catalog = await this.app.api.getShopOffers();
        this._setBalance(this._catalog?.balance);
        this._renderOffers();
      } else if (this._tab === 'mine') {
        await this._renderMine();
      } else {
        await this._renderPoints();
      }
    } catch (err) {
      this._content.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(err.message)}</p>`;
    }
  }

  _setBalance(balance) {
    if (typeof balance !== 'number') return;
    this._lastBalance = balance;
    if (this._balance) this._balance.textContent = `🪙 ${points(balance)}`;
    this.app.updatePointsBadge?.(balance);
  }

  // ---- Angebote ----

  _renderOffers() {
    if (this._tab !== 'offers') return;
    const all = (this._catalog && this._catalog.offers) || [];
    const q = (this._search?.value || '').toLowerCase().trim();
    const onlyShared = !!this._onlyShared?.checked;
    const list = all.filter((o) => {
      if (onlyShared && !o.sharedWithMe) return false;
      if (!q) return true;
      return [o.title, o.description, o.sellerName, ...o.modules.map((m) => m.title)]
        .some((s) => (s || '').toLowerCase().includes(q));
    });

    this._content.innerHTML = '';
    if (list.length === 0) {
      this._content.innerHTML = all.length === 0
        ? '<div class="empty-state"><span class="empty-icon">🛒</span><p>Im Moment bietet niemand etwas an.</p></div>'
        : '<div class="empty-state"><span class="empty-icon">🔍</span><p>Kein Angebot passt zur Suche.</p></div>';
      return;
    }
    for (const offer of list) this._content.appendChild(this._offerCard(offer));
  }

  _offerCard(o) {
    const balance = this._catalog?.balance ?? 0;
    // Ins Minus darf es gehen; nur unter eine vom Admin gesetzte Untergrenze nicht.
    const minBalance = this._catalog?.minBalance ?? null;
    const card = document.createElement('div');
    card.className = 'topic-card shop-card';
    const otherCreators = o.creators.filter((c) => c !== o.sellerName);
    const typeOf = (t) => (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[t]) || {};
    const scope = SCOPE_LABEL[o.scopeType === 'node' ? o.nodeKind : o.scopeType] || SCOPE_LABEL.topic;

    const button = (mode) => {
      const allowed = mode === 'copy' ? o.allowCopy : o.allowUse;
      if (!allowed) return '';
      const price = mode === 'copy' ? o.priceCopy : o.priceUse;
      if (mode === 'use' && o.hasUse) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Du verwendest das bereits">✓ In Verwendung</button>';
      }
      const poor = minBalance !== null && balance - price < minBalance;
      const label = mode === 'copy' ? '📥 Copy' : '🔗 Use';
      const priceLabel = price === 0 ? 'frei' : points(price);
      return `<button class="btn ${mode === 'copy' ? 'btn-primary' : 'btn-secondary'} btn-sm btn-acquire" data-mode="${mode}"
        ${poor ? 'disabled' : ''} title="${poor ? `Dein Konto darf nicht unter ${minBalance} Punkte fallen` : mode === 'copy'
          ? (o.foreignCount ? `Eigene Kopie der ${o.ownCount} Module von ${o.sellerName}; die übrigen ${o.foreignCount} bekommst du zur Nutzung dazu` : 'Eigene Kopie: bearbeiten erlaubt, Weitergabe nur zur Nutzung')
          : 'Original in eigenen Links verwenden – Änderungen des Creators wirken sofort'}">
        ${label} · ${priceLabel}</button>`;
    };

    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${scope.icon} ${escapeHtml(o.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(o.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-shared-badge" title="${o.scopeType === 'node' ? 'Kommt beim Anbieter etwas dazu, gehört es bei Use automatisch dazu' : ''}">${scope.label}${o.scopeType !== 'topic' ? ` · ${o.topicCount} Lernthem${o.topicCount === 1 ? 'a' : 'en'}` : ''}</span>
            <span class="topic-module-count">${o.modules.length} Modul${o.modules.length === 1 ? "" : "e"}</span>
            ${o.foreignCount ? `<span class="topic-shared-badge" title="Hat der Anbieter selbst erworben – nur zur Nutzung, nicht zum Kopieren">${o.foreignCount} davon nur zur Nutzung</span>` : ''}
            <span class="topic-shared-badge">von ${escapeHtml(o.sellerName)}</span>
            ${otherCreators.length ? `<span class="topic-shared-badge" title="Creator der Module">✍️ ${otherCreators.map(escapeHtml).join(', ')}</span>` : ''}
            ${o.sharedWithMe ? '<span class="topic-shared-badge use">👥 an dich geteilt</span>' : ''}
            ${o.kind === 'buyer' ? '<span class="topic-shared-badge" title="Weitergabe einer gekauften Kopie: nur zur Nutzung, kostenlos">↪ Weitergabe</span>' : ''}
            ${!o.sellerActive ? '<span class="topic-status inactive" title="Das Konto ist deaktiviert – seine Inhalte sind kostenlos">Konto deaktiviert</span>' : ''}
            ${o.copies ? `<span class="topic-shared-badge">📋 ${o.copies}× kopiert</span>` : ''}
          </div>
          <details class="shop-modules">
            <summary>Module anzeigen</summary>
            ${this._moduleListHtml(o, typeOf)}
          </details>
        </div>
        <div class="topic-card-actions">
          ${button('use')}
          ${button('copy')}
        </div>
      </div>`;

    card.querySelectorAll('.btn-acquire').forEach((btn) => {
      btn.addEventListener('click', () => this._acquire(o, btn.dataset.mode, btn));
    });
    return card;
  }

  /** Module eines Angebots, bei mehreren Lernthemen nach Thema gegliedert. */
  _moduleListHtml(o, typeOf) {
    const item = (m) => `<li>${typeOf(m.type).icon || '📦'} ${escapeHtml(m.title)}${m.own === false ? ' <span class="hint">(nur Use)</span>' : ''}</li>`;
    if (o.topicCount <= 1) return `<ul>${o.modules.map(item).join('')}</ul>`;
    const groups = new Map();
    for (const m of o.modules) {
      if (!groups.has(m.topicTitle)) groups.set(m.topicTitle, []);
      groups.get(m.topicTitle).push(m);
    }
    return [...groups].map(([title, list]) => `<p class="shop-topic-head">📘 ${escapeHtml(title)}</p><ul>${list.map(item).join('')}</ul>`).join('');
  }

  async _acquire(o, mode, btn) {
    const price = mode === 'copy' ? o.priceCopy : o.priceUse;
    const cost = price === 0 ? 'kostenlos' : `für ${points(price)}`;
    const where = o.scopeType === 'node'
      ? (o.nodeKind === 'book' ? 'als eigenes Book in deinen Notebooks' : 'in deinen Notebooks im Book „Erworben“')
      : 'unter deinen Lernthemen';
    const text = mode === 'copy'
      ? `Eigene Kopie von „${o.title}" ${cost} erwerben?\n\n` +
        `Sie liegt danach ${where}, gesperrt, bis du sie freigibst. Du darfst sie bearbeiten und eigene Module ergänzen. ` +
        `Die Module bleiben auf ihre Creator (${o.creators.join(', ')}) verzeichnet. ` +
        (o.foreignCount
          ? `\n\nKopiert werden die ${o.ownCount} Module von ${o.sellerName}. Die übrigen ${o.foreignCount} hat ${o.sellerName} selbst erworben – sie bekommst du ohne Aufpreis zur Nutzung (Use), kopieren lassen sie sich nicht.`
          : '') +
        (o.copies ? `\n\nDu hast das schon ${o.copies}× kopiert.` : '') +
        (price > 0 ? '\n\nEine Kopie lässt sich nicht zurückgeben.' +
          (o.allowUse ? ' Zum Ausprobieren erst „🔗 Use“ wählen – das kannst du 14 Tage lang mit Erstattung zurückgeben.' : '') : '')
      : `„${o.title}" ${cost} zur Nutzung erwerben?\n\n` +
        'Du verwendest das Original in deinen eigenen Themen- und Quick-Links, die Ergebnisse kommen zu dir. ' +
        'Änderungen des Anbieters wirken sofort' + (o.scopeType === 'node' ? ', und was er später hineinlegt, gehört automatisch dazu' : '') + '. ' +
        'Bearbeiten und weitergeben kannst du es nicht.' +
        (price > 0 ? '\n\nInnerhalb von 14 Tagen kannst du es zurückgeben und bekommst die Punkte erstattet.' : '');
    if (!(await this.app.appConfirm(text))) return;

    btn.disabled = true;
    try {
      const res = await this.app.api.acquireOffer(o.offerId, mode);
      if (!res || !res.success) throw new Error(res?.message || 'Erwerb fehlgeschlagen');
      this._setBalance(res.balance);
      this.app.showToast(
        mode === 'copy'
          ? `„${o.title}" liegt jetzt ${o.scopeType === 'node' ? 'in deinen Notebooks' : 'in deinen Lernthemen'} – gesperrt, bis du es freigibst.`
            + (res.foreignForUse ? ` ${res.foreignForUse} erworbene Module stehen dir zur Nutzung bereit.` : '')
          : `„${o.title}" steht dir jetzt in deinen Links zur Verfügung.`,
        'success',
      );
      await this.refresh();
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      btn.disabled = false;
    }
  }

  // ---- Meine Angebote ----

  async _renderMine() {
    const [offers, topics] = await Promise.all([this.app.api.getMyOffers(), this.app.api.getTopics()]);
    this._content.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'hint';
    intro.textContent = 'Anbieten geht über 👥 auf der Themenkarte, hier über „Thema anbieten" oder in den Notebooks über ⋯ › „Teilen" – ' +
      'auch für ganze Books, Bereiche, Abschnitte oder eine Auswahl von Modulen. Erworbene Module lassen sich zur Nutzung mit anbieten.';
    this._content.appendChild(intro);

    const pick = document.createElement('div');
    pick.className = 'shop-pick-row';
    const own = (Array.isArray(topics) ? topics : []).filter((t) => (t.modules || []).length > 0);
    pick.innerHTML = `
      <select id="shopPickTopic">
        <option value="">— Thema wählen —</option>
        ${own.map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.title)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" id="shopPickOpen">➕ Thema anbieten</button>`;
    this._content.appendChild(pick);
    pick.querySelector('#shopPickOpen').addEventListener('click', () => {
      const id = pick.querySelector('#shopPickTopic').value;
      if (id) this.openOfferDialog(id);
    });

    if (!Array.isArray(offers) || offers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<span class="empty-icon">🏷</span><p>Du bietest noch nichts an.</p>';
      this._content.appendChild(empty);
      return;
    }

    for (const o of offers) {
      const card = document.createElement('div');
      card.className = `topic-card ${o.active ? '' : 'topic-inactive'}`;
      const modes = [
        o.allowUse ? `🔗 Use · ${o.priceUse ? points(o.priceUse) : 'frei'}` : null,
        o.allowCopy ? `📥 Copy · ${o.priceCopy ? points(o.priceCopy) : 'frei'}` : null,
      ].filter(Boolean).join(' &nbsp; ');
      card.innerHTML = `
        <div class="topic-card-header">
          <div class="topic-card-info">
            <h3 class="topic-card-title">${(SCOPE_LABEL[o.scopeType === 'node' ? o.nodeKind : o.scopeType] || SCOPE_LABEL.topic).icon} ${escapeHtml(o.title)}</h3>
            <div class="topic-card-meta">
              <span class="topic-status ${o.active ? 'active' : 'inactive'}">${o.active ? '✅ im Shop' : '⏸ zurückgezogen'}</span>
              <span class="topic-shared-badge">${o.kind === 'buyer' ? '↪ frühere Weitergabe zur Nutzung' : `${(SCOPE_LABEL[o.scopeType === 'node' ? o.nodeKind : o.scopeType] || SCOPE_LABEL.topic).label}${o.scopeType !== 'topic' ? ` · ${o.topicCount} Lernthem${o.topicCount === 1 ? 'a' : 'en'}` : ''} · ${o.moduleCount} Module`}</span>
              ${o.includeForeign && o.kind !== 'buyer' ? '<span class="topic-shared-badge" title="Erworbene Module zur Nutzung mit angeboten">+ erworbene zur Nutzung</span>' : ''}
              <span class="topic-shared-badge use">${modes}</span>
              <span class="topic-shared-badge">${this._audienceText(o.audience)}</span>
              ${o.kind === 'creator' && o.copyCount ? `<span class="topic-shared-badge">📋 ${o.copyCount}× kopiert</span>` : ''}
            </div>
            ${this._holdersHtml(o.holders)}
          </div>
          <div class="topic-card-actions">
            <button class="btn btn-secondary btn-sm btn-edit-offer">✏️ Bearbeiten</button>
            ${o.active ? `<button class="btn btn-danger btn-sm btn-withdraw">${o.kind === 'buyer' ? '🗑 Beenden' : '⏸ Zurückziehen'}</button>` : ''}
          </div>
        </div>`;
      card.querySelector('.btn-edit-offer').addEventListener('click', () => this.openOfferDialog(
        o.scopeType === 'node' ? { type: 'node', id: o.nodeId }
          : o.scopeType === 'modules' ? { type: 'modules', id: o.id }
            : { type: 'topic', id: o.topicId },
      ));
      card.querySelector('.btn-withdraw')?.addEventListener('click', () => this._withdraw(o));
      this._bindHolders(card);
      this._content.appendChild(card);
    }
  }

  _audienceText(audience) {
    const list = Array.isArray(audience) ? audience : [];
    if (list.includes('*')) return '🌍 für alle';
    const groups = list.filter((e) => String(e).startsWith('group:')).length;
    const people = list.length - groups;
    const parts = [];
    if (people) parts.push(`${people} Person${people === 1 ? '' : 'en'}`);
    if (groups) parts.push(`${groups} Gruppe${groups === 1 ? '' : 'n'}`);
    return parts.length ? `👥 ${parts.join(' + ')}` : 'niemand';
  }

  /** Wer ein Nutzungsrecht hat. Nur kostenlose lassen sich entziehen. */
  _holdersHtml(holders) {
    if (!holders || holders.length === 0) return '';
    return `<details class="shop-modules"><summary>${holders.length} verwenden das Thema</summary><ul>
      ${holders.map((h) => `<li>${escapeHtml(h.name)} · ${h.pricePaid ? points(h.pricePaid) : 'kostenlos'}
        ${h.pricePaid ? '' : `<button class="btn btn-secondary btn-sm btn-revoke-holder" data-grant="${escapeAttr(h.grantId)}" title="Kostenloses Nutzungsrecht entziehen">entziehen</button>`}</li>`).join('')}
    </ul></details>`;
  }

  _bindHolders(root, after) {
    root.querySelectorAll('.btn-revoke-holder').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await this.app.appConfirm('Nutzungsrecht entziehen? Die Links dieser Person liefern das Thema danach nicht mehr aus.'))) return;
        const res = await this.app.api.revokeGrant(btn.dataset.grant);
        if (res && res.success) {
          this.app.showToast('Nutzungsrecht entzogen', 'info');
          if (after) after(); else this.refresh();
        } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
      });
    });
  }

  async _withdraw(o) {
    const text = o.kind === 'buyer'
      ? 'Weitergabe beenden? Alle, die das Thema darüber verwenden, verlieren es sofort.'
      : 'Angebot zurückziehen? Es verschwindet aus dem Shop. Wer schon gekauft hat, behält Kopie bzw. Nutzungsrecht.';
    if (!(await this.app.appConfirm(text))) return;
    const res = await this.app.api.withdrawOffer(o.id);
    if (res && res.success) {
      this.app.showToast(o.kind === 'buyer' ? 'Weitergabe beendet' : 'Angebot zurückgezogen', 'info');
      this.refresh();
    } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
  }

  // ---- Punktekonto ----

  async _renderPoints() {
    const data = await this.app.api.getMyPoints();
    this._setBalance(data.balance);
    const s = data.settings || {};
    const rows = (data.entries || []).map((e) => `
      <tr>
        <td>${new Date(e.createdAt).toLocaleDateString('de-DE')}</td>
        <td>${escapeHtml(REASON_LABELS[e.reason] || e.reason)}</td>
        <td>${escapeHtml(e.note || '')}</td>
        <td class="shop-delta ${e.delta < 0 ? 'neg' : 'pos'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
        <td>${e.balance}</td>
      </tr>`).join('');
    this._content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-number${data.balance < 0 ? ' negative' : ''}">${data.balance}</div><div class="stat-label">Punkte auf deinem Konto</div></div>
      </div>
      <p class="hint">So funktioniert es: Wer etwas aus dem Shop nimmt, zahlt den Preis an den Creator.
        Punkte sind vor allem eine Rückmeldung dafür, selbst etwas zu teilen – das Konto darf deshalb ins Minus
        gehen${typeof s.minBalance === 'number' ? `, für Einkäufe bis ${points(s.minBalance)}` : ''}.
        Neue Konten starten mit ${s.startPoints ?? 200} Punkt${(s.startPoints ?? 200) === 1 ? "" : "en"}.</p>
      ${rows ? `<table class="shop-ledger">
        <thead><tr><th>Datum</th><th>Art</th><th>Wofür</th><th>Punkte</th><th>Stand</th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<p class="hint">Noch keine Buchungen.</p>'}`;
  }

  // ---- Anbieten ----

  /**
   * Dialog „Im Shop anbieten“ für ein Lernthema, einen Notebook-Knoten oder
   * eine Auswahl von Modulen. target: { type, id } bzw. { type: 'modules', moduleIds }.
   *
   * Eigene Module lassen sich kopieren und nutzen; erworbene (fremde) nur
   * nutzen, und nur, wenn man sie ausdrücklich mit anbietet. Die Punkte gehen
   * anteilig an die Creator.
   */
  async openOfferDialog(target) {
    if (typeof target === 'string') target = { type: 'topic', id: target };
    const { api } = this.app;
    let state;
    let users = [];
    let groups = [];
    try {
      [state, users, groups] = await Promise.all([api.getOfferState(target), api.getColleagues(), api.getGroups()]);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!state || !state.type) {
      this.app.showToast('Fehler: ' + (state?.message || 'Lässt sich nicht anbieten'), 'error');
      return;
    }
    if (!Array.isArray(users)) users = [];
    if (!Array.isArray(groups)) groups = [];

    const offer = state.offer;
    const audience0 = offer ? offer.audience : ['*'];
    const own = state.ownModules.length;
    const foreign = state.foreignModules.length;
    const foreignCreators = [...new Set(state.foreignModules.map((m) => m.creatorName))];
    const what = SCOPE_LABEL[state.type === 'node' ? state.nodeKind : state.type] || SCOPE_LABEL.topic;

    // Eingetragene Personen, die die Auswahlliste nicht kennt (andere Schule) –
    // sie müssen sichtbar bleiben, sonst fielen sie beim Speichern heraus.
    const known = new Set(users.map((u) => u.id));
    const extra = (offer?.audienceUsers || []).filter((u) => !known.has(u.id));
    const extraRow = (u, checked) => `
          <label class="share-user-row"><input type="checkbox" class="co-entry" value="${escapeAttr(u.id)}" ${checked ? 'checked' : ''} />
            <span class="share-user-name">${escapeHtml(u.label || u.displayName || u.email)}
              <span class="import-module-type">🏫 ${escapeHtml(u.schoolName || 'andere Schule')}</span></span></label>`;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:min(440px,92vw); max-width:640px; max-height:88vh; overflow:auto">
        <h3>🛒 Im Shop anbieten: ${what.icon} <em>${escapeHtml(state.title)}</em></h3>
        <p class="hint">${what.label}${state.type !== 'topic' ? ` · ${state.topicCount} Lernthem${state.topicCount === 1 ? 'a' : 'en'}` : ''}
          · ${own} eigene${foreign ? ` · ${foreign} erworbene (${foreignCreators.map(escapeHtml).join(', ')})` : ''}
          ${state.type === 'node' ? '<br>Das Angebot wächst mit: Was du später hineinlegst, gehört für Käufer mit „Use“ automatisch dazu.' : ''}</p>
        ${offer && offer.fromDeactivation ? '<p class="login-error">Dieses Angebot wurde beim Deaktivieren deines Kontos auf „frei für alle" gestellt.</p>' : ''}

        ${state.type === 'modules' ? `
        <div class="form-group">
          <label for="coTitle">Name des Angebots</label>
          <input type="text" id="coTitle" maxlength="120" value="${escapeAttr(offer?.title || '')}" placeholder="z. B. Grundlagen Optik – Auswahl" />
        </div>` : ''}

        ${foreign ? `
        <label class="share-flag"><input type="checkbox" id="coForeign" ${!offer || offer.includeForeign ? 'checked' : ''} />
          <span><strong>Erworbene Module mit anbieten</strong> – nur zur Nutzung (Use), kopieren lassen sie sich nicht.
            Die Punkte dafür gehen an ihre Creator.</span></label>` : ''}

        <div class="shop-mode-row">
          <label class="share-flag"><input type="checkbox" id="coUse" ${!offer || offer.allowUse ? 'checked' : ''} />
            <span><strong>Use</strong> – Original verwenden${foreign ? ' (eigene und erworbene)' : ''}</span></label>
          <input type="number" id="coPriceUse" min="0" step="1" value="${offer ? offer.priceUse : 0}" class="shop-price" /> Punkte
        </div>
        <div class="shop-mode-row">
          <label class="share-flag"><input type="checkbox" id="coCopy" ${offer && offer.allowCopy ? 'checked' : ''} ${own ? '' : 'disabled'} />
            <span><strong>Copy</strong> – eigene Kopie ${own ? (foreign ? '(nur deine Module; die erworbenen bekommt der Käufer zur Nutzung dazu)' : '') : '(geht nur mit eigenen Modulen)'}</span></label>
          <input type="number" id="coPriceCopy" min="0" step="1" value="${offer ? offer.priceCopy : 0}" class="shop-price" ${own ? '' : 'disabled'} /> Punkte
        </div>
        <p class="hint">0 Punkte heißt frei. Enthält das Angebot Module anderer Creator, bekommt jeder den Anteil seiner Module.</p>

        <p class="hint"><strong>Für wen?</strong> Ohne Auswahl einzelner Personen oder Gruppen sehen es alle.</p>
        <label class="share-flag shop-all"><input type="checkbox" class="co-all" ${audience0.includes('*') ? 'checked' : ''} />
          <span><strong>Alle Kolleginnen und Kollegen</strong></span></label>
        <div class="share-user-list co-list">
          ${groups.map((g) => `
            <label class="share-user-row"><input type="checkbox" class="co-entry" value="group:${escapeAttr(g.id)}"
              ${audience0.includes(`group:${g.id}`) ? 'checked' : ''} />
              <span class="share-user-name">👥 ${escapeHtml(g.name)}
                <span class="import-module-type">${(g.memberIds || []).length} Mitglieder</span></span></label>`).join('')}
          ${users.map((u) => `
            <label class="share-user-row"><input type="checkbox" class="co-entry" value="${escapeAttr(u.id)}"
              ${audience0.includes(u.id) ? 'checked' : ''} />
              <span class="share-user-name">${escapeHtml(u.displayName || u.email)}</span></label>`).join('')}
          ${extra.map((u) => extraRow(u, audience0.includes(u.id))).join('')}
        </div>
        <div class="share-lookup">
          <input type="email" class="co-lookup" placeholder="Person einer anderen Schule: vollständige E-Mail-Adresse" autocomplete="off" />
          <button type="button" class="btn btn-secondary btn-sm co-lookup-btn">+ Hinzufügen</button>
        </div>
        ${offer ? this._holdersHtml(offer.holders) : ''}

        ${state.legacyShare ? `
        <div class="settings-group" style="margin-top:18px">
          <h3>↪ Frühere Weitergabe zur Nutzung</h3>
          <p class="hint">Diese Weitergabe stammt aus der Zeit vor den gemischten Angeboten. Sie gilt weiter;
            neue Weitergaben laufen über „Erworbene Module mit anbieten“ oben.</p>
          ${this._holdersHtml(state.legacyShare.holders)}
          <div class="confirm-actions"><button class="btn btn-danger btn-sm" id="btnEndLegacy">🗑 Weitergabe beenden</button></div>
        </div>` : ''}

        <div class="confirm-actions">
          <button class="btn btn-primary" id="btnSaveOffer">${offer && offer.active ? 'Angebot speichern' : 'In den Shop stellen'}</button>
          ${offer && offer.active ? '<button class="btn btn-danger" id="btnWithdrawOffer">⏸ Zurückziehen</button>' : ''}
          <button class="btn btn-secondary" id="btnOfferClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const done = (msg) => {
      this.app.showToast(msg, 'success');
      close();
      // Der Dialog kann über dem Shop oder über den Notebooks liegen.
      if (document.getElementById('view-teacher-shop')?.classList.contains('active')) this.refresh();
      else if (document.getElementById('view-teacher-notebooks')?.classList.contains('active')) this.app.notebooksView.refresh();
    };
    overlay.querySelector('#btnOfferClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    this._bindHolders(overlay, () => { close(); this.openOfferDialog(target); });

    const picked = () => [...overlay.querySelectorAll('.co-entry:checked')].map((cb) => cb.value);
    // "Alle" schaltet die Einzelauswahl ab – sonst wäre der Zustand widersprüchlich.
    const coAll = overlay.querySelector('.co-all');
    const syncAll = () => overlay.querySelectorAll('.co-entry').forEach((cb) => { cb.disabled = !!coAll.checked; });
    coAll.addEventListener('change', syncAll);
    syncAll();

    // Person einer anderen Schule über die genaue E-Mail-Adresse ergänzen.
    const lookup = overlay.querySelector('.co-lookup');
    const add = async () => {
      const email = lookup.value.trim();
      if (!email) return;
      const res = await this.app.api.lookupColleague(email);
      if (!res || !res.id) { this.app.showToast(res?.message || 'Nicht gefunden.', 'error'); return; }
      let cb = [...overlay.querySelectorAll('.co-entry')].find((x) => x.value === res.id);
      if (!cb) {
        overlay.querySelector('.co-list').insertAdjacentHTML('beforeend', extraRow(res, true));
        cb = [...overlay.querySelectorAll('.co-entry')].find((x) => x.value === res.id);
      }
      cb.checked = true;
      // Eine bestimmte Person schließt "alle" aus.
      if (coAll.checked) { coAll.checked = false; syncAll(); }
      lookup.value = '';
      this.app.showToast(`${res.displayName} hinzugefügt${res.schoolName && !res.sameSchool ? ` (${res.schoolName})` : ''} – bitte speichern.`, 'success');
    };
    overlay.querySelector('.co-lookup-btn').addEventListener('click', add);
    lookup.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    overlay.querySelector('#btnSaveOffer').addEventListener('click', async () => {
      const audience = coAll.checked ? ['*'] : picked();
      const body = {
        type: state.type,
        topicId: state.topicId,
        nodeId: state.nodeId,
        moduleIds: state.type === 'modules' ? state.moduleIds : undefined,
        offerId: state.type === 'modules' ? offer?.id : undefined,
        title: overlay.querySelector('#coTitle')?.value.trim() || undefined,
        includeForeign: overlay.querySelector('#coForeign') ? overlay.querySelector('#coForeign').checked : true,
        allowUse: overlay.querySelector('#coUse').checked,
        allowCopy: overlay.querySelector('#coCopy').checked,
        priceUse: Number(overlay.querySelector('#coPriceUse').value || 0),
        priceCopy: Number(overlay.querySelector('#coPriceCopy').value || 0),
        audience: audience.length ? audience : ['*'],
        active: true,
      };
      const res = await api.saveOffer(body);
      if (res && res.success) done('Angebot steht im Shop');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    overlay.querySelector('#btnWithdrawOffer')?.addEventListener('click', async () => {
      if (!(await this.app.appConfirm('Angebot zurückziehen? Wer schon gekauft hat, behält Kopie bzw. Nutzungsrecht.'))) return;
      const res = await api.withdrawOffer(offer.id);
      if (res && res.success) done('Angebot zurückgezogen');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    overlay.querySelector('#btnEndLegacy')?.addEventListener('click', async () => {
      if (!(await this.app.appConfirm('Weitergabe beenden? Alle, die das Thema darüber verwenden, verlieren es sofort.'))) return;
      const res = await api.withdrawOffer(state.legacyShare.id);
      if (res && res.success) done('Weitergabe beendet');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });
  }
}
