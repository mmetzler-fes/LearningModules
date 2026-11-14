// ==================== HTML-APP IM SANDKASTEN ====================
//
// Hauptseite → Rahmenseite auf der App-Adresse → App (docs/html-apps.md). Die App zeigt genau einen
// Schritt und meldet ihre Antwort; Weiter, Prüfen, Lösung und Punkte liegen beim Durchlauf. Sie sieht
// nur die Felder von `init`, Ausweis und Meldungen bleiben hier.

const MAX_STATE = 256 * 1024;
const MAX_DOWNLOAD = 10 * 1024 * 1024;
const DOWNLOAD_TYPES = /\.(xlsx|csv|pdf|png|jpe?g|txt)$/i;
const TEXT_LIMIT = 500;

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
  anonymous: 'Ohne Anmeldung: Der Stand der App bleibt auf diesem Gerät.',
};

/**
 * Eine Sitzung je App und Durchlauf: Alle Schritte teilen Adresse und Stand. So kommt die Datei aus
 * dem Browser-Speicher, und der Stand aus dem letzten Schritt ist beim nächsten schon da.
 */
const sessions = new Map();

async function openSession({ moduleId, content, up }) {
  const inRun = up && (up.linkToken || up.quickToken);
  const key = [inRun ? up.linkToken || up.quickToken : 'vorschau', up?.studentTicket || '', content?.rootId || moduleId].join('|');
  if (sessions.has(key)) return sessions.get(key);
  const open = await (inRun
    ? post('/api/public/html-app/open', {
      linkToken: up.linkToken || undefined, quickToken: up.quickToken || undefined,
      password: up.password || undefined, studentTicket: up.studentTicket || undefined, moduleId,
    })
    : post('/api/html-apps/preview', { moduleId: content?.rootId || moduleId, fileId: content?.app?.fileId }, authToken()));
  const stateKey = `lm_html_app:${open.rootId || moduleId}`;
  const session = { open, stateKey, state: open.mode === 'anonymous' ? localState(stateKey) : open.state };
  sessions.set(key, session);
  return session;
}

/** Was die App als Antwort meldet: fremde Daten, nur diese Felder und in dieser Länge. */
export function cleanAnswer(a) {
  const text = (v) => (v === undefined || v === null ? '' : String(v).slice(0, TEXT_LIMIT));
  const points = Number(a?.points);
  return {
    isCorrect: a?.isCorrect === true,
    points: Number.isFinite(points) ? Math.min(1, Math.max(0, points)) : undefined,
    userAnswer: text(a?.userAnswer),
    correctAnswer: text(a?.correctAnswer),
  };
}

function offerDownload(name, blob) {
  const safe = String(name || '').replace(/[^\wäöüÄÖÜß.-]+/g, '_').slice(0, 120);
  if (!DOWNLOAD_TYPES.test(safe)) return `Dateien vom Typ „${safe.split('.').pop()}“ sind nicht erlaubt.`;
  if (!(blob instanceof Blob) || blob.size > MAX_DOWNLOAD) return 'Die Datei fehlt oder ist größer als 10 MB.';
  const a = document.createElement('a');
  // Immer als Download, nie als Seite im Browser.
  a.href = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return null;
}

function stepsOf(manifest) {
  return (manifest?.units || []).flatMap((u) => (u.steps || []).map((s) => ({ unit: u.id, unitTitle: u.title, id: s.id, title: s.title, kind: s.kind })));
}

export async function mountHtmlApp({ el, moduleId, content, options, title }) {
  el.textContent = 'HTML-App wird geladen …';
  let session;
  try {
    session = await openSession({ moduleId, content, up: options.upload });
  } catch (e) {
    el.textContent = `❌ ${e.message}`;
    return;
  }
  const { open } = session;
  let step = content?.step || null;

  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
  const hint = document.createElement('small');
  hint.className = 'hint';
  hint.textContent = HINTS[open.mode] || '';
  const big = document.createElement('button');
  big.type = 'button';
  big.className = 'btn btn-secondary btn-sm';
  big.textContent = '⛶ Groß';

  const frame = document.createElement('iframe');
  frame.title = title || 'HTML-App';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-downloads allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', '');
  frame.style.cssText = 'width:100%; height:75vh; border:1px solid var(--border); border-radius:var(--radius-md); background:#fff;';

  // Vorschau ohne Durchlauf: Die Lehrkraft wählt den Schritt selbst.
  if (!step) {
    const steps = stepsOf(open.manifest);
    step = steps.find((s) => !(options.startUnit || open.unit) || s.unit === (options.startUnit || open.unit)) || steps[0] || null;
    const pick = document.createElement('select');
    for (const s of steps) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.unitTitle}: ${s.title}`;
      opt.selected = s.id === step?.id;
      pick.appendChild(opt);
    }
    pick.addEventListener('change', () => {
      step = steps.find((s) => s.id === pick.value);
      frame.src = open.shellUrl;
    });
    bar.append(pick);
  }

  // Im Durchlauf stehen Groß/Verkleinern und der Hinweis in der Titelleiste des Quiz, sonst über der App.
  // Das Quiz schreibt die Titelleiste je Schritt neu, deshalb auch nach dem Zurückblättern (syncLarge).
  const inRun = !!options.appRun && !!document.getElementById('quizActions');
  const titleSlot = document.createElement('span');
  const showInTitle = () => {
    if (wrap.isConnected) document.getElementById('quizInfo')?.appendChild(titleSlot);
  };
  if (inRun) {
    titleSlot.className = 'quiz-info-actions lm-app-title-actions';
    hint.classList.add('lm-app-title-hint');
    titleSlot.append(hint, big);
  } else {
    bar.prepend(hint);
    bar.append(big);
  }

  frame.src = open.shellUrl;
  wrap.append(...(bar.childElementCount ? [bar] : []), frame);
  el.appendChild(wrap);
  if (inRun) showInTitle();

  // Ohne Umhängen: Ein iframe, das den Platz im Baum wechselt, lädt neu.
  // Im Durchlauf füllt „Groß“ die freie Fläche: Weiter-Zeile und Eule bleiben sichtbar, und es gilt auch für die
  // nächsten Schritte. Ohne Durchlauf (Vorschau) gibt es nichts freizuhalten: über den ganzen Bildschirm.
  // Das Layout füllt die Fläche, nicht gerechnete Pixel: Die vertragen sich nicht mit „Zoom Inhalt“.
  const box = document.getElementById('quizModuleContainer');
  let large = false;
  const setLarge = (on) => {
    large = on;
    big.textContent = on ? '✕ Verkleinern' : '⛶ Groß';
    if (inRun) {
      session.large = on;
      document.body.classList.toggle('html-app-large', on);
      // Alle Hüllen von der App bis zur Fläche des Moduls müssen mitwachsen.
      for (let n = wrap; n && n !== box; n = n.parentElement) n.classList.toggle('lm-app-fill', on);
      frame.classList.toggle('lm-app-frame', on);
      if (on) document.getElementById('mainContent')?.scrollTo(0, 0);
      return;
    }
    // In der obersten Ebene (Popover): Im Dokument-Editor liegt die App in Hüllen mit eigener
    // Bezugsfläche (Zoom, Transform) – dort fiel „position:fixed“ auf eine Höhe von null zusammen
    // und lag über dem Text. Die oberste Ebene hängt das iframe nicht um, es lädt also nicht neu.
    const topLayer = typeof wrap.showPopover === 'function';
    if (topLayer) {
      if (on && !wrap.popover) wrap.popover = 'manual';
      if (!on && wrap.matches?.(':popover-open')) wrap.hidePopover();
    }
    wrap.style.cssText = on
      ? 'position:fixed; left:0; top:0; max-width:none; max-height:none; margin:0; border:0; overflow:hidden; z-index:9999; display:flex; flex-direction:column; gap:6px; padding:8px; box-sizing:border-box; background:var(--bg-primary,#fff); color:var(--text-primary,#111);'
      : 'display:flex; flex-direction:column; gap:6px;';
    if (on) fitScreen();
    frame.style.height = on ? 'auto' : '75vh';
    frame.style.flex = on ? '1' : '';
    frame.style.minHeight = on ? '0' : '';
    if (topLayer && on && !wrap.matches?.(':popover-open')) wrap.showPopover();
    if (!on && wrap.popover) wrap.removeAttribute('popover');
  };
  // Esc schließt die große Ansicht (nicht im Durchlauf: Dort bleibt die Weiter-Zeile sichtbar).
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && large && !inRun) { e.preventDefault(); setLarge(false); } });
  // Die App erbt den Zoom ihrer Hüllen (Blatt im Editor auf Breite gebracht, A−/A+ des Quiz). Ohne Ausgleich
  // ragte die große Ansicht über den Bildschirm hinaus – samt Scrollleiste der App – oder wurde winzig.
  // Groß gilt der gewählte „Zoom Inhalt“, sonst 100 %.
  function fitScreen() {
    wrap.style.zoom = '';
    let z = 1;
    for (let n = wrap.parentElement; n; n = n.parentElement) z *= Number(getComputedStyle(n).zoom) || 1;
    const main = document.getElementById('mainContent');
    const want = main?.contains(wrap) ? Number(getComputedStyle(main).zoom) || 1 : 1;
    wrap.style.zoom = String(want / z);
    wrap.style.width = `${window.innerWidth / want}px`;
    wrap.style.height = `${window.innerHeight / want}px`;
  }
  window.addEventListener('resize', () => { if (large && !inRun) fitScreen(); });
  big.addEventListener('click', () => setLarge(!large));
  // Der nächste Schritt baut seinen Rahmen neu auf; „Groß“ bleibt.
  if (inRun && session.large) setLarge(true);

  const send = (type, data) => frame.contentWindow?.postMessage({ lm: 2, type, data }, open.appOrigin);
  const refuse = (code, message) => send('lm.error', { code, message });
  let flushDone = null;

  // Für den Durchlauf: Sperren, Lösung, Prüfen und das Abholen noch offener Eingaben.
  wrap.dataset.lmApp = '1';
  wrap._lmApp = {
    lock: (locked) => send('lm.lock', { locked: !!locked }),
    reveal: () => send('lm.reveal', {}),
    check: () => send('lm.check', {}),
    /** Zurückgeblättert: Die Ansicht ist wieder da, „Groß“ gilt wie zuletzt gewählt. */
    syncLarge: () => { if (inRun) { showInTitle(); setLarge(!!session.large); } },
    /** Offene Eingabe abschließen lassen; die Antwort ist da, wenn das Versprechen erfüllt ist. */
    flush: () => new Promise((resolve) => {
      const done = () => { flushDone = null; resolve(); };
      flushDone = done;
      send('lm.flush', {});
      setTimeout(() => { if (flushDone === done) done(); }, 500);
    }),
  };

  const saveState = async (data) => {
    const body = JSON.stringify({ session: open.session, type: 'lm.state', data: { data } });
    try {
      // keepalive: Beim Schließen der Seite soll der letzte Stand noch ankommen (Grenze 64 KB).
      const res = await fetch('/api/public/html-app/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) refuse(`http-${res.status}`, out.message || 'Der Stand wurde nicht angenommen.');
      else if (out.success === false) refuse(out.code, out.message);
    } catch (_) {
      refuse('offline', 'Keine Verbindung zum Server.');
    }
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.origin !== open.appOrigin || e.source !== frame.contentWindow || !m || m.lm !== 2) return;
    switch (m.type) {
      case 'lm.ready':
        send('lm.init', { mode: open.mode, run: options.appRun || 'quiz', step, state: session.state, displayName: null });
        break;
      case 'lm.answer':
        if (content && step?.kind === 'task') content.answer = cleanAnswer(m.data);
        break;
      case 'lm.flushed':
        flushDone?.();
        break;
      case 'lm.state': {
        const data = m.data?.data ?? null;
        if (JSON.stringify(data).length > MAX_STATE) { refuse('state-too-large', 'Der Stand ist größer als 256 KB.'); break; }
        // Der nächste Schritt und das Zurückblättern starten mit dem letzten Stand.
        session.state = data;
        if (open.mode === 'anonymous') {
          try { localStorage.setItem(session.stateKey, JSON.stringify(data)); } catch (_) { refuse('state-too-large', 'Der Speicher des Geräts ist voll.'); }
        }
        if (open.session) saveState(data);
        break;
      }
      case 'lm.download': {
        const problem = offerDownload(m.data?.name, m.data?.blob);
        if (problem) refuse('download', problem);
        break;
      }
      default:
    }
  });
}

/**
 * Prüflauf beim Einfügen: jeden Schritt einmal öffnen. Eine Aufgabe muss sich melden, ihre Antwort
 * schicken, und unberührt darf sie nicht als richtig gelten. `onProgress(fertig, alle)`.
 */
export async function checkAppRun({ fileId, manifest, onProgress = () => {} }) {
  const { shellUrl, appOrigin } = await post('/api/html-apps/preview', { fileId }, authToken());
  const steps = stepsOf(manifest);
  const errors = [];
  const WAIT = 8000;
  const one = (step) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.setAttribute('allow', '');
    frame.style.cssText = 'position:fixed; left:-9999px; top:0; width:1000px; height:700px; border:0;';
    let shown = null;
    let answer = null;
    let timer = null;
    const problems = [];
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (!shown) problems.push('startet nicht (LM.start fehlt oder ein Fehler beim Aufbau)');
      else if (!shown.text) problems.push('zeigt nichts an');
      if (shown && step.kind === 'task') {
        if (!answer) problems.push('meldet beim Start keine Antwort (LM.answer)');
        else if (answer.isCorrect) problems.push('gilt unberührt als richtig');
      }
      if (problems.length) errors.push(`${step.title}: ${problems.join(', ')}.`);
      resolve();
    };
    const settle = () => { clearTimeout(timer); timer = setTimeout(finish, step.kind === 'task' && !answer ? 1500 : 50); };
    function onMessage(e) {
      const m = e.data;
      if (e.origin !== appOrigin || e.source !== frame.contentWindow || !m || m.lm !== 2) return;
      if (m.type === 'lm.ready') frame.contentWindow.postMessage({ lm: 2, type: 'lm.init', data: { mode: 'preview', run: 'quiz', step, state: null, displayName: null } }, appOrigin);
      if (m.type === 'lm.crash') problems.push(`Skriptfehler: ${String(m.data?.message || '').slice(0, 160)}`);
      if (m.type === 'lm.answer') { answer = cleanAnswer(m.data); if (shown) settle(); }
      if (m.type === 'lm.shown') { shown = m.data || {}; settle(); }
    }
    window.addEventListener('message', onMessage);
    timer = setTimeout(finish, WAIT);
    frame.src = shellUrl;
    document.body.appendChild(frame);
  });
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < steps.length) {
      const step = steps[next++];
      await one(step);
      onProgress(++done, steps.length);
    }
  }));
  return errors;
}
