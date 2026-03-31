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
