/*
 * tree.js — "O'sadigan daraxt": a tree that grows when you practice every day.
 *
 * Rules (computed from the history, so export/import keeps the tree):
 *  - A day counts as "watered" when you typed at least GOAL_SEC seconds in total.
 *  - Every watered day the tree grows (+1) and gets water (health +40).
 *  - The first missed day is forgiven. From the second missed day on the tree
 *    loses 25 health per day: leaves turn yellow, then brown and fall.
 *  - At 0 health the tree dries out and loses half of its growth.
 *    Practicing again brings it back to life.
 *
 * The drawing is a procedural SVG fractal: more days → taller, more branches,
 * then flowers (21+ days) and fruit (45+ days). It is seeded with the day you
 * started, so your tree keeps its own shape.
 */
(function (TA) {
  'use strict';
  const { el, dayKey, dayFromKey, addDays } = TA.Utils;

  const GOAL_SEC = 60;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 320;
  const H = 280;
  const GROUND = 250;

  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  function rng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ======================= state from history ======================= */

  const STAGES = [
    { min: 0, name: 'seed' },
    { min: 1, name: 'sprout' },
    { min: 3, name: 'sapling' },
    { min: 7, name: 'young tree' },
    { min: 14, name: 'tree' },
    { min: 21, name: 'blooming tree' },
    { min: 45, name: 'fruit tree' }
  ];
  const stageOf = (g) => STAGES.filter((s) => g >= s.min).pop();

  function compute(history) {
    const perDay = new Map();
    for (const r of history) {
      const k = dayKey(r.ts);
      perDay.set(k, (perDay.get(k) || 0) + (r.duration || 0));
    }
    const today = dayKey();
    const todaySec = Math.round(perDay.get(today) || 0);
    const firstKey = [...perDay.keys()].sort()[0];
    const state = { growth: 0, health: 100, dead: false, missed: 0, todaySec, goalSec: GOAL_SEC, activeToday: todaySec >= GOAL_SEC, seed: 7, started: !!firstKey, wateredDays: 0 };
    if (!firstKey) { state.stage = stageOf(0); return state; }

    state.seed = Number(firstKey.replace(/-/g, ''));
    let d = dayFromKey(firstKey);
    const end = dayFromKey(today);
    let guard = 0;
    while (d <= end && guard++ < 4000) {
      const k = dayKey(d);
      const active = (perDay.get(k) || 0) >= GOAL_SEC;
      if (active) {
        state.dead = false;
        state.growth++;
        state.wateredDays++;
        state.health = Math.min(100, state.health + 40);
        state.missed = 0;
      } else if (k !== today) {
        state.missed++;
        if (state.missed >= 2 && !state.dead) {
          state.health -= 25;
          if (state.health <= 0) {
            state.health = 0;
            state.dead = true;
            state.growth = Math.floor(state.growth / 2);
          }
        }
      }
      d = addDays(d, 1);
    }
    state.stage = stageOf(state.growth);
    return state;
  }

  function message(s) {
    if (!s.started) return 'Plant your tree: type for 1 minute today.';
    if (s.dead) return 'Your tree dried out. Practice today to bring it back to life.';
    if (s.activeToday) return 'Watered today! Your tree is happy.';
    if (s.health < 70) return 'Your tree is thirsty — leaves are falling. Practice today!';
    if (s.missed >= 1) return 'You skipped yesterday. Water your tree today or it will start to dry.';
    return 'Type for 1 minute today to water your tree.';
  }

  /* ======================= drawing ======================= */

  const LEAF_GREEN = ['#4caf62', '#3d9a55', '#69c07a', '#2f8a4c'];
  const LEAF_YELLOW = ['#c9b845', '#d8a93e', '#a8b84a'];
  const LEAF_BROWN = ['#b07a3c', '#9c6531', '#c28a4a'];

  function leafColor(health, rand) {
    const pick = (list) => list[Math.floor(rand() * list.length)];
    if (health >= 70) return pick(LEAF_GREEN);
    if (health >= 40) return rand() < 0.5 ? pick(LEAF_YELLOW) : pick(LEAF_GREEN);
    return rand() < 0.6 ? pick(LEAF_BROWN) : pick(LEAF_YELLOW);
  }

  function buildTree(state) {
    const rand = rng(state.seed);
    const g = state.growth;
    const maxDepth = g < 3 ? 1 : Math.min(7, 2 + Math.floor(Math.log2(g)));
    let sum = 0;
    for (let i = 0; i <= maxDepth; i++) sum += 0.74 ** i;
    const heightBudget = 70 + Math.min(g, 40) * 3.8;
    const trunk = (heightBudget / sum) * 0.95;
    const out = { branches: [], tips: [], maxDepth };

    function grow(x, y, ang, len, w, depth) {
      const x2 = x + Math.cos(ang) * len;
      const y2 = y + Math.sin(ang) * len;
      out.branches.push({ x1: x, y1: y, x2, y2, w, d: depth, len });
      if (depth >= maxDepth) { out.tips.push({ x: x2, y: y2, d: depth }); return; }
      if (depth >= maxDepth - 1) out.tips.push({ x: x2, y: y2, d: depth });
      const n = depth > 0 && rand() < 0.3 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const spread = 0.32 + rand() * 0.28;
        const a = ang + (n === 2 ? (i ? spread : -spread) : (i - 1) * spread * 1.15) + (rand() - 0.5) * 0.25;
        grow(x2, y2, a, len * (0.68 + rand() * 0.12), Math.max(1.2, w * 0.66), depth + 1);
      }
    }
    grow(W / 2, GROUND, -Math.PI / 2 + (rand() - 0.5) * 0.08, trunk, 6 + Math.min(g, 40) * 0.28, 0);
    return { out, rand };
  }

  function draw(container, state, { small = false, celebrate = false } = {}) {
    container.textContent = '';
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `tree${small ? ' tree--small' : ''}${state.dead ? ' is-dead' : ''}`, role: 'img', 'aria-label': state.stage.name });
    const health = state.dead ? 0 : state.health;

    // ground
    root.append(svg('ellipse', { class: 'tree__ground', cx: W / 2, cy: GROUND + 8, rx: 130, ry: 16 }));
    root.append(svg('ellipse', { class: `tree__grass${health < 40 ? ' is-dry' : ''}`, cx: W / 2, cy: GROUND + 2, rx: 95, ry: 7 }));

    const g = state.growth;
    const crown = svg('g', { class: 'tree__sway', style: `transform-origin:${W / 2}px ${GROUND}px` });

    if (!state.started || g === 0) {
      // Seed in the soil (or a dried stump if it died with nothing left)
      root.append(svg('ellipse', { class: 'tree__seed', cx: W / 2, cy: GROUND - 2, rx: 9, ry: 6 }));
      if (state.dead) root.append(svg('path', { class: 'tree__branch is-dead', d: `M${W / 2} ${GROUND} L${W / 2 + 2} ${GROUND - 26}`, 'stroke-width': 5 }));
    } else if (g < 3) {
      // Sprout: curved stem + two leaves
      const hgt = 30 + g * 16;
      crown.append(svg('path', { class: 'tree__stem', d: `M${W / 2} ${GROUND} Q${W / 2 - 8} ${GROUND - hgt / 2} ${W / 2} ${GROUND - hgt}`, 'stroke-width': 4, style: '--len:120' }));
      const color = state.dead ? '#8a6a45' : leafColor(health, () => 0.3);
      [[-1, -18], [1, 18]].forEach(([side, rot], i) => {
        crown.append(svg('ellipse', {
          class: 'tree__leaf', cx: W / 2 + side * 12, cy: GROUND - hgt + 4, rx: 13, ry: 6, fill: color,
          transform: `rotate(${rot} ${W / 2 + side * 12} ${GROUND - hgt + 4})`, style: `--delay:${0.5 + i * 0.1}s`
        }));
      });
    } else {
      const { out, rand } = buildTree(state);
      const branchGroup = svg('g');
      for (const b of out.branches) {
        branchGroup.append(svg('path', {
          class: `tree__branch${state.dead ? ' is-dead' : ''}`,
          d: `M${b.x1.toFixed(1)} ${b.y1.toFixed(1)} L${b.x2.toFixed(1)} ${b.y2.toFixed(1)}`,
          'stroke-width': b.w.toFixed(1),
          style: `--len:${Math.ceil(b.len) + 2};--delay:${(b.d * 0.13).toFixed(2)}s`
        }));
      }
      crown.append(branchGroup);

      if (!state.dead) {
        const keep = health >= 70 ? 1 : health / 80;
        const leafDelay = out.maxDepth * 0.13 + 0.1;
        const leaves = svg('g');
        const extras = svg('g');
        const size = 5 + Math.min(g, 40) * 0.08;
        out.tips.forEach((t, i) => {
          for (let j = 0; j < 3; j++) {
            if (rand() > keep) continue;
            const r = size * (0.75 + rand() * 0.6);
            leaves.append(svg('circle', {
              class: 'tree__leaf', cx: (t.x + (rand() - 0.5) * 14).toFixed(1), cy: (t.y + (rand() - 0.6) * 12).toFixed(1), r: r.toFixed(1),
              fill: leafColor(health, rand), style: `--delay:${(leafDelay + (i % 30) * 0.015).toFixed(2)}s`
            }));
          }
          const bloom = g >= 21 && health >= 70;
          if (bloom && rand() < 0.35) {
            const f = svg('g', { class: 'tree__flower', style: `--delay:${(leafDelay + 0.4 + (i % 20) * 0.02).toFixed(2)}s` });
            const fx = t.x + (rand() - 0.5) * 10, fy = t.y + (rand() - 0.5) * 10;
            for (let p = 0; p < 5; p++) {
              const a = (p / 5) * Math.PI * 2;
              f.append(svg('circle', { cx: (fx + Math.cos(a) * 3).toFixed(1), cy: (fy + Math.sin(a) * 3).toFixed(1), r: 2.6, fill: '#f7a8c4' }));
            }
            f.append(svg('circle', { cx: fx.toFixed(1), cy: fy.toFixed(1), r: 1.8, fill: '#ffe08a' }));
            extras.append(f);
          } else if (g >= 45 && health >= 70 && rand() < 0.18) {
            extras.append(svg('circle', { class: 'tree__fruit', cx: (t.x + (rand() - 0.5) * 8).toFixed(1), cy: (t.y + 6).toFixed(1), r: 4.5, fill: '#e25b4a', style: `--delay:${(leafDelay + 0.6).toFixed(2)}s` }));
          }
        });
        crown.append(leaves, extras);

        // falling leaves while thirsty
        if (health < 70) {
          for (let i = 0; i < 5; i++) {
            const t = out.tips[Math.floor(rand() * out.tips.length)];
            if (!t) break;
            root.append(svg('ellipse', {
              class: 'tree__falling', cx: t.x.toFixed(1), cy: t.y.toFixed(1), rx: 4, ry: 2.2, fill: leafColor(30, rand),
              style: `--fall:${(GROUND - t.y).toFixed(0)}px;--delay:${(i * 1.3).toFixed(1)}s;--drift:${((rand() - 0.5) * 60).toFixed(0)}px`
            }));
          }
        }
      } else {
        // dry leaves lying on the ground
        const rand2 = rng(state.seed + 1);
        for (let i = 0; i < 9; i++) {
          root.append(svg('ellipse', { cx: (W / 2 + (rand2() - 0.5) * 170).toFixed(1), cy: (GROUND + 4 + rand2() * 8).toFixed(1), rx: 5, ry: 2.4, fill: LEAF_BROWN[i % 3], opacity: 0.8 }));
        }
      }
    }
    root.insertBefore(crown, root.children[2] || null);

    if (celebrate) {
      const burst = svg('g', { class: 'tree__burst' });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        burst.append(svg('circle', { cx: W / 2, cy: GROUND - 90, r: 3, style: `--dx:${(Math.cos(a) * 70).toFixed(0)}px;--dy:${(Math.sin(a) * 70).toFixed(0)}px` }));
      }
      root.append(burst);
    }
    container.append(root);
  }

  /* ======================= UI blocks ======================= */

  function meter(state) {
    const pct = Math.min(100, Math.round((state.todaySec / state.goalSec) * 100));
    const health = state.dead ? 0 : state.health;
    return el('div', { class: 'tree-info__meters' }, [
      el('div', { class: 'tree-meter' }, [
        el('div', { class: 'tree-meter__head' }, [el('span', { text: 'today' }), el('b', { text: `${Math.min(state.todaySec, state.goalSec)} / ${state.goalSec} s` })]),
        el('div', { class: 'tree-meter__bar' }, [el('i', { class: 'is-today', style: `width:${pct}%` })])
      ]),
      el('div', { class: 'tree-meter' }, [
        el('div', { class: 'tree-meter__head' }, [el('span', { text: 'water' }), el('b', { text: `${health}%` })]),
        el('div', { class: 'tree-meter__bar' }, [el('i', { class: `is-water${health < 40 ? ' is-low' : ''}`, style: `width:${health}%` })])
      ])
    ]);
  }

  let lastGrewId = null;

  const Tree = {
    GOAL_SEC,
    compute,

    /** Call after a result is saved: remembers if this test watered the tree today. */
    noteResult(result, historyBefore) {
      const before = compute(historyBefore);
      const after = compute(TA.History.all());
      if (!before.activeToday && after.activeToday) lastGrewId = result.id;
    },

    renderDashboard() {
      const box = document.getElementById('treeDash');
      if (!box) return;
      const state = compute(TA.History.all());
      box.textContent = '';
      const art = el('div', { class: 'tree-art' });
      box.append(art, el('div', { class: 'tree-info' }, [
        el('p', { class: 'tree-info__stage' }, [el('span', { text: state.dead ? 'dried tree' : state.stage.name })]),
        el('p', { class: 'tree-info__msg', text: message(state) }),
        el('dl', { class: 'tree-info__stats' }, [
          el('div', {}, [el('dt', { text: 'days grown' }), el('dd', { text: String(state.growth) })]),
          el('div', {}, [el('dt', { text: 'watered days' }), el('dd', { text: String(state.wateredDays) })])
        ]),
        meter(state)
      ]));
      draw(art, state);
    },

    renderResult(result) {
      const box = document.getElementById('treeResult');
      if (!box) return;
      const state = compute(TA.History.all());
      const grew = result && result.id === lastGrewId;
      box.textContent = '';
      const art = el('div', { class: 'tree-art tree-art--small' });
      box.append(art, el('div', { class: 'tree-info' }, [
        grew ? el('p', { class: 'tree-info__grew', text: '+1 day! Your tree grew.' }) : null,
        el('p', { class: 'tree-info__stage' }, [el('span', { text: state.dead ? 'dried tree' : state.stage.name })]),
        el('p', { class: 'tree-info__msg', text: message(state) }),
        meter(state)
      ]));
      draw(art, state, { small: true, celebrate: grew });
    }
  };

  TA.Tree = Tree;
})(window.TA = window.TA || {});
