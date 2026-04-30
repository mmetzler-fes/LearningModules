// ==================== UTILITY FUNCTIONS ====================

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function generateId() {
  return 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

export function escapeHtmlPreservingText(text) {
  return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

export function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function appConfirm(message) {
  return new Promise((resolve) => {
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmBtnYes = document.getElementById('confirmBtnYes');
    const confirmBtnNo = document.getElementById('confirmBtnNo');

    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');
    confirmBtnYes.focus();

    function cleanup(result) {
      confirmBtnYes.removeEventListener('click', onYes);
      confirmBtnNo.removeEventListener('click', onNo);
      confirmOverlay.classList.add('hidden');
      resolve(result);
    }

    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    confirmBtnYes.addEventListener('click', onYes);
    confirmBtnNo.addEventListener('click', onNo);
  });
}

export function sanitizeModuleDescriptionHtml(html) {
  const allowedTags = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'SPAN', 'FONT']);
  const template = document.createElement('template');
  template.innerHTML = html || '';

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tag = node.tagName.toUpperCase();
    const fragment = document.createDocumentFragment();

    if (!allowedTags.has(tag)) {
      Array.from(node.childNodes).forEach((child) => {
        fragment.appendChild(sanitizeNode(child));
      });
      return fragment;
    }

    const clean = document.createElement(tag.toLowerCase());

    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:|mailto:|#)/i.test(href)) {
        clean.setAttribute('href', href);
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (tag === 'TH' || tag === 'TD') {
      const colspan = node.getAttribute('colspan');
      const rowspan = node.getAttribute('rowspan');
      if (colspan && /^\d+$/.test(colspan)) clean.setAttribute('colspan', colspan);
      if (rowspan && /^\d+$/.test(rowspan)) clean.setAttribute('rowspan', rowspan);
    }

    if (tag === 'FONT') {
      const size = node.getAttribute('size');
      if (size && /^[1-7]$/.test(size)) clean.setAttribute('size', size);
    }

    const style = node.getAttribute('style') || '';
    const textAlignMatch = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
    if (textAlignMatch && ['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TH', 'TD', 'SPAN'].includes(tag)) {
      clean.style.textAlign = textAlignMatch[1].toLowerCase();
    }
    const marginBottomMatch = style.match(/margin-bottom\s*:\s*(\d+px)/i);
    if (marginBottomMatch && ['P', 'H1', 'H2', 'H3', 'DIV', 'LI', 'UL', 'OL'].includes(tag)) {
      clean.style.marginBottom = marginBottomMatch[1].toLowerCase();
    }

    Array.from(node.childNodes).forEach((child) => {
      clean.appendChild(sanitizeNode(child));
    });

    return clean;
  };

  const out = document.createElement('div');
  Array.from(template.content.childNodes).forEach((child) => {
    out.appendChild(sanitizeNode(child));
  });

  return out.innerHTML;
}
