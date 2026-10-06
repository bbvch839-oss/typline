/*
 * settings.js — user preferences: defaults, validation, persistence,
 * applying them to the document and rendering the Settings page.
 */
(function (TA) {
  'use strict';
  const { el, $ } = TA.Utils;
  const { Storage } = TA;

  /** Register new themes here (and add a matching block in css/themes.css). */
  const THEMES = [
    { value: 'dark', label: 'Dark', swatch: '#4fd1b5', bg: '#16181d' },
    { value: 'light', label: 'Light', swatch: '#3b5bdb', bg: '#f4f2ee' },
    { value: 'midnight', label: 'Midnight', swatch: '#a78bfa', bg: '#0f1226' },
    { value: 'amoled', label: 'AMOLED', swatch: '#ff9f43', bg: '#000000' },
    { value: 'forest', label: 'Forest', swatch: '#c7d36f', bg: '#1a211d' },
    { value: 'sand', label: 'Sand', swatch: '#b5552d', bg: '#efe6d8' }
  ];

  const onOff = [{ value: true, label: 'On' }, { value: false, label: 'Off' }];

  /** Declarative schema: the settings page is generated from this list. */
  const SCHEMA = [
    { group: 'Language', key: 'uiLang', name: 'Interface language', desc: 'Language of menus, buttons and messages. The typing language is chosen on the test page.', type: 'options',
      options: [{ value: 'en', label: 'English' }, { value: 'uz', label: "O'zbekcha" }, { value: 'ru', label: 'Русский' }] },
    { group: 'Appearance', key: 'theme', name: 'Theme', desc: 'Color theme for the whole app.', type: 'options', options: THEMES },
    { group: 'Appearance', key: 'font', name: 'Font', desc: 'Font used in the typing area. Only system fonts are used, so it works offline.', type: 'options',
      options: [{ value: 'system', label: 'System' }, { value: 'mono', label: 'Monospace' }, { value: 'sans', label: 'Sans' }] },
    { group: 'Appearance', key: 'fontSize', name: 'Font size', desc: 'Size of the words in the typing area.', type: 'options',
      options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] },
    { group: 'Appearance', key: 'caret', name: 'Caret style', desc: 'Shape of the cursor that marks the current character.', type: 'options',
      options: [{ value: 'line', label: 'Line' }, { value: 'block', label: 'Block' }, { value: 'underline', label: 'Underline' }] },
    { group: 'Appearance', key: 'animations', name: 'Animations', desc: 'Smooth caret, page transitions, count-up numbers, chart draw-in and micro-animations.', type: 'options', options: onOff },
    { group: 'Appearance', key: 'typingEffects', name: 'Typing effects', desc: 'Letters pop when typed, shake on mistakes, words slide in, caret glows.', type: 'options', options: onOff },
    { group: 'Appearance', key: 'confetti', name: 'Celebrations', desc: 'Confetti burst on a new personal best or a newly unlocked achievement.', type: 'options', options: onOff },

    { group: 'Test', key: 'liveWpm', name: 'Show live WPM', desc: 'Display words per minute while typing.', type: 'options', options: onOff },
    { group: 'Test', key: 'liveAcc', name: 'Show live accuracy', desc: 'Display accuracy while typing.', type: 'options', options: onOff },
    { group: 'Test', key: 'liveDetails', name: 'Show live details', desc: 'Current word, next key and character counters above the text.', type: 'options', options: onOff },
    { group: 'Test', key: 'ghost', name: 'Ghost race', desc: 'Race a ghost caret that replays your best run of the same mode and language — with the same speed and pauses.', type: 'options', options: onOff },
    { group: 'Test', key: 'focusMode', name: 'Focus mode', desc: 'Fade out navigation and controls while a test is running.', type: 'options', options: onOff },
    { group: 'Test', key: 'confirmRestart', name: 'Confirm restart', desc: 'Ask before restarting a test that is in progress.', type: 'options', options: onOff },

    { group: 'Sound', key: 'sound', name: 'Sound', desc: 'Master switch for every sound. All sounds are synthesized locally — no audio files.', type: 'options', options: onOff },
    { group: 'Sound', key: 'soundProfile', name: 'Keyboard sound', desc: 'Sound played on every keystroke. Pick one to hear a preview.', type: 'options',
      options: [
        { value: 'soft', label: 'Soft click' }, { value: 'mechanical', label: 'Mechanical' }, { value: 'typewriter', label: 'Typewriter' },
        { value: 'bubble', label: 'Bubble' }, { value: 'retro', label: 'Retro 8-bit' }, { value: 'melodic', label: 'Melodic' }
      ] },
    { group: 'Sound', key: 'volume', name: 'Volume', desc: 'Loudness of all sounds.', type: 'range', min: 0, max: 100, step: 5 },
    { group: 'Sound', key: 'errorSound', name: 'Error sound', desc: 'A distinct low sound when you press a wrong key.', type: 'options', options: onOff },
    { group: 'Sound', key: 'eventSounds', name: 'Result sounds', desc: 'Chime when a test ends, fanfare on a personal best, countdown ticks in the last 3 seconds, achievement bells.', type: 'options', options: onOff },
    { group: 'Sound', key: 'uiSounds', name: 'Interface clicks', desc: 'Tiny tick when clicking buttons and menus.', type: 'options', options: onOff },

    { group: 'Keyboard', key: 'guide', name: 'Keyboard guide', desc: 'Keyboard below the text. With hands it also shows which finger presses the next key (desktop only).', type: 'options',
      options: [{ value: 'hands', label: 'Keyboard + hands' }, { value: 'keyboard', label: 'Keyboard only' }, { value: 'off', label: 'Off' }] },
    { group: 'Keyboard', key: 'keyHint', name: 'Highlight next key', desc: 'Mark the key you need to press next on the virtual keyboard.', type: 'options', options: onOff }
  ];

  const DEFAULTS = {
    uiLang: 'en',
    guide: 'hands',
    theme: 'dark',
    font: 'mono',
    fontSize: 'medium',
    caret: 'line',
    animations: true,
    typingEffects: true,
    confetti: true,
    liveWpm: true,
    liveAcc: true,
    liveDetails: true,
    ghost: true,
    focusMode: true,
    confirmRestart: false,
    sound: true,
    soundProfile: 'mechanical',
    volume: 50,
    errorSound: true,
    eventSounds: true,
    uiSounds: false,
    keyHint: true
  };

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('bad settings');
    const clean = Object.assign({}, DEFAULTS);
    for (const item of SCHEMA) {
      const value = raw[item.key];
      if (value === undefined) continue;
      if (item.type === 'options' && item.options.some((o) => o.value === value)) clean[item.key] = value;
      if (item.type === 'range' && Number.isFinite(value)) clean[item.key] = TA.Utils.clamp(value, item.min, item.max);
    }
    // Migration: settings saved before sound profiles existed had sound off by default.
    if (raw.soundProfile === undefined) clean.sound = DEFAULTS.sound;
    return clean;
  }

  let state = Storage.get(Storage.KEYS.settings, DEFAULTS, sanitize);
  const listeners = new Set();

  const Settings = {
    THEMES,
    SCHEMA,
    DEFAULTS,

    get(key) { return state[key]; },
    all() { return Object.assign({}, state); },

    set(key, value) {
      if (!(key in DEFAULTS) || state[key] === value) return;
      state[key] = value;
      Storage.set(Storage.KEYS.settings, state);
      Settings.apply();
      listeners.forEach((fn) => fn(key, value));
      syncControl(key);
    },

    reload() {
      state = Storage.get(Storage.KEYS.settings, DEFAULTS, sanitize);
      Settings.apply();
      listeners.forEach((fn) => fn('*', null));
      if (container) Settings.render(container);
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Push settings onto <html> data attributes (CSS reacts to them). */
    apply() {
      const root = document.documentElement;
      if (root.dataset.theme && root.dataset.theme !== state.theme && state.animations) {
        // cross-fade colors while switching themes
        root.classList.add('theme-anim');
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => root.classList.remove('theme-anim'), 500);
      }
      root.dataset.theme = state.theme;
      root.dataset.effects = state.typingEffects && state.animations ? 'on' : 'off';
      root.dataset.font = state.font;
      root.dataset.size = state.fontSize;
      root.dataset.animations = state.animations ? 'on' : 'off';
      root.lang = state.uiLang;
      const label = $('#themeToggleLabel');
      if (label) label.textContent = state.theme;
    },

    cycleTheme() {
      const index = THEMES.findIndex((t) => t.value === state.theme);
      Settings.set('theme', THEMES[(index + 1) % THEMES.length].value);
    },

    render(target) {
      container = target;
      target.textContent = '';
      const groups = new Map();
      for (const item of SCHEMA) {
        if (!groups.has(item.group)) groups.set(item.group, []);
        groups.get(item.group).push(item);
      }
      for (const [groupName, items] of groups) {
        const section = el('section', { class: 'settings-group', 'aria-label': groupName }, [
          el('h2', { class: 'settings-group__title', text: groupName })
        ]);
        items.forEach((item) => section.append(renderSetting(item)));
        target.append(section);
      }
    }
  };

  let container = null;
  let themeTimer = null;

  function renderSetting(item) {
    const control = el('div', { class: 'setting__control', 'data-setting': item.key });
    const nameId = `setting-${item.key}`;

    if (item.type === 'options') {
      const group = el('div', { class: 'options', role: 'radiogroup', 'aria-labelledby': nameId });
      item.options.forEach((opt) => {
        const btn = el('button', {
          type: 'button', class: 'option', role: 'radio',
          'aria-checked': String(state[item.key] === opt.value),
          tabindex: state[item.key] === opt.value ? '0' : '-1',
          onclick: () => Settings.set(item.key, opt.value)
        }, [
          opt.swatch ? el('span', { class: 'option__swatch', style: `background:${opt.swatch};box-shadow:0 0 0 3px ${opt.bg}, 0 0 0 4px rgba(128,128,128,.4)` }) : null,
          opt.label
        ]);
        btn.dataset.value = JSON.stringify(opt.value);
        group.append(btn);
      });
      // Arrow-key navigation inside a radio group
      group.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const buttons = Array.from(group.children);
        const i = buttons.indexOf(document.activeElement);
        const next = buttons[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length];
        next.focus(); next.click();
      });
      control.append(group);
    } else if (item.type === 'range') {
      const output = el('span', { class: 'range-value', text: String(state[item.key]) });
      const input = el('input', {
        type: 'range', min: item.min, max: item.max, step: item.step, value: state[item.key],
        'aria-labelledby': nameId
      });
      input.addEventListener('input', () => { output.textContent = input.value; });
      input.addEventListener('change', () => Settings.set(item.key, Number(input.value)));
      control.append(input, output);
    }

    return el('div', { class: 'setting' }, [
      el('div', { class: 'setting__text' }, [
        el('h3', { class: 'setting__name', id: nameId, text: item.name }),
        el('p', { class: 'setting__desc', text: item.desc })
      ]),
      control
    ]);
  }

  function syncControl(key) {
    if (!container) return;
    const control = container.querySelector(`[data-setting="${key}"]`);
    if (!control) return;
    control.querySelectorAll('.option').forEach((btn) => {
      const active = JSON.parse(btn.dataset.value) === state[key];
      btn.setAttribute('aria-checked', String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    const range = control.querySelector('input[type="range"]');
    if (range) { range.value = state[key]; control.querySelector('.range-value').textContent = state[key]; }
  }

  Settings.apply();
  TA.Settings = Settings;
})(window.TA = window.TA || {});
