/**
 * lm-bridge.js – Verbindung einer HTML-App zu LearningModules (Schnittstelle 1,
 * docs/html-apps.md). In die HTML-Datei kopieren: Im Sandkasten gibt es kein Nachladen.
 * Ohne Gastgeber (Datei einfach geöffnet) tut sie nichts, die App läuft weiter wie allein.
 */
(function () {
  'use strict';
  var V = 1;
  var hosted = window.parent !== window;
  var initHandlers = [];
  var openHandlers = [];
  var errorHandlers = [];
  var init = null;
  var timers = {};
  var pending = {};

  function post(type, data) {
    if (!hosted) return;
    window.parent.postMessage({ lm: V, type: type, data: data }, '*');
  }

  // Häufiges bündeln: Tippen und Klicken sollen nicht je eine Meldung erzeugen.
  function later(key, ms, type, data) {
    pending[key] = { type: type, data: data };
    if (timers[key]) return;
    timers[key] = setTimeout(function () { flushOne(key); }, ms);
  }
  function flushOne(key) {
    clearTimeout(timers[key]);
    delete timers[key];
    var p = pending[key];
    if (!p) return;
    delete pending[key];
    post(p.type, p.data);
  }
  function flush() { Object.keys(pending).forEach(flushOne); }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.lm !== V) return;
    if (m.type === 'lm.init') {
      init = m.data || {};
      initHandlers.splice(0).forEach(function (fn) { fn(init); });
    } else if (m.type === 'lm.open') {
      openHandlers.forEach(function (fn) { fn(m.data && m.data.unit); });
    } else if (m.type === 'lm.error') {
      errorHandlers.forEach(function (fn) { fn(m.data || {}); });
      if (window.console) console.warn('LearningModules:', m.data && m.data.message);
    }
  });
  // Vor dem Schließen alles Offene noch absenden.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  window.LM = {
    version: V,
    /** Läuft die App in LearningModules? */
    hosted: hosted,
    /**
     * Start: `fn({ mode, unit, enabledUnits, state, displayName })`. Ohne Gastgeber sofort mit
     * mode 'standalone'. Erst hier den Stand laden und die Oberfläche aufbauen.
     */
    start: function (fn) {
      if (!hosted) { fn({ mode: 'standalone', unit: null, enabledUnits: null, state: null, displayName: null }); return; }
      if (init) { fn(init); return; }
      initHandlers.push(fn);
      post('lm.ready', {});
    },
    /** Die Lehrkraft schickt die Klasse in einen Abschnitt oder ein Klick im Baum: `fn(unitId)`. */
    onOpen: function (fn) { openHandlers.push(fn); },
    /** Meldungen des Gastgebers zu abgelehnten Nachrichten: `fn({ code, message })`. */
    onError: function (fn) { errorHandlers.push(fn); },
    /** Der Schüler ist jetzt in diesem Abschnitt (Liveview: „gerade dran“). */
    enter: function (unit) { post('lm.progress', { unit: unit, active: true }); },
    /** Fortschritt für den Liveview: `{ done, total, item? }` – Gesamtstand, kein Zuwachs. */
    progress: function (unit, p) {
      later('p:' + unit, 1000, 'lm.progress', { unit: unit, done: p.done, total: p.total, item: p.item == null ? null : String(p.item) });
    },
    /** Ergebnis: `{ score, max, items? }` – immer der Gesamtstand des Abschnitts, er ersetzt den vorigen. */
    result: function (unit, r) {
      later('r:' + unit, 1500, 'lm.result', { unit: unit, score: r.score, max: r.max, items: r.items || null });
    },
    /** Stand speichern (JSON, höchstens 256 KB); kommt beim nächsten Start als `state` zurück. */
    saveState: function (data) { later('s', 2000, 'lm.state', { data: data }); },
    /** Sofort absenden, z. B. nach „Abgeben“. */
    flush: flush,
  };
}());
