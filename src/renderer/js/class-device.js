// ==================== ANMELDUNG AUF DIESEM GERÄT ====================
//
// Name und PIN einmal je Gerät (docs/quick-link.md). Gespeichert ist nur ein signierter Ausweis, nie
// die PIN; eine neue PIN macht ihn ungültig. Klassenlinks fragen dann „Angemeldet als …“.

const keyOf = (classId) => `lm_class_device:${classId}`;

export function rememberedStudent(classId) {
  if (!classId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(classId)));
    return v?.ticket && v?.name ? v : null;
  } catch (_) {
    return null;
  }
}

export function rememberStudent(classId, { ticket, name }) {
  if (!classId) return;
  try { localStorage.setItem(keyOf(classId), JSON.stringify({ ticket, name })); } catch (_) { /* ohne Speicher fragt der Link wieder */ }
}

export function forgetStudent(classId) {
  try { localStorage.removeItem(keyOf(classId)); } catch (_) { /* nichts zu tun */ }
}
