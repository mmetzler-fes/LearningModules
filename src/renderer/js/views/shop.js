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
// Anbieten kann nur der Creator, gegen Punkte oder frei. Wer eine Kopie
// gekauft hat, darf sie kostenlos zur Nutzung an wenige Kolleginnen
// weitergeben.

const TABS = ['offers', 'mine', 'points'];

const REASON_LABELS = {
  start: 'Startguthaben',
  purchase: 'Kauf',
  sale: 'Verkauf',
  'yearly-decay': 'Jahresabzug',
  'yearly-bonus': 'Jahresgeschenk',
  merge: 'Konto übernommen',
  admin: 'Admin',
};

const points = (n) => `${n} Punkt${n === 1 ? '' : 'e'}`;

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
    await this.openOfferDialog(topicId);
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
    const card = document.createElement('div');
    card.className = 'topic-card shop-card';
    const otherCreators = o.creators.filter((c) => c !== o.sellerName);
    const typeOf = (t) => (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[t]) || {};

    const button = (mode) => {
      const allowed = mode === 'copy' ? o.allowCopy : o.allowUse;
      if (!allowed) return '';
      const price = mode === 'copy' ? o.priceCopy : o.priceUse;
      if (mode === 'use' && o.hasUse) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Du verwendest dieses Thema bereits">✓ In Verwendung</button>';
      }
      const poor = price > balance;
      const label = mode === 'copy' ? '📥 Copy' : '🔗 Use';
      const priceLabel = price === 0 ? 'frei' : points(price);
      return `<button class="btn ${mode === 'copy' ? 'btn-primary' : 'btn-secondary'} btn-sm btn-acquire" data-mode="${mode}"
        ${poor ? 'disabled' : ''} title="${poor ? 'Nicht genug Punkte' : mode === 'copy'
          ? 'Eigene Kopie: bearbeiten erlaubt, Weitergabe nur zur Nutzung'
          : 'Original in eigenen Links verwenden – Änderungen des Creators wirken sofort'}">
        ${label} · ${priceLabel}</button>`;
    };

    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(o.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(o.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-module-count">${o.modules.length} Module</span>
            <span class="topic-shared-badge">von ${escapeHtml(o.sellerName)}</span>
            ${otherCreators.length ? `<span class="topic-shared-badge" title="Creator der Module">✍️ ${otherCreators.map(escapeHtml).join(', ')}</span>` : ''}
            ${o.sharedWithMe ? '<span class="topic-shared-badge use">👥 an dich geteilt</span>' : ''}
            ${o.kind === 'buyer' ? '<span class="topic-shared-badge" title="Weitergabe einer gekauften Kopie: nur zur Nutzung, kostenlos">↪ Weitergabe</span>' : ''}
            ${!o.sellerActive ? '<span class="topic-status inactive" title="Das Konto ist deaktiviert – seine Inhalte sind kostenlos">Konto deaktiviert</span>' : ''}
            ${o.copies ? `<span class="topic-shared-badge">📋 ${o.copies}× kopiert</span>` : ''}
          </div>
          <details class="shop-modules">
            <summary>Module anzeigen</summary>
            <ul>${o.modules.map((m) => `<li>${typeOf(m.type).icon || '📦'} ${escapeHtml(m.title)}</li>`).join('')}</ul>
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

  async _acquire(o, mode, btn) {
    const price = mode === 'copy' ? o.priceCopy : o.priceUse;
    const cost = price === 0 ? 'kostenlos' : `für ${points(price)}`;
    const text = mode === 'copy'
      ? `Eigene Kopie von „${o.title}" ${cost} erwerben?\n\n` +
        'Du wirst Owner und Buyer: Du darfst die Kopie bearbeiten und eigene Module ergänzen. ' +
        `Die vorhandenen Module bleiben auf ${o.creators.join(', ')} als Creator verzeichnet. ` +
        'Weitergeben kannst du die Kopie nur zur Nutzung (Use), kostenlos und an wenige Personen.' +
        (o.copies ? `\n\nDu hast dieses Thema schon ${o.copies}× kopiert.` : '')
      : `„${o.title}" ${cost} zur Nutzung erwerben?\n\n` +
        'Du verwendest das Original in deinen eigenen Themen- und Quick-Links, die Ergebnisse kommen zu dir. ' +
        'Änderungen des Creators wirken sofort. Bearbeiten und weitergeben kannst du es nicht.';
    if (!(await this.app.appConfirm(text))) return;

    btn.disabled = true;
    try {
      const res = await this.app.api.acquireOffer(o.offerId, mode);
      if (!res || !res.success) throw new Error(res?.message || 'Erwerb fehlgeschlagen');
      this._setBalance(res.balance);
      this.app.showToast(
        mode === 'copy'
          ? `„${o.title}" liegt jetzt in deinen Lernthemen – gesperrt, bis du es freigibst.`
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
    intro.textContent = 'Anbieten geht über 👥 auf der Themenkarte oder hier über „Thema anbieten". ' +
      'Angeboten werden immer nur die Module, die du selbst verfasst hast.';
    this._content.appendChild(intro);

    const pick = document.createElement('div');
    pick.className = 'shop-pick-row';
    const own = (Array.isArray(topics) ? topics : []).filter((t) => (t.modules || []).length > 0);
    pick.innerHTML = `
      <select class="setting-select" id="shopPickTopic">
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
            <h3 class="topic-card-title">${escapeHtml(o.title)}</h3>
            <div class="topic-card-meta">
              <span class="topic-status ${o.active ? 'active' : 'inactive'}">${o.active ? '✅ im Shop' : '⏸ zurückgezogen'}</span>
              <span class="topic-shared-badge">${o.kind === 'buyer' ? '↪ Weitergabe zur Nutzung' : '✍️ als Creator'}</span>
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
      card.querySelector('.btn-edit-offer').addEventListener('click', () => this.openOfferDialog(o.topicId));
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
        <div class="stat-card"><div class="stat-number">${data.balance}</div><div class="stat-label">Punkte auf deinem Konto</div></div>
      </div>
      <p class="hint">So funktioniert es: Wer etwas aus dem Shop nimmt, zahlt den Preis an den Creator.
        Am 1.1. werden ${s.yearlyDecayPercent ?? 10} % jedes Kontos abgezogen, danach bekommt jeder
        ${points(s.yearlyBonus ?? 100)} geschenkt – Punkte sind zum Tauschen da, nicht zum Sparen.
        Neue Konten starten mit ${points(s.startPoints ?? 200)}.</p>
      ${rows ? `<table class="shop-ledger">
        <thead><tr><th>Datum</th><th>Art</th><th>Wofür</th><th>Punkte</th><th>Stand</th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<p class="hint">Noch keine Buchungen.</p>'}`;
  }

  // ---- Anbieten / Weitergeben ----

  /**
   * Dialog für ein eigenes Thema. Zwei Teile, je nach Rolle:
   *   – als Creator: die eigenen Module anbieten (Copy/Use, Preise, Zielgruppe)
   *   – als Buyer: fremde Module zur Nutzung weitergeben (kostenlos, begrenzt)
   */
  async openOfferDialog(topicId) {
    const { api } = this.app;
    let state;
    let users = [];
    let groups = [];
    try {
      [state, users, groups] = await Promise.all([api.getTopicOfferState(topicId), api.getColleagues(), api.getGroups()]);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!state || !state.topicId) {
      this.app.showToast('Fehler: ' + (state?.message || 'Thema kann nicht angeboten werden'), 'error');
      return;
    }
    if (!Array.isArray(users)) users = [];
    if (!Array.isArray(groups)) groups = [];

    const co = state.creatorOffer;
    const bs = state.buyerShare;
    const coAudience = co ? co.audience : ['*'];
    const bsAudience = bs ? bs.audience : [];

    const audienceList = (prefix, selected, allowAll) => `
      ${allowAll ? `<label class="share-flag shop-all"><input type="checkbox" class="${prefix}-all" ${selected.includes('*') ? 'checked' : ''} />
        <span><strong>Alle Kolleginnen und Kollegen</strong></span></label>` : ''}
      <div class="share-user-list ${prefix}-list">
        ${groups.map((g) => `
          <label class="share-user-row"><input type="checkbox" class="${prefix}-entry" value="group:${escapeAttr(g.id)}"
            ${selected.includes(`group:${g.id}`) ? 'checked' : ''} />
            <span class="share-user-name">👥 ${escapeHtml(g.name)}
              <span class="import-module-type">${(g.memberIds || []).length} Mitglieder</span></span></label>`).join('')}
        ${users.map((u) => `
          <label class="share-user-row"><input type="checkbox" class="${prefix}-entry" value="${escapeAttr(u.id)}"
            ${selected.includes(u.id) ? 'checked' : ''} />
            <span class="share-user-name">${escapeHtml(u.displayName || u.email)}</span></label>`).join('')}
      </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:440px; max-width:620px; max-height:88vh; overflow:auto">
        <h3>🛒 Im Shop anbieten: <em>${escapeHtml(state.title)}</em></h3>
        <p class="hint">${state.ownModules.length} von dir verfasste${state.ownModules.length === 1 ? 's' : ''} Modul${state.ownModules.length === 1 ? '' : 'e'}
          ${state.foreignModules.length ? ` · ${state.foreignModules.length} fremde (${[...new Set(state.foreignModules.map((m) => m.creatorName))].map(escapeHtml).join(', ')})` : ''}</p>

        ${state.canOfferAsCreator ? `
        <div class="settings-group">
          <h3>✍️ Als Creator anbieten</h3>
          <p class="hint">Angeboten werden nur deine eigenen Module${state.foreignModules.length ? ' – die fremden in diesem Thema gehören nicht dazu' : ''}.
            Wer etwas nimmt, zahlt dir den Preis. 0 heißt frei.</p>
          ${co && co.fromDeactivation ? '<p class="login-error">Dieses Angebot wurde beim Deaktivieren deines Kontos auf „frei für alle" gestellt.</p>' : ''}
          <div class="shop-mode-row">
            <label class="share-flag"><input type="checkbox" id="coUse" ${!co || co.allowUse ? 'checked' : ''} />
              <span><strong>Use</strong> – Original verwenden</span></label>
            <input type="number" id="coPriceUse" min="0" step="1" value="${co ? co.priceUse : 0}" class="shop-price" /> Punkte
          </div>
          <div class="shop-mode-row">
            <label class="share-flag"><input type="checkbox" id="coCopy" ${co && co.allowCopy ? 'checked' : ''} />
              <span><strong>Copy</strong> – eigene Kopie</span></label>
            <input type="number" id="coPriceCopy" min="0" step="1" value="${co ? co.priceCopy : 0}" class="shop-price" /> Punkte
          </div>
          <p class="hint"><strong>Für wen?</strong> Ohne Auswahl einzelner Personen oder Gruppen sehen es alle.</p>
          ${audienceList('co', coAudience, true)}
          ${co ? this._holdersHtml(co.holders) : ''}
          <div class="confirm-actions">
            <button class="btn btn-primary" id="btnSaveCreatorOffer">${co && co.active ? 'Angebot speichern' : 'In den Shop stellen'}</button>
            ${co && co.active ? '<button class="btn btn-danger" id="btnWithdrawCreatorOffer">⏸ Zurückziehen</button>' : ''}
          </div>
        </div>` : `
        <p class="hint">Dieses Thema enthält keine von dir verfassten Module – anbieten kann nur der Creator.</p>`}

        ${state.canShareAsBuyer ? `
        <div class="settings-group" style="margin-top:18px">
          <h3>↪ Zur Nutzung weitergeben</h3>
          <p class="hint">Fremde Module, die du erworben hast, darfst du an höchstens
            <strong>${state.buyerShareMax}</strong> Personen weitergeben – nur zum Verwenden (Use), kostenlos und ohne
            Punkte für dich. Wen du abwählst, verliert die Nutzung sofort.</p>
          ${audienceList('bs', bsAudience, false)}
          <p class="hint" id="bsCount"></p>
          ${bs ? this._holdersHtml(bs.holders) : ''}
          <div class="confirm-actions">
            <button class="btn btn-primary" id="btnSaveBuyerShare">Weitergabe speichern</button>
          </div>
        </div>` : ''}

        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnOfferClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const done = (msg) => { this.app.showToast(msg, 'success'); close(); this.refresh(); };
    overlay.querySelector('#btnOfferClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    this._bindHolders(overlay, () => { close(); this.openOfferDialog(topicId); });

    const picked = (prefix) => [...overlay.querySelectorAll(`.${prefix}-entry:checked`)].map((cb) => cb.value);

    // "Alle" schaltet die Einzelauswahl ab – sonst wäre der Zustand widersprüchlich.
    const coAll = overlay.querySelector('.co-all');
    const syncCo = () => {
      overlay.querySelectorAll('.co-entry').forEach((cb) => { cb.disabled = !!coAll?.checked; });
    };
    coAll?.addEventListener('change', syncCo);
    syncCo();

    const memberCount = () => {
      const ids = new Set();
      for (const v of picked('bs')) {
        if (v.startsWith('group:')) {
          const g = groups.find((x) => `group:${x.id}` === v);
          for (const m of (g?.memberIds || [])) ids.add(m);
        } else ids.add(v);
      }
      ids.delete(this.app.state.currentUser?.id);
      return ids.size;
    };
    const bsCount = overlay.querySelector('#bsCount');
    const syncBs = () => {
      if (!bsCount) return;
      const n = memberCount();
      bsCount.textContent = `${n} von höchstens ${state.buyerShareMax} Personen gewählt`;
      bsCount.classList.toggle('login-error', n > state.buyerShareMax);
    };
    overlay.querySelectorAll('.bs-entry').forEach((cb) => cb.addEventListener('change', syncBs));
    syncBs();

    overlay.querySelector('#btnSaveCreatorOffer')?.addEventListener('click', async () => {
      const audience = coAll?.checked ? ['*'] : picked('co');
      const body = {
        allowUse: overlay.querySelector('#coUse').checked,
        allowCopy: overlay.querySelector('#coCopy').checked,
        priceUse: Number(overlay.querySelector('#coPriceUse').value || 0),
        priceCopy: Number(overlay.querySelector('#coPriceCopy').value || 0),
        audience: audience.length ? audience : ['*'],
        active: true,
      };
      const res = await this.app.api.saveCreatorOffer(topicId, body);
      if (res && res.success) done('Angebot steht im Shop');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    overlay.querySelector('#btnWithdrawCreatorOffer')?.addEventListener('click', async () => {
      if (!(await this.app.appConfirm('Angebot zurückziehen? Wer schon gekauft hat, behält Kopie bzw. Nutzungsrecht.'))) return;
      const res = await this.app.api.withdrawOffer(co.id);
      if (res && res.success) done('Angebot zurückgezogen');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    overlay.querySelector('#btnSaveBuyerShare')?.addEventListener('click', async () => {
      if (memberCount() > state.buyerShareMax) {
        this.app.showToast(`Höchstens ${state.buyerShareMax} Personen.`, 'error');
        return;
      }
      const res = await this.app.api.saveBuyerShare(topicId, picked('bs'));
      if (res && res.success) done(res.removed ? 'Weitergabe beendet' : 'Weitergabe gespeichert');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });
  }
}
