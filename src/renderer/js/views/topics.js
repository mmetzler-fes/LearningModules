import { escapeHtml, showImportReport } from '../utils.js';
import { usesOutside, usageText } from '../quiz-usage.js';
import { helpHint } from './help-view.js';
import { openHandoverDialog, renderIncomingHandovers } from './handover.js';
import { openAccountLinksDialog } from './account-links.js';
import { openGithubBackupDialog } from './github-backup.js';
import { openNextcloudDialog } from './nextcloud.js';

// ==================== LERNTHEMEN: DIALOGE UND ☰ MENÜ ====================
//
// Die Seite „LernModule“ gibt es nicht mehr, die Themen stehen in den Notebooks. Hier bleiben Dialoge,
// die mehrere Ansichten brauchen (Export, Quick-Link, Löschen), und die Einträge von ☰ Menü.

export class TopicsView {
  constructor(app) {
    this.app = app;

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('btnH5pTypes')?.addEventListener('click', () => this._openH5pTypes());
    document.getElementById('btnAiPrompt')?.addEventListener('click', () => this.app.navigateToView('teacher-ai-prompt'));
    document.getElementById('btnHandover')?.addEventListener('click', () => openHandoverDialog(this.app));
    document.getElementById('btnAccountLinks')?.addEventListener('click', () => openAccountLinksDialog(this.app));
    document.getElementById('btnGithubBackup')?.addEventListener('click', () => openGithubBackupDialog(this.app));
    document.getElementById('btnNextcloud')?.addEventListener('click', () => openNextcloudDialog(this.app));
  }

  /** Was zur Titelzeile gehört: Zahlen, 🎁 eingehende Übergaben, 💾 GitHub-Backup. */
  async refreshTitleTools() {
    renderIncomingHandovers(this.app, document.getElementById('handoverIncoming'));
    this._syncGithubBackupButton();
    this.renderCounts();
    try {
      const results = await this.app.api.getQuizResults();
      const el = document.getElementById('statResults');
      if (el) el.textContent = Array.isArray(results) ? results.length : 0;
    } catch (_) { /* Zahl bleibt stehen */ }
  }

  /** 💾 GitHub-Backup nur zeigen, wenn der Admin es nicht abgeschaltet hat. */
  async _syncGithubBackupButton() {
    const btn = document.getElementById('btnGithubBackup');
    if (!btn) return;
    const data = await this.app.api.getGithubBackup().catch(() => null);
    btn.classList.toggle('hidden', data?.allowed === false);
  }

  /** Zahlen in der Titelzeile, die ohne Server auskommen. */
  renderCounts() {
    const topics = this.app.state.topics || [];
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('statTopics', topics.length);
    set('statModules', topics.reduce((sum, t) => sum + (t.modules || []).length, 0));
    set('statActive', topics.filter((t) => t.selected).length);
  }

  /** Übersicht der H5P-Modultypen (früher auf dem Dashboard). */
  _openH5pTypes() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card h5p-types-card">
        <h3>${escapeHtml(t('dashboard.types.title'))}</h3>
        <div class="type-grid">${getH5pTypesArray().map((type) => `
          <div class="type-card">
            <div class="type-card-icon">${type.icon}</div>
            <div class="type-card-name">${escapeHtml(type.name)}</div>
            <div class="type-card-desc">${escapeHtml(type.description)}</div>
          </div>`).join('')}
        </div>
        <div class="confirm-actions"><button type="button" class="btn btn-primary btn-close">Schließen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.btn-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  /**
   * Thema nach Rückfrage löschen; true, wenn gelöscht. Wer das Thema per
   * "Use" verwendet, verliert es mit – das gehört vor die Entscheidung.
   */
  async deleteTopic(topic) {
    const paid = topic.paidUseCount || 0;
    const free = (topic.useCount || 0) - paid;
    const users = [
      paid ? `${paid} Person${paid === 1 ? ' hat' : 'en haben'} früher Punkte für die Nutzung bezahlt und bekomm${paid === 1 ? 't' : 'en'} automatisch eine eigene Kopie.` : '',
      free ? `${free} Person${free === 1 ? ' verwendet' : 'en verwenden'} dieses Thema über den Shop und verlier${free === 1 ? 't' : 'en'} es.` : '',
    ].filter(Boolean).map((x) => `\n\n${x}`).join('');
    const reach = await this.app.api.getReach().catch(() => null);
    const classes = (reach?.[topic.id]?.classes || []).join(', ');
    const inClasses = classes ? `\n\nEs verschwindet auch aus dem Klassennotizbuch: ${classes}. Ergebnisse und ausgefüllte Blätter der Schüler bleiben für dich sichtbar.` : '';
    // Quizze dieses Lernthemas, die Dokumente anderer Lernthemen einbetten: Dort fehlen sie danach.
    const full = (this.app.state.topics || []).find((x) => x.id === topic.id) || topic;
    const outside = usesOutside(this.app.state.topics || [], full);
    const embedded = outside.length ? `\n\nQuizze daraus stecken ${usageText(outside)} – dort fehlen sie dann.` : '';
    if (!(await this.app.appConfirm(t('topics.delete.confirm', { title: topic.title }) + users + inClasses + embedded))) return false;
    const res = await this.app.api.deleteTopic(topic.id);
    this.app.showToast(res?.preservedCopies
      ? `${t('topics.deleted')} ${res.preservedCopies} Person${res.preservedCopies === 1 ? ' hat' : 'en haben'} eine eigene Kopie erhalten.`
      : t('topics.deleted'), 'info');
    return true;
  }

  // ==================== QUICK-LINK ====================

  /**
   * Quick-Link: ein Link für das ganze Thema, Schüler wählen ihre Klasse aus
   * der Auswahl der Lehrkraft (views/links.js → openQuickLink). Früher
   * verteilte Quick-Links (?q=) bleiben gültig, ihre Ergebnisse stehen unter
   * "ohne Klasse".
   */
  async _createQuickClassLink(topic) {
    // Ein ausgegrauter Knopf erklärte nicht, was fehlt – gerade bei frisch
    // erworbenen Kopien, die gesperrt beginnen. Deshalb hier nachfragen.
    if (!topic.selected) {
      const ok = await this.app.appConfirm(
        `„${topic.title}" ist noch nicht für Schüler freigegeben. Ein Quick-Link führt erst nach der Freigabe zum Thema.\n\nJetzt freigeben und den Quick-Link erstellen?`,
      );
      if (!ok) return;
      await this.app.api.toggleTopicSelection(topic.id, true);
      topic.selected = true;
      this.refresh();
    }
    await this.app.linksView.openQuickLink({ kind: 'topic', id: topic.id, title: topic.title });
  }

  // ==================== EXPORT ====================

  /**
   * Export eines Themas. Unverschlüsselt (JSON, H5P) verlassen nur die selbst
   * verfassten Module die App; das ganze Thema samt fremden Modulen gibt es
   * nur verschlüsselt mit dem Masterkey.
   */
  async openExportDialog(topic) {
    let info;
    try {
      info = await this.app.api.getExportInfo(topic.id);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!info || typeof info.ownModules !== 'number') {
      this.app.showToast('Fehler: ' + (info?.message || 'Export nicht möglich'), 'error');
      return;
    }
    const own = info.ownModules;
    const foreign = info.foreignModules;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:420px; max-width:560px">
        <h3>📤 Exportieren: <em>${escapeHtml(info.title)}</em> ${helpHint('moodle-und-h5p#ausgeben', 'Hilfe: Exportieren als Moodle-XML und H5P')}</h3>
        ${foreign > 0 && own > 0 ? `<p class="login-error">⚠️ Dieses Thema enthält ${foreign} fremde${foreign === 1 ? 's' : ''} Modul${foreign === 1 ? '' : 'e'}.
          Unverschlüsselt werden nur deine ${own} eigenen exportiert.</p>` : ''}
        ${own === 0 ? '<p class="login-error">Dieses Thema enthält keine von dir verfassten Module – es lässt sich nur verschlüsselt exportieren.</p>' : ''}
        <div class="settings-group">
          <h3>Offen – nur eigene Module (${own})</h3>
          <p class="hint">Zum Weitergeben außerhalb der App oder für andere H5P-Plattformen.</p>
          <div class="confirm-actions" style="justify-content:flex-start">
            <button class="btn btn-secondary" id="btnExpJson" ${own ? '' : 'disabled'}>📤 JSON</button>
            <button class="btn btn-secondary" id="btnExpH5p" ${own ? '' : 'disabled'}>📦 H5P</button>
            <button class="btn btn-secondary" id="btnExpMoodle" ${own ? '' : 'disabled'} title="Fragensammlung für Moodle-Tests (Moodle-XML)">🎓 Moodle-XML</button>
          </div>
        </div>
        <div class="settings-group" style="margin-top:14px">
          <h3>🔒 Verschlüsselt – ganzes Thema (${own + foreign})</h3>
          <p class="hint">Zur Sicherung. Lässt sich nur in einer App mit demselben Masterkey und nur von dir wieder einlesen;
            die Creator der Module bleiben dabei verzeichnet.</p>
          <div class="confirm-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnExpEnc" ${info.canExportEncrypted ? '' : 'disabled title="Nur für eigene Themen"'}>🔒 Verschlüsselt exportieren</button>
          </div>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnExpClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#btnExpClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const run = async (fn, okMsg) => {
      const res = await fn();
      if (res && res.success) { this.app.showToast(okMsg, 'success'); close(); }
      else this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error');
    };
    overlay.querySelector('#btnExpJson').addEventListener('click', () => run(() => this.app.api.exportTopic(topic.id), t('topics.exported')));
    overlay.querySelector('#btnExpH5p').addEventListener('click', async () => {
      const res = await this.app.api.exportTopicAsH5p(topic.id);
      if (!res || !res.success) { this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error'); return; }
      this.app.showToast(`📦 H5P-Fragenset mit ${res.count ?? ''} Frage(n) exportiert.`, 'success');
      close();
      showImportReport({ skipped: res.skipped || [], notes: res.notes || [] }, '📋 Export-Bericht');
    });
    overlay.querySelector('#btnExpMoodle').addEventListener('click', async () => {
      const res = await this.app.api.exportTopicAsMoodle(topic.id);
      if (!res || !res.success) { this.app.showToast('Export fehlgeschlagen: ' + (res?.error || '?'), 'error'); return; }
      this.app.showToast(`🎓 ${res.count ?? ''} Moodle-Frage(n) exportiert – in Moodle unter Fragensammlung → Import → Moodle-XML einlesen.`, 'success');
      close();
      showImportReport({ skipped: res.skipped || [], notes: res.notes || [] }, '📋 Export-Bericht');
    });
    overlay.querySelector('#btnExpEnc').addEventListener('click', () => run(() => this.app.api.exportTopicEncrypted(topic.id), '🔒 Verschlüsselt exportiert'));
  }

  /** Nutzungsrecht nach Rückfrage zurückgeben; true, wenn zurückgegeben. */
  async returnGrant(entry) {
    // Ein Recht an einem Bereich oder einer Auswahl gibt man als Ganzes zurück.
    const whole = entry.grants.some((g) => g.scopeType === 'node' || g.scopeType === 'modules');
    const ok = await this.app.appConfirm(
      `Nutzungsrecht an „${entry.title}" zurückgeben?\n\n` +
      (whole ? 'Es gilt für das ganze Angebot (Bereich bzw. Auswahl), zu dem dieses Lernthema gehört – zurückgegeben wird alles.\n\n' : '') +
      'Deine Themen- und Quick-Links liefern das Thema danach nicht mehr aus.',
    );
    if (!ok) return false;
    try {
      for (const g of entry.grants) {
        const res = await this.app.api.revokeGrant(g.id);
        if (!res || !res.success) throw new Error(res?.message || 'Zurückgeben fehlgeschlagen');
      }
      this.app.showToast('Nutzungsrecht zurückgegeben', 'info');
      return true;
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return false;
    }
  }

  /**
   * Fremdes Thema ansehen: Modulliste im Overlay, Vorschau im selben
   * Fenster. Bewusst eine eigene, schreibfreie Ansicht statt der
   * Modulverwaltung – dort sind alle Knöpfe zum Ändern, die hier nicht
   * greifen dürfen.
   */
  async _openSharedTopicViewer(entry) {
    let topic = null;
    try {
      topic = await this.app.api.getSharedTopicView(entry.id);
    } catch (err) {
      this.app.showToast('Fehler: ' + err.message, 'error');
      return;
    }
    if (!topic || !topic.id) {
      this.app.showToast('Fehler: ' + (topic?.message || 'Thema kann nicht angezeigt werden'), 'error');
      return;
    }

    const modules = Array.isArray(topic.modules) ? topic.modules : [];
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="import-modules-card" style="min-width:480px; max-width:820px; max-height:82vh; overflow:auto">
        <h3>👁 ${escapeHtml(topic.title)}</h3>
        <p class="hint">Thema von <strong>${escapeHtml(topic.ownerName)}</strong> – du darfst es verwenden, aber
          nicht ändern. Für eine eigene Fassung im Shop „Copy" wählen.</p>
        ${topic.origin ? `<p class="hint">📋 Kopie von „${escapeHtml(topic.origin.title || '')}" · Ursprung: ${escapeHtml(topic.origin.author)}</p>` : ''}
        <div id="sharedViewList"></div>
        <div id="sharedViewPreview" class="hidden"></div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="btnSharedViewClose">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const listBox = overlay.querySelector('#sharedViewList');
    const previewBox = overlay.querySelector('#sharedViewPreview');

    if (modules.length === 0) {
      listBox.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>Dieses Thema hat noch keine Module.</p></div>';
    }
    modules.forEach((mod, idx) => {
      const typeDef = (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[mod.type]) || {};
      const item = document.createElement('div');
      item.className = 'import-module-item';
      item.style.justifyContent = 'space-between';
      item.innerHTML = `
        <div>
          <span class="import-module-title">${typeDef.icon || '📦'} ${idx + 1}. ${escapeHtml(mod.title)}</span>
          <span class="import-module-type">${escapeHtml(typeDef.name || mod.type || '')} · ✍️ ${escapeHtml(mod.creatorName || '')}</span>
        </div>
        <button class="btn btn-secondary btn-sm">▶ Vorschau</button>`;
      item.querySelector('button').addEventListener('click', () => {
        listBox.classList.add('hidden');
        previewBox.classList.remove('hidden');
        previewBox.innerHTML = '';
        const back = document.createElement('button');
        back.className = 'btn btn-secondary btn-sm';
        back.textContent = '← Zurück zur Modulliste';
        back.addEventListener('click', () => {
          previewBox.innerHTML = '';
          previewBox.classList.add('hidden');
          listBox.classList.remove('hidden');
        });
        previewBox.appendChild(back);
        const host = document.createElement('div');
        previewBox.appendChild(host);
        this.app.renderer.renderPreview(mod, typeDef, host);
      });
      listBox.appendChild(item);
    });

    const close = () => overlay.remove();
    overlay.querySelector('#btnSharedViewClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
}
