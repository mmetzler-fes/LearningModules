import AdmZip from 'adm-zip';

/** Seite einer Druckvorlage in cm – für die Vorschau im Editor (Blattgröße, Seitenumbrüche). */
export interface TemplatePage {
  width: number;
  height: number;
  margin: { top: number; bottom: number; left: number; right: number };
  /** Höhe der Kopf- und Fußzeile samt Abstand (mindestens, wie in der Vorlage angegeben). */
  header: number;
  footer: number;
}

/** Grundvorlage des Renderers (worksheet-renderer/templates/Grundvorlage.ott), wenn keine eigene gilt. */
export const DEFAULT_PAGE: TemplatePage = {
  width: 21, height: 29.7, margin: { top: 1.27, bottom: 1, left: 2.5, right: 2 }, header: 1.231, footer: 0,
};

const UNIT_CM: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 };

function cm(value: string | undefined): number {
  const m = /^(-?\d+(?:\.\d+)?)(cm|mm|in|pt|pc|px)$/.exec(String(value ?? '').trim());
  return m ? Math.round(parseFloat(m[1]) * UNIT_CM[m[2]] * 1000) / 1000 : 0;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * Seite der Masterseite „Standard“ (sonst der ersten) aus einer .ott/.odt
 * als base64 – `null`, wenn die Datei sie nicht hergibt.
 */
export function templatePage(base64: string | null | undefined): TemplatePage | null {
  if (!base64) return null;
  let xml: string;
  try {
    xml = new AdmZip(Buffer.from(base64, 'base64')).readAsText('styles.xml');
  } catch {
    return null;
  }
  if (!xml) return null;
  const masters = [...xml.matchAll(/<style:master-page\s[^>]*?\/>|<style:master-page\s[^>]*>([\s\S]*?)<\/style:master-page>/g)];
  const master = masters.find((m) => attrs(m[0].slice(0, m[0].indexOf('>') + 1))['style:name'] === 'Standard') || masters[0];
  if (!master) return null;
  const masterAttrs = attrs(master[0].slice(0, master[0].indexOf('>') + 1));
  const layoutName = masterAttrs['style:page-layout-name'];
  const layout = [...xml.matchAll(/<style:page-layout\s[^>]*>[\s\S]*?<\/style:page-layout>/g)]
    .map((m) => m[0]).find((l) => attrs(l.slice(0, l.indexOf('>') + 1))['style:name'] === layoutName);
  if (!layout) return null;
  const propsTag = /<style:page-layout-properties\s[^>]*>/.exec(layout)?.[0];
  if (!propsTag) return null;
  const p = attrs(propsTag);
  const width = cm(p['fo:page-width']);
  const height = cm(p['fo:page-height']);
  if (!width || !height) return null;
  const all = cm(p['fo:margin']);
  const margin = {
    top: cm(p['fo:margin-top']) || all,
    bottom: cm(p['fo:margin-bottom']) || all,
    left: cm(p['fo:margin-left']) || all,
    right: cm(p['fo:margin-right']) || all,
  };
  // Kopf-/Fußzeile zählt nur, wenn die Masterseite eine hat.
  const body = master[1] || '';
  const part = (name: 'header' | 'footer') => {
    if (!new RegExp(`<style:${name}\\b(?![-\\w])`).test(body)) return 0;
    const style = new RegExp(`<style:${name}-style>\\s*<style:header-footer-properties\\s[^>]*>`).exec(layout)?.[0];
    if (!style) return 0;
    const s = attrs(style);
    return cm(s['fo:min-height']) || cm(s['svg:height']);
  };
  return { width, height, margin, header: part('header'), footer: part('footer') };
}
