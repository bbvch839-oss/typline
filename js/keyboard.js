/*
 * keyboard.js — on-screen keyboard with a hands guide (TypingClub style).
 *
 * Shown below the text while typing. It draws the full keyboard for the
 * current typing language (QWERTY or ЙЦУКЕН), highlights the next key and
 * the Shift key when needed, and moves the correct finger of two translucent
 * hands onto that key. Keys are color-coded by the finger that presses them.
 *
 * Everything is one SVG using key units (1 unit = 1 key), so it scales to
 * any width. Public API used by the engine: press(char, wrong), setNext(char).
 */
(function (TA) {
  'use strict';
  const { el } = TA.Utils;
  const { Layout } = TA;

  const U = 40;           // px per key unit inside the SVG viewBox
  const GAP = 3;
  const VIEW_H = 7.1;     // keyboard (5 rows) + room for the hands below it
  const NS = 'http://www.w3.org/2000/svg';

  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  /*
   * Hand geometry (key units). Each finger has a knuckle (base) and rests its
   * tip on its home key; wb / wt = width at the knuckle / at the fingertip.
   * Knuckles sit on an arc like a real relaxed hand: the middle finger reaches
   * furthest, the pinky is shortest.
   */
  const K = Layout.KEYS;
  const FINGER_GEO = {
    lp: { base: [K.a.cx + 0.28, 4.8], wb: 0.64, wt: 0.5 },
    lr: { base: [K.s.cx + 0.2, 4.55], wb: 0.72, wt: 0.56 },
    lm: { base: [K.d.cx + 0.1, 4.45], wb: 0.76, wt: 0.58 },
    li: { base: [K.f.cx + 0.02, 4.55], wb: 0.78, wt: 0.6 },
    ri: { base: [K.j.cx - 0.02, 4.55], wb: 0.78, wt: 0.6 },
    rm: { base: [K.k.cx - 0.1, 4.45], wb: 0.76, wt: 0.58 },
    rr: { base: [K.l.cx - 0.2, 4.55], wb: 0.72, wt: 0.56 },
    rp: { base: [K[';'].cx - 0.28, 4.8], wb: 0.64, wt: 0.5 },
    tl: { base: [K.f.cx + 0.35, 5.85], wb: 0.95, wt: 0.68, home: [K.f.cx + 1.15, 4.6] },
    tr: { base: [K.j.cx - 0.35, 5.85], wb: 0.95, wt: 0.68, home: [K.j.cx - 1.15, 4.6] }
  };
  Object.entries(FINGER_GEO).forEach(([f, g]) => {
    if (!g.home) g.home = [K[Layout.HOME[f]].cx, K[Layout.HOME[f]].cy];
    g.tip = g.home.slice();
    g.target = g.home.slice();
  });

  // pinky → index for each hand, plus the thumb and the inward direction (towards the other hand)
  const HANDS = {
    L: { fingers: ['lp', 'lr', 'lm', 'li'], thumb: 'tl', inward: 1 },
    R: { fingers: ['rp', 'rr', 'rm', 'ri'], thumb: 'tr', inward: -1 }
  };

  let root = null;
  let board = null;
  let caption = null;
  let language = 'english';
  const keyNodes = new Map();
  const fingerNodes = {};
  let highlighted = [];
  let activeFingers = [];
  let lastChar = null;
  let anim = 0;
  const releaseTimers = new Map();

  /* ======================= building ======================= */

  function build() {
    keyNodes.clear();
    board = svg('svg', { viewBox: `0 0 ${Layout.WIDTH * U} ${VIEW_H * U}`, class: 'kbd__svg', 'aria-hidden': 'true' });

    const keysGroup = svg('g', { class: 'kbd__keys' });
    for (const key of Layout.KEY_LIST) {
      const g = svg('g', { class: `kbd__k f-${Layout.KEY_FINGER[key.id] || 'x'}${Layout.isSpecial(key.id) ? ' is-mod' : ''}` });
      const x = key.x * U + GAP / 2;
      const y = key.row * U + GAP / 2;
      const w = key.w * U - GAP;
      const h = U - GAP;
      g.append(svg('rect', { class: 'kbd__cap', x, y, width: w, height: h, rx: 6 }));
      g.append(svg('rect', { class: 'kbd__zone', x: x + 4, y: y + h - 5, width: w - 8, height: 3, rx: 1.5 }));
      const lbl = Layout.label(key.id, language);
      const main = svg('text', { class: 'kbd__label', x: x + w / 2, y: y + h / 2 + (lbl.shift ? 7 : 5) });
      main.textContent = /^[a-zа-яё]$/.test(lbl.main) ? lbl.main.toUpperCase() : lbl.main;
      g.append(main);
      if (lbl.shift) {
        const s = svg('text', { class: 'kbd__label kbd__label--shift', x: x + w / 2, y: y + 13 });
        s.textContent = lbl.shift;
        g.append(s);
      }
      if (key.id === 'f' || key.id === 'j') g.append(svg('rect', { class: 'kbd__bump', x: x + w / 2 - 5, y: y + h - 10, width: 10, height: 2, rx: 1 }));
      keysGroup.append(g);
      keyNodes.set(key.id, g);
    }
    board.append(keysGroup);

    // Hands: skin gradient + one translucent group so overlaps don't darken
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: 'kbdSkin', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(svg('stop', { offset: '0', 'stop-color': '#f6d3b8' }), svg('stop', { offset: '1', 'stop-color': '#dca483' }));
    const gradA = svg('linearGradient', { id: 'kbdSkinActive', x1: '0', y1: '0', x2: '0', y2: '1' });
    gradA.append(svg('stop', { offset: '0', 'stop-color': '#ffe2cc' }), svg('stop', { offset: '1', 'stop-color': '#f0b894' }));
    defs.append(grad, gradA);
    board.append(defs);

    const hands = svg('g', { class: 'kbd__hands' });
    for (const side of ['L', 'R']) {
      const cfg = HANDS[side];
      const hand = svg('g', { class: `kbd__hand kbd__hand--${side}` });
      // thumb and fingers first, the back of the hand on top hides their roots
      for (const f of [cfg.thumb, ...cfg.fingers]) {
        const g = svg('g', { class: `kbd__finger${f[0] === 't' ? ' kbd__finger--thumb' : ''}` });
        g.body = svg('path', { class: 'kbd__finger-body' });
        g.joints = svg('path', { class: 'kbd__finger-joints' });
        g.nail = svg('ellipse', { class: 'kbd__nail' });
        g.append(g.body, g.joints, g.nail);
        hand.append(g);
        fingerNodes[f] = g;
      }
      hand.palm = svg('path', { class: 'kbd__palm' });
      hand.knuckles = svg('g', { class: 'kbd__knuckles' });
      hand.append(hand.palm, hand.knuckles);
      hand.side = side;
      hands.append(hand);
    }
    board.append(hands);
    // Target rings drawn on top (not translucent)
    const tips = svg('g', { class: 'kbd__tips' });
    Object.keys(FINGER_GEO).forEach((f) => {
      const c = svg('circle', { class: 'kbd__tip', r: FINGER_GEO[f].wt * U * 0.62 });
      tips.append(c);
      fingerNodes[`${f}Tip`] = c;
    });
    board.append(tips);

    caption = el('div', { class: 'kbd__caption', 'aria-live': 'off' });
    root.textContent = '';
    root.append(board, caption);
    drawHands();
  }

  const P = (x, y) => `${(x * U).toFixed(1)} ${(y * U).toFixed(1)}`;

  /** One finger: tapered body with a rounded tip, two joint creases and a nail. */
  function drawFinger(node, g) {
    const [bx0, by0] = g.base;
    const [tx0, ty0] = g.tip;
    const L = Math.hypot(tx0 - bx0, ty0 - by0) || 1;
    const ux = (tx0 - bx0) / L, uy = (ty0 - by0) / L;
    const nx = -uy, ny = ux;
    const rt = g.wt / 2, rb = g.wb / 2;
    // root goes a bit into the palm; the fingertip ends just past the key centre
    const bx = bx0 - ux * 0.45, by = by0 - uy * 0.45;
    const cx = tx0 - ux * rt * 0.35, cy = ty0 - uy * rt * 0.35;
    const mx = (bx + cx) / 2, my = (by + cy) / 2;
    const rm = (rb + rt) / 2 * 1.08; // slightly fuller around the middle joint
    const k = rt * 1.33;             // bezier handle for a round fingertip
    node.body.setAttribute('d',
      `M${P(bx + nx * rb, by + ny * rb)} ` +
      `Q${P(mx + nx * rm, my + ny * rm)} ${P(cx + nx * rt, cy + ny * rt)} ` +
      `C${P(cx + nx * rt + ux * k, cy + ny * rt + uy * k)} ${P(cx - nx * rt + ux * k, cy - ny * rt + uy * k)} ${P(cx - nx * rt, cy - ny * rt)} ` +
      `Q${P(mx - nx * rm, my - ny * rm)} ${P(bx - nx * rb, by - ny * rb)} Z`);

    // joint creases at ~45 % and ~72 % of the visible finger
    const crease = (t, w) => {
      const px = bx0 + (cx - bx0) * t, py = by0 + (cy - by0) * t;
      return `M${P(px + nx * w, py + ny * w)} Q${P(px + ux * 0.07, py + uy * 0.07)} ${P(px - nx * w, py - ny * w)}`;
    };
    node.joints.setAttribute('d', `${crease(0.38, rm * 0.55)} ${crease(0.7, rt * 0.6)}`);

    // nail near the tip, aligned with the finger
    const ncx = cx - ux * rt * 0.15, ncy = cy - uy * rt * 0.15;
    const angle = (Math.atan2(ny, nx) * 180) / Math.PI;
    node.nail.setAttribute('cx', (ncx * U).toFixed(1));
    node.nail.setAttribute('cy', (ncy * U).toFixed(1));
    node.nail.setAttribute('rx', (rt * 0.62 * U).toFixed(1));
    node.nail.setAttribute('ry', (rt * 0.82 * U).toFixed(1));
    node.nail.setAttribute('transform', `rotate(${angle.toFixed(1)} ${(ncx * U).toFixed(1)} ${(ncy * U).toFixed(1)})`);
  }

  /** Back of the hand: knuckle bumps on top, thumb web on the inner side, wrist at the bottom. */
  function palmPath(side) {
    const { fingers, inward: s } = HANDS[side];
    const b = fingers.map((f) => FINGER_GEO[f].base);   // pinky … index
    const [pk, , , ix] = b;
    const wrist = VIEW_H + 0.6;
    let d = `M${P(pk[0] - s * 0.34, pk[1] + 0.2)} `;
    d += `Q${P(pk[0] - s * 0.3, pk[1] - 0.22)} ${P(pk[0], pk[1] - 0.24)} `;
    for (let i = 1; i < b.length; i++) {
      const prev = b[i - 1], cur = b[i];
      d += `Q${P((prev[0] + cur[0]) / 2, Math.max(prev[1], cur[1]) - 0.05)} ${P(cur[0], cur[1] - 0.27)} `;
    }
    d += `Q${P(ix[0] + s * 0.36, ix[1] - 0.22)} ${P(ix[0] + s * 0.38, ix[1] + 0.25)} `;   // index side
    d += `Q${P(ix[0] + s * 0.42, ix[1] + 0.85)} ${P(ix[0] + s * 0.62, ix[1] + 1.25)} `;   // thumb web
    d += `Q${P(ix[0] + s * 0.55, ix[1] + 1.9)} ${P(ix[0] + s * 0.1, wrist)} `;            // inner wrist
    d += `L${P(pk[0] + s * 0.3, wrist)} `;
    d += `Q${P(pk[0] - s * 0.55, pk[1] + 1.2)} ${P(pk[0] - s * 0.34, pk[1] + 0.2)} Z`;   // outer edge
    return d;
  }

  function drawHands() {
    if (!board) return;
    for (const [f, g] of Object.entries(FINGER_GEO)) {
      drawFinger(fingerNodes[f], g);
      const tip = fingerNodes[`${f}Tip`];
      tip.setAttribute('cx', g.target[0] * U); tip.setAttribute('cy', g.target[1] * U);
    }
    board.querySelectorAll('.kbd__hand').forEach((hand) => {
      hand.palm.setAttribute('d', palmPath(hand.side));
      if (!hand.knuckles.childNodes.length) {
        HANDS[hand.side].fingers.forEach((f) => {
          const [x, y] = FINGER_GEO[f].base;
          hand.knuckles.append(svg('ellipse', { cx: x * U, cy: (y - 0.05) * U, rx: FINGER_GEO[f].wb * 0.36 * U, ry: 0.14 * U }));
        });
      }
    });
  }

  /* Smoothly move finger tips towards their targets */
  function animate() {
    cancelAnimationFrame(anim);
    const reduce = document.documentElement.dataset.animations === 'off';
    const step = () => {
      let moving = false;
      for (const g of Object.values(FINGER_GEO)) {
        for (let i = 0; i < 2; i++) {
          const d = g.target[i] - g.tip[i];
          if (Math.abs(d) > 0.01 && !reduce) { g.tip[i] += d * 0.35; moving = true; } else g.tip[i] = g.target[i];
        }
      }
      drawHands();
      if (moving) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /* ======================= state ======================= */

  function fingerKey(f, keyId) {
    // map layout finger ids to hand-drawing ids (thumbs are split per hand)
    if (f !== 'th') return f;
    const k = Layout.KEYS[keyId];
    return k && k.cx < Layout.WIDTH / 2 ? 'tl' : 'tr';
  }

  function clearHighlight() {
    highlighted.forEach((n) => n.classList.remove('is-next', 'is-shift'));
    highlighted = [];
    activeFingers.forEach((f) => {
      fingerNodes[f] && fingerNodes[f].classList.remove('is-active');
      fingerNodes[`${f}Tip`] && fingerNodes[`${f}Tip`].classList.remove('is-active');
    });
    activeFingers = [];
    for (const g of Object.values(FINGER_GEO)) g.target = g.home.slice();
  }

  const FINGER_TEXT = {
    lp: 'left pinky', lr: 'left ring finger', lm: 'left middle finger', li: 'left index finger',
    ri: 'right index finger', rm: 'right middle finger', rr: 'right ring finger', rp: 'right pinky',
    tl: 'thumb', tr: 'thumb'
  };

  function showNext(char) {
    clearHighlight();
    caption.textContent = '';
    const hands = Keyboard.handsOn;
    if (!char || !TA.Settings.get('keyHint')) { animate(); return; }
    const r = Layout.resolve(char, language);
    if (!r) { animate(); return; }
    const node = keyNodes.get(r.id);
    if (node) { node.classList.add('is-next'); highlighted.push(node); }
    const main = fingerKey(r.finger, r.id);
    const move = (f, keyId) => {
      const k = Layout.KEYS[keyId];
      if (!FINGER_GEO[f] || !k) return;
      FINGER_GEO[f].target = [k.cx, k.cy];
      activeFingers.push(f);
      fingerNodes[f].classList.add('is-active');
      fingerNodes[`${f}Tip`].classList.add('is-active');
    };
    if (hands) move(main, r.id);
    let shiftFinger = null;
    if (r.shift) {
      const sNode = keyNodes.get(r.shiftKey);
      if (sNode) { sNode.classList.add('is-shift'); highlighted.push(sNode); }
      shiftFinger = r.shiftKey === 'ShiftL' ? 'lp' : 'rp';
      if (hands) move(shiftFinger, r.shiftKey);
    }
    // Caption: "right index finger  J  + left pinky  Shift"
    const keyLabel = r.id === 'Space' ? 'space' : Layout.label(r.id, language).main.toUpperCase();
    caption.append(
      el('span', { class: `kbd__dot f-${r.finger}` }),
      el('span', { text: FINGER_TEXT[main] }),
      el('kbd', { text: keyLabel })
    );
    if (shiftFinger) {
      caption.append(el('span', { class: 'kbd__plus', text: '+' }), el('span', { class: `kbd__dot f-${shiftFinger}` }),
        el('span', { text: FINGER_TEXT[shiftFinger] }), el('kbd', { text: 'shift' }));
    }
    animate();
  }

  /* ======================= public API ======================= */

  const Keyboard = {
    init(container) {
      root = container;
      language = TA.App && TA.App.getConfig ? TA.App.getConfig().language : 'english';
      build();
      Keyboard.sync();
      TA.Settings.onChange((key) => {
        if (key === 'guide' || key === 'keyHint' || key === '*') { Keyboard.sync(); showNext(lastChar); }
      });
    },

    /** Rebuild labels for a typing language (english / uzbek / russian). */
    setLanguage(lang) {
      if (lang === language || !root) return;
      const oldLayout = Layout.layoutOf(language);
      language = lang;
      if (Layout.layoutOf(lang) !== oldLayout) build();
      showNext(lastChar);
    },

    get handsOn() { return TA.Settings.get('guide') === 'hands'; },

    sync() {
      if (!root) return;
      const mode = TA.Settings.get('guide');
      root.hidden = mode === 'off';
      root.classList.toggle('kbd--no-hands', mode !== 'hands');
    },

    get active() { return !!root && !root.hidden; },

    press(char, wrong = false) {
      if (!Keyboard.active) return;
      const r = Layout.resolve(char, language);
      if (!r) return;
      const node = keyNodes.get(r.id);
      if (!node) return;
      node.classList.add('is-down');
      node.classList.toggle('is-wrong', wrong);
      clearTimeout(releaseTimers.get(r.id));
      releaseTimers.set(r.id, setTimeout(() => node.classList.remove('is-down', 'is-wrong'), 130));
    },

    setNext(char) {
      lastChar = char;
      if (!Keyboard.active) return;
      showNext(char);
    }
  };

  TA.Keyboard = Keyboard;
})(window.TA = window.TA || {});
