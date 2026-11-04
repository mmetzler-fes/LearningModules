/**
 * Schutzskript: läuft beim Ausliefern als allererstes Skript in jeder HTML-App
 * (docs/html-apps.md, „Sicherheit“). Es nimmt der App, was der Sandkasten allein
 * nicht sperrt: WebRTC, neue Fenster-Umgebungen, Rahmen und Seitenwechsel über Links.
 */
export const GUARD_JS = `(function () {
  'use strict';
  var w = window;
  Object.getOwnPropertyNames(w).forEach(function (n) {
    if (/^(webkit)?RTC|^(Shared)?Worker$|^ServiceWorker|^XSLTProcessor$|^WebTransport|^WebSocket$|^XMLHttpRequest$|^EventSource$/.test(n)) {
      try { delete w[n]; } catch (e) { /* bleibt: dann greift die CSP */ }
    }
  });
  var TAGS = 'iframe|frame|frameset|object|embed|link|base|meta|fencedframe|portal';
  var BAD = new RegExp('^(' + TAGS + ')$', 'i');
  var BADHTML = new RegExp('<\\\\s*(' + TAGS + ')\\\\b', 'i');
  var SELECTOR = TAGS.split('|').join(',');
  var no = function (what) { throw new TypeError('LearningModules: ' + what + ' ist in HTML-Apps nicht erlaubt.'); };
  var D = Document.prototype;
  var ce = D.createElement, cn = D.createElementNS, ad = D.adoptNode, im = D.importNode;
  D.createElement = function (n, o) { if (BAD.test(String(n))) no('<' + n + '>'); return ce.call(this, n, o); };
  D.createElementNS = function (s, n, o) { if (BAD.test(String(n).split(':').pop())) no('<' + n + '>'); return cn.call(this, s, n, o); };
  var check = function (node) {
    if (!node) return;
    if (node.nodeType === 1 && BAD.test(node.localName)) no('<' + node.localName + '>');
    if (node.querySelector && node.querySelector(SELECTOR)) no('Rahmen');
  };
  D.adoptNode = function (n) { check(n); return ad.call(this, n); };
  D.importNode = function (n, d) { check(n); return im.call(this, n, d); };
  ['write', 'writeln', 'open'].forEach(function (k) { D[k] = function () { no('document.' + k); }; });
  DOMImplementation.prototype.createDocument = function () { no('createDocument'); };
  var pf = w.DOMParser && DOMParser.prototype.parseFromString;
  if (pf) DOMParser.prototype.parseFromString = function (s, t) { if (t !== 'text/html') no('XML-Parser'); return pf.call(this, s, t); };
  ['contentWindow', 'contentDocument'].forEach(function (k) {
    [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement, w.HTMLEmbedElement].forEach(function (C) {
      if (C && Object.getOwnPropertyDescriptor(C.prototype, k)) Object.defineProperty(C.prototype, k, { get: function () { return null; } });
    });
  });
  var clean = function (s) { s = String(s); if (BADHTML.test(s)) no('Dieses HTML'); return s; };
  if (w.trustedTypes && w.trustedTypes.createPolicy) {
    w.trustedTypes.createPolicy('default', { createHTML: function (s) { return BADHTML.test(s) ? null : s; } });
  } else {
    // Ältere Browser ohne Trusted Types: dieselben Stellen von Hand.
    var setter = function (proto, prop) {
      var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (d && d.set) Object.defineProperty(proto, prop, { get: d.get, set: function (v) { d.set.call(this, clean(v)); }, configurable: false });
    };
    setter(Element.prototype, 'innerHTML');
    setter(Element.prototype, 'outerHTML');
    setter(w.ShadowRoot && ShadowRoot.prototype, 'innerHTML');
    var wrap = function (proto, name, at) {
      var f = proto && proto[name];
      if (f) proto[name] = function () { var a = [].slice.call(arguments); a[at] = clean(a[at]); return f.apply(this, a); };
    };
    wrap(Element.prototype, 'insertAdjacentHTML', 1);
    wrap(Element.prototype, 'setHTMLUnsafe', 0);
    wrap(w.ShadowRoot && ShadowRoot.prototype, 'setHTMLUnsafe', 0);
    wrap(w.Range && Range.prototype, 'createContextualFragment', 0);
    wrap(D, 'execCommand', 2);
    if (pf) wrap(DOMParser.prototype, 'parseFromString', 0);
  }
  // Links wechseln die Seite nicht: Sprungmarken in der App bleiben, alles andere nicht.
  var external = function (a) {
    var h = a && a.getAttribute && (a.getAttribute('href') || a.getAttribute('xlink:href'));
    return !!h && h.charAt(0) !== '#';
  };
  var linkOf = function (el) { return el && el.closest ? el.closest('a,area') : null; };
  w.addEventListener('click', function (e) {
    if (external(linkOf(e.target))) e.preventDefault();
  }, true);
  var click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { if (!external(linkOf(this))) click.call(this); };
  var de = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && external(linkOf(this))) return false;
    return de.call(this, ev);
  };
  [w.HTMLFormElement].forEach(function (F) {
    if (!F) return;
    F.prototype.submit = function () {};
    F.prototype.requestSubmit = function () {};
  });
})();
`;
