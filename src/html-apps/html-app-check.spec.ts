import * as fs from 'fs';
import * as path from 'path';
import { BRIDGE_JS } from './html-app-bridge';
import { deliverable, inspectApp } from './html-app-check';
import { GUARD_JS } from './html-app-guard';

const manifest = { lmApp: 2, id: 'ohm', version: '1', title: 'Ohm', units: [{ id: 'a', title: 'A', steps: [{ id: 's1', title: 'S', kind: 'task' }] }] };
const app = (js = 'LM.start(() => {});', extra = '', head = '') => `<!doctype html><html><head><title>x</title><script type="application/lm-app+json">${JSON.stringify(manifest)}</script>${head}</head><body>${extra}<script>${js}</script></body></html>`;
const errorsOf = (html: string) => inspectApp(html).errors.join(' | ');

describe('inspectApp', () => {
  it('nimmt eine saubere App an und nennt ihre Skripte', () => {
    const r = inspectApp(app());
    expect(r.errors).toEqual([]);
    expect(r.manifest?.id).toBe('ohm');
    expect(r.scripts).toEqual(['LM.start(() => {});']);
  });

  it('verlangt genau einen Steckbrief', () => {
    expect(errorsOf('<html><body>nichts</body></html>')).toContain('Steckbrief fehlt');
    expect(errorsOf(app('', '', `<script type="application/lm-app+json">${JSON.stringify(manifest)}</script>`))).toContain('nur einen');
  });

  it.each([
    ['iframe', '<iframe></iframe>'],
    ['iframe mit srcdoc', '<iframe srcdoc="<script>1</script>"></iframe>'],
    ['object', '<object data="x"></object>'],
    ['embed', '<embed src="x">'],
    ['link', '<link rel="preconnect" href="https://x.de">'],
    ['base', '<base href="https://x.de/">'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://x.de">'],
    ['Skript von außen', '<script src="https://x.de/a.js"></script>'],
    ['Modul-Skript', '<script type="module">1</script>'],
    ['speculationrules', '<script type="speculationrules">{}</script>'],
    ['on…=', '<button onclick="x()">a</button>'],
    ['Link nach außen', '<a href="https://x.de">a</a>'],
    ['javascript:', '<a href="javascript:x()">a</a>'],
    ['Bild von außen', '<img src="https://x.de/a.png">'],
    ['Formular nach außen', '<form action="https://x.de"></form>'],
    ['Stil von außen', '<div style="background:url(https://x.de/a)"></div>'],
    ['@import', '<style>@import "https://x.de/a.css";</style>'],
    ['Rahmen im template', '<template><iframe></iframe></template>'],
  ])('lehnt im HTML ab: %s', (_n, extra) => {
    expect(inspectApp(app('LM.start(() => {});', extra)).errors.length).toBeGreaterThan(0);
  });

  it('erlaubt Sprungmarken und eingebettete Bilder', () => {
    expect(errorsOf(app('LM.start(() => {});', '<a href="#x">a</a><img src="data:image/png;base64,AA=="><svg><use href="#y"></use></svg>'))).toBe('');
  });

  it.each([
    ['WebRTC', 'new RTCPeerConnection()'],
    ['WebRTC über window', 'new window.RTCPeerConnection()'],
    ['WebRTC mit festem Namen', "self['RTCPeerConnection']"],
    ['Escape im Namen', "self['\\x6cocation']"],
    ['location', 'location.href = "x"'],
    ['document.location', 'document.location = "x"'],
    ['fetch', 'fetch("x")'],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['WebSocket', 'new WebSocket("x")'],
    ['sendBeacon', 'navigator.sendBeacon("x")'],
    ['Worker', 'new Worker("x")'],
    ['eval', 'eval("1")'],
    ['Function', 'new Function("1")'],
    ['import()', 'import("x")'],
    ['Reflect', 'Reflect.get(self, "a")'],
    ['document.write', 'document.write("x")'],
    ['window.open', 'window.open("x")'],
    ['open()', 'open("x")'],
    ['berechneter Name an self', "self['loc' + 'ation']"],
    ['berechneter Name an window', 'window[k]'],
    ['berechneter Name an document', 'document[k]'],
    ['Zahl an window', 'window[0]'],
    ['window als Wert', 'const w = window;'],
    ['globalThis als Wert', 'f(globalThis)'],
    ['defaultView', 'el.ownerDocument.defaultView'],
    ['with', 'with (a) { b(); }'],
    ['Rahmen im Text', "d.innerHTML = '<iframe>'"],
    ['on…= im Text', "d.innerHTML = '<img onerror=\"x()\">'"],
    ['on…= in Vorlage', 'd.innerHTML = `<b onclick="x()">`'],
    ['javascript: im Text', "a.href = 'javascript:x()'"],
    ['Unlesbares', 'function ('],
  ])('lehnt im Skript ab: %s', (_n, js) => {
    expect(inspectApp(app(js)).errors.length).toBeGreaterThan(0);
  });

  it('nennt die Stelle', () => {
    expect(errorsOf(app('const a = 1;\nfetch("x");'))).toContain('Zeile 2');
  });

  it('erlaubt, was Apps üblicherweise brauchen', () => {
    const js = `LM.start((init) => { const r = document.querySelector('#a'); r.textContent = window.innerWidth; const o = { location: 1, fetchen: 2 }; addEventListener('resize', () => {}); LM.answer({ isCorrect: false }); });`;
    expect(errorsOf(app(js, '<div id="a"></div>'))).toBe('');
  });

  it('lässt nur die unveränderte Bridge ungeprüft', () => {
    expect(errorsOf(app(BRIDGE_JS))).toBe('');
    expect(errorsOf(app(`${BRIDGE_JS}\nfetch("x");`))).toContain('fetch');
  });
});

describe('deliverable', () => {
  it('setzt Schutzskript und Bridge vor alles andere und nennt alle Hashes', () => {
    const html = app();
    const d = deliverable(html, inspectApp(html).scripts);
    expect(d.html.startsWith(`<!doctype html><script>${GUARD_JS}</script><script>${BRIDGE_JS}</script>`)).toBe(true);
    expect(d.scriptHashes).toHaveLength(3);
    expect(d.scriptHashes.every((h) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(h))).toBe(true);
  });
});

describe('Dateien im Projekt', () => {
  it('Bridge als Datei und im Server sind gleich', () => {
    expect(fs.readFileSync(path.join(__dirname, '../renderer/lm-bridge.js'), 'utf8')).toBe(BRIDGE_JS);
  });
  it.each([
    ['html-app-beispiel.html', 3],
    ['beispiel_excel.html', 123],
  ])('Beispiel %s besteht die Prüfung', (name, steps) => {
    const r = inspectApp(fs.readFileSync(path.join(__dirname, '../../docs', name), 'utf8'));
    expect(r.errors).toEqual([]);
    expect(r.manifest?.units.reduce((n, u) => n + u.steps.length, 0)).toBe(steps);
  });
});
