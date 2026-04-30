import { sanitizeModuleDescriptionHtml, escapeHtmlPreservingText } from './utils.js';

// ==================== MODULE DESCRIPTION EDITOR ====================

export class ModuleDescriptionEditor {
  constructor() {
    this._initialized = false;
    this._editor = document.getElementById('moduleDescriptionEditor');
    this._input  = document.getElementById('moduleDescription');
    this._toolbar = document.getElementById('moduleDescToolbar');
    this._blockFormat  = document.getElementById('moduleDescBlockFormat');
    this._spacing      = document.getElementById('moduleDescSpacing');
    this._fontSize     = document.getElementById('moduleDescFontSize');
    this._insertTable  = document.getElementById('moduleDescInsertTable');
    this._createLink   = document.getElementById('moduleDescCreateLink');
    this._clearFormat  = document.getElementById('moduleDescClearFormat');
  }

  init() {
    if (!this._editor || !this._toolbar) return;
    if (this._initialized) return;
    this._initialized = true;

    this._toolbar.querySelectorAll('[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => this._applyCommand(btn.dataset.command));
    });

    if (this._blockFormat) {
      this._blockFormat.addEventListener('change', () => {
        if (!this._blockFormat.value) return;
        this._applyCommand('formatBlock', this._blockFormat.value);
        this._blockFormat.value = 'p';
      });
    }

    if (this._fontSize) {
      this._fontSize.addEventListener('change', () => {
        this._applyCommand('fontSize', this._fontSize.value);
        this._fontSize.value = '3';
      });
    }

    if (this._spacing) {
      this._spacing.addEventListener('change', () => {
        const val = this._spacing.value;
        if (!val) return;
        this._editor.focus();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          let node = sel.getRangeAt(0).commonAncestorContainer;
          if (node.nodeType === 3) node = node.parentNode;
          while (node && node !== this._editor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
            node = node.parentNode;
          }
          if (node && node !== this._editor) {
            node.style.marginBottom = val;
          } else {
            document.execCommand('formatBlock', false, 'p');
            node = sel.getRangeAt(0).commonAncestorContainer;
            if (node.nodeType === 3) node = node.parentNode;
            while (node && node !== this._editor && !/^(P|H[1-6]|DIV|LI)$/i.test(node.nodeName)) {
              node = node.parentNode;
            }
            if (node && node !== this._editor) node.style.marginBottom = val;
          }
        }
        this._spacing.selectedIndex = 0;
        this._syncInput();
      });
    }

    if (this._insertTable) {
      this._insertTable.addEventListener('click', () => {
        this._editor.focus();
        const tableHtml =
          '<table class="h5p-table" style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:10px;" border="1">' +
          '<tbody><tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr>' +
          '<tr><td style="padding:6px;">Inhalt</td><td style="padding:6px;">Inhalt</td></tr>' +
          '</tbody></table><p><br></p>';
        document.execCommand('insertHTML', false, tableHtml);
        this._syncInput();
      });
    }

    if (this._createLink) {
      this._createLink.addEventListener('click', () => {
        const url = prompt('Link-URL eingeben:', 'https://');
        if (!url) return;
        this._applyCommand('createLink', url.trim());
      });
    }

    if (this._clearFormat) {
      this._clearFormat.addEventListener('click', () => {
        if (!this._editor) return;
        this._editor.focus();
        document.execCommand('removeFormat', false, null);
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          document.execCommand('formatBlock', false, 'p');
        }
        this._syncInput();
      });
    }

    this._editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.originalEvent || e).clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    this._editor.addEventListener('input', () => this._syncInput());
    this._editor.addEventListener('blur', () => this.setHtml(this.getHtml()));

    this.setHtml('');
  }

  _applyCommand(command, value = null) {
    if (!this._editor) return;
    this._editor.focus();
    document.execCommand(command, false, value);
    this._syncInput();
  }

  _syncInput() {
    if (this._input) {
      this._input.value = this.getHtml();
    }
  }

  getHtml() {
    return sanitizeModuleDescriptionHtml(
      this._editor ? this._editor.innerHTML : (this._input ? this._input.value : '')
    );
  }

  setHtml(value) {
    const hasMarkup = /<\/?[a-z][\s\S]*>/i.test(value || '');
    const html = hasMarkup
      ? sanitizeModuleDescriptionHtml(value || '')
      : escapeHtmlPreservingText(value || '');
    if (this._editor) this._editor.innerHTML = html;
    if (this._input) this._input.value = html;
  }
}
