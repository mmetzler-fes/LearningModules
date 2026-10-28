/**
 * API Shim for LearningModules Redesign
 * Redirects legacy Electron IPC calls to the new NestJS REST API.
 */

const API_BASE_URL = window.location.origin;
var isElectron = false;

window.electron = {
  ipcRenderer: {
    invoke: async (channel, data) => {
      console.log(`[Shim] IPC Invoke: ${channel}`, data);

      if (channel === 'login') {
        try {
          const res = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const result = await res.json();
          if (res.ok && result.access_token) {
            localStorage.setItem('token', result.access_token);
            localStorage.setItem('user', JSON.stringify(result.user));
            return { success: true, user: result.user };
          }
          return { success: false, message: result.message || 'Login fehlgeschlagen' };
        } catch (e) {
          return { success: false, message: 'Netzwerkfehler' };
        }
      }

      if (channel === 'get-topics') {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`${API_BASE_URL}/topics`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const topics = await res.json();
          return topics;
        } catch (e) {
          return [];
        }
      }

      // Placeholder for other channels
      console.warn(`[Shim] Unhandled channel: ${channel}`);
      return null;
    },
    send: (channel, data) => {
      console.log(`[Shim] IPC Send: ${channel}`, data);
    },
    on: (channel, func) => {
      console.log(`[Shim] IPC On: ${channel}`);
    }
  }
};

window.appApi = {
  // Ergebnis `dataUrl`: das Bild als data:-URL – oder, mit verbundener
  // Nextcloud, der Link auf die dort hochgeladene Datei (views/nextcloud.js).
  selectImage: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false });
        // Nextcloud oder – verkleinert und mit Grenze – in die App (views/image-store.js).
        const url = await window.appImages.store(file, file.name).catch(() => false);
        if (!url) return resolve({ success: false }); // abgebrochen oder Grenze erreicht
        resolve({ success: true, dataUrl: url, nextcloud: !String(url).startsWith('data:') });
      };
      input.click();
    });
  },
  /**
   * Bild aus der Zwischenablage (z. B. Screenshot, kopiertes Bild) – abgelegt
   * wie beim Auswählen einer Datei. Ohne Bild oder ohne Zugriff:
   * `{ success: false, message }`. Strg+V geht dort, wo es einen Einfüge-Ort
   * gibt, auch ohne diese Funktion (Ereignis „paste“).
   */
  pasteImage: async () => {
    if (!navigator.clipboard?.read) {
      return { success: false, message: 'Dieser Browser lässt die Zwischenablage nicht so lesen – bitte das Bild als Datei speichern und auswählen.' };
    }
    let items;
    try { items = await navigator.clipboard.read(); } catch (_) {
      return { success: false, message: 'Kein Zugriff auf die Zwischenablage – bitte erlauben oder das Bild als Datei auswählen.' };
    }
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return window.appApi.storeImageFile(new File([blob], `Zwischenablage.${type.split('/')[1] || 'png'}`, { type }));
    }
    return { success: false, message: 'In der Zwischenablage ist kein Bild. Erst ein Bild kopieren (z. B. Screenshot, Rechtsklick → Bild kopieren).' };
  },
  /** Bilddatei ablegen (Nextcloud oder verkleinert in der App) → `{ success, dataUrl }`. */
  storeImageFile: async (file) => {
    const url = await window.appImages.store(file, file.name).catch(() => false);
    if (!url) return { success: false }; // abgebrochen oder Grenze erreicht
    return { success: true, dataUrl: url, nextcloud: !String(url).startsWith('data:') };
  },
  selectAudio: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false });
        const reader = new FileReader();
        reader.onload = (ev) => {
          resolve({ success: true, dataUrl: ev.target.result });
        };
        reader.onerror = () => resolve({ success: false });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
};

