// ==================== BEARBEITUNG AUF DEM SERVER ====================
//
// Speicher für den Stift-Editor (lm-editor: openInkEditor({ store })), wenn
// ein Schüler über einen Klassenlink arbeitet: Der Stand liegt bei der
// Lehrkraft statt nur auf dem Gerät – so geht es auf einem anderen Gerät
// oder später weiter. Die PIN fragt der Server ab, sobald der Schüler sie
// einmal gesehen hat (docs/bearbeitungen.md).
//
// Wackliges WLAN (docs/offline-sync.md): Jeder Stand landet zuerst auf dem
// Gerät (Spiegel und Sende-Warteschlange, ../sync/outbox.js) und geht von
// dort zum Server, sobald das Netz da ist. Schreiben wartet nie auf das Netz.

import { icon } from '../../lm-editor/src/util/icons.js';
import { mirror, enqueue, pending, onSent, beforeSend, retryBlocked, deviceId, deviceSeq, flush, syncState } from '../sync/outbox.js';

// PIN je Schülerausweis, solange die Seite offen ist – nicht bei jedem Dokument neu fragen.
const pins = new Map();

/** PIN schon bekannt (Anmeldung im Klassennotizbuch) – dann fragt kein Blatt mehr danach. */
export function rememberPin(studentTicket, pin) {
  if (studentTicket && pin) pins.set(studentTicket, pin);
}

/** Antwort ohne Netz (offline, Zeitüberschreitung) – dann zählt der Stand auf dem Gerät. */
class Offline extends Error {}

async function post(path, body, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`/api/public/work/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (_) {
    throw new Offline('Keine Verbindung');
  } finally {
    clearTimeout(t);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Offline(data.message || `HTTP ${res.status}`);
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.needPin = !!data.needPin;
    throw err;
  }
  return data;
}

/** Schlüssel eines Blatts in Spiegel und Warteschlange. */
const workKey = (up, moduleId) => `work|${up.linkToken}|${up.studentTicket}|${moduleId}`;
/** Wartet für dieses Blatt noch ein Stand auf das Senden? */
const waitingFor = async (key) => (await pending(key)).some((e) => e.key === key && e.state !== 'failed');

// ---- Nach dem Senden (outbox.js) ----

// Kurz vor dem Senden: PIN (vielleicht inzwischen eingegeben) und die zuletzt bekannte Revision.
beforeSend('work', async (entry) => {
  const m = await mirror.get(entry.key);
  const pin = pins.get(entry.body.studentTicket) || entry.body.pin;
  return { ...entry.body, ...(pin ? { pin } : {}), sync: { ...entry.body.sync, base: m && Number.isFinite(m.rev) ? m.rev : null } };
});
onSent('work', async (entry, res) => {
  if (Number.isFinite(res?.rev)) await mirror.patch(entry.key, { rev: res.rev });
  if (res?.pin) {
    pins.set(entry.body.studentTicket, res.pin);
    await dialog(`<h3>${icon('key')} Deine PIN: <span class="work-pin-show">${esc(res.pin)}</span></h3>
      <p>Schreib sie dir auf. Mit ihr kannst du später – auch auf einem anderen Gerät – an deinen Blättern weiterarbeiten.
      Sie gilt für alle Links deiner Klasse und wird <strong>nur dieses eine Mal</strong> angezeigt.</p>`);
  }
});
// Der Server will (wieder) die PIN: einmal fragen, dann geht alles Liegengebliebene hinaus.
let askingPin = null;
onSent('work:pin', async (entry, res) => {
  const ticket = entry.body.studentTicket;
  askingPin ||= (async () => {
    const pin = await dialog(`<h3>${icon('key')} PIN</h3><p>${esc(res?.message || 'Bitte deine PIN eingeben.')} Dann wird dein Blatt übertragen.</p>`, { input: true });
    if (pin) { pins.set(ticket, pin); await retryBlocked(); }
  })().finally(() => { askingPin = null; });
});

/** Kleiner Dialog über allem (auch über dem Stift-Editor). */
function dialog(html, { input = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay work-pin-overlay';
    overlay.innerHTML = `<form class="import-modules-card work-pin-card" role="dialog" aria-modal="true">${html}
      ${input ? '<input class="work-pin-input" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" required aria-label="PIN">' : ''}
      <div class="confirm-actions">
        <button type="submit" class="btn btn-primary">${input ? 'Weiter' : 'Verstanden'}</button>
        ${input ? '<button type="button" class="btn btn-secondary work-pin-cancel">Abbrechen</button>' : ''}
      </div></form>`;
    document.body.appendChild(overlay);
    const field = overlay.querySelector('.work-pin-input');
    field?.focus();
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      overlay.remove();
      resolve(input ? field.value.trim() : true);
    });
    overlay.querySelector('.work-pin-cancel')?.addEventListener('click', () => { overlay.remove(); resolve(null); });
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Gespeicherter Stand ohne Nachfrage – `{ data, teacher }` (teacher: die
 * Beschriftung der Lehrkraft, wenn sie für alle ist); null, wenn die PIN fehlt.
 * Ohne Netz oder mit noch nicht übertragenem Stand: der auf diesem Gerät.
 */
export async function peekWork({ up, moduleId }) {
  const key = workKey(up, moduleId);
  const local = await mirror.get(key);
  if (local && await waitingFor(key)) return { data: local.data || null, teacher: local.teacher || null };
  try {
    const res = await post('load', { linkToken: up.linkToken, studentTicket: up.studentTicket, moduleId, pin: pins.get(up.studentTicket) }, { timeoutMs: 6000 });
    return { data: res.data || null, teacher: res.teacher || null };
  } catch (err) {
    if (err instanceof Offline && local) return { data: local.data || null, teacher: local.teacher || null };
    return null;
  }
}

/**
 * Speicher für einen Schüler mit Schülerausweis. Ergebnis: `{ store, initial }`
 * – `initial` ist der geladene Stand (oder null); `null` insgesamt, wenn der
 * Schüler die PIN-Abfrage abbricht.
 *
 * Laden: vom Server, außer auf dem Gerät wartet noch ein neuerer Stand (dann
 * der) oder das Netz fehlt (dann der Spiegel). Speichern: auf dem Gerät, die
 * Übertragung übernimmt die Warteschlange.
 */
export async function serverWorkStore({ up, moduleId }) {
  const base = { linkToken: up.linkToken, studentTicket: up.studentTicket, moduleId };
  const key = workKey(up, moduleId);
  const ticket = up.studentTicket;
  let message = 'Du hast hier schon einmal gearbeitet. Gib deine <strong>PIN</strong> ein (4 Ziffern) – sie wurde dir beim ersten Speichern angezeigt.';
  const local = await mirror.get(key);
  const waiting = local ? await waitingFor(key) : false;
  let initial = null;
  let teacher = null; // Beschriftung der Lehrkraft, wenn sie für alle ist
  let offline = false;
  for (;;) {
    try {
      const res = await post('load', { ...base, pin: pins.get(ticket) });
      teacher = res.teacher || null;
      if (waiting) {
        // Auf dem Gerät liegt Neueres, das noch hinaus muss – das gilt (die Revision bleibt die alte: so erkennt der Server ein zweites Gerät).
        initial = local.data || null;
        await mirror.patch(key, { teacher });
      } else {
        initial = res.data || null;
        await mirror.put(key, { data: initial, rev: Number(res.rev) || 0, teacher });
      }
      break;
    } catch (err) {
      if (err instanceof Offline) {
        // Ohne Netz: der Stand dieses Geräts (oder ein leeres Blatt – der Server bewahrt dann beide Fassungen).
        offline = true;
        initial = local?.data || null;
        teacher = local?.teacher || null;
        break;
      }
      if (!err.needPin) throw err;
      if (pins.has(ticket)) message = esc(err.message);
      pins.delete(ticket);
      const pin = await dialog(`<h3>${icon('key')} PIN</h3><p>${message}</p>`, { input: true });
      if (pin === null) return null;
      pins.set(ticket, pin);
      message = 'Falsche PIN. Vergessen? Die Lehrkraft sieht sie in der Klassenliste.';
    }
  }

  // Zustand für die Statuszeile des Stift-Editors.
  const describe = (detail) => {
    const state = detail.states?.[key];
    if (!state) return '💾 Bei der Lehrkraft gespeichert';
    if (state === 'failed') return '⚠️ Der Server nimmt das Blatt nicht an – es bleibt auf diesem Gerät gespeichert';
    if (state === 'pin') return '⚠️ Auf dem Gerät gespeichert – zum Übertragen fehlt die PIN';
    return detail.online
      ? '⏳ Auf dem Gerät gespeichert – wird übertragen …'
      : '⏳ Auf dem Gerät gespeichert – wird übertragen, sobald das WLAN wieder geht';
  };
  const store = {
    label: 'auf dem Gerät',
    offline,
    load: async () => initial,
    async save(data) {
      const old = await mirror.get(key);
      const kept = await mirror.put(key, { data, rev: old?.rev, teacher: old?.teacher ?? teacher });
      const queued = await enqueue({
        key, kind: 'work', url: '/api/public/work/save', label: 'Blatt',
        body: { ...base, data, sync: { device: deviceId(), seq: deviceSeq() } },
      });
      return kept || queued;
    },
    /** Statuszeile mitführen: `fn(text)` bei jeder Änderung der Warteschlange; → Abmelden. */
    watch(fn) {
      const on = (e) => fn(describe(e.detail));
      window.addEventListener('lm-sync', on);
      if (offline) setTimeout(() => fn('⏳ Ohne WLAN geöffnet – du arbeitest mit dem Stand dieses Geräts, er wird später übertragen'), 0);
      return () => window.removeEventListener('lm-sync', on);
    },
    /** Zustand neu melden (nach dem Speichern). */
    refresh: () => syncState(),
    /** Beim Schließen: gleich senden (nicht auf den nächsten Takt warten). */
    flush: () => flush(),
  };
  return { store, initial, teacher };
}
