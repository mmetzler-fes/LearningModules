// ==================== QR-CODE MIT DER KAMERA LESEN ====================
//
// Für die Schüler-App: Ein QR-Code vom Beamer oder Blatt öffnet in iOS immer
// Safari, nie die installierte App – deshalb liest die App ihn selbst.
// Safari kann QR-Codes nicht von sich aus erkennen; jsQR (vendor/jsQR.js)
// wird erst beim ersten Scannen geladen.

let loading = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/jsQR.js', import.meta.url).href;
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => { loading = null; reject(new Error('Der QR-Leser ließ sich nicht laden.')); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Kamerabild in `host` zeigen, bis ein QR-Code erkannt ist. Ergebnis: sein
 * Text – oder null bei Abbruch (`cancel()` am zurückgegebenen Objekt).
 * Wirft, wenn es keine Kamera gibt oder sie nicht erlaubt wird.
 */
export function scanQr(host) {
  // Abbruch schon während Laden oder Kamerafreigabe: danach nicht mehr starten.
  let cancelled = false;
  let stop = () => { cancelled = true; };
  const done = (async () => {
    const jsQR = await loadJsQr();
    if (cancelled) return null;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Dieses Gerät erlaubt hier keine Kamera.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return null; }
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    video.setAttribute('playsinline', ''); // iPad: im Bild bleiben statt Vollbild
    video.className = 'qr-video';
    video.srcObject = stream;
    host.replaceChildren(video);
    await video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let running = true;
    const result = await new Promise((resolve) => {
      stop = () => { running = false; resolve(null); };
      const tick = () => {
        if (!running) return;
        if (video.readyState >= 2 && video.videoWidth) {
          // Verkleinert lesen: schneller, und QR-Codes sind groß genug.
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) { running = false; resolve(code.data); return; }
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    stream.getTracks().forEach((t) => t.stop());
    video.remove();
    return result;
  })();
  return { done, cancel: () => stop() };
}
