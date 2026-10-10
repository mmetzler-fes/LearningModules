import { escapeHtml, escapeAttr } from '../utils.js';
import { openFeedbackDialog, ratingBadge } from './feedback.js';
import { CategoryPicker, categoryChips, categoryOptions, ensureCategories, withDescendants } from './categories.js';

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
// sich kopieren und nutzen, erworbene nur nutzen.
//
// Alles ist frei. Statt Punkten zeigt „Geteilt & genutzt“, wen das eigene
// Material erreicht, und wer etwas nutzt, kann es bewerten
// (docs/nutzung-und-bewertung.md).

const TABS = ['offers', 'mine', 'impact'];

/** Arten der früheren Punkte-Buchungen (bis Oktober 2026), für den Verlauf. */
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
    /** Nur Angebote mit Modulen dieses Creators: { id, name } oder null. */
    this._creatorFilter = null;
    this._search = document.getElementById('shopSearch');
    this._onlyShared = document.getElementById('shopOnlyShared');
    this._subject = document.getElementById('shopSubject');
    this._stage = document.getElementById('shopStage');
    this._filterBar = document.getElementById('shopFilterBar');

    document.querySelectorAll('#view-teacher-shop .admin-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._showTab(btn.dataset.tab));
    });
    this._search?.addEventListener('input', () => this._renderOffers());
    this._onlyShared?.addEventListener('change', () => this._renderOffers());
    this._subject?.addEventListener('change', () => this._renderOffers());
    this._stage?.addEventListener('change', () => this._renderOffers());
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
        [this._catalog] = await Promise.all([this.app.api.getShopOffers(), ensureCategories(this.app)]);
        this._fillCategoryFilters();
        this._renderOffers();
      } else if (this._tab === 'mine') {
        await this._renderMine();
      } else {
        await this._renderImpact();
      }
    } catch (err) {
      this._content.innerHTML = `<p class="login-error">Fehler: ${escapeHtml(err.message)}</p>`;
    }
  }

  // ---- Angebote ----

  _renderOffers() {
    if (this._tab !== 'offers') return;
    const all = (this._catalog && this._catalog.offers) || [];
    const q = (this._search?.value || '').toLowerCase().trim();
    const onlyShared = !!this._onlyShared?.checked;
    const creator = this._creatorFilter;
    // „Elektrotechnik“ findet auch alles darunter, etwa „SPS-Programmierung“.
    const subject = this._subject?.value ? withDescendants(this.app, [this._subject.value]) : null;
    const stage = this._stage?.value ? withDescendants(this.app, [this._stage.value]) : null;
    const list = all.filter((o) => {
      if (onlyShared && !o.sharedWithMe) return false;
      if (subject && !(o.categoryIds || []).some((id) => subject.has(id))) return false;
      if (stage && !(o.categoryIds || []).some((id) => stage.has(id))) return false;
      if (creator && !(o.creatorList || []).some((c) => c.id === creator.id)) return false;
      if (!q) return true;
      return [o.title, o.description, o.sellerName, ...o.modules.map((m) => m.title)]
        .some((s) => (s || '').toLowerCase().includes(q));
    });

    this._content.innerHTML = '';
    if (this._catalog?.shareHint) this._content.appendChild(this._shareHint());
    if (creator) this._content.appendChild(this._creatorBanner(creator));
    if (list.length === 0) {
      const html = all.length === 0
        ? '<div class="empty-state"><span class="empty-icon">🛒</span><p>Im Moment bietet niemand etwas an.</p></div>'
        : '<div class="empty-state"><span class="empty-icon">🔍</span><p>Kein Angebot passt zur Suche.</p></div>';
      this._content.insertAdjacentHTML('beforeend', html);
      return;
    }
    for (const offer of list) this._content.appendChild(this._offerCard(offer));
  }

  /** Fach- und Stufen-Auswahl: nur, was in den Angeboten vorkommt (samt Oberbegriffen). */
  _fillCategoryFilters() {
    const used = new Set((this._catalog?.offers || []).flatMap((o) => o.categoryIds || []));
    for (const [sel, facet, all] of [[this._subject, 'subject', '📚 Alle Fächer'], [this._stage, 'stage', '🎓 Alle Stufen']]) {
      if (!sel) continue;
      const current = sel.value;
      sel.innerHTML = `<option value="">${all}</option>` + categoryOptions(this.app, facet, { onlyUsed: used });
      sel.value = [...sel.options].some((o) => o.value === current) ? current : '';
    }
  }

  /** Freundlicher Hinweis für alle, die viel übernommen und noch nichts geteilt haben. */
  _shareHint() {
    const g = this._catalog.giveAndTake || {};
    const box = document.createElement('div');
    box.className = 'share-hint';
    box.innerHTML = `
      <span class="share-hint-icon">🤝</span>
      <div><strong>Material teilen &amp; Wirkung schenken.</strong>
        Du hast schon ${g.taken}× etwas aus dem Shop übernommen – magst du auch etwas teilen?
        Ein Lernthema, das bei dir gut läuft, hilft anderen genauso.
        <div class="share-hint-actions">
          <button class="btn btn-primary btn-sm" data-go="mine">🏷 Etwas anbieten</button>
          <button class="btn btn-secondary btn-sm" data-go="impact">📈 Geteilt & genutzt</button>
        </div></div>`;
    box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => this._showTab(b.dataset.go)));
    return box;
  }

  /** Kopfzeile beim Filter nach einem Creator: was er teilt und wen es erreicht. */
  _creatorBanner(creator) {
    const box = document.createElement('div');
    box.className = 'creator-banner';
    box.innerHTML = `<div class="creator-banner-text">✍️ Angebote mit Modulen von <strong>${escapeHtml(creator.name)}</strong>
      <span class="hint creator-banner-stats">…</span></div>
      <button class="btn btn-secondary btn-sm">✕ alle Angebote</button>`;
    box.querySelector('button').addEventListener('click', () => { this._creatorFilter = null; this._renderOffers(); });
    this.app.api.getCreatorImpact(creator.id).then((s) => {
      if (!s || s.id !== creator.id) return;
      const parts = [
        `${s.modules} Modul${s.modules === 1 ? '' : 'e'} verfasst`,
        s.teachers ? `genutzt von ${s.teachers} Lehrkr${s.teachers === 1 ? 'aft' : 'äften'}${s.schools > 1 ? ` an ${s.schools} Schulen` : ''}` : null,
        s.runs ? `${s.runs} Bearbeitungen im Unterricht` : null,
        s.rating?.count ? `★ ${String(s.rating.avg).replace('.', ',')} (${s.rating.count})` : null,
        s.rating?.thanks ? `👍 ${s.rating.thanks}` : null,
      ].filter(Boolean);
      box.querySelector('.creator-banner-stats').textContent = '· ' + parts.join(' · ');
    }).catch(() => {});
    return box;
  }

  _offerCard(o) {
    const card = document.createElement('div');
    card.className = 'topic-card shop-card';
    const otherCreators = (o.creatorList || []).filter((c) => c.id !== o.sellerId);
    const creatorLink = (c) => `<button type="button" class="link-btn creator-link" data-creator="${escapeAttr(c.id)}" data-name="${escapeAttr(c.name)}" title="Alle Angebote mit Modulen von ${escapeAttr(c.name)}">${escapeHtml(c.name)}</button>`;
    const typeOf = (t) => (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[t]) || {};
    const scope = SCOPE_LABEL[o.scopeType === 'node' ? o.nodeKind : o.scopeType] || SCOPE_LABEL.topic;

    const button = (mode) => {
      const allowed = mode === 'copy' ? o.allowCopy : o.allowUse;
      if (!allowed) return '';
      if (mode === 'use' && o.hasUse) {
        return '<button class="btn btn-secondary btn-sm" disabled title="Du verwendest das bereits">✓ In Verwendung</button>';
      }
      const label = mode === 'copy' ? '📥 Copy' : '🔗 Use';
      return `<button class="btn ${mode === 'copy' ? 'btn-primary' : 'btn-secondary'} btn-sm btn-acquire" data-mode="${mode}"
        title="${escapeAttr(mode === 'copy'
          ? (o.foreignCount ? `Eigene Kopie der ${o.ownCount} Module von ${o.sellerName}; die übrigen ${o.foreignCount} bekommst du zur Nutzung dazu` : 'Eigene Kopie: bearbeiten erlaubt, Weitergabe nur zur Nutzung')
          : 'Original in eigenen Links verwenden – Änderungen des Creators wirken sofort')}">
        ${label}</button>`;
    };
    const rateable = o.rateable || [];

    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${scope.icon} ${escapeHtml(o.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(o.description || '')}</p>
          ${(o.categoryIds || []).length ? `<div class="shop-cats">${categoryChips(this.app, o.categoryIds)}</div>` : ''}
          <div class="topic-card-meta">
            <span class="topic-shared-badge" title="${o.scopeType === 'node' ? 'Kommt beim Anbieter etwas dazu, gehört es bei Use automatisch dazu' : ''}">${scope.label}${o.scopeType !== 'topic' ? ` · ${o.topicCount} Lernthem${o.topicCount === 1 ? 'a' : 'en'}` : ''}</span>
            <span class="topic-module-count">${o.modules.length} Modul${o.modules.length === 1 ? "" : "e"}</span>
            ${o.foreignCount ? `<span class="topic-shared-badge" title="Hat der Anbieter selbst erworben – nur zur Nutzung, nicht zum Kopieren">${o.foreignCount} davon nur zur Nutzung</span>` : ''}
            <span class="topic-shared-badge">von ${creatorLink({ id: o.sellerId, name: o.sellerName })}</span>
            ${otherCreators.length ? `<span class="topic-shared-badge" title="Creator der Module">✍️ ${otherCreators.map(creatorLink).join(', ')}</span>` : ''}
            ${ratingBadge(o.rating)}
            ${o.sharedWithMe ? '<span class="topic-shared-badge use">👥 an dich geteilt</span>' : ''}
            ${o.kind === 'buyer' ? '<span class="topic-shared-badge" title="Weitergabe einer erworbenen Kopie: nur zur Nutzung">↪ Weitergabe</span>' : ''}
            ${!o.sellerActive ? '<span class="topic-status inactive" title="Das Konto ist deaktiviert – seine Inhalte bleiben im Shop">Konto deaktiviert</span>' : ''}
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
          ${rateable.length ? '<button class="btn btn-secondary btn-sm btn-rate" title="Nützlichkeit bewerten, Danke sagen, Rückmeldung geben">⭐ Bewerten</button>' : ''}
        </div>
      </div>`;

    card.querySelectorAll('.btn-acquire').forEach((btn) => {
      btn.addEventListener('click', () => this._acquire(o, btn.dataset.mode, btn));
    });
    card.querySelectorAll('.creator-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._creatorFilter = { id: btn.dataset.creator, name: btn.dataset.name };
        this._renderOffers();
        this._content.scrollIntoView?.({ block: 'start' });
      });
    });
    card.querySelector('.btn-rate')?.addEventListener('click', () => this._rate(o));
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

  /** Bewerten – bei mehreren genutzten Lernthemen im Angebot erst eins wählen. */
  async _rate(o) {
    const list = o.rateable || [];
    let topicId = list[0]?.topicId;
    if (list.length > 1) {
      topicId = await this._choose('Welches Lernthema möchtest du bewerten?', list.map((t) => ({ value: t.topicId, label: `📘 ${t.title}` })));
      if (!topicId) return;
    }
    if (topicId && (await openFeedbackDialog(this.app, topicId))) await this.refresh();
  }

  /** Eine Wahl aus wenigen Möglichkeiten; liefert den Wert oder null. */
  _choose(title, options) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="import-modules-card" style="min-width:min(380px,92vw)">
          <h3>${escapeHtml(title)}</h3>
          <div class="choose-list">${options.map((o, i) => `<button class="btn btn-secondary choose-item" data-i="${i}">${escapeHtml(o.label)}</button>`).join('')}</div>
          <div class="confirm-actions"><button class="btn btn-secondary choose-cancel">Abbrechen</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelectorAll('.choose-item').forEach((b) => b.addEventListener('click', () => done(options[Number(b.dataset.i)].value)));
      overlay.querySelector('.choose-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
  }

  async _acquire(o, mode, btn) {
    const where = o.scopeType === 'node'
      ? (o.nodeKind === 'book' ? 'als eigenes Book in deinen Notebooks' : 'in deinen Notebooks im Book „Erworben“')
      : 'unter deinen Lernthemen';
    const text = mode === 'copy'
      ? `Eigene Kopie von „${o.title}" übernehmen?\n\n` +
        `Sie liegt danach ${where}, gesperrt, bis du sie freigibst. Du darfst sie bearbeiten und eigene Module ergänzen. ` +
        `Die Module bleiben auf ihre Creator (${o.creators.join(', ')}) verzeichnet. ` +
        (o.foreignCount
          ? `\n\nKopiert werden die ${o.ownCount} Module von ${o.sellerName}. Die übrigen ${o.foreignCount} hat ${o.sellerName} selbst erworben – sie bekommst du ohne Aufpreis zur Nutzung (Use), kopieren lassen sie sich nicht.`
          : '') +
        (o.copies ? `\n\nDu hast das schon ${o.copies}× kopiert.` : '')
      : `„${o.title}" zur Nutzung übernehmen?\n\n` +
        'Du verwendest das Original in deinen eigenen Themen- und Quick-Links, die Ergebnisse kommen zu dir. ' +
        'Änderungen des Anbieters wirken sofort' + (o.scopeType === 'node' ? ', und was er später hineinlegt, gehört automatisch dazu' : '') + '. ' +
        'Bearbeiten und weitergeben kannst du es nicht; zurückgeben geht jederzeit.';
    if (!(await this.app.appConfirm(text))) return;

    btn.disabled = true;
    try {
      const res = await this.app.api.acquireOffer(o.offerId, mode);
      if (!res || !res.success) throw new Error(res?.message || 'Übernehmen fehlgeschlagen');
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
    const [offers, topics] = await Promise.all([this.app.api.getMyOffers(), this.app.api.getTopics(), ensureCategories(this.app)]);
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
      const modes = [o.allowUse ? '🔗 Use' : null, o.allowCopy ? '📥 Copy' : null].filter(Boolean).join(' &nbsp; ');
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
            <div class="shop-cats">${(o.categoryIds || []).some((id) => this.app.state.categoryById?.get(id)?.facet === 'subject')
              ? categoryChips(this.app, o.categoryIds)
              : `${categoryChips(this.app, o.categoryIds)}<span class="topic-status inactive" title="Ohne Fach findet es im Shop kaum jemand – beim nächsten Speichern ist eins nötig">📚 noch kein Fach</span>`}</div>
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

  /** Wer ein Nutzungsrecht hat. Rechte, für die früher Punkte bezahlt wurden, lassen sich nicht entziehen. */
  _holdersHtml(holders) {
    if (!holders || holders.length === 0) return '';
    return `<details class="shop-modules"><summary>${holders.length} verwenden das Thema</summary><ul>
      ${holders.map((h) => `<li>${escapeHtml(h.name)}${h.pricePaid ? ` <span class="hint" title="Aus der Zeit der Punkte – lässt sich nicht entziehen">(früher ${points(h.pricePaid)} bezahlt)</span>` : ''}
        ${h.pricePaid ? '' : `<button class="btn btn-secondary btn-sm btn-revoke-holder" data-grant="${escapeAttr(h.grantId)}" title="Nutzungsrecht entziehen">entziehen</button>`}</li>`).join('')}
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
      : 'Angebot zurückziehen? Es verschwindet aus dem Shop. Wer es schon übernommen hat, behält Kopie bzw. Nutzungsrecht.';
    if (!(await this.app.appConfirm(text))) return;
    const res = await this.app.api.withdrawOffer(o.id);
    if (res && res.success) {
      this.app.showToast(o.kind === 'buyer' ? 'Weitergabe beendet' : 'Angebot zurückgezogen', 'info');
      this.refresh();
    } else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
  }

  // ---- Geteilt & genutzt: was aus dem eigenen Material wird ----

  async _renderImpact() {
    const data = await this.app.api.getMyImpact();
    const t = data.totals || {};
    const g = data.giveAndTake || {};
    const num = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const stat = (n, label, title = '') => `<div class="stat-card" title="${escapeAttr(title)}"><div class="stat-number">${n}</div><div class="stat-label">${label}</div></div>`;
    const avg = (r) => (r && r.count ? `★ ${String(r.avg).replace('.', ',')}` : '–');

    const rows = (data.topics || []).map((x) => `
      <tr>
        <td>📘 ${escapeHtml(x.title)}${x.gone ? ' <span class="hint" title="Das Original gibt es nicht mehr – gezählt wird über die Kopien weiter">(Original gelöscht)</span>' : ''}
          ${x.offered ? ' <span class="topic-shared-badge owner" title="Steht im Shop">🛒</span>' : ''}</td>
        <td>${x.modules}</td>
        <td>${x.teachers || '–'}</td>
        <td>${x.usedBy || '–'}</td>
        <td>${x.copiedBy || '–'}</td>
        <td title="davon ${x.runsByOthers} über Links anderer Lehrkräfte">${x.runs || '–'}</td>
        <td>${x.classes || '–'}</td>
        <td>${avg(x.rating)}${x.rating?.count ? ` <span class="hint">(${x.rating.count})</span>` : ''}${x.rating?.thanks ? ` · 👍 ${x.rating.thanks}` : ''}</td>
      </tr>`).join('');

    const comments = (data.comments || []).map((c) => `
      <li class="impact-comment">
        <div class="impact-comment-head"><strong>${escapeHtml(c.name)}</strong> zu 📘 ${escapeHtml(c.topicTitle)}
          ${c.stars ? `<span class="rating-stars">${'★'.repeat(c.stars)}${'☆'.repeat(5 - c.stars)}</span>` : ''}${c.thanks ? ' 👍' : ''}
          <span class="hint">${new Date(c.date).toLocaleDateString('de-DE')}</span></div>
        <div class="impact-comment-text">${escapeHtml(c.comment)}</div>
      </li>`).join('');

    const balance = g.shared === 0 && g.taken > 0
      ? `Du hast ${num(g.taken, 'Mal', 'Mal')} etwas übernommen (${g.copies} Kopien, ${g.uses} zur Nutzung) und selbst noch nichts angeboten. Magst du etwas teilen?`
      : `Du bietest ${num(g.shared, 'Angebot', 'Angebote')} an und hast ${num(g.taken, 'Mal', 'Mal')} etwas übernommen (${g.copies} Kopien, ${g.uses} zur Nutzung).`;

    this._content.innerHTML = `
      <h3 class="impact-h">Geteilt & genutzt <button type="button" class="help-hint" data-help="nutzung-und-bewertung" title="Hilfe: Nutzung und Bewertung" aria-label="Hilfe: Nutzung und Bewertung">?</button></h3>
      <p class="hint">Wo dein Material im Unterricht ankommt – auch über Kopien bei anderen und wenn sie es weiterreichen.
        Gezählt wird ohne Schülernamen.</p>
      <div class="stats-grid">
        ${stat(t.teachers || 0, `Lehrkr${t.teachers === 1 ? 'aft' : 'äfte'} erreicht`, 'Andere Lehrkräfte, die dein Material nutzen, kopiert haben oder damit unterrichten')}
        ${t.schools ? stat(t.schools, `Schule${t.schools === 1 ? '' : 'n'}`) : ''}
        ${stat(t.runs || 0, 'Bearbeitungen im Unterricht', `davon ${t.runsByOthers || 0} bei anderen Lehrkräften`)}
        ${stat(t.classes || 0, `Klasse${t.classes === 1 ? '' : 'n'}`, 'Klassen mit Klassenlink, die damit gearbeitet haben – auch deine eigenen')}
        ${stat(avg(t.rating), `Nützlichkeit${t.rating?.count ? ` (${t.rating.count})` : ''}`)}
        ${stat(t.rating?.thanks || 0, '👍 Danke')}
      </div>
      <p class="give-take ${g.shared === 0 && g.taken > 0 ? 'nudge' : ''}">🤝 ${balance}</p>
      ${rows ? `<table class="shop-ledger impact-table">
        <thead><tr><th>Lernthema</th><th>Module</th><th title="Andere Lehrkräfte insgesamt">Lehrkräfte</th><th title="Über ein Nutzungsrecht (Use)">Use</th><th title="Mit einer eigenen Kopie">Kopien</th><th title="Bearbeitungen im Unterricht">Bearb.</th><th>Klassen</th><th>Bewertung</th></tr></thead>
        <tbody>${rows}</tbody></table>`
        : '<div class="empty-state"><span class="empty-icon">✍️</span><p>Du hast noch keine eigenen Module verfasst.</p></div>'}
      <h3 class="impact-h">💬 Rückmeldungen</h3>
      ${comments ? `<ul class="impact-comments">${comments}</ul>` : '<p class="hint">Noch keine Rückmeldungen mit Text.</p>'}
      <details class="shop-modules points-history"><summary>Frühere Punkte-Buchungen (bis Oktober 2026)</summary><div class="points-history-body hint">Wird geladen…</div></details>`;

    const hist = this._content.querySelector('.points-history');
    hist.addEventListener('toggle', async () => {
      if (!hist.open || hist.dataset.loaded) return;
      hist.dataset.loaded = '1';
      const body = hist.querySelector('.points-history-body');
      try {
        const { entries } = await this.app.api.getPointsHistory();
        body.classList.remove('hint');
        body.innerHTML = (entries || []).length
          ? `<table class="shop-ledger"><thead><tr><th>Datum</th><th>Art</th><th>Wofür</th><th>Punkte</th></tr></thead><tbody>${entries.map((e) => `
              <tr><td>${new Date(e.createdAt).toLocaleDateString('de-DE')}</td><td>${escapeHtml(REASON_LABELS[e.reason] || e.reason)}</td>
              <td>${escapeHtml(e.note || '')}</td><td class="shop-delta ${e.delta < 0 ? 'neg' : 'pos'}">${e.delta > 0 ? '+' : ''}${e.delta}</td></tr>`).join('')}</tbody></table>`
          : '<p class="hint">Keine Buchungen.</p>';
      } catch (err) {
        body.textContent = 'Fehler: ' + err.message;
      }
    });
  }

  // ---- Anbieten ----

  /**
   * Dialog „Im Shop anbieten“ für ein Lernthema, einen Notebook-Knoten oder
   * eine Auswahl von Modulen. target: { type, id } bzw. { type: 'modules', moduleIds }.
   *
   * Eigene Module lassen sich kopieren und nutzen; erworbene (fremde) nur
   * nutzen, und nur, wenn man sie ausdrücklich mit anbietet.
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
            Ihre Nutzung zählt für ihre Creator.</span></label>` : ''}

        <div class="form-group">
          <label>Einordnung – mindestens ein Fach <button type="button" class="help-hint" data-help="kategorien" title="Hilfe: Kategorien" aria-label="Hilfe: Kategorien">?</button></label>
          ${(state.topicCategoryIds || []).length ? '<span class="hint">Was nach dem + steht, kommt schon aus den Lernthemen (oder ihren Tags) und zählt mit.</span>' : ''}
          <div class="co-cats"></div>
        </div>

        <div class="shop-mode-row">
          <label class="share-flag"><input type="checkbox" id="coUse" ${!offer || offer.allowUse ? 'checked' : ''} />
            <span><strong>Use</strong> – Original verwenden${foreign ? ' (eigene und erworbene)' : ''}</span></label>
        </div>
        <div class="shop-mode-row">
          <label class="share-flag"><input type="checkbox" id="coCopy" ${offer && offer.allowCopy ? 'checked' : ''} ${own ? '' : 'disabled'} />
            <span><strong>Copy</strong> – eigene Kopie ${own ? (foreign ? '(nur deine Module; die erworbenen bekommt man zur Nutzung dazu)' : '') : '(geht nur mit eigenen Modulen)'}</span></label>
        </div>
        <p class="hint">Alles im Shop ist frei. Unter „📈 Geteilt & genutzt“ siehst du, wen dein Material erreicht – auch über Kopien.</p>

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
    const catPicker = new CategoryPicker(this.app, overlay.querySelector('.co-cats'), { fixed: state.topicCategoryIds || [] });
    catPicker.render(offer?.categoryIds || []);

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
        audience: audience.length ? audience : ['*'],
        categoryIds: catPicker.selectedIds,
        active: true,
      };
      const res = await api.saveOffer(body);
      if (res && res.success) done('Angebot steht im Shop');
      else this.app.showToast('Fehler: ' + (res?.message || '?'), 'error');
    });

    overlay.querySelector('#btnWithdrawOffer')?.addEventListener('click', async () => {
      if (!(await this.app.appConfirm('Angebot zurückziehen? Wer es schon übernommen hat, behält Kopie bzw. Nutzungsrecht.'))) return;
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
