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
    return ['k', 'l', 'q'].some((k) => url.searchParams.get(k)) ? { href: url.pathname + url.search } : null;
  } catch (_) {
    return null;
  }
}

export function bindStudentEntry() {
  const box = document.getElementById('studentEntry');
  if (!box) return;
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
    location.href = `/?k=${encodeURIComponent(data.token)}`;
  });
}
