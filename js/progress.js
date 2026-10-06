/*
 * progress.js — Rank + Level (LVL / XP) system.
 *
 * RANK measures skill. Rating = average of (wpm × accuracy³) over your last 10
 * serious tests (15 s+, not failed). 3 placement tests are needed first.
 *   Bronze 0 · Silver 25 · Gold 40 · Platinum 55 · Diamond 70 · Master 90 · Grandmaster 110
 *   Every tier except Grandmaster has 3 divisions: III → II → I.
 *
 * LEVEL measures effort. Every test gives XP (words typed, accuracy bonus,
 * first test of the day, daily streak, personal best). XP to go from level n
 * to n+1 = 100 + 20·(n−1).
 *
 * Everything is computed from the history, so export / import keeps it.
 * Visuals: SVG emblems with a glossy shine, animated XP ring, promotion /
 * level-up celebration overlay with spring animations.
 */
(function (TA) {
  'use strict';
  const { $, el, dayKey, round, mean } = TA.Utils;
  const NS = 'http://www.w3.org/2000/svg';

  /* ======================= definitions ======================= */

  const TIERS = [
    { id: 'bronze', name: 'Bronze', min: 0, max: 25, c1: '#f0b27a', c2: '#a0522d', c3: '#5e2f14', points: 4 },
    { id: 'silver', name: 'Silver', min: 25, max: 40, c1: '#f4f6fa', c2: '#a7b0bf', c3: '#596273', points: 5 },
    { id: 'gold', name: 'Gold', min: 40, max: 55, c1: '#fff1a8', c2: '#f2b705', c3: '#8a5a00', points: 5 },
    { id: 'platinum', name: 'Platinum', min: 55, max: 70, c1: '#d6fff6', c2: '#3cc9b4', c3: '#13665d', points: 6 },
    { id: 'diamond', name: 'Diamond', min: 70, max: 90, c1: '#e0f0ff', c2: '#4d9bff', c3: '#1b3f9e', points: 7 },
    { id: 'master', name: 'Master', min: 90, max: 110, c1: '#f3e2ff', c2: '#a45cff', c3: '#4b178f', points: 8 },
    { id: 'grandmaster', name: 'Grandmaster', min: 110, max: Infinity, c1: '#ffe0e0', c2: '#ff4d6d', c3: '#7a0f2a', points: 9 }
  ];
  const DIVS = ['III', 'II', 'I'];
  const PLACEMENT = 3;
  const WINDOW = 10;

  const serious = (r) => r && !r.failed && r.duration >= 15;
  const ratingOf = (r) => r.wpm * (Math.min(100, r.acc) / 100) ** 3;

  /** Rank for a rating: { tier, t (index), div (0‥2 or null), step (global division number), progress 0‥1, nextAt } */
  function rankFor(rating) {
    let t = TIERS.findIndex((x) => rating >= x.min && rating < x.max);
    if (t < 0) t = rating >= 110 ? TIERS.length - 1 : 0;
    const tier = TIERS[t];
    if (tier.max === Infinity) return { tier, t, div: null, step: t * 3, progress: 1, nextAt: null, from: tier.min };
    const size = (tier.max - tier.min) / 3;
    const div = Math.min(2, Math.floor((rating - tier.min) / size));
    const from = tier.min + div * size;
    return { tier, t, div, step: t * 3 + div, progress: (rating - from) / size, nextAt: from + size, from };
  }

  const xpNeeded = (level) => 100 + 20 * (level - 1);
  function levelFor(xp) {
    let level = 1, rest = xp;
    while (rest >= xpNeeded(level)) { rest -= xpNeeded(level); level++; }
    return { level, into: rest, need: xpNeeded(level), total: xp, progress: rest / xpNeeded(level) };
  }

  /** XP of one test, with a breakdown. ctx = { firstToday, streak, isPb } */
  function xpFor(r, ctx) {
    const parts = [];
    const words = Math.max(0, Math.round((r.chars ? r.chars[0] : r.wpm * r.duration / 60 * 5) / 5));
    let base = r.failed ? Math.round(words / 2) : words;
    parts.push(['words', base]);
    if (!r.failed && r.acc >= 98) parts.push(['accuracy bonus', Math.round(base * 0.4)]);
    else if (!r.failed && r.acc >= 95) parts.push(['accuracy bonus', Math.round(base * 0.2)]);
    if (!r.failed) parts.push(['test completed', 10]);
    if (ctx.firstToday) parts.push(['first test today', 25]);
    if (ctx.streak > 1 && !r.failed) parts.push([`streak ×${Math.min(ctx.streak, 10)}`, Math.min(ctx.streak, 10) * 3]);
    if (ctx.isPb) parts.push(['personal best', 50]);
    return { total: parts.reduce((s, p) => s + p[1], 0), parts };
  }

  /** Full state from a history array. */
  function compute(history) {
    let xp = 0;
    let lastDay = null;
    let streak = 0;
    const pbs = {};
    const perTest = new Map();
    for (const r of history) {
      const day = dayKey(r.ts);
      let firstToday = false;
      if (day !== lastDay) {
        firstToday = true;
        const prev = lastDay ? TA.Utils.dayFromKey(lastDay) : null;
        const cur = TA.Utils.dayFromKey(day);
        streak = prev && Math.round((cur - prev) / 86400000) === 1 ? streak + 1 : 1;
        lastDay = day;
      }
      const key = `${r.mode}-${r.mode2}`;
      const isPb = !r.failed && pbs[key] !== undefined && r.wpm > pbs[key];
      if (!r.failed && (pbs[key] === undefined || r.wpm > pbs[key])) pbs[key] = r.wpm;
      const gain = xpFor(r, { firstToday, streak, isPb });
      perTest.set(r.id, gain);
      xp += gain.total;
    }
    const valid = history.filter(serious);
    const recent = valid.slice(-WINDOW);
    const placed = valid.length >= PLACEMENT;
    const rating = recent.length ? mean(recent.map(ratingOf)) : 0;
    return {
      xp, level: levelFor(xp), perTest,
      placed, placementDone: Math.min(valid.length, PLACEMENT),
      rating: round(rating, 1),
      rank: placed ? rankFor(rating) : null,
      avgWpm: recent.length ? mean(recent.map((r) => r.wpm)) : 0,
      avgAcc: recent.length ? mean(recent.map((r) => r.acc)) : 0
    };
  }

  /* ======================= emblem (SVG) ======================= */

  let uid = 0;
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  function starPath(cx, cy, points, outer, inner) {
    let d = '';
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const r = i % 2 ? inner : outer;
      d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)} `;
    }
    return `${d}Z`;
  }

  /**
   * A rank emblem: shield with gradient + bevel, tier star, division chevrons,
   * wings from Master up, animated glossy shine. `rank` null → unranked badge.
   */
  function emblem(rank, { size = 64, locked = false, animated = true } = {}) {
    const id = `em${++uid}`;
    const tier = rank ? rank.tier : { c1: '#d7dbe3', c2: '#8d95a3', c3: '#4a505c', points: 0, id: 'unranked' };
    const root = svg('svg', { viewBox: '0 0 120 130', width: size, height: size * 130 / 120, class: `emblem emblem--${tier.id}${locked ? ' is-locked' : ''}${animated ? ' is-animated' : ''}`, 'aria-hidden': 'true' });
    const defs = svg('defs');
    const g1 = svg('linearGradient', { id: `${id}a`, x1: '0', y1: '0', x2: '0.4', y2: '1' });
    g1.append(svg('stop', { offset: '0', 'stop-color': tier.c1 }), svg('stop', { offset: '.55', 'stop-color': tier.c2 }), svg('stop', { offset: '1', 'stop-color': tier.c3 }));
    const g2 = svg('linearGradient', { id: `${id}b`, x1: '0', y1: '1', x2: '0', y2: '0' });
    g2.append(svg('stop', { offset: '0', 'stop-color': tier.c1 }), svg('stop', { offset: '1', 'stop-color': tier.c3 }));
    const shine = svg('linearGradient', { id: `${id}s`, x1: '0', y1: '0', x2: '1', y2: '0' });
    shine.append(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }), svg('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '.75' }), svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
    // explicit size + no inherited stroke (the global `svg` rule sets 1.2em / currentColor)
    root.style.width = `${size}px`;
    root.style.height = `${size * 130 / 120}px`;
    root.style.stroke = 'none';
    const shield = 'M60 6 L108 24 L104 78 Q98 106 60 124 Q22 106 16 78 L12 24 Z';
    const clip = svg('clipPath', { id: `${id}c` });
    clip.append(svg('path', { d: shield }));
    defs.append(g1, g2, shine, clip);
    root.append(defs);

    // wings (Master and Grandmaster)
    if (rank && rank.t >= 5) {
      const wing = (s) => svg('path', {
        class: 'emblem__wing',
        d: s > 0 ? 'M104 34 Q128 30 132 14 Q124 44 108 58 Q122 58 128 48 Q118 70 104 74 Z' : 'M16 34 Q-8 30 -12 14 Q-4 44 12 58 Q-2 58 -8 48 Q2 70 16 74 Z',
        fill: `url(#${id}a)`, opacity: '.9'
      });
      root.setAttribute('viewBox', '-16 0 152 130');
      root.setAttribute('width', size * 152 / 120);
      root.style.width = `${size * 152 / 120}px`;
      root.append(wing(-1), wing(1));
    }

    root.append(svg('path', { d: shield, fill: `url(#${id}a)`, class: 'emblem__shield' }));
    root.append(svg('path', { d: 'M60 18 L96 31 L93 76 Q88 98 60 112 Q32 98 27 76 L24 31 Z', fill: `url(#${id}b)`, class: 'emblem__inner' }));
    root.append(svg('path', { d: 'M60 18 L96 31 L93 76 Q88 98 60 112 Q32 98 27 76 L24 31 Z', fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-width': '1.5' }));

    if (rank) {
      root.append(svg('path', { d: starPath(60, 58, tier.points, 25, 11), fill: tier.c1, stroke: tier.c3, 'stroke-width': '2', class: 'emblem__star' }));
      root.append(svg('circle', { cx: 60, cy: 58, r: 6, fill: '#fff', opacity: '.85' }));
      // division chevrons (III = 1, II = 2, I = 3)
      const count = rank.div === null ? 3 : rank.div + 1;
      for (let i = 0; i < count; i++) {
        const y = 92 + i * 7 - (count - 1) * 3.5;
        root.append(svg('path', { d: `M48 ${y} L60 ${y + 5} L72 ${y}`, fill: 'none', stroke: '#fff', 'stroke-width': '3.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '.92' }));
      }
    } else {
      const q = svg('text', { x: 60, y: 76, 'text-anchor': 'middle', 'font-size': '48', 'font-weight': '700', fill: '#fff', opacity: '.9' });
      q.textContent = '?';
      root.append(q);
    }

    // glossy shine sweeping across
    const shineGroup = svg('g', { 'clip-path': `url(#${id}c)` });
    shineGroup.append(svg('rect', { class: 'emblem__shine', x: '-60', y: '-10', width: '40', height: '160', fill: `url(#${id}s)`, transform: 'rotate(20 60 65)' }));
    root.append(shineGroup);
    return root;
  }

  /* ======================= small UI pieces ======================= */

  function ring(progress, { size = 120, stroke = 10, label = '', sub = '' } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const root = el('div', { class: 'xp-ring', style: `--size:${size}px` });
    const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: `width:${size}px;height:${size}px` });
    const id = `xr${++uid}`;
    const grad = svg('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.append(svg('stop', { offset: '0', 'stop-color': 'var(--accent)' }), svg('stop', { offset: '1', 'stop-color': '#a78bfa' }));
    const defs = svg('defs'); defs.append(grad); s.append(defs);
    s.append(svg('circle', { class: 'xp-ring__track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }));
    const bar = svg('circle', {
      class: 'xp-ring__bar', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, stroke: `url(#${id})`,
      'stroke-dasharray': c.toFixed(1), 'stroke-dashoffset': (c * (1 - progress)).toFixed(1), transform: `rotate(-90 ${size / 2} ${size / 2})`
    });
    s.append(bar);
    root.append(s, el('div', { class: 'xp-ring__label' }, [el('small', { text: 'LVL' }), el('b', { text: label }), sub ? el('span', { text: sub }) : null]));
    root.setProgress = (p, ms) => {
      bar.style.transition = ms ? `stroke-dashoffset ${ms}ms cubic-bezier(.32,.72,0,1)` : 'none';
      bar.setAttribute('stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, p)))).toFixed(1));
    };
    return root;
  }

  function rankTitle(rank) {
    if (!rank) return el('span', { class: 'rank-title' }, [el('span', { text: 'Unranked' })]);
    return el('span', { class: `rank-title rank-title--${rank.tier.id}` }, [
      el('span', { text: rank.tier.name }),
      rank.div !== null ? el('b', { 'data-no-i18n': '', text: ` ${DIVS[rank.div]}` }) : null
    ]);
  }

  function bar(progress, cls = '') {
    return el('div', { class: `rank-bar ${cls}` }, [el('i', { style: `width:${Math.round(progress * 100)}%` })]);
  }

  /* ======================= topbar chip ======================= */

  let chip = null;
  function renderChip(state) {
    if (!chip) {
      chip = el('a', { class: 'profile-chip', href: '#dashboard', title: 'Your rank and level', onclick: () => setTimeout(() => TA.Dashboard && TA.Dashboard.selectTab && TA.Dashboard.selectTab('rank'), 30) });
      const nav = $('.nav');
      nav.parentNode.insertBefore(chip, nav.nextSibling);
    }
    chip.textContent = '';
    const lv = state.level;
    chip.append(
      el('span', { class: 'profile-chip__emblem' }, [emblem(state.rank, { size: 26, animated: false })]),
      el('span', { class: 'profile-chip__text' }, [
        el('b', { 'data-no-i18n': '', text: `LVL ${lv.level}` }),
        el('span', { class: 'profile-chip__bar' }, [el('i', { style: `width:${Math.round(lv.progress * 100)}%` })])
      ])
    );
  }

  /* ======================= celebration overlay ======================= */

  function celebrate({ kind, rank, level }) {
    if (!TA.Effects.on) return;
    const overlay = el('div', { class: 'celebrate', role: 'dialog', 'aria-label': kind === 'rank' ? 'Promoted' : 'Level up' });
    const rays = el('div', { class: 'celebrate__rays' });
    const card = el('div', { class: 'celebrate__card' });
    if (kind === 'rank') {
      card.append(
        el('div', { class: 'celebrate__kicker', text: 'Promoted!' }),
        el('div', { class: 'celebrate__emblem' }, [emblem(rank, { size: 150 })]),
        el('div', { class: 'celebrate__title' }, [rankTitle(rank)]),
        el('div', { class: 'celebrate__sub', text: 'New rank unlocked' })
      );
    } else {
      card.append(
        el('div', { class: 'celebrate__kicker', text: 'Level up!' }),
        el('div', { class: 'celebrate__level' }, [el('small', { text: 'LVL' }), el('b', { text: String(level) })]),
        el('div', { class: 'celebrate__sub', text: 'Keep typing to reach the next level' })
      );
    }
    const sparks = el('div', { class: 'celebrate__sparks' });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const d = 140 + Math.random() * 120;
      sparks.append(el('i', { style: `--x:${(Math.cos(a) * d).toFixed(0)}px;--y:${(Math.sin(a) * d).toFixed(0)}px;--d:${(Math.random() * 0.25).toFixed(2)}s` }));
    }
    overlay.append(rays, sparks, card);
    document.body.append(overlay);
    TA.Sound.event(kind === 'rank' ? 'pb' : 'achievement');
    const close = () => {
      overlay.classList.add('is-leaving');
      setTimeout(() => overlay.remove(), 450);
    };
    overlay.addEventListener('click', close);
    setTimeout(close, 3200);
  }

  /* ======================= results panel ======================= */

  let lastChange = null; // { id, before, after }

  function renderResult(result) {
    const box = $('#progressResult');
    if (!box) return;
    const state = compute(TA.History.all());
    const change = lastChange && lastChange.id === result.id ? lastChange : null;
    const gain = state.perTest.get(result.id);
    box.textContent = '';

    // ---- level side
    const before = change ? change.before : state;
    const after = state;
    const lvBefore = before.level;
    const lvAfter = after.level;
    const r = ring(change ? lvBefore.progress : lvAfter.progress, { size: 132, stroke: 11, label: String(change ? lvBefore.level : lvAfter.level) });
    const xpValue = el('b', { class: 'xp-gain__value', text: gain ? `+${gain.total}` : '+0' });
    const parts = el('div', { class: 'xp-parts' }, (gain ? gain.parts : []).map(([label, v], i) => el('span', { class: 'xp-part', style: `--i:${i}` }, [
      el('b', { 'data-no-i18n': '', text: `+${v}` }), el('span', { text: label.replace(/ ×\d+$/, '') }), /×\d+$/.test(label) ? el('span', { 'data-no-i18n': '', text: label.match(/×\d+$/)[0] }) : null
    ])));
    const levelInfo = el('div', { class: 'xp-info' }, [
      el('div', { class: 'xp-gain' }, [xpValue, el('span', { text: 'XP' })]),
      parts,
      el('p', { class: 'xp-next' }, [el('span', { 'data-no-i18n': '', text: `${lvAfter.into} / ${lvAfter.need} XP` }), el('span', { text: ' to the next level' })])
    ]);
    const levelCard = el('div', { class: 'progress-card' }, [r, levelInfo]);

    // ---- rank side
    const rankBefore = before.rank;
    const rankAfter = after.rank;
    const emblemBox = el('div', { class: 'progress-emblem' }, [emblem(change ? rankBefore : rankAfter, { size: 96 })]);
    const titleBox = el('div', { class: 'progress-rank__title' }, [rankTitle(change ? rankBefore : rankAfter)]);
    const ratingValue = el('b', { 'data-no-i18n': '', text: String(after.rating) });
    const rb = bar(change && rankBefore ? rankBefore.progress : (rankAfter ? rankAfter.progress : after.placementDone / PLACEMENT));
    const rankInfo = el('div', { class: 'progress-rank__info' }, [
      titleBox,
      after.placed
        ? el('p', { class: 'muted small' }, [el('span', { text: 'rating' }), ' ', ratingValue])
        : el('p', { class: 'muted small' }, [el('span', { text: 'placement tests' }), ' ', el('b', { 'data-no-i18n': '', text: `${after.placementDone}/${PLACEMENT}` })]),
      rb,
      rankAfter && rankAfter.nextAt
        ? el('p', { class: 'muted small' }, [el('span', { text: 'next division at rating' }), ' ', el('b', { 'data-no-i18n': '', text: String(round(rankAfter.nextAt, 1)) })])
        : null
    ]);
    const rankCard = el('div', { class: 'progress-card progress-card--rank' }, [emblemBox, rankInfo]);
    box.append(levelCard, rankCard);

    if (!change) return;
    lastChange = null; // animate only once
    const on = TA.Effects.on;
    // XP count-up and ring fill (with level-up roll-over)
    TA.Effects.countUp(xpValue, gain ? gain.total : 0, { duration: 1100, delay: 250 });
    const setLabel = (n) => { r.querySelector('.xp-ring__label b').textContent = String(n); };
    if (lvAfter.level > lvBefore.level && on) {
      setTimeout(() => r.setProgress(1, 900), 300);
      setTimeout(() => {
        r.classList.add('is-levelup');
        setLabel(lvAfter.level);
        r.setProgress(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => r.setProgress(lvAfter.progress, 900)));
        celebrate({ kind: 'level', level: lvAfter.level });
      }, 1250);
    } else {
      setLabel(lvAfter.level);
      setTimeout(() => r.setProgress(lvAfter.progress, on ? 1100 : 0), 300);
    }

    // rank: bar and promotion / demotion
    const barFill = rb.querySelector('i');
    const target = rankAfter ? rankAfter.progress : after.placementDone / PLACEMENT;
    const promoted = rankAfter && (!rankBefore || rankAfter.step > rankBefore.step);
    const demoted = rankAfter && rankBefore && rankAfter.step < rankBefore.step;
    if (promoted || demoted) {
      setTimeout(() => {
        emblemBox.classList.add('is-swapping');
        setTimeout(() => {
          emblemBox.textContent = '';
          emblemBox.append(emblem(rankAfter, { size: 96 }));
          titleBox.textContent = '';
          titleBox.append(rankTitle(rankAfter), el('span', { class: `rank-change ${promoted ? 'is-up' : 'is-down'}`, text: promoted ? 'promoted' : 'demoted' }));
          emblemBox.classList.remove('is-swapping');
          emblemBox.classList.add(promoted ? 'is-promoted' : 'is-demoted');
          barFill.style.width = `${Math.round(target * 100)}%`;
        }, 380);
        const tierUp = promoted && (!rankBefore || rankAfter.t > rankBefore.t);
        if (tierUp || (!rankBefore && rankAfter)) setTimeout(() => celebrate({ kind: 'rank', rank: rankAfter }), lvAfter.level > lvBefore.level ? 3600 : 700);
      }, 900);
    } else {
      setTimeout(() => { barFill.style.width = `${Math.round(target * 100)}%`; }, 400);
    }
  }

  /* ======================= dashboard tab ======================= */

  function renderDashboard() {
    const box = $('#rankDash');
    if (!box) return;
    const state = compute(TA.History.all());
    box.textContent = '';
    const rank = state.rank;

    // hero
    const hero = el('div', { class: `panel rank-hero rank-hero--${rank ? rank.tier.id : 'unranked'}` }, [
      el('div', { class: 'rank-hero__glow' }),
      el('div', { class: 'rank-hero__emblem' }, [emblem(rank, { size: 150 })]),
      el('div', { class: 'rank-hero__info' }, [
        el('p', { class: 'rank-hero__kicker', text: 'Your rank' }),
        el('h2', { class: 'rank-hero__name' }, [rankTitle(rank)]),
        state.placed
          ? el('p', { class: 'muted' }, [el('span', { text: 'rating' }), ' ', el('b', { 'data-no-i18n': '', text: String(state.rating) }), ' · ', el('span', { text: 'average of your last 10 tests' })])
          : el('p', { class: 'muted' }, [el('span', { text: 'Finish 3 tests of 15 seconds or longer to get your rank.' }), ' ', el('b', { 'data-no-i18n': '', text: `${state.placementDone}/${PLACEMENT}` })]),
        bar(rank ? rank.progress : state.placementDone / PLACEMENT, 'rank-bar--big'),
        rank && rank.nextAt
          ? el('p', { class: 'muted small' }, [el('span', { text: 'next division at rating' }), ' ', el('b', { 'data-no-i18n': '', text: String(round(rank.nextAt, 1)) })])
          : null
      ])
    ]);

    // level card
    const lv = state.level;
    const levelCard = el('div', { class: 'panel level-card' }, [
      ring(lv.progress, { size: 150, stroke: 12, label: String(lv.level) }),
      el('div', {}, [
        el('p', { class: 'rank-hero__kicker', text: 'Your level' }),
        el('p', { class: 'level-card__xp' }, [el('b', { 'data-no-i18n': '', text: `${lv.into} / ${lv.need}` }), el('span', { text: ' XP' })]),
        el('p', { class: 'muted small' }, [el('span', { text: 'total XP' }), ' ', el('b', { 'data-no-i18n': '', text: state.xp.toLocaleString('en-US') })]),
        el('ul', { class: 'xp-rules' }, [
          el('li', { text: '1 XP for every word typed' }),
          el('li', { text: '+20% / +40% for 95% / 98% accuracy' }),
          el('li', { text: '+25 XP for the first test of the day' }),
          el('li', { text: '+3 XP per day of your streak' }),
          el('li', { text: '+50 XP for a new personal best' })
        ])
      ])
    ]);

    // ladder
    const ladder = el('div', { class: 'rank-ladder' }, TIERS.map((t, i) => {
      const reached = rank && rank.t >= i;
      const current = rank && rank.t === i;
      const fake = { tier: t, t: i, div: i === TIERS.length - 1 ? null : 2 };
      return el('div', { class: `ladder-step${reached ? ' is-reached' : ''}${current ? ' is-current' : ''}`, style: `--i:${i}` }, [
        emblem(fake, { size: 58, locked: !reached, animated: current }),
        el('b', { text: t.name }),
        el('span', { 'data-no-i18n': '', text: t.max === Infinity ? `${t.min}+` : `${t.min}–${t.max}` })
      ]);
    }));

    box.append(
      el('div', { class: 'dash-grid rank-grid' }, [hero, levelCard]),
      el('div', { class: 'panel' }, [
        el('h2', { class: 'panel__title', text: 'Rank ladder' }),
        el('p', { class: 'muted small', text: 'Rating = speed × accuracy³, averaged over your last 10 tests. Each tier has divisions III → II → I.' }),
        ladder
      ])
    );
  }

  /* ======================= public ======================= */

  const Progress = {
    TIERS,
    compute,
    rankFor,
    emblem,

    init() {
      renderChip(compute(TA.History.all()));
      TA.History.onChange(() => renderChip(compute(TA.History.all())));
    },

    /** Called after a result is saved (historyBefore = history without it). */
    noteResult(result, historyBefore) {
      lastChange = { id: result.id, before: compute(historyBefore) };
    },

    renderResult,
    renderDashboard,
    reload() { renderChip(compute(TA.History.all())); }
  };

  TA.Progress = Progress;
})(window.TA = window.TA || {});
