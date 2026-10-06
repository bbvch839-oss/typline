/*
 * i18n.js — interface translation (English / O'zbekcha / Русский).
 *
 * The app is written in English. Instead of changing every module, this file
 * translates the page itself: a MutationObserver watches the DOM and replaces
 * any English text node (and title / aria-label / placeholder attributes) with
 * its translation from data/i18n.js. The original English is remembered, so
 * switching language (or back to English) is instant and needs no reload.
 *
 * Dictionary: exact strings  →  TA_DATA.i18n.uz / .ru  { "New test": "Yangi test" }
 *             dynamic text   →  TA_DATA.i18n.patterns  [{ en: "{n} tests", uz: "{n} ta test", ru: "{n} тестов" }]
 * Parts of the page that must never be translated (typed words, keys, quotes)
 * are excluded with SKIP or a data-no-i18n attribute.
 */
(function (TA) {
  'use strict';

  const SKIP = '[data-no-i18n], #words, .typing__track, .rank-key, .focus-key, .hm-key, .kbd__svg, .kbd__caption kbd, kbd, script, style, textarea, .brand, .quote-source, #customText';
  const ATTRS = ['title', 'aria-label', 'placeholder'];

  let lang = 'en';
  let dict = {};
  let patterns = [];
  const textState = new WeakMap(); // Text node → { en, set }
  const attrState = new WeakMap(); // Element → { [attr]: { en, set } }
  const missing = new Set();

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function load() {
    const data = window.TA_DATA && window.TA_DATA.i18n;
    dict = (data && data[lang]) || {};
    patterns = [];
    if (!data || lang === 'en') return;
    for (const p of data.patterns || []) {
      if (!p[lang]) continue;
      const names = [];
      // {n…} = number, {m…} = month abbreviation, anything else = any text
      const source = escapeRe(p.en).replace(/\\\{(\w+)\\\}/g, (_, name) => {
        names.push(name);
        if (name[0] === 'n') return '(-?[\\d.,:]+)';
        if (name[0] === 'm') return '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
        return '(.+?)';
      });
      patterns.push({ re: new RegExp(`^${source}$`), names, out: p[lang] });
    }
  }

  function translate(text) {
    if (lang === 'en') return text;
    if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (!m) continue;
      const values = {};
      p.names.forEach((n, i) => { values[n] = m[i + 1]; });
      // captured values may be translatable words themselves (e.g. a mode name)
      return p.out.replace(/\{(\w+)\}/g, (_, n) => {
        const v = values[n];
        return v !== undefined && Object.prototype.hasOwnProperty.call(dict, v) ? dict[v] : (v !== undefined ? v : '');
      });
    }
    if (/[A-Za-z]{2}/.test(text)) missing.add(text);
    return text;
  }

  function skipped(node) {
    const parent = node.nodeType === 1 ? node : node.parentElement;
    return !parent || !!parent.closest(SKIP);
  }

  function translateNode(node) {
    const current = node.nodeValue;
    let state = textState.get(node);
    if (!state || state.set !== current) {
      state = { en: current, set: current };
      textState.set(node, state);
    }
    const en = state.en;
    if (!/[A-Za-z]/.test(en) || skipped(node)) return;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(en);
    const out = m[2] ? m[1] + translate(m[2]) + m[3] : en;
    state.set = out;
    if (out !== current) node.nodeValue = out;
  }

  function translateAttr(elNode, attr) {
    const current = elNode.getAttribute(attr);
    if (current === null) return;
    let states = attrState.get(elNode);
    if (!states) { states = {}; attrState.set(elNode, states); }
    let state = states[attr];
    if (!state || state.set !== current) state = states[attr] = { en: current, set: current };
    if (!/[A-Za-z]/.test(state.en) || skipped(elNode)) return;
    const out = translate(state.en.trim());
    state.set = out;
    if (out !== current) elNode.setAttribute(attr, out);
  }

  function walk(root) {
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) translateNode(n);
    const els = [root, ...root.querySelectorAll('[title], [aria-label], [placeholder]')];
    for (const e of els) for (const a of ATTRS) if (e.hasAttribute && e.hasAttribute(a)) translateAttr(e, a);
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateNode(r.target);
      else if (r.type === 'attributes') { if (!skipped(r.target)) translateAttr(r.target, r.attributeName); }
      else r.addedNodes.forEach(walk);
    }
  });

  const I18n = {
    get lang() { return lang; },

    /** Translate a string from code (for alert-like texts not in the DOM). */
    t(text) { return translate(text); },

    setLanguage(next) {
      lang = ['en', 'uz', 'ru'].includes(next) ? next : 'en';
      document.documentElement.lang = lang;
      load();
      walk(document.body);
      if (TA.Chart && TA.Chart.redrawAll) TA.Chart.redrawAll();
    },

    /** Debug helper: English strings seen on screen that have no translation yet. */
    missing() { return [...missing].sort(); }
  };

  I18n.setLanguage(TA.Settings.get('uiLang'));
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  TA.Settings.onChange((key) => { if (key === 'uiLang' || key === '*') I18n.setLanguage(TA.Settings.get('uiLang')); });

  TA.I18n = I18n;
})(window.TA = window.TA || {});
