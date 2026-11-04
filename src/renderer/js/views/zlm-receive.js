// ==================== .ZLM AUS DEM LM-EDITOR EMPFANGEN ====================
//
// Der lm-editor öffnet diese Seite mit ?zlm=empfang und schickt die Datei von Fenster zu Fenster
// (lm-editor: src/app/send-to-lm.js). Sie läuft dann wie bei „Öffnen mit“: ansehen, ablegen entscheidet die
// Lehrkraft. Weil das jede Seite versuchen könnte, nennt ein Dialog vorher, woher die Datei kommt.

const MAX_BYTES = 200 * 1024 * 1024;

export function receiveZlm(app) {
  if (new URLSearchParams(location.search).get('zlm') !== 'empfang') return;
  history.replaceState(null, '', location.pathname);
  const sender = window.opener;
  if (!sender) {
    app.showToast('Bitte das Blatt im lm-editor über „📓 In LearningModules öffnen“ schicken.', 'info');
    return;
  }
  const onMessage = async (e) => {
    if (e.source !== sender || e.data?.type !== 'lm-zlm') return;
    window.removeEventListener('message', onMessage);
    const { bytes, name } = e.data;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > MAX_BYTES) {
      app.showToast('Die Datei ließ sich nicht übernehmen.', 'error');
      return;
    }
    const clean = String(name || 'Dokument').replace(/[\\/]/g, '-').replace(/\.zlm$/i, '').slice(0, 120) || 'Dokument';
    if (e.origin !== location.origin
      && !(await app.appConfirm(`„${clean}“ von ${e.origin} öffnen?\n\nDas Blatt wird nur angezeigt. Ins Notizbuch kommt es erst, wenn du es dort ablegst.`))) return;
    const { openWhenSignedIn } = await import('./file-open.js');
    await openWhenSignedIn(app, new File([bytes], `${clean}.zlm`));
  };
  window.addEventListener('message', onMessage);
  sender.postMessage({ type: 'lm-zlm-ready' }, '*');
}
