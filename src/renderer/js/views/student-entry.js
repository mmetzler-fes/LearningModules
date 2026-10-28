import { scanQr } from './qr-scan.js';

// ==================== EINSTIEG FÜR SCHÜLER (STARTSEITE) ====================
//
// Ohne Link in der Adresse: QR-Code der Lehrkraft hier scannen (nicht jeder
// findet die Kamera-App, und in der installierten App geht es nur so) oder
// den Klassencode eines Klassennotizbuchs eintippen.

/** Schüler-Link dieses Servers (`?k=`, `?l=`, `?q=`) aus einem gescannten Text – oder null. */
export function studentLinkFrom(text) {
  try {
    const url = new URL(String(text || '').trim(), location.origin);
    if (url.origin !== location.origin) return { foreign: url.host };
    // Schülerseiten unter /schueler/ (eigener App-Bereich), gleich dorthin.
    return ['k', 'l', 'q'].some((k) => url.searchParams.get(k)) ? { href: `/schueler/${url.search}` } : null;
  } catch (_) {
    return null;
  }
}

/** Windows-, Mac- oder Linux-PC (kein iPad/iPhone, das sich als Mac meldet, kein Handy). */
export function isDesktop(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  if (/iPad|iPhone|iPod|Android|Mobi/.test(ua)) return false;
  if (/Macintosh/.test(ua) && touchPoints > 1) return false; // iPad mit Desktop-Ansicht
  return /Windows|Macintosh|Linux|X11|CrOS/.test(ua);
}

/**
 * „💻 Schüler-App für den PC“: eine eigene App (LearningModules_Schüler) neben
 * der Lehrer-App. Installieren lässt sie sich nur auf den Schülerseiten
 * (/schueler/, eigener App-Bereich) – von der Startseite führt der Knopf
 * dorthin, dort öffnet er den Dialog des Browsers.
 */
function bindInstall(box) {
  const btn = box.querySelector('#btnStudentInstall');
  const hint = box.querySelector('#studentInstallHint');
  if (!btn) return;
  let standalone = false;
  try { standalone = window.matchMedia('(display-mode: standalone)').matches; } catch (_) { /* egal */ }
  if (!isDesktop() || standalone) return;
  const onStudentPages = location.pathname.startsWith('/schueler/');
  let prompt = window.appInstallPrompt || null;
  window.addEventListener('beforeinstallprompt', (e) => { prompt = e; });
  window.addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    hint.textContent = '✅ Installiert – die App „LearningModules_Schüler“ findest du im Startmenü bzw. bei den Programmen.';
    hint.classList.remove('hidden');
  });
  btn.classList.remove('hidden');
  if (onStudentPages) {
    btn.textContent = '📲 Schüler-App jetzt installieren';
    btn.classList.replace('btn-secondary', 'btn-primary');
  }
  btn.addEventListener('click', async () => {
    if (!onStudentPages) { location.href = '/schueler/?install=1'; return; }
    prompt = prompt || window.appInstallPrompt || null;
    if (prompt) {
      const p = prompt;
      prompt = null;
      window.appInstallPrompt = null;
      p.prompt();
      await p.userChoice.catch(() => null);
      return;
    }
    const ua = navigator.userAgent;
    hint.textContent = /Firefox\//.test(ua)
      ? 'Firefox kann keine Apps installieren – bitte diese Seite in Chrome oder Edge öffnen.'
      : /Safari\//.test(ua) && !/Chrome\/|Edg\//.test(ua)
        ? 'Safari am Mac: im Menü „Ablage“ → „Zum Dock hinzufügen“.'
        : 'Kein Dialog? Dann ist die App vielleicht schon installiert – oder in der Adressleiste rechts auf das Symbol „App installieren“ klicken.';
    hint.classList.remove('hidden');
  });
}

export function bindStudentEntry() {
  const box = document.getElementById('studentEntry');
  if (!box) return;
  bindInstall(box);
  const err = box.querySelector('#studentEntryErr');
  const scanBox = box.querySelector('#studentScanBox');
  const scanBtn = box.querySelector('#btnStudentScan');
  const showErr = (text) => { err.textContent = text; err.classList.toggle('hidden', !text); };
  let scan = null;
  const stop = () => { scan?.cancel(); scan = null; scanBox.classList.add('hidden'); scanBtn.classList.remove('hidden'); };

  scanBtn.addEventListener('click', async () => {
    showErr('');
    scanBtn.classList.add('hidden');
    scanBox.classList.remove('hidden');
    scan = scanQr(scanBox.querySelector('.cb-scan-view'));
    let text;
    try { text = await scan.done; } catch (e) {
      stop();
      showErr(e?.name === 'NotAllowedError' ? 'Die Kamera ist nicht erlaubt – erlaube sie in den Einstellungen oder tipp den Klassencode ein.' : (e?.message || 'Die Kamera lässt sich nicht starten.'));
      return;
    }
    if (text === null) return;
    stop();
    const link = studentLinkFrom(text);
    if (link?.href) { location.href = link.href; return; }
    showErr(link?.foreign ? `Dieser QR-Code gehört zu ${link.foreign}, nicht zu diesem Server.` : 'Das ist kein QR-Code deiner Lehrkraft für LernModule.');
  });
  box.querySelector('#btnStudentScanStop').addEventListener('click', stop);

  box.querySelector('#studentCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const code = box.querySelector('#studentCode').value.replace(/[\s-]/g, '').toUpperCase();
    if (!code) return;
    const res = await fetch(`/api/public/classbook/code/${encodeURIComponent(code)}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    if (!res?.ok || !data?.token) { showErr(data?.message || 'Der Server ist nicht erreichbar.'); return; }
    location.href = `/schueler/?k=${encodeURIComponent(data.token)}`;
  });
}
