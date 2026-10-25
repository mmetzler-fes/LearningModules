// ==================== BEARBEITUNG AUF DEM SERVER ====================
//
// Speicher für den Stift-Editor (lm-editor: openInkEditor({ store })), wenn
// ein Schüler über einen Klassenlink arbeitet: Der Stand liegt bei der
// Lehrkraft statt nur auf dem Gerät – so geht es auf einem anderen Gerät
// oder später weiter. Die PIN fragt der Server ab, sobald der Schüler sie
// einmal gesehen hat (docs/bearbeitungen.md).

// PIN je Schülerausweis, solange die Seite offen ist – nicht bei jedem Dokument neu fragen.
const pins = new Map();

async function post(path, body) {
  const res = await fetch(`/api/public/work/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.needPin = !!data.needPin;
    throw err;
  }
  return data;
}

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
 * Speicher für einen Schüler mit Schülerausweis. Ergebnis: `{ store, initial }`
 * – `initial` ist der geladene Stand (oder null); `null` insgesamt, wenn der
 * Schüler die PIN-Abfrage abbricht.
 */
export async function serverWorkStore({ up, moduleId }) {
  const base = { linkToken: up.linkToken, studentTicket: up.studentTicket, moduleId };
  const key = up.studentTicket;
  let message = 'Du hast hier schon einmal gearbeitet. Gib deine <strong>PIN</strong> ein (4 Ziffern) – sie wurde dir beim ersten Speichern angezeigt.';
  let initial = null;
  for (;;) {
    try {
      initial = (await post('load', { ...base, pin: pins.get(key) })).data || null;
      break;
    } catch (err) {
      if (!err.needPin) throw err;
      if (pins.has(key)) message = esc(err.message);
      pins.delete(key);
      const pin = await dialog(`<h3>🔑 PIN</h3><p>${message}</p>`, { input: true });
      if (pin === null) return null;
      pins.set(key, pin);
      message = 'Falsche PIN. Vergessen? Die Lehrkraft sieht sie in der Klassenliste.';
    }
  }
  const store = {
    label: 'bei der Lehrkraft',
    load: async () => initial,
    async save(data) {
      try {
        const res = await post('save', { ...base, pin: pins.get(key), data });
        if (res.pin) {
          pins.set(key, res.pin);
          await dialog(`<h3>🔑 Deine PIN: <span class="work-pin-show">${esc(res.pin)}</span></h3>
            <p>Schreib sie dir auf. Mit ihr kannst du später – auch auf einem anderen Gerät – an deinen Blättern weiterarbeiten.
            Sie gilt für alle Links deiner Klasse und wird <strong>nur dieses eine Mal</strong> angezeigt.</p>`);
        }
        return true;
      } catch (_) {
        return false;
      }
    },
  };
  return { store, initial };
}
