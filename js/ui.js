/*
 * ui.js — reusable UI pieces: modal dialogs (with focus trap),
 * confirmation prompt and toast notifications.
 */
(function (TA) {
  'use strict';
  const { $, $$, el } = TA.Utils;

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

  /* ---------------- Modal ---------------- */
  const stack = [];

  const Modal = {
    open(id, { onClose } = {}) {
      const modal = document.getElementById(id);
      if (!modal || !modal.hidden) return modal;
      const entry = { modal, returnFocus: document.activeElement, onClose };
      stack.push(entry);
      modal.hidden = false;
      modal.addEventListener('keydown', trapFocus);
      $$('[data-close]', modal).forEach((btn) => { btn.onclick = () => Modal.close(id); });
      const first = $('[autofocus]', modal) || $$(FOCUSABLE, modal.querySelector('.modal__dialog'))[0];
      requestAnimationFrame(() => first && first.focus());
      return modal;
    },

    close(id) {
      const index = id ? stack.findIndex((e) => e.modal.id === id) : stack.length - 1;
      if (index < 0) return;
      const [entry] = stack.splice(index, 1);
      entry.modal.hidden = true;
      entry.modal.removeEventListener('keydown', trapFocus);
      if (entry.onClose) entry.onClose();
      if (entry.returnFocus && document.contains(entry.returnFocus)) entry.returnFocus.focus({ preventScroll: true });
    },

    closeTop() { if (stack.length) { Modal.close(); return true; } return false; },
    isOpen() { return stack.length > 0; }
  };

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget.querySelector('.modal__dialog');
    const items = $$(FOCUSABLE, dialog).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    event.stopPropagation();
  }

  /** Promise-based confirmation dialog. Resolves true when confirmed. */
  function confirmDialog({ title = 'Are you sure?', text = '', confirmLabel = 'Confirm' } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      const ok = $('#confirmOk');
      ok.textContent = confirmLabel;
      Modal.open('confirmModal', { onClose: () => { if (!answered) resolve(false); } });
      ok.onclick = () => { answered = true; Modal.close('confirmModal'); resolve(true); };
      requestAnimationFrame(() => ok.focus());
    });
  }

  /* ---------------- Toasts ---------------- */
  function toast({ title, text = '', icon = '', type = 'info', duration = 3500 }) {
    const root = $('#toastRoot');
    if (!root) return;
    const node = el('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, [
      icon ? el('span', { class: 'toast__icon', 'aria-hidden': 'true', text: icon }) : null,
      el('div', {}, [
        el('div', { class: 'toast__title', text: title }),
        text ? el('div', { class: 'toast__text', text }) : null
      ])
    ]);
    root.append(node);
    while (root.children.length > 4) root.firstElementChild.remove();
    const remove = () => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 260);
    };
    const timer = setTimeout(remove, duration);
    node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  }

  TA.UI = { Modal, confirm: confirmDialog, toast };
})(window.TA = window.TA || {});
