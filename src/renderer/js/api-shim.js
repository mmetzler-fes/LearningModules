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
  selectImage: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
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
  },
  /**
   * PDF hochladen. Die Datei landet auf dem Server dieser App; zurueck kommt
   * die Adresse, unter der sie ohne Anmeldung abrufbar ist.
   */
  uploadPdf: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      // Bricht jemand den Dateidialog ab, kommt kein change-Ereignis. Ohne
      // diesen Fall bliebe der Knopf fuer immer auf "Wird hochgeladen".
      // Der Rueckkehr-Fokus kommt auch bei einer getroffenen Auswahl, deshalb
      // entscheidet nicht er, sondern ob bis dahin eine Datei da ist.
      let done = false;
      let picked = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      window.addEventListener('focus', () => {
        setTimeout(() => { if (!picked) finish({ success: false, cancelled: true }); }, 1000);
      }, { once: true });

      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return finish({ success: false, cancelled: true });
        picked = true;
        const formData = new FormData();
        formData.append('file', file);
        const token = localStorage.getItem('lm_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        try {
          const res = await fetch('/api/files', { method: 'POST', headers, body: formData });
          const data = await res.json();
          if (res.ok && data.success) {
            finish({ success: true, url: data.url, name: data.name, size: data.size });
          } else {
            finish({ success: false, error: data.message || data.error || `HTTP ${res.status}` });
          }
        } catch (err) {
          finish({ success: false, error: err.message });
        }
      };
      input.click();
    });
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

