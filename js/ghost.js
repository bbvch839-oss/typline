/*
 * ghost.js — "Arvoh poyga" (ghost race).
 *
 * Every test records a replay: [milliseconds since start, character position].
 * The best run of each mode + language is kept as a "ghost". In the next test
 * of the same kind a translucent ghost caret replays that run on the current
 * text — with exactly the same speed changes and pauses — so you race yourself.
 * The HUD shows how many characters you are ahead of / behind the ghost.
 *
 * Storage: localStorage key "ghosts" → { "time-60-english": { wpm, acc, ts, t: [...], p: [...] } }
 */
(function (TA) {
  'use strict';
  const { $, el, round } = TA.Utils;

  const MAX_GHOSTS = 40;
  let ghosts = TA.Storage.get(TA.Storage.KEYS.ghosts, {}, sanitize);
  let engine = null;
  let current = null;     // ghost used in the running test
  let caret = null;
  let badge = null;
  let raf = 0;
  let startAt = 0;
  let idx = 0;
  const outcomes = new Map(); // result id → { type, diff }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('bad ghosts');
    const out = {};
    for (const [k, g] of Object.entries(raw)) {
      if (g && Number.isFinite(g.wpm) && Array.isArray(g.t) && Array.isArray(g.p) && g.t.length === g.p.length) out[k] = g;
    }
    return out;
  }

  const keyOf = (r) => `${r.mode}-${r.mode2}-${r.language}`;
  const enabled = () => TA.Settings.get('ghost') !== false;

  function save() {
    const keys = Object.keys(ghosts);
    if (keys.length > MAX_GHOSTS) {
      keys.sort((a, b) => ghosts[a].ts - ghosts[b].ts).slice(0, keys.length - MAX_GHOSTS).forEach((k) => delete ghosts[k]);
    }
    TA.Storage.set(TA.Storage.KEYS.ghosts, ghosts);
  }

  /** Ghost position (characters) at `ms` after the start. */
  function posAt(ms) {
    const t = current.t;
    while (idx < t.length - 1 && t[idx + 1] <= ms) idx++;
    while (idx > 0 && t[idx] > ms) idx--;
    return t[idx] <= ms ? current.p[idx] : 0;
  }

  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

  function tick() {
    if (!current || !engine || !engine.inProgress) { raf = 0; return; }
    const ms = performance.now() - startAt;
    const gpos = posAt(ms);
    const at = engine.positionOf(gpos);
    if (at) {
      caret.hidden = false;
      caret.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
    }
    const diff = engine.progressPos() - gpos;
    badge.textContent = diff > 0 ? `+${diff}` : String(diff);
    badge.className = `ghost-badge__value ${diff > 0 ? 'is-ahead' : diff < 0 ? 'is-behind' : ''}`;
    raf = requestAnimationFrame(tick);
  }

  const Ghost = {
    init(eng) {
      engine = eng;
      caret = el('div', { class: 'caret caret--line ghost-caret', hidden: true, 'aria-hidden': 'true' });
      $('#wordsTrack').append(caret);
      badge = el('span', { class: 'ghost-badge__value', text: '0' });
      const wrap = el('div', { class: 'hud__stat ghost-badge', id: 'ghostBadge', hidden: true, title: 'characters ahead of your ghost' }, [
        badge, el('span', { class: 'hud__label', text: 'vs ghost' })
      ]);
      $('#hud .hud__main').append(wrap);
      TA.Settings.onChange((k) => { if (k === 'ghost' || k === '*') Ghost.prepare(engine.plan); });
    },

    /** Called for every new test (before typing starts). */
    prepare(plan) {
      stopLoop();
      if (!caret) return;
      caret.hidden = true;
      current = plan && enabled() ? ghosts[keyOf(plan)] || null : null;
      idx = 0;
      $('#ghostBadge').hidden = !current;
      badge.textContent = '0';
      badge.className = 'ghost-badge__value';
      const info = $('#ghostInfo');
      if (info) {
        info.hidden = !current;
        if (current) {
          info.textContent = '';
          info.append(el('span', { class: 'ghost-dot' }), el('span', { text: 'Racing your ghost' }), el('b', { text: `${Math.round(current.wpm)} wpm` }));
        }
      }
    },

    /** Called when the first key of a test is pressed. */
    start() {
      if (!current) return;
      startAt = performance.now();
      idx = 0;
      stopLoop();
      raf = requestAnimationFrame(tick);
    },

    stop() { stopLoop(); if (caret) caret.hidden = true; },

    /** After a finished test: compare with the ghost and keep the faster run. */
    finish(result, trace, saved) {
      Ghost.stop();
      if (!saved || result.failed || !trace || trace.length < 5) return;
      const key = keyOf(result);
      const old = ghosts[key];
      if (enabled()) {
        if (!old) outcomes.set(result.id, { type: 'first' });
        else if (result.wpm > old.wpm) outcomes.set(result.id, { type: 'won', diff: round(result.wpm - old.wpm, 1) });
        else outcomes.set(result.id, { type: 'lost', diff: round(old.wpm - result.wpm, 1) });
      }
      if (!old || result.wpm > old.wpm) {
        ghosts[key] = { wpm: result.wpm, acc: result.acc, ts: result.ts, t: trace.map((x) => x[0]), p: trace.map((x) => x[1]) };
        save();
      }
    },

    /** Badge on the results page. */
    badge(result) {
      const o = result && outcomes.get(result.id);
      if (!o) return null;
      if (o.type === 'first') return el('span', { class: 'badge badge--ghost', text: 'ghost saved — race it next time' });
      if (o.type === 'won') return el('span', { class: 'badge badge--ghost is-won', text: `you beat your ghost by ${o.diff} wpm` });
      return el('span', { class: 'badge badge--ghost is-lost', text: `your ghost won by ${o.diff} wpm` });
    },

    reload() { ghosts = TA.Storage.get(TA.Storage.KEYS.ghosts, {}, sanitize); }
  };

  TA.Ghost = Ghost;
})(window.TA = window.TA || {});
