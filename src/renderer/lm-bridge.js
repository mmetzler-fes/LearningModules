/**
 * lm-bridge.js – Verbindung einer HTML-App zu LearningModules (Schnittstelle 2, docs/html-apps.md).
 * Der Server fügt sie beim Ausliefern selbst ein. In die Datei kopieren muss sie nur, wer die App
 * auch allein öffnen will; allein zeigt sie unten eine Leiste zum Blättern durch die Schritte.
 */
(function () {
  'use strict';
  if (window.LM) return;
  var V = 2;
  var hosted = window.parent !== window;
  var starter = null;
  var handlers = { lock: [], reveal: [], check: [], flush: [], error: [] };

  function post(type, data) {
    if (hosted) window.parent.postMessage({ lm: V, type: type, data: data }, '*');
  }
  function fire(name, arg) {
    handlers[name].forEach(function (fn) { fn(arg); });
  }
  // Zoom der App: Strg + Mausrad (auch Zwei-Finger am Trackpad) oder zwei Finger (iPad).
  // Die Seite drumherum sieht die Gesten im Rahmen nicht – deshalb hier. Der Wert geht an
  // LearningModules und kommt beim nächsten Schritt in "init.zoom" zurück.
  var zoom = 1;
  function setZoom(z, report, auto) {
    zoom = Math.max(0.3, Math.min(3, Math.round(z * 100) / 100));
    document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
    if (report) post('lm.zoom', auto ? { scale: zoom, auto: true } : { scale: zoom });
  }
  window.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    fitMode = null;
    setZoom(zoom * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) / 600), true);
  }, { passive: false });
  /**
   * Breite des Inhalts: läuft er über, die ganze Breite; sonst nur, was die Elemente wirklich belegen –
   * eine schmale, mittig gesetzte App hätte sonst rechts und links weißen Rand.
   */
  function contentWidth() {
    var root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) return root.scrollWidth;
    var body = document.body;
    if (!body) return root.clientWidth;
    var left = Infinity, right = -Infinity;
    for (var i = 0; i < body.children.length; i++) {
      var el = body.children[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
    }
    return right > left ? Math.max(right - left, 1) : root.clientWidth;
  }
  /** So weit zoomen, dass der Inhalt genau die Breite des Rahmens füllt – ohne weißen Rand. */
  function fitWidth() {
    setZoom(1, false);
    setZoom(document.documentElement.clientWidth / contentWidth(), true, true);
  }
  /** Ganze Seite: Breite und Höhe passen in den Rahmen, ohne Scrollen. */
  function fitPage() {
    setZoom(1, false);
    var root = document.documentElement;
    var body = document.body;
    var high = Math.max(root.scrollHeight, body ? body.scrollHeight : 0);
    var z = Math.min(root.clientWidth / contentWidth(), high > 0 ? root.clientHeight / high : 1);
    setZoom(z, true, true);
  }
  function fit(how) {
    if (how === 'page') fitPage(); else fitWidth();
  }
  /** Nach dem Aufbau einpassen – und noch einmal, wenn Bilder oder Schriften nachgeladen haben. */
  function fitSoon(how) {
    var go = function () { if (fitMode === how) fit(how); };
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { raf(go); });
    setTimeout(go, 400);
    window.addEventListener('load', go, { once: true });
  }
  var fitMode = null;
  window.addEventListener('resize', function () { if (fitMode) fit(fitMode); });
  var pinchFrom = 1;
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); pinchFrom = zoom; fitMode = null; }, { passive: false });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); setZoom(pinchFrom * e.scale, false); }, { passive: false });
  document.addEventListener('gestureend', function (e) { e.preventDefault(); post('lm.zoom', { scale: zoom }); }, { passive: false });

  function run(init) {
    if (init && init.zoom) setZoom(Number(init.zoom) || 1, false);
    fitMode = init && (init.fit === 'width' || init.fit === 'page') ? init.fit : null;
    if (starter) starter(init);
    if (fitMode) fitSoon(fitMode);
    post('lm.shown', { text: document.body ? (document.body.innerText || '').trim().length : 0 });
  }
  function manifest() {
    var el = document.querySelector('script[type="application/lm-app+json"]');
    try { return JSON.parse(el.textContent); } catch (e) { return { units: [] }; }
  }
  /** Allein geöffnet: Schritt aus der Adresse, Leiste zum Blättern, Stand nur im Speicher. */
  function standalone() {
    var steps = [];
    manifest().units.forEach(function (u) {
      (u.steps || []).forEach(function (s) { steps.push({ unit: u.id, id: s.id, title: s.title, kind: s.kind }); });
    });
    var at = Math.max(0, steps.findIndex(function (s) { return '#' + s.id === location.hash; }));
    run({ mode: 'standalone', run: 'quiz', step: steps[at] || null, state: null });
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:6px 10px;background:#222;color:#fff;font:13px sans-serif;z-index:99999';
    var go = function (d) {
      var next = steps[at + d];
      if (!next) return;
      location.hash = next.id;
      location.reload();
    };
    var btn = function (text, d) {
      var b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', function () { go(d); });
      return b;
    };
    bar.append(btn('◀', -1), ' Schritt ' + (at + 1) + ' von ' + steps.length + ' ', btn('▶', 1));
    document.body.appendChild(bar);
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.lm !== V) return;
    if (m.type === 'lm.init') run(m.data);
    else if (m.type === 'lm.lock') fire('lock', !!(m.data && m.data.locked));
    else if (m.type === 'lm.reveal') fire('reveal');
    else if (m.type === 'lm.check') fire('check');
    else if (m.type === 'lm.flush') { fire('flush'); post('lm.flushed', {}); }
    else if (m.type === 'lm.zoom') {
      if (m.data && (m.data.fit === 'width' || m.data.fit === 'page')) { fitMode = m.data.fit; fit(fitMode); }
      else { fitMode = null; setZoom(Number(m.data && m.data.scale) || 1, true); }
    }
    else if (m.type === 'lm.error') {
      fire('error', m.data);
      if (window.console) console.warn('LearningModules:', m.data && m.data.message);
    }
  });
  window.addEventListener('error', function (e) { post('lm.crash', { message: String(e.message || 'Fehler').slice(0, 300) }); });

  var LM = {
    hosted: hosted,
    /** Pflicht. "fn(init)" baut genau den Schritt "init.step" auf. */
    start: function (fn) {
      starter = fn;
      if (hosted) { post('lm.ready', {}); return; }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', standalone);
      else standalone();
    },
    /** Stand der Aufgabe, bei jeder Änderung und gleich beim Start: "{ isCorrect, points?, userAnswer?, correctAnswer? }". */
    answer: function (a) { post('lm.answer', a || {}); },
    /** Eigener Stand, JSON, höchstens 256 KB. Kommt beim nächsten Schritt wieder in "init.state". */
    saveState: function (data) { post('lm.state', { data: data === undefined ? null : data }); },
    /** Datei anbieten: ".xlsx", ".csv", ".pdf", ".png", ".jpg" oder ".txt". */
    download: function (name, blob) { post('lm.download', { name: String(name), blob: blob }); },
    /** Zu einem anderen Schritt der App springen (z. B. aus einer Übersicht); LearningModules entscheidet, ob es geht. */
    goto: function (stepId) {
      if (hosted) { post('lm.goto', { step: String(stepId) }); return; }
      location.hash = String(stepId);
      location.reload();
    },
    onLock: function (fn) { handlers.lock.push(fn); },
    onReveal: function (fn) { handlers.reveal.push(fn); },
    onCheck: function (fn) { handlers.check.push(fn); },
    onFlush: function (fn) { handlers.flush.push(fn); },
    onError: function (fn) { handlers.error.push(fn); },
  };
  Object.freeze(LM);
  Object.defineProperty(window, 'LM', { value: LM, writable: false, configurable: false });
})();
