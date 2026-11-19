// ⬇ Dokument als Jupyter-Notebook (.ipynb): ausführbares Python wird Code-Zelle, alles andere
// Markdown (lm-editor/src/doc/ipynb.js). Bilder vom eigenen Server (/api/…) kommen vorher als
// data:-Adresse hinein, damit das Notebook sie als Anhang mitnimmt und überall zeigt.
import { downloadBlob } from './api.js';
import { specToIpynb } from '../lm-editor/src/doc/ipynb.js';

const token = () => sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || '';

async function inlineImages(spec) {
  const copy = JSON.parse(JSON.stringify(spec || { content: [] }));
  const images = [];
  const walk = (blocks) => (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b || typeof b !== 'object') return;
    if (b.type === 'image' && /^\/api\//.test(String(b.src || ''))) images.push(b);
    walk(b.blocks);
  });
  walk(copy.content);
  await Promise.all(images.map(async (b) => {
    try {
      const res = await fetch(b.src, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
      if (!res.ok) return;
      const blob = await res.blob();
      b.src = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => resolve(b.src);
        r.readAsDataURL(blob);
      });
    } catch (_) { /* Bild bleibt Verweis – im Notebook dann als Hinweis */ }
  }));
  return copy;
}

/** Dokument herunterladen; Ergebnis: Zahl der Code-Zellen. */
export async function downloadIpynb(spec, title) {
  const nb = specToIpynb(await inlineImages(spec), { title });
  const name = `${String(title || 'Dokument').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Dokument'}.ipynb`;
  downloadBlob(new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' }), name);
  return nb.cells.filter((c) => c.cell_type === 'code').length;
}
