/**
 * Editor für "Branching Scenario": Schritte als Karten. Ein Schritt ist
 * entweder eine Entscheidung (Antworten mit Ziel-Schritt) oder ein Ende
 * (Bewertung 0–100 % und Rückmeldung). Oben steht eine Strukturprüfung, damit
 * kein Weg in einer Sackgasse endet.
 *
 * Datenformat und Prüfung: branching.js (über window.normalizeBranching /
 * window.checkBranching). Der Text eines Schritts nutzt den gemeinsamen
 * Texteditor samt Bildwerkzeugen (manager.renderRichtextField).
 *
 * Klassisches Skript wie content-editors.js – deshalb eine globale Klasse.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let counter = 0;
  const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

  class BranchingEditor {
    constructor(manager, container, typeDef, data) {
      this.manager = manager;
      this.root = container;
      this.data = window.normalizeBranching ? window.normalizeBranching(data) : { startScreen: {}, steps: [], allowBack: false };
      if (!this.data.steps.length) {
        this.data.steps.push({ id: newId(), title: 'Start', content: '', kind: 'choice', choices: [], score: 100, feedback: '' });
      }
      this.build(typeDef);
    }

    build(typeDef) {
      this.root.insertAdjacentHTML('beforeend', `
        <h4>${typeDef.icon} ${esc(typeDef.name)} — Inhalt konfigurieren</h4>
        <p class="hint">Jeder Schritt ist eine <strong>Entscheidung</strong> (Antworten führen zu anderen Schritten) oder ein
          <strong>Ende</strong> (mit Bewertung und Rückmeldung). Der erste Schritt ist der Start. Gut geeignet für
          Fehlersuche, Inbetriebnahme oder Entscheidungstraining.</p>
        <div class="form-group"><label>Titel auf dem Startbildschirm</label>
          <input type="text" class="br-start-title" value="${esc(this.data.startScreen.title)}" placeholder="z. B. Fehlersuche an der Biegemaschine" /></div>
        <div class="form-group"><label>Untertitel / Situation</label>
          <input type="text" class="br-start-sub" value="${esc(this.data.startScreen.subtitle)}" placeholder="z. B. Die Anlage startet nicht. Wie gehst du vor?" /></div>
        <label class="share-flag"><input type="checkbox" class="br-back" ${this.data.allowBack ? 'checked' : ''} />
          <span>„Zurück“ erlauben (eine Entscheidung rückgängig machen)</span></label>
        <div class="br-check"></div>
        <div class="br-steps"></div>
        <button type="button" class="btn btn-secondary br-add-step" style="margin-top:10px">➕ Schritt hinzufügen</button>`);

      this.stepsBox = this.root.querySelector('.br-steps');
      this.checkBox = this.root.querySelector('.br-check');
      this.root.querySelector('.br-start-title').addEventListener('input', (e) => { this.data.startScreen.title = e.target.value; });
      this.root.querySelector('.br-start-sub').addEventListener('input', (e) => { this.data.startScreen.subtitle = e.target.value; });
      this.root.querySelector('.br-back').addEventListener('change', (e) => { this.data.allowBack = e.target.checked; });
      this.root.querySelector('.br-add-step').addEventListener('click', () => {
        this.addStep('choice');
        this.render();
        this.focusStep(this.data.steps.length - 1);
      });
      this.render();
    }

    addStep(kind, title = '') {
      const st = { id: newId(), title, content: '', kind, choices: [], score: kind === 'end' ? 100 : 100, feedback: '' };
      this.data.steps.push(st);
      return st;
    }

    /** Text aus den Editoren in den Zustand holen, bevor neu gezeichnet wird. */
    pullContent() {
      this.data.steps.forEach((st) => {
        const hidden = this.stepsBox.querySelector(`input[name="content_br_${st.id}"]`);
        if (hidden) st.content = hidden.value;
      });
    }

    render() {
      this.pullContent();
      const steps = this.data.steps;
      const label = (s, i) => `${i + 1}. ${s.title || (s.kind === 'end' ? 'Ende' : 'Schritt')}${s.kind === 'end' ? ' ⏹' : ''}`;
      this.stepsBox.innerHTML = '';
      steps.forEach((st, i) => {
        const card = document.createElement('div');
        card.className = `br-step br-${st.kind}`;
        card.dataset.id = st.id;
        card.innerHTML = `
          <div class="br-step-head">
            <span class="br-num">${i + 1}</span>
            ${i === 0 ? '<span class="br-badge">Start</span>' : ''}
            <input type="text" class="br-title" placeholder="Titel des Schritts" value="${esc(st.title)}" />
            <select class="br-kind" title="Art des Schritts">
              <option value="choice" ${st.kind === 'choice' ? 'selected' : ''}>🔀 Entscheidung</option>
              <option value="end" ${st.kind === 'end' ? 'selected' : ''}>⏹ Ende</option>
            </select>
            ${i > 0 ? '<button type="button" class="btn btn-danger btn-sm br-del" title="Schritt löschen">🗑</button>' : ''}
          </div>
          <div class="br-text"></div>
          ${st.kind === 'choice' ? `
            <div class="br-choices">
              ${st.choices.map((ch, k) => `
                <div class="br-choice" data-k="${k}">
                  <span class="br-arrow">↳</span>
                  <input type="text" class="br-ch-label" placeholder="Antwort, z. B. Not-Aus prüfen" value="${esc(ch.label)}" />
                  <span class="hint">führt zu</span>
                  <select class="br-ch-next">
                    <option value="">– Ziel wählen –</option>
                    ${steps.map((s, j) => j === i ? '' : `<option value="${esc(s.id)}" ${ch.next === s.id ? 'selected' : ''}>${esc(label(s, j))}</option>`).join('')}
                    <option value="__new_choice">➕ neuer Schritt (Entscheidung)</option>
                    <option value="__new_end">➕ neues Ende</option>
                  </select>
                  <button type="button" class="btn btn-sm br-ch-del" title="Antwort entfernen">✕</button>
                </div>`).join('')}
              <button type="button" class="btn btn-secondary btn-sm br-add-choice">➕ Antwort</button>
            </div>` : `
            <div class="br-end-fields">
              <label>Bewertung dieses Endes
                <select class="br-score">${[100, 75, 50, 25, 0].map((v) =>
                  `<option value="${v}" ${Number(st.score) === v ? 'selected' : ''}>${v} %${v === 100 ? ' – optimal' : v === 0 ? ' – falsch' : ''}</option>`).join('')}</select></label>
              <label>Rückmeldung
                <input type="text" class="br-feedback" placeholder="z. B. Richtig – zuerst den Not-Aus prüfen spart Zeit." value="${esc(st.feedback)}" /></label>
            </div>`}`;
        this.stepsBox.appendChild(card);

        // Text des Schritts: gemeinsamer Texteditor mit Bildern
        this.manager.renderRichtextField(card.querySelector('.br-text'),
          { key: `br_${st.id}`, label: 'Text / Situation', type: 'richtext', images: true,
            placeholder: st.kind === 'end' ? 'Was ist passiert? (optional)' : 'Beschreibe die Situation und die Frage …' }, st.content);

        card.querySelector('.br-title').addEventListener('input', (e) => { st.title = e.target.value; this.refreshTargets(); });
        card.querySelector('.br-kind').addEventListener('change', (e) => { st.kind = e.target.value; this.render(); });
        card.querySelector('.br-del')?.addEventListener('click', () => this.removeStep(st.id));
        card.querySelector('.br-add-choice')?.addEventListener('click', () => {
          st.choices.push({ label: '', next: '' });
          this.render();
          this.stepsBox.querySelector(`.br-step[data-id="${st.id}"] .br-choice:last-of-type .br-ch-label`)?.focus();
        });
        card.querySelectorAll('.br-choice').forEach((row) => {
          const ch = st.choices[Number(row.dataset.k)];
          row.querySelector('.br-ch-label').addEventListener('input', (e) => { ch.label = e.target.value; this.renderCheck(); });
          row.querySelector('.br-ch-next').addEventListener('change', (e) => {
            const v = e.target.value;
            if (v === '__new_choice' || v === '__new_end') {
              // Neuen Schritt anlegen und gleich verknüpfen
              const target = this.addStep(v === '__new_end' ? 'end' : 'choice', ch.label ? `Nach „${ch.label}“` : '');
              ch.next = target.id;
              this.render();
              this.focusStep(this.data.steps.length - 1);
              return;
            }
            ch.next = v;
            this.renderCheck();
          });
          row.querySelector('.br-ch-del').addEventListener('click', () => {
            st.choices.splice(Number(row.dataset.k), 1);
            this.render();
          });
        });
        card.querySelector('.br-score')?.addEventListener('change', (e) => { st.score = Number(e.target.value); });
        card.querySelector('.br-feedback')?.addEventListener('input', (e) => { st.feedback = e.target.value; });
      });
      this.renderCheck();
    }

    /** Zielauswahl aktualisieren, wenn sich ein Titel ändert – ohne Neuzeichnen. */
    refreshTargets() {
      const steps = this.data.steps;
      this.stepsBox.querySelectorAll('.br-ch-next').forEach((sel) => {
        [...sel.options].forEach((opt) => {
          const j = steps.findIndex((s) => s.id === opt.value);
          if (j >= 0) {
            const s = steps[j];
            opt.textContent = `${j + 1}. ${s.title || (s.kind === 'end' ? 'Ende' : 'Schritt')}${s.kind === 'end' ? ' ⏹' : ''}`;
          }
        });
      });
    }

    renderCheck() {
      const warnings = window.checkBranching ? window.checkBranching(this.data) : [];
      this.checkBox.innerHTML = warnings.length
        ? `<div class="br-warn">⚠️ Noch offen:<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
        : '<div class="br-ok">✅ Alle Wege führen zu einem Ende.</div>';
    }

    removeStep(id) {
      const st = this.data.steps.find((s) => s.id === id);
      const used = this.data.steps.some((s) => s.choices.some((ch) => ch.next === id));
      if (!window.confirm(`Schritt „${st?.title || 'ohne Titel'}“ löschen?${used ? '\n\nAntworten, die hierhin führen, haben danach kein Ziel mehr.' : ''}`)) return;
      this.pullContent();
      this.data.steps = this.data.steps.filter((s) => s.id !== id);
      this.data.steps.forEach((s) => s.choices.forEach((ch) => { if (ch.next === id) ch.next = ''; }));
      this.render();
    }

    focusStep(index) {
      const card = this.stepsBox.children[index];
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card?.querySelector('.br-title')?.focus({ preventScroll: true });
    }

    collect() {
      this.pullContent();
      return {
        startScreen: { ...this.data.startScreen },
        allowBack: this.data.allowBack,
        steps: this.data.steps.map((s) => ({
          id: s.id, title: s.title.trim(), content: s.content, kind: s.kind,
          choices: s.kind === 'choice' ? s.choices.map((ch) => ({ label: ch.label.trim(), next: ch.next })) : [],
          score: s.kind === 'end' ? Number(s.score) : undefined,
          feedback: s.kind === 'end' ? s.feedback : undefined,
        })),
      };
    }
  }

  window.BranchingEditor = BranchingEditor;
})();
