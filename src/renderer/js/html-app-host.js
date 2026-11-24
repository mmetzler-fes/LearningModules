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
    el.textContent = e.message;
    return;
  }
  const { open } = session;
  let step = content?.step || null;

  el.textContent = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
  const bar = document.createElement('div');
  // Eine Zeile: Ist sie zu lang (schmale Spalte, Stift-Editor), lässt sie sich seitlich wischen.
  bar.className = 'lm-app-bar';
  // Hinweis zur Speicherung nur als Symbol – Antippen zeigt den Text (Tooltip gibt es auf dem iPad nicht).
  const hintText = HINTS[open.mode] || '';
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'btn btn-secondary btn-sm lm-app-info';
  hint.textContent = 'ℹ️';
  hint.title = hintText;
  hint.setAttribute('aria-label', hintText);
  hint.hidden = !hintText;
  // Sprechblase über allem (am body – in der wischbaren Leiste würde sie abgeschnitten): Sie verschiebt
  // nichts und geht nach ein paar Sekunden, beim erneuten Antippen oder beim Tippen daneben wieder weg.
  let bubble = null;
  let bubbleTimer = 0;
  const hideBubble = () => {
    clearTimeout(bubbleTimer);
    bubble?.remove();
    bubble = null;
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e) => { if (e.target !== hint) hideBubble(); };
  hint.addEventListener('click', () => {
    if (bubble) { hideBubble(); return; }
    bubble = document.createElement('div');
    bubble.className = 'lm-app-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.textContent = hintText;
    document.body.appendChild(bubble);
    const r = hint.getBoundingClientRect();
    const w = bubble.offsetWidth;
    bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    bubble.style.top = `${r.bottom + 6}px`;
    bubbleTimer = setTimeout(hideBubble, 4000);
    document.addEventListener('pointerdown', outside, true);
  });
  const big = document.createElement('button');
  big.type = 'button';
  big.className = 'btn btn-secondary btn-sm lm-app-big';
  big.textContent = '⛶ Groß';

  // „Überprüfen“ ohne Durchlauf (App im Dokument, Vorschau): Im Durchlauf drückt der Prüfen-Knopf
  // des Quiz – hier gäbe es sonst nie eine Rückmeldung. Nicht in Klassenarbeiten.
  const exam = !!(options.quizMode && (options.examMode || options.examRun));
  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn btn-primary btn-sm';
  checkBtn.textContent = '✓ Überprüfen';
  const verdict = document.createElement('span');
  verdict.className = 'lm-app-verdict';
  verdict.setAttribute('aria-live', 'polite');
  let lastAnswer = null;
  let checked = false;
  const showVerdict = () => {
    if (!checked) { verdict.textContent = ''; return; }
    const ok = lastAnswer?.isCorrect;
    // points: 0 bis 1 (Teilpunkte, docs/html-apps.md)
    const p = Number(lastAnswer?.points);
    const pts = ok === false && lastAnswer?.points != null && Number.isFinite(p) && p > 0 ? ` (${Math.round(p * 100)} %)` : '';
    verdict.textContent = ok === true ? `✓ Richtig${pts}` : ok === false ? `✗ Noch nicht richtig${pts}` : '';
  };
  const showCheck = () => {
    checkBtn.hidden = exam || (!!step && step.kind !== 'task');
    checked = false;
    lastAnswer = null;
    showVerdict();
  };
  let checkPending = false;
  checkBtn.addEventListener('click', async () => {
    checkPending = true;
    await wrap._lmApp?.flush();
    wrap._lmApp?.check();
    checked = true;
    // Die App meldet ihren Stand beim Prüfen oft noch einmal – kurz abwarten.
    setTimeout(() => { checkPending = false; showVerdict(); }, 300);
  });

  // Zoom in der App (Strg + Mausrad, zwei Finger – lm-bridge.js): ↔ passt die App an die Breite an
  // (sie misst ihren Inhalt selbst), die Prozentanzeige setzt auf 100 % zurück.
  const zoomTo = (data) => frame.contentWindow?.postMessage({ lm: 2, type: 'lm.zoom', data }, open.appOrigin);
  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'btn btn-secondary btn-sm';
  fitBtn.textContent = '↔';
  fitBtn.title = 'App an die Breite anpassen (zoomen: Strg + Mausrad oder zwei Finger)';
  fitBtn.setAttribute('aria-label', fitBtn.title);
  fitBtn.addEventListener('click', () => { session.zoomAuto = 'width'; zoomTo({ fit: 'width' }); });
  // ⤢ Ganze Seite: Breite und Höhe passen hinein (kann klein werden) – gilt auch für die nächsten Schritte.
  const pageBtn = document.createElement('button');
  pageBtn.type = 'button';
  pageBtn.className = 'btn btn-secondary btn-sm';
  pageBtn.textContent = '⤢';
  pageBtn.title = 'Ganze Seite der App einpassen (ohne Scrollen)';
  pageBtn.setAttribute('aria-label', pageBtn.title);
  pageBtn.addEventListener('click', () => { session.zoomAuto = 'page'; zoomTo({ fit: 'page' }); });
  const zoomBtn = document.createElement('button');
  zoomBtn.type = 'button';
  zoomBtn.className = 'btn btn-secondary btn-sm';
  zoomBtn.title = 'Zurück auf 100 %';
  const showZoom = () => {
    const z = session.zoom || 1;
    zoomBtn.hidden = Math.abs(z - 1) < 0.01;
    zoomBtn.textContent = `${Math.round(z * 100)} %`;
  };
  zoomBtn.addEventListener('click', () => {
    session.zoom = 1;
    session.zoomAuto = null;
    showZoom();
    zoomTo({ scale: 1 });
  });
  showZoom();
  showCheck();

  const frame = document.createElement('iframe');
  frame.title = title || 'HTML-App';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-downloads allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', '');
  frame.style.cssText = 'width:100%; height:75vh; border:1px solid var(--border); border-radius:var(--radius-md); background:#fff;';

  // LM.goto der App: in der Vorschau bzw. im Blatt über die Auswahl, im Durchlauf über den Quiz-Player.
  let jumpTo = null;
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
    // ◀ / ▶ blättern durch die Schritte, ohne die Auswahlbox aufzuklappen.
    const arrow = (label, delta, tip) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-sm';
      b.textContent = label;
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', () => {
        const i = pick.selectedIndex + delta;
        if (i < 0 || i >= steps.length) return;
        pick.selectedIndex = i;
        pick.dispatchEvent(new Event('change'));
      });
      return b;
    };
    const prev = arrow('◀', -1, 'Vorheriger Schritt');
    const next = arrow('▶', 1, 'Nächster Schritt');
    const syncArrows = () => {
      prev.disabled = pick.selectedIndex <= 0;
      next.disabled = pick.selectedIndex >= steps.length - 1;
      prev.hidden = next.hidden = steps.length < 2;
    };
    pick.addEventListener('change', () => {
      step = steps.find((s) => s.id === pick.value);
      syncArrows();
      showCheck();
      frame.src = open.shellUrl;
    });
    syncArrows();
    jumpTo = (id) => {
      if (!steps.some((s) => s.id === id)) return false;
      pick.value = id;
      pick.dispatchEvent(new Event('change'));
      return true;
    };
    const nav = document.createElement('span');
    nav.className = 'lm-app-nav';
    nav.append(prev, pick, next);
    bar.append(nav);
  }

  // Im Durchlauf stehen Groß/Verkleinern und der Hinweis in der Titelleiste des Quiz, sonst über der App.
  // Das Quiz schreibt die Titelleiste je Schritt neu, deshalb auch nach dem Zurückblättern (syncLarge).
  // In einem Dokument eingebettet (Quiz im Blatt) gilt das nicht: Dort stehen Text und weitere Quizze
  // um die App herum, „Groß“ hätte das Blatt am Scrollen gehindert – die App geht über den Bildschirm.
  const embedded = !!el.closest('.ds-quiz-slot, .ds-quiz');
  const inRun = !!options.appRun && !embedded && !!document.getElementById('quizActions');
  const titleSlot = document.createElement('span');
  const showInTitle = () => {
    if (wrap.isConnected) document.getElementById('quizInfo')?.appendChild(titleSlot);
  };
  if (inRun) {
    titleSlot.className = 'quiz-info-actions lm-app-title-actions';
    hint.classList.add('lm-app-title-hint');
    // Schritt der App wählen (wie LM.goto) – nicht in Klassenarbeit und Lernbegleitung.
    const steps = stepsOf(open.manifest);
    if (!exam && steps.length > 1 && step) {
      const pick = document.createElement('select');
      pick.className = 'lm-app-step-pick';
      pick.title = 'Seite der App wählen';
      pick.setAttribute('aria-label', pick.title);
      for (const s of steps) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.unitTitle && s.unitTitle !== s.title ? `${s.unitTitle}: ${s.title}` : s.title;
        opt.selected = s.id === step.id;
        pick.appendChild(opt);
      }
      pick.addEventListener('change', () => {
        const ev = new CustomEvent('lm-app-goto', { bubbles: true, cancelable: true, detail: { rootId: content?.rootId || null, step: pick.value } });
        wrap.dispatchEvent(ev);
        if (!ev.defaultPrevented) pick.value = step.id; // Schritt nicht in diesem Durchlauf
      });
      titleSlot.append(pick);
    }
    // Handy (schmal, styles.css): Zurück, Weiter und Abbrechen hier oben – die untere Leiste entfällt dort.
    const proxy = (text, title, id, cls = 'btn-secondary') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls} btn-sm lm-app-nav`;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => document.getElementById(id)?.click());
      return b;
    };
    const prevBtn = proxy('◀', 'Zurück', 'btnQuizPrev');
    const prevOrig = document.getElementById('btnQuizPrev');
    if (!prevOrig || prevOrig.style.display === 'none') prevBtn.disabled = true;
    const nextBtn = proxy('▶', document.getElementById('btnQuizNext')?.textContent?.replace(/[→\s]+$/, '') || 'Weiter', 'btnQuizNext', 'btn-primary');
    const quitBtn = proxy('✕', 'Quiz abbrechen', 'btnQuizCancel');
    titleSlot.prepend(prevBtn);
    titleSlot.append(hint, fitBtn, pageBtn, zoomBtn, big, nextBtn, quitBtn);
  } else {
    const gap = document.createElement('span');
    gap.className = 'lm-app-gap';
    bar.prepend(hint);
    bar.append(checkBtn, verdict, gap, fitBtn, pageBtn, zoomBtn, big);
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
    big.textContent = on ? '⤡ Klein' : '⛶ Groß';
    big.title = on ? 'Wieder mit Kopfzeilen anzeigen' : 'App über die ganze freie Fläche';
    if (inRun) {
      session.large = on;
      document.body.classList.toggle('html-app-large', on);
      // Alle Hüllen von der App bis zur Fläche des Moduls müssen mitwachsen.
      for (let n = wrap; n && n !== box; n = n.parentElement) n.classList.toggle('lm-app-fill', on);
      frame.classList.toggle('lm-app-frame', on);
      if (on) document.getElementById('mainContent')?.scrollTo(0, 0);
      return;
    }
    // Eigene Ebene direkt am body: Im Blatt (Stift-Editor, Dokument) liegt die App in Hüllen mit Zoom
    // und eigener Bezugsfläche – dort lag „Groß“ verschoben, und das Blatt dahinter scrollte mit.
    // Das Umhängen lädt die App neu; Stand und Zoom kommen wie beim Blättern zurück (lm.init).
    void moveLarge(on);
  };
  const placeholder = document.createElement('div');
  let layer = null;
  async function moveLarge(on) {
    big.disabled = true;
    await wrap._lmApp?.flush();
    if (on && !layer) {
      placeholder.style.height = `${wrap.getBoundingClientRect().height}px`;
      wrap.replaceWith(placeholder);
      layer = document.createElement('div');
      layer.className = 'lm-app-layer';
      layer.appendChild(wrap);
      document.body.appendChild(layer);
    } else if (!on && layer) {
      if (placeholder.isConnected) placeholder.replaceWith(wrap);
      else wrap.remove(); // Das Blatt wurde inzwischen neu aufgebaut.
      layer.remove();
      layer = null;
    }
    document.body.classList.toggle('lm-app-big', !!layer);
    wrap.classList.toggle('lm-app-big-wrap', !!layer);
    frame.style.height = layer ? 'auto' : '75vh';
    frame.src = open.shellUrl;
    big.disabled = false;
    if (!on) {
      // Zurück im Blatt: Fokus aus der App nehmen (Tastatur zu) und der Seite Bescheid geben –
      // der Stift-Editor holt seine Leiste zurück, falls Safari die Seite verschoben hat.
      if (document.activeElement === frame || document.activeElement?.tagName === 'IFRAME') document.activeElement.blur();
      window.scrollTo(0, 0);
      window.dispatchEvent(new CustomEvent('lm-app-restored'));
      // Weiter mit dem, was nach der App kommt: Das Blatt so scrollen, dass die Zeile danach oben
      // im Bild steht (nur die eigene Scrollfläche – scrollIntoView schöbe auf dem iPad die Seite mit).
      requestAnimationFrame(() => requestAnimationFrame(() => showAfterApp()));
    }
  }
  function showAfterApp() {
    if (!wrap.isConnected) return;
    const end = wrap.closest('.ds-quiz') || wrap;
    let sc = end.parentElement;
    while (sc && sc !== document.body) {
      const o = getComputedStyle(sc).overflowY;
      if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break;
      sc = sc.parentElement;
    }
    if (!sc || sc === document.body) return;
    const top = sc.getBoundingClientRect().top;
    sc.scrollTop += end.getBoundingClientRect().bottom - top - Math.min(80, sc.clientHeight * 0.15);
  }
  // Esc schließt die große Ansicht (nicht im Durchlauf: Dort bleibt die Weiter-Zeile sichtbar).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && large && !inRun && layer) { e.preventDefault(); setLarge(false); } });
  big.addEventListener('click', () => setLarge(!large));
  // Der nächste Schritt baut seinen Rahmen neu auf; „Groß“ bleibt.
  // Standard im Durchlauf: Groß (Wunsch der Lehrkraft, überall) – bis jemand „Klein“ wählt.
  // Auf dem Handy immer groß (dort gibt es keinen Knopf „Klein“, styles.css).
  const phone = () => !!window.matchMedia?.('(max-width: 700px)').matches;
  if (inRun && (session.large !== false || phone())) setLarge(true);

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
    syncLarge: () => { if (inRun) { showInTitle(); setLarge(session.large !== false || phone()); } },
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
        // Ohne eigenen Zoom passt die App sich ein: an die Breite (Standard) oder als ganze Seite (⤢).
        if (session.zoomAuto === undefined) session.zoomAuto = 'width';
        send('lm.init', { mode: open.mode, run: options.appRun || 'quiz', step, state: session.state, displayName: null, zoom: session.zoomAuto ? 1 : (session.zoom || 1), fit: session.zoomAuto || null });
        break;
      case 'lm.zoom':
        session.zoom = Math.max(0.3, Math.min(3, Number(m.data?.scale) || 1));
        if (!m.data?.auto) session.zoomAuto = null; // von Hand gezoomt: gilt so weiter
        showZoom();
        break;
      case 'lm.answer':
        if (content && step?.kind === 'task') content.answer = cleanAnswer(m.data);
        lastAnswer = m.data || null;
        // Geändert nach dem Prüfen: Die Rückmeldung gilt nicht mehr – erneut überprüfen.
        if (checked && !checkPending) { checked = false; showVerdict(); }
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
      case 'lm.goto': {
        const id = String(m.data?.step || '');
        const known = stepsOf(open.manifest).some((s) => s.id === id);
        if (!known) { refuse('goto', `Den Schritt „${id.slice(0, 40)}“ gibt es nicht.`); break; }
        if (jumpTo) { jumpTo(id); break; }
        // Im Durchlauf entscheidet der Quiz-Player (nicht in Klassenarbeit und Lernbegleitung).
        const ev = new CustomEvent('lm-app-goto', { bubbles: true, cancelable: true, detail: { rootId: content?.rootId || null, step: id } });
        wrap.dispatchEvent(ev);
        if (!ev.defaultPrevented) refuse('goto', 'Springen ist hier nicht möglich – bitte mit Weiter und Zurück blättern.');
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
