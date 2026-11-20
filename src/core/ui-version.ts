import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Version der Oberfläche (src/renderer): Prüfsumme über Name, Größe und Zeitstempel der HTML-, JS-
 * und CSS-Dateien. Sie ändert sich nur, wenn eine neue Oberfläche eingespielt wurde – nicht bei
 * jedem Neustart. Die App fragt sie ab und bietet dann das Aktualisieren an (js/update-check.js).
 */
export function uiVersion(dir: string): string {
  const hash = crypto.createHash('sha1');
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'test') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js|mjs|css|webmanifest)$/i.test(e.name)) {
        try {
          const st = fs.statSync(p);
          hash.update(`${path.relative(dir, p)}|${st.size}|${Math.round(st.mtimeMs)}\n`);
        } catch { /* weg */ }
      }
    }
  };
  walk(dir);
  return hash.digest('hex').slice(0, 12);
}
