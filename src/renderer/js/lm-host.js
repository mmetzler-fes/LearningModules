// ==================== GASTGEBER FÜR DIE MODUL-ANZEIGE ====================
//
// Die Anzeige der Module (lm-editor/src/modules/h5p-renderer.js) kennt den
// Server nicht. Was LearningModules beisteuert – Weiter-Knopf des Quiz,
// Knöpfe am Dokument, Abgabe von Aufnahmen –, steht hier
// (Schnittstelle: lm-editor/docs/HOST.md).

const authToken = () => sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');
// Schüler im Durchlauf: über ihren Link (options.upload trägt den Zugang).
const inRun = (up) => !!(up && (up.linkToken || up.quickToken));

export const lmHost = {
  nextButton: () => document.getElementById('btnQuizNext'),

  /**
   * Knöpfe über einem Dokument. `options.inkEdit` setzen die Aufrufer nur mit
   * der Freischaltung „Stift-Editor“: 'teacher' in Vorschau und Notebooks,
   * 'student' über den Link. `options.inkDocument` (Lehrkraft, eigenes
   * Lernthema): { module, topicId, modules, onSaved } – dann fügt das ⊕ im
   * Stift-Editor Schreibfelder, Quizze und PDFs ins Dokument ein.
   */
  documentActions({ moduleId, title, content, options, el = null }) {
    if (!moduleId) return [];
    const up = options.upload;
    const actions = [];
    const inkMode = options.inkEdit === 'teacher' || (options.inkEdit === 'student' && inRun(up)) ? options.inkEdit : null;
    if (inkMode && el) {
      // Was schon mit dem Stift beschriftet ist, steht auch in der Ansicht.
      import('./ink/ink-open.js')
        .then(({ showSavedInk }) => showSavedInk(el, { mode: inkMode, up, moduleId, landscape: content?.spec?.orientation === 'landscape' }))
        .catch(() => { /* ohne Beschriftung */ });
    }
    if (inkMode) {
      actions.push({
        label: '✍️ Mit Stift bearbeiten',
        title: up?.studentTicket && up?.linkToken
          ? 'Das Blatt mit Stift, Finger oder Maus beschriften – gespeichert bei der Lehrkraft, mit deiner PIN später weiter'
          : 'Das Blatt mit Stift, Finger oder Maus beschriften – gespeichert auf diesem Gerät',
        className: 'ds-ink-btn',
        primary: true,
        async onClick() {
          const { openDocumentInk } = await import('./ink/ink-open.js');
          const own = inkMode === 'teacher' && options.inkDocument?.topicId ? options.inkDocument : null;
          await openDocumentInk({
            mode: inkMode, up, embedModule: options.embedModule || null, sourceEl: el,
            // Gespeichert wird das ganze Modul – daher das vollständige aus dem Lernthema.
            mod: own ? { ...own.module, topicId: own.topicId } : { id: moduleId, title, content },
            editable: !!own, topicModules: own?.modules || null, onSaved: own?.onSaved || null,
          });
        },
      });
    }
    // Eigenes Dokument: Wer sieht die Beschriftung der Lehrkraft? (Vorgabe: nur sie selbst)
    if (inkMode === 'teacher' && options.inkDocument?.topicId && el) {
      const label = (v) => (v === 'all' ? '👁 Beschriftung: für alle' : '🙈 Beschriftung: nur für mich');
      let visibility = 'teacher';
      import('./ink/ink-open.js').then(async ({ teacherInkGet }) => {
        const res = await teacherInkGet(moduleId);
        visibility = res?.visibility || 'teacher';
        const btn = el.querySelector('.ds-ink-vis-btn');
        if (btn) btn.textContent = label(visibility);
      }).catch(() => {});
      actions.push({
        label: label(visibility),
        title: 'Deine Beschriftung mit dem Stift: nur für dich (wie eine Lösung) oder auch für die Schüler – unter ihrer eigenen',
        className: 'ds-ink-vis-btn',
        async onClick() {
          const { teacherInkPut } = await import('./ink/ink-open.js');
          const next = visibility === 'all' ? 'teacher' : 'all';
          const res = await teacherInkPut(moduleId, { visibility: next });
          if (!res?.success) throw new Error('Nicht gespeichert');
          visibility = res.visibility;
          const btn = el.querySelector('.ds-ink-vis-btn');
          // Der Renderer setzt danach den Text zurück – erst im nächsten Takt umschreiben.
          setTimeout(() => { if (btn) btn.textContent = label(visibility); }, 0);
        },
      });
    }
    // Schüler: das Blatt als PDF (POST /api/public/document/:id/pdf).
    if (inRun(up)) {
      actions.push({
        label: '⬇ Als PDF',
        className: 'ds-pdf-btn',
        async onClick() {
          const win = window.open('', '_blank');
          try {
            const res = await fetch(`/api/public/document/${encodeURIComponent(moduleId)}/pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ linkToken: up.linkToken || undefined, quickToken: up.quickToken || undefined, password: up.password || undefined, studentTicket: up.studentTicket || undefined }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
            win.location.href = URL.createObjectURL(await res.blob());
          } catch (err) {
            win?.close();
            throw err;
          }
        },
      });
    }
    return actions;
  },

  /**
   * Abgabe einer Aufnahme: Schüler im Durchlauf an die Lehrkraft, in der
   * Vorschau als Probe in die eigene Ablage (Adresse aus dem Modul).
   */
  recording({ content, moduleId, title, options }) {
    const up = options.upload || {};
    const token = authToken();
    const mode = inRun(up) ? 'run' : content.uploadUrl && token ? 'preview' : null;
    if (!mode) return null;
    return {
      mode,
      async upload(blob) {
        const form = new FormData();
        form.append('file', blob, 'aufnahme');
        let url = '/api/public/recording';
        const headers = {};
        if (mode === 'run') {
          form.append('moduleId', moduleId || '');
          form.append('studentName', up.studentName || '');
          if (up.linkToken) form.append('linkToken', up.linkToken);
          if (up.quickToken) form.append('quickToken', up.quickToken);
        } else {
          url = '/api/topics/recording-preview';
          headers.Authorization = `Bearer ${token}`;
          form.append('uploadUrl', content.uploadUrl);
          form.append('uploadPassword', content.uploadPassword || '');
          form.append('title', title || content.title || 'Aufnahme');
        }
        const res = await fetch(url, { method: 'POST', body: form, headers });
        // Ein vorgeschalteter Proxy antwortet bei Fehlern oft mit HTML statt JSON.
        const data = await res.json().catch(() => ({}));
        if (res.status === 413) throw new Error('Die Aufnahme ist zu groß für den Server (Upload-Grenze des Proxys, z. B. client_max_body_size).');
        if (!res.ok || !data.success) throw new Error(data.message || `Fehler ${res.status}`);
        return data;
      },
    };
  },
};
