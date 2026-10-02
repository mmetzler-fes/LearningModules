/**
 * Visueller Editor für "Image Hotspots": Bild hochladen oder verlinken,
 * Hotspots per Klick ins Bild setzen und mit der Maus verschieben, Titel
 * und Text in der Liste darunter bearbeiten.
 *
 * Datenformat wie bisher (imageUrl, hotspots[{title, content, posX, posY}]),
 * dazu imageFile (hochgeladenes Bild als data-URL) und imageAlt.
 *
 * Klassisches Skript wie content-editors.js – deshalb eine globale Klasse.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Wie normalizeShareUrl in utils.js: Nextcloud-Freigabelink → Direktlink. */
  function shareUrl(url) {
    const u = String(url || '').trim();
    const m = /^(https?:\/\/[^?#]+?\/(?:index\.php\/)?s\/[A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(u);
    return m ? `${m[1]}/download` : u;
  }

  const round = (v) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

  class HotspotEditor {
    constructor(container, typeDef, data) {
      this.root = container;
      this.state = {
        imageUrl: data.imageUrl || '',
        imageFile: data.imageFile || '',
        imageAlt: data.imageAlt || '',
        hotspots: (data.hotspots || []).map((h) => ({
          title: h.title || '', content: h.content || '',
          posX: Number(h.posX ?? 50), posY: Number(h.posY ?? 50),
        })),
      };
      this.selected = null;
      this.build(typeDef);
    }

    get src() {
      return this.state.imageFile || shareUrl(this.state.imageUrl);
    }

    build(typeDef) {
      this.root.insertAdjacentHTML('beforeend', `
        <h4>${typeDef.icon} ${esc(typeDef.name)} — Inhalt konfigurieren</h4>
        <div class="form-group">
          <label>Bild *</label>
          <div class="hs-ed-imagebar">
            <button type="button" class="btn btn-secondary btn-sm hs-ed-upload">📁 Bild hochladen</button>
            <button type="button" class="btn btn-secondary btn-sm hs-ed-compose" title="Mehrere Bilder zu einem zusammenstellen">🧩 Zusammenstellen</button>
            <input type="text" class="hs-ed-url" placeholder="oder Bild-URL, z. B. Nextcloud-Freigabelink" value="${esc(this.state.imageUrl)}" />
            <button type="button" class="btn btn-danger btn-sm hs-ed-remove" title="Bild entfernen">✕</button>
          </div>
          <span class="hint hs-ed-status"></span>
        </div>
        <div class="form-group">
          <label>Bildbeschreibung (für Screenreader, optional)</label>
          <input type="text" class="hs-ed-alt" value="${esc(this.state.imageAlt)}" />
        </div>
        <p class="hint hs-ed-hint">👆 <strong>Ins Bild klicken</strong> setzt einen Hotspot. Hotspots lassen sich mit der Maus
          verschieben; Rechtsklick (bzw. langes Drücken) löscht.</p>
        <div class="hs-ed-canvas"></div>
        <h4 style="margin-top:16px">Hotspots</h4>
        <div class="hs-ed-list"></div>`);

      this.canvas = this.root.querySelector('.hs-ed-canvas');
      this.list = this.root.querySelector('.hs-ed-list');
      this.status = this.root.querySelector('.hs-ed-status');

      this.root.querySelector('.hs-ed-upload').addEventListener('click', async () => {
        const res = await appApi.selectImage();
        if (res && res.success) {
          this.state.imageFile = res.dataUrl;
          this.renderCanvas();
        }
      });
      this.root.querySelector('.hs-ed-compose').addEventListener('click', async () => {
        if (typeof openImageComposer !== 'function') return;
        const dataUrl = await openImageComposer();
        if (!dataUrl) return;
        this.state.imageFile = dataUrl;
        this.renderCanvas();
      });
      const urlInput = this.root.querySelector('.hs-ed-url');
      urlInput.addEventListener('change', () => {
        this.state.imageUrl = urlInput.value.trim();
        this.state.imageFile = ''; // ein neuer Link ersetzt ein hochgeladenes Bild
        this.renderCanvas();
      });
      this.root.querySelector('.hs-ed-remove').addEventListener('click', () => {
        this.state.imageFile = '';
        this.state.imageUrl = '';
        urlInput.value = '';
        this.renderCanvas();
      });
      this.root.querySelector('.hs-ed-alt').addEventListener('input', (e) => { this.state.imageAlt = e.target.value; });

      this.renderCanvas();
      this.renderList();
    }

    // ---- Bild mit Hotspots ----

    renderCanvas() {
      const src = this.src;
      this.root.querySelector('.hs-ed-remove').style.display = src ? '' : 'none';
      this.root.querySelector('.hs-ed-hint').style.display = src ? '' : 'none';
      if (!src) {
        this.canvas.innerHTML = '<div class="hs-ed-placeholder">Erst ein Bild hochladen oder einen Link angeben.</div>';
        this.status.textContent = '';
        return;
      }
      this.status.textContent = this.state.imageFile ? '✅ Hochgeladenes Bild'
        : src !== this.state.imageUrl ? `Nextcloud-Freigabe erkannt – verwendet wird ${src}` : '';
      this.canvas.innerHTML = `<div class="hs-ed-stage"><img class="hs-img" src="${esc(src)}" draggable="false" alt="" /></div>`;
      this.stage = this.canvas.querySelector('.hs-ed-stage');
      const img = this.stage.querySelector('img');
      img.addEventListener('error', () => {
        this.status.innerHTML = '⚠️ Das Bild lässt sich nicht laden. Bei Nextcloud: Freigabe ohne Passwort und ohne „Download verbergen“.';
      });
      // Klick ins Bild: neuer Hotspot an dieser Stelle.
      img.addEventListener('click', (e) => {
        const r = img.getBoundingClientRect();
        this.state.hotspots.push({
          title: '', content: '',
          posX: round(((e.clientX - r.left) / r.width) * 100),
          posY: round(((e.clientY - r.top) / r.height) * 100),
        });
        this.selected = this.state.hotspots.length - 1;
        this.renderMarkers();
        this.renderList(true);
      });
      this.renderMarkers();
    }

    renderMarkers() {
      if (!this.stage) return;
      this.stage.querySelectorAll('.hs-marker').forEach((m) => m.remove());
      this.state.hotspots.forEach((h, i) => {
        const m = document.createElement('button');
        m.type = 'button';
        m.className = 'hs-marker hs-ed-marker' + (this.selected === i ? ' active' : '');
        m.textContent = String(i + 1);
        m.title = h.title || `Hotspot ${i + 1}`;
        m.style.left = `${h.posX}%`;
        m.style.top = `${h.posY}%`;
        this.attachDrag(m, i);
        m.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [
            { label: '🗑 Hotspot löschen', danger: true, onClick: () => this.remove(i) },
          ]);
        });
        this.stage.appendChild(m);
      });
    }

    /** Ziehen mit Maus, Stift oder Finger; ein Klick ohne Bewegung wählt nur aus. */
    attachDrag(marker, i) {
      marker.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const img = this.stage.querySelector('img');
        const r = img.getBoundingClientRect();
        const x0 = e.clientX;
        const y0 = e.clientY;
        let moved = false;
        try { marker.setPointerCapture(e.pointerId); } catch (_) { /* ohne Capture geht es auch */ }
        const move = (ev) => {
          if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
          moved = true;
          const h = this.state.hotspots[i];
          h.posX = round(((ev.clientX - r.left) / r.width) * 100);
          h.posY = round(((ev.clientY - r.top) / r.height) * 100);
          marker.style.left = `${h.posX}%`;
          marker.style.top = `${h.posY}%`;
        };
        const up = () => {
          marker.removeEventListener('pointermove', move);
          marker.removeEventListener('pointerup', up);
          marker.removeEventListener('pointercancel', up);
          this.selected = i;
          this.renderMarkers();
          this.renderList(!moved);
        };
        marker.addEventListener('pointermove', move);
        marker.addEventListener('pointerup', up);
        marker.addEventListener('pointercancel', up);
      });
    }

    // ---- Liste mit Titel und Text ----

    renderList(focusSelected = false) {
      const hs = this.state.hotspots;
      if (!hs.length) {
        this.list.innerHTML = '<p class="hint">Noch keine Hotspots – klicke ins Bild.</p>';
        return;
      }
      this.list.innerHTML = '';
      hs.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'hs-ed-item' + (this.selected === i ? ' selected' : '');
        row.innerHTML = `
          <div class="hs-ed-item-head">
            <span class="hs-ed-num">${i + 1}</span>
            <input type="text" class="hs-ed-title" placeholder="Titel" value="${esc(h.title)}" />
            <span class="hint hs-ed-pos">${h.posX} % / ${h.posY} %</span>
            <button type="button" class="btn btn-danger btn-sm hs-ed-del" title="Hotspot löschen">🗑</button>
          </div>
          <textarea class="hs-ed-content" rows="2" placeholder="Text, der beim Antippen erscheint">${esc(h.content)}</textarea>`;
        row.addEventListener('focusin', () => {
          if (this.selected === i) return;
          this.selected = i;
          this.list.querySelectorAll('.hs-ed-item').forEach((el, k) => el.classList.toggle('selected', k === i));
          this.renderMarkers();
        });
        row.querySelector('.hs-ed-title').addEventListener('input', (e) => {
          h.title = e.target.value;
          const m = this.stage?.querySelectorAll('.hs-marker')[i];
          if (m) m.title = h.title || `Hotspot ${i + 1}`;
        });
        row.querySelector('.hs-ed-content').addEventListener('input', (e) => { h.content = e.target.value; });
        row.querySelector('.hs-ed-del').addEventListener('click', () => this.remove(i));
        this.list.appendChild(row);
      });
      if (focusSelected && this.selected !== null) {
        const row = this.list.children[this.selected];
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        row?.querySelector('.hs-ed-title')?.focus({ preventScroll: true });
      }
    }

    remove(i) {
      this.state.hotspots.splice(i, 1);
      this.selected = null;
      this.renderMarkers();
      this.renderList();
    }

    /** Daten für das Speichern. */
    collect() {
      return {
        imageUrl: this.state.imageFile ? '' : this.state.imageUrl,
        imageFile: this.state.imageFile,
        imageAlt: this.state.imageAlt.trim(),
        hotspots: this.state.hotspots.map((h) => ({
          title: h.title.trim(), content: h.content, posX: h.posX, posY: h.posY,
        })),
      };
    }
  }

  window.HotspotEditor = HotspotEditor;
})();
