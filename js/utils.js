/*
 * utils.js — small, dependency-free helpers shared by every module.
 * All modules live on a single global namespace: window.TA
 */
(function (TA) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const Utils = {
    $(selector, root = document) { return root.querySelector(selector); },
    $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); },

    /** Create an element: el('div', { class: 'x', text: 'hi' }, [children]) */
    el(tag, attrs = {}, children = []) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      }
      for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
      return node;
    },

    clamp(value, min, max) { return Math.min(max, Math.max(min, value)); },
    round(value, digits = 0) { const f = 10 ** digits; return Math.round(value * f) / f; },
    randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },
    pick(list) { return list[Math.floor(Math.random() * list.length)]; },
    chance(p) { return Math.random() < p; },

    /** Fisher–Yates shuffle (returns a new array). */
    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },

    sum(list) { let s = 0; for (const v of list) s += v; return s; },
    mean(list) { return list.length ? Utils.sum(list) / list.length : 0; },
    stdDev(list) {
      if (list.length < 2) return 0;
      const m = Utils.mean(list);
      return Math.sqrt(Utils.mean(list.map((v) => (v - m) ** 2)));
    },

    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },

    /** Local calendar day key: "2026-09-28" */
    dayKey(date = new Date()) {
      const d = date instanceof Date ? date : new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    dayFromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); },
    addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; },
    startOfWeek(date) { const d = new Date(date); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d; },

    formatDate(ts) { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; },
    formatDateTime(ts) {
      const d = new Date(ts);
      return `${Utils.formatDate(ts)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    formatShortDate(ts) { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; },
    monthName(i) { return MONTHS[i]; },

    /** 3725 → "1h 2m 5s" */
    formatDuration(seconds) {
      seconds = Math.round(seconds);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h) return `${h}h ${m}m`;
      if (m) return `${m}m ${s}s`;
      return `${s}s`;
    },

    formatNumber(n) { return Number(n).toLocaleString('en-US'); },

    throttle(fn, wait) {
      let last = 0, timer = null, lastArgs;
      return function throttled(...args) {
        lastArgs = args;
        const now = performance.now();
        const remaining = wait - (now - last);
        if (remaining <= 0) {
          clearTimeout(timer); timer = null; last = now; fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => { last = performance.now(); timer = null; fn.apply(this, lastArgs); }, remaining);
        }
      };
    },

    debounce(fn, wait) {
      let timer = null;
      return function debounced(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), wait); };
    },

    /** Read a CSS custom property from :root */
    cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },

    /** Trigger a browser download of text content (works offline, no server). */
    downloadText(filename, text, mime = 'application/json') {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    readFileText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    },

    isEditableTarget(target) {
      if (!target || !target.tagName) return false;
      const tag = target.tagName;
      return (tag === 'INPUT' && target.id !== 'typingInput') || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }
  };

  TA.Utils = Utils;
})(window.TA = window.TA || {});
