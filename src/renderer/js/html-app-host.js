// ==================== HTML-APP IM SANDKASTEN ====================
//
// Hauptseite → Rahmenseite auf der App-Adresse → App (docs/html-apps.md). Die
// App sieht nur die Felder von `init`. Ausweis und Meldungen bleiben hier: Der
// Server bekommt sie von dieser Seite, nie von der App.

const MAX_STATE = 256 * 1024;

const authToken = () => sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');

async function post(url, body, token = null) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Die HTML-App konnte nicht geöffnet werden.');
  return data;
}

function localState(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
}

const HINTS = {
  preview: 'Vorschau: Es wird nichts gespeichert.',
  anonymous: 'Ohne Anmeldung: Der Stand bleibt auf diesem Gerät, Ergebnisse gibt es keine.',
};

export async function mountHtmlApp({ el, moduleId, content, options, title }) {
  const up = options.upload;
  el.textContent = 'HTML-App wird geladen …';
  let open;
  try {
    open = up && (up.linkToken || up.quickToken)
      ? await post('/api/public/html-app/open', {
        linkToken: up.linkToken || undefined, quickToken: up.quickToken || undefined,
        password: up.password || undefined, studentTicket: up.studentTicket || undefined, moduleId,
      })
      : await post('/api/html-apps/preview', { moduleId, fileId: content?.app?.fileId }, authToken());
  } catch (e) {
    el.textContent = `❌ ${e.message}`;
    return;
  }

  const stateKey = `lm_html_app:${open.rootId || moduleId}`;
  let state = open.mode === 'anonymous' ? localState(stateKey) : open.state;

  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
  const hint = document.createElement('small');
  hint.className = 'hint';
  hint.textContent = !open.manifest ? 'Nur Anzeige, kein Lernstand: Die App hat keinen Steckbrief.' : HINTS[open.mode] || '';
  const big = document.createElement('button');
  big.type = 'button';
  big.className = 'btn btn-secondary btn-sm';
  big.textContent = '⛶ Groß';
  bar.append(hint, big);

  const frame = document.createElement('iframe');
  frame.title = title || 'HTML-App';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-downloads allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', '');
  frame.style.cssText = 'width:100%; height:75vh; border:1px solid var(--border); border-radius:var(--radius-md); background:#fff;';
  frame.src = open.shellUrl;
  wrap.append(bar, frame);
  el.appendChild(wrap);

  // Ohne Umhängen: Ein iframe, das den Platz im Baum wechselt, lädt neu.
  let large = false;
  big.addEventListener('click', () => {
    large = !large;
    wrap.style.cssText = large
      ? 'position:fixed; inset:0; z-index:9999; display:flex; flex-direction:column; gap:6px; padding:8px; background:var(--bg-primary,#fff);'
      : 'display:flex; flex-direction:column; gap:6px;';
    frame.style.height = large ? 'auto' : '75vh';
    frame.style.flex = large ? '1' : '';
    big.textContent = large ? '✕ Verkleinern' : '⛶ Groß';
  });

  const send = (type, data) => frame.contentWindow?.postMessage({ lm: 1, type, data }, open.appOrigin);
  const refuse = (code, message) => send('lm.error', { code, message });

  const report = async (type, data) => {
    const body = JSON.stringify({ session: open.session, type, data });
    try {
      // keepalive: Beim Schließen der Seite soll die letzte Meldung noch ankommen (Grenze 64 KB).
      const res = await fetch('/api/public/html-app/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) refuse(`http-${res.status}`, out.message || 'Die Meldung wurde nicht angenommen.');
      else if (out.success === false) refuse(out.code, out.message);
    } catch (_) {
      refuse('offline', 'Keine Verbindung zum Server.');
    }
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.origin !== open.appOrigin || e.source !== frame.contentWindow || !m || m.lm !== 1) return;
    if (m.type === 'lm.ready') {
      send('lm.init', {
        mode: open.mode, unit: options.startUnit || open.unit || null, enabledUnits: open.enabledUnits, state, displayName: null,
      });
      return;
    }
    if (!['lm.progress', 'lm.result', 'lm.state'].includes(m.type)) return;
    if (m.type === 'lm.state') {
      const data = m.data?.data ?? null;
      if (JSON.stringify(data).length > MAX_STATE) { refuse('state-too-large', 'Der Stand ist größer als 256 KB.'); return; }
      // Hängt die Ansicht beim Blättern neu ein, startet die App mit dem letzten Stand.
      state = data;
      if (open.mode === 'anonymous') {
        try { localStorage.setItem(stateKey, JSON.stringify(data)); } catch (_) { refuse('state-too-large', 'Der Speicher des Geräts ist voll.'); }
      }
    }
    if (open.session) report(m.type, m.data);
  });
}
