/*
 * layout.js — physical keyboard model shared by the hands guide (keyboard.js)
 * and the analysis heatmap (analysis.js).
 *
 *  - Physical keys are identified by their US-QWERTY character ("q", ";", "Space" …).
 *  - Each typing language has a layout: english / uzbek = QWERTY, russian = ЙЦУКЕН.
 *  - Layout.resolve(char, language) tells which physical key produces a character,
 *    whether Shift is needed, and which finger should press it.
 */
(function (TA) {
  'use strict';

  /* Rows of [id, width-in-key-units]. Every row is 15 units wide. */
  const ROWS = [
    [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['Backspace', 2]],
    [['Tab', 1.5], ['q', 1], ['w', 1], ['e', 1], ['r', 1], ['t', 1], ['y', 1], ['u', 1], ['i', 1], ['o', 1], ['p', 1], ['[', 1], [']', 1], ['\\', 1.5]],
    [['Caps', 1.75], ['a', 1], ['s', 1], ['d', 1], ['f', 1], ['g', 1], ['h', 1], ['j', 1], ['k', 1], ['l', 1], [';', 1], ["'", 1], ['Enter', 2.25]],
    [['ShiftL', 2.25], ['z', 1], ['x', 1], ['c', 1], ['v', 1], ['b', 1], ['n', 1], ['m', 1], [',', 1], ['.', 1], ['/', 1], ['ShiftR', 2.75]],
    [['CtrlL', 1.25], ['Win', 1.25], ['AltL', 1.25], ['Space', 6.25], ['AltR', 1.25], ['Fn', 1.25], ['Menu', 1.25], ['CtrlR', 1.25]]
  ];

  /* Key geometry in key units: { id, row, x, w, cx, cy } */
  const KEYS = {};
  const KEY_LIST = [];
  ROWS.forEach((row, r) => {
    let x = 0;
    for (const [id, w] of row) {
      const key = { id, row: r, x, w, cx: x + w / 2, cy: r + 0.5 };
      KEYS[id] = key;
      KEY_LIST.push(key);
      x += w;
    }
  });

  const SPECIAL_LABEL = {
    Backspace: '⌫', Tab: 'tab', Caps: 'caps', Enter: 'enter', ShiftL: 'shift', ShiftR: 'shift',
    CtrlL: 'ctrl', CtrlR: 'ctrl', Win: '', AltL: 'alt', AltR: 'alt', Fn: 'fn', Menu: '', Space: ''
  };

  /* Standard touch-typing finger zones */
  const FINGER_KEYS = {
    lp: ['`', '1', 'q', 'a', 'z', 'Tab', 'Caps', 'ShiftL', 'CtrlL'],
    lr: ['2', 'w', 's', 'x'],
    lm: ['3', 'e', 'd', 'c'],
    li: ['4', '5', 'r', 't', 'f', 'g', 'v', 'b'],
    ri: ['6', '7', 'y', 'u', 'h', 'j', 'n', 'm'],
    rm: ['8', 'i', 'k', ','],
    rr: ['9', 'o', 'l', '.'],
    rp: ['0', '-', '=', 'p', '[', ']', '\\', ';', "'", '/', 'Backspace', 'Enter', 'ShiftR', 'CtrlR'],
    th: ['Space', 'AltL', 'AltR', 'Win', 'Fn', 'Menu']
  };
  const KEY_FINGER = {};
  Object.entries(FINGER_KEYS).forEach(([f, ids]) => ids.forEach((id) => { KEY_FINGER[id] = f; }));

  const FINGER_NAMES = {
    lp: 'left pinky', lr: 'left ring', lm: 'left middle', li: 'left index',
    ri: 'right index', rm: 'right middle', rr: 'right ring', rp: 'right pinky', th: 'thumb'
  };
  const HOME = { lp: 'a', lr: 's', lm: 'd', li: 'f', ri: 'j', rm: 'k', rr: 'l', rp: ';' };

  /* ---------------- QWERTY (english, uzbek) ---------------- */
  const US_SHIFT = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
  };
  const US_SHIFT_LABEL = {};
  Object.entries(US_SHIFT).forEach(([s, b]) => { US_SHIFT_LABEL[b] = s; });

  /* ---------------- ЙЦУКЕН (russian) ---------------- */
  const RU = {
    '`': 'ё', q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '/': '.'
  };
  const RU_REVERSE = {};
  Object.entries(RU).forEach(([id, ch]) => { RU_REVERSE[ch] = id; });
  // Shifted symbols on the Russian layout
  const RU_SHIFT = { '!': '1', '"': '2', '№': '3', ';': '4', '%': '5', ':': '6', '?': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', ',': '/' };
  const RU_SHIFT_LABEL = { '1': '!', '2': '"', '3': '№', '4': ';', '5': '%', '6': ':', '7': '?', '8': '*', '9': '(', '0': ')', '/': ',' };

  const LAYOUTS = {
    english: 'qwerty', uzbek: 'qwerty', russian: 'jcuken'
  };
  const layoutOf = (language) => LAYOUTS[language] || 'qwerty';

  /* Characters that look like the apostrophe in Uzbek (o‘ g‘) */
  const APOSTROPHES = /[‘’ʻʼ`´]/;

  function resolveQwerty(ch) {
    if (ch === ' ') return { id: 'Space', shift: false };
    if (APOSTROPHES.test(ch) && ch !== '`') return { id: "'", shift: false };
    if (KEYS[ch] && ch.length === 1) return { id: ch, shift: false };
    const lower = ch.toLowerCase();
    if (lower !== ch && KEYS[lower]) return { id: lower, shift: true };
    if (US_SHIFT[ch]) return { id: US_SHIFT[ch], shift: true };
    return null;
  }

  function resolveJcuken(ch) {
    if (ch === ' ') return { id: 'Space', shift: false };
    const c = ch === 'Ё' ? 'ё' : ch;
    if (RU_REVERSE[c]) return { id: RU_REVERSE[c], shift: false };
    const lower = c.toLowerCase();
    if (lower !== c && RU_REVERSE[lower]) return { id: RU_REVERSE[lower], shift: true };
    if (RU_SHIFT[c]) return { id: RU_SHIFT[c], shift: true };
    if (/[0-9=\-\\]/.test(c)) return { id: c, shift: false };
    return resolveQwerty(ch); // Latin letters inside Russian text
  }

  const Layout = {
    ROWS,
    KEYS,
    KEY_LIST,
    KEY_FINGER,
    FINGER_NAMES,
    HOME,
    WIDTH: 15,
    HEIGHT: 5,

    layoutOf,

    /** Which physical key (and Shift) produces `ch` in `language`. null if unknown. */
    resolve(ch, language = 'english') {
      if (!ch) return null;
      const r = layoutOf(language) === 'jcuken' ? resolveJcuken(ch) : resolveQwerty(ch);
      if (!r) return null;
      const finger = KEY_FINGER[r.id] || null;
      // Shift is pressed by the pinky of the other hand
      const shiftKey = r.shift ? (finger && finger[0] === 'l' ? 'ShiftR' : 'ShiftL') : null;
      return { id: r.id, shift: r.shift, shiftKey, finger };
    },

    /** Physical key id for a character (used as the analysis/heatmap key). */
    keyId(ch, language) {
      const r = Layout.resolve(ch, language);
      if (!r) return ch.toLowerCase();
      return r.id === 'Space' ? ' ' : r.id;
    },

    /** Labels printed on a key: { main, shift } */
    label(id, language = 'english') {
      if (SPECIAL_LABEL[id] !== undefined) return { main: SPECIAL_LABEL[id], shift: '' };
      if (layoutOf(language) === 'jcuken') {
        if (RU[id]) return { main: RU[id], shift: '' };
        return { main: id, shift: RU_SHIFT_LABEL[id] || '' };
      }
      if (/^[a-z]$/.test(id)) return { main: id, shift: '' };
      return { main: id, shift: US_SHIFT_LABEL[id] || '' };
    },

    isSpecial(id) { return SPECIAL_LABEL[id] !== undefined; }
  };

  TA.Layout = Layout;
})(window.TA = window.TA || {});
