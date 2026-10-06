/*
 * analysis.js — the analysis & training system.
 *
 *  1. Keyboard heatmap  — which keys you miss most / type slowest.
 *  2. Finger analysis   — errors and speed grouped by the finger that
 *                          should press each key (standard QWERTY touch typing).
 *  3. Smart practice     — a "practice" mode that builds text out of words
 *                          containing your weakest letters and letter pairs.
 *  4. Fatigue graph      — shows when (and how much) you slowed down in a test.
 *
 * Data model
 *  - During a test the engine feeds every keystroke into a Recorder.
 *  - Each saved result carries `analysis.keys` (per-key stats of that test).
 *  - A long-term profile (localStorage key "analysis") accumulates per-key and
 *    per-letter-pair stats. Older data slowly fades (DECAY) so the profile
 *    follows your current weaknesses, not the ones you fixed months ago.
 *
 * A stat entry is always [hits, misses, msSum, msCount].
 */
(function (TA) {
  'use strict';
  const { $, el, round, mean, shuffle } = TA.Utils;

  const DECAY = 0.97;            // weight kept by old profile data on each new test
  const MAX_DT = 1500;           // pauses longer than this are not counted as key time
  const MIN_KEY_SAMPLES = 8;     // needed before a key can be called "weak"
  const MIN_PAIR_SAMPLES = 5;
  const MIN_PROFILE_KEYS = 150;  // keystrokes needed before practice mode personalises

  /* ======================= keyboard & fingers ======================= */

  // Physical character keys (row 0-3 of the shared keyboard model, without tab/shift/…)
  const ROWS = TA.Layout.ROWS.slice(0, 4).map((row) => row.map(([id]) => id).filter((id) => !TA.Layout.isSpecial(id) && id !== '`' && id !== '\\'));

  const FINGERS = [
    { id: 'lp', hand: 'L', name: 'left pinky', keys: '`1qaz', h: 58 },
    { id: 'lr', hand: 'L', name: 'left ring', keys: '2wsx', h: 80 },
    { id: 'lm', hand: 'L', name: 'left middle', keys: '3edc', h: 92 },
    { id: 'li', hand: 'L', name: 'left index', keys: '45rtfgvb', h: 82 },
    { id: 'ri', hand: 'R', name: 'right index', keys: '67yuhjnm', h: 82 },
    { id: 'rm', hand: 'R', name: 'right middle', keys: '8ik,', h: 92 },
    { id: 'rr', hand: 'R', name: 'right ring', keys: '9ol.', h: 80 },
    { id: 'rp', hand: 'R', name: 'right pinky', keys: "0-=p[];'/", h: 58 },
    { id: 'th', hand: '', name: 'thumbs', keys: ' ', h: 40 }
  ];
  const KEY_FINGER = { ' ': 'th' };
  Object.entries(TA.Layout.KEY_FINGER).forEach(([k, f]) => { if (k !== 'Space') KEY_FINGER[k] = f; });

  /** Map any typed character to the physical key it lives on (depends on the language layout). */
  const baseKey = (ch, language) => TA.Layout.keyId(ch, language);
  const isLetter = (ch) => /\p{L}/u.test(ch);

  /* ======================= stat helpers ======================= */

  const newEntry = () => [0, 0, 0, 0];
  const total = (e) => e[0] + e[1];
  const errRate = (e) => (total(e) ? e[1] / total(e) : 0);
  const avgMs = (e) => (e[3] ? e[2] / e[3] : 0);

  function addTo(map, key, correct, dt) {
    const e = map[key] || (map[key] = newEntry());
    if (correct) e[0]++; else e[1]++;
    if (correct && dt !== null) { e[2] += dt; e[3]++; }
  }

  /** Average ms per key across a whole map (weighted by samples). */
  function globalAvgMs(map) {
    let ms = 0, n = 0;
    for (const e of Object.values(map)) { ms += e[2]; n += e[3]; }
    return n ? ms / n : 0;
  }

  /** Aggregate a key map by finger. */
  function fingerStats(keys) {
    const out = {};
    FINGERS.forEach((f) => { out[f.id] = newEntry(); });
    for (const [k, e] of Object.entries(keys || {})) {
      const f = KEY_FINGER[k];
      if (!f) continue;
      for (let i = 0; i < 4; i++) out[f][i] += e[i];
    }
    return out;
  }

  /**
   * Weakness score of one entry: error percentage plus a penalty for being
   * slower than your average. Scaled down while there are few samples.
   */
  function weakness(e, avg, minSamples) {
    const n = total(e);
    if (n < minSamples) return 0;
    const errPart = errRate(e) * 100;
    const slowPart = avg && e[3] >= 3 ? Math.max(0, avgMs(e) / avg - 1) * 40 : 0;
    return (errPart + slowPart) * Math.min(1, n / 25);
  }

  /* ======================= recorder (used by the engine) ======================= */

  class Recorder {
    constructor(language) { this.language = language || 'english'; this.keys = {}; this.pairs = {}; this.last = 0; }

    /** A keystroke. `expected` = the character that should have been typed. */
    key(expected, correct, prev) {
      const now = performance.now();
      const dt = this.last && now - this.last < MAX_DT ? now - this.last : null;
      this.last = now;
      if (expected === undefined) return;
      addTo(this.keys, baseKey(expected, this.language), correct, dt);
      const a = prev && prev.toLowerCase();
      const b = expected.toLowerCase();
      if (a && isLetter(a) && isLetter(b)) addTo(this.pairs, a + b, correct, dt);
    }

    /** Backspace etc. — resets the clock so corrections don't count as slow keys. */
    touch() { this.last = performance.now(); }

    export() {
      const keys = {};
      for (const [k, e] of Object.entries(this.keys)) keys[k] = [e[0], e[1], Math.round(e[2]), e[3]];
      return { keys };
    }
  }

  /* ======================= long-term profile ======================= */

  const EMPTY_PROFILE = { v: 1, tests: 0, keys: {}, pairs: {}, fatigue: [] };

  function validEntry(e) { return Array.isArray(e) && e.length === 4 && e.every((x) => Number.isFinite(x) && x >= 0); }
  function sanitizeMap(m) {
    const out = {};
    if (m && typeof m === 'object') for (const [k, e] of Object.entries(m)) if (k.length <= 2 && validEntry(e)) out[k] = e;
    return out;
  }
  function sanitizeProfile(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('bad profile');
    return {
      v: 1,
      tests: Number.isFinite(raw.tests) ? raw.tests : 0,
      keys: sanitizeMap(raw.keys),
      pairs: sanitizeMap(raw.pairs),
      fatigue: Array.isArray(raw.fatigue) ? raw.fatigue.filter((f) => f && Number.isFinite(f.drop)).slice(-30) : []
    };
  }

  let profile = TA.Storage.get(TA.Storage.KEYS.analysis, EMPTY_PROFILE, sanitizeProfile);

  function mergeInto(target, source) {
    for (const e of Object.values(target)) for (let i = 0; i < 4; i++) e[i] *= DECAY;
    for (const [k, e] of Object.entries(source)) {
      const t = target[k] || (target[k] = newEntry());
      for (let i = 0; i < 4; i++) t[i] += e[i];
    }
    for (const [k, e] of Object.entries(target)) {
      if (total(e) < 0.5) delete target[k];
      else for (let i = 0; i < 4; i++) e[i] = round(e[i], i === 2 ? 0 : 2);
    }
  }

  /** Weak keys / letter pairs from a profile, strongest weakness first. */
  function weakSpots(p = profile, limit = 6) {
    const avg = globalAvgMs(p.keys);
    const rank = (map, min, filter) => Object.entries(map)
      .filter(([k]) => filter(k))
      .map(([k, e]) => ({ k, e, score: weakness(e, avg, min) }))
      .filter((x) => x.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      avg,
      keys: rank(p.keys, MIN_KEY_SAMPLES, (k) => k !== ' '),
      pairs: rank(p.pairs, MIN_PAIR_SAMPLES, () => true)
    };
  }

  /* ======================= fatigue ======================= */

  function rolling(list, size) {
    return list.map((_, i) => mean(list.slice(Math.max(0, i - size + 1), i + 1)));
  }

  /**
   * Looks at per-second raw speed. Baseline = the early part of the test
   * (after a 2 s warm-up), end = the last 30 %. Onset = the first second from
   * which your speed stays below 92 % of the baseline.
   */
  function fatigue(result) {
    const s = result && result.samples;
    if (!s || !Array.isArray(s.raw) || s.raw.length < 15) return { ok: false, n: s && s.raw ? s.raw.length : 0 };
    const raw = s.raw.slice(0, Math.floor(result.duration) || s.raw.length);
    const n = raw.length;
    const smooth = rolling(raw, 5);
    const warm = Math.min(2, Math.floor(n * 0.1));
    const baseEnd = Math.max(warm + 3, Math.floor(n * 0.3));
    const baseline = mean(raw.slice(warm, baseEnd));
    const endAvg = mean(raw.slice(Math.floor(n * 0.7)));
    if (!baseline) return { ok: false, n };
    const drop = (1 - endAvg / baseline) * 100;
    let onset = null;
    const limit = baseline * 0.92;
    for (let i = baseEnd; i < n - 2; i++) {
      if (smooth[i] < limit && mean(smooth.slice(i)) < limit) { onset = i + 1; break; }
    }
    return { ok: true, n, raw, smooth, baseline, endAvg, drop: round(drop, 1), onset };
  }

  function fatigueText(f) {
    if (!f.ok) return `Test too short for fatigue analysis — needs at least 15 seconds (this one: ${f.n}s).`;
    if (f.drop >= 8) {
      return f.onset
        ? `After ${f.onset}s your speed dropped by ${Math.round(f.drop)}% (${Math.round(f.baseline)} → ${Math.round(f.endAvg)} raw wpm).`
        : `You finished ${Math.round(f.drop)}% slower than you started (${Math.round(f.baseline)} → ${Math.round(f.endAvg)} raw wpm).`;
    }
    if (f.drop <= -5) return `You got faster towards the end (+${Math.round(-f.drop)}%). You need some time to warm up.`;
    return `Your speed stayed steady — no fatigue detected (${f.drop > 0 ? '-' : '+'}${Math.abs(Math.round(f.drop))}%).`;
  }

  /* ======================= practice generator ======================= */

  function wordScore(word, spots) {
    const w = word.toLowerCase();
    let s = 0;
    for (const x of spots.keys) if (w.includes(x.k)) s += x.score * (w.split(x.k).length - 1);
    for (const x of spots.pairs) if (w.includes(x.k)) s += x.score * 1.5 * (w.split(x.k).length - 1);
    return s / Math.sqrt(w.length);
  }

  /**
   * Returns a generator ({ next, take, focus }) or null when there is not
   * enough data yet. 75 % of words target weak spots, 25 % are normal words.
   */
  function createPracticeGenerator(plan) {
    const keysTyped = Object.values(profile.keys).reduce((s, e) => s + total(e), 0);
    if (keysTyped < MIN_PROFILE_KEYS) return null;
    const raw = weakSpots(profile, 12);
    // Keep only letters of this language's alphabet; key ids become the letter printed on the key
    const cyr = TA.Layout.layoutOf(plan.language) === 'jcuken';
    const fits = (s) => (cyr ? /^[а-яё]+$/ : /^[a-z']+$/).test(s);
    const spots = {
      pairs: raw.pairs.filter((x) => fits(x.k)).slice(0, 6),
      keys: raw.keys.map((x) => Object.assign({}, x, { k: TA.Layout.label(x.k, plan.language).main })).filter((x) => fits(x.k)).slice(0, 6)
    };
    if (!spots.keys.length && !spots.pairs.length) return null;

    const all = TA.WordSource.allWords(plan.language);
    const scored = all.map((w) => ({ w, s: wordScore(w, spots) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const pool = scored.slice(0, Math.max(40, Math.min(150, Math.floor(scored.length * 0.4)))).map((x) => x.w);
    if (pool.length < 8) return null;

    const normal = TA.WordSource.createGenerator({ language: plan.language, wordList: 'common' });
    let bag = [];
    const recent = [];
    const gen = {
      focus: [...spots.pairs.slice(0, 4).map((x) => x.k), ...spots.keys.slice(0, 3).map((x) => x.k)],
      next() {
        if (Math.random() < 0.25) return normal.next();
        for (let i = 0; i < 10; i++) {
          if (!bag.length) bag = shuffle(pool);
          const w = bag.pop();
          if (!recent.includes(w) || i === 9) {
            recent.push(w); if (recent.length > 8) recent.shift();
            return w;
          }
        }
        return pool[0];
      },
      take(n) { const a = []; for (let i = 0; i < n; i++) a.push(this.next()); return a; }
    };
    return gen;
  }

  /* ======================= rendering: heatmap ======================= */

  let labelLang = 'english';
  const keyLabel = (k) => (k === ' ' ? 'space' : TA.Layout.label(k, labelLang).main);

  function keyTitle(k, e) {
    const name = keyLabel(k);
    if (!e || !total(e)) return `${name} — no data`;
    return `${name} — ${Math.round(total(e))} presses, ${Math.round(e[1])} errors (${round(errRate(e) * 100, 1)}%)` +
      (e[3] ? `, avg ${Math.round(avgMs(e))} ms` : '');
  }

  /** 0‥1 intensity for a key in the chosen view. Speed view: negative = faster than average. */
  function keyLevel(e, view, avg) {
    if (!e || total(e) < 2) return null;
    if (view === 'errors') return Math.min(1, errRate(e) / 0.15);
    if (!e[3] || !avg) return null;
    const ratio = avgMs(e) / avg;
    return Math.max(-1, Math.min(1, (ratio - 1) / 0.5));
  }

  function renderHeatmap(root, keys, view) {
    root.textContent = '';
    const avg = globalAvgMs(keys || {});
    let i = 0;
    const makeKey = (k, extraClass = '') => {
      const e = keys ? keys[k] : null;
      const lvl = keyLevel(e, view, avg);
      const node = el('div', {
        class: `hm-key${extraClass}${lvl === null ? ' is-empty' : ''}`,
        title: keyTitle(k, e),
        style: `--i:${i++}`
      }, [el('span', { text: keyLabel(k) })]);
      if (lvl !== null) {
        if (view === 'errors') node.style.setProperty('--heat', `color-mix(in srgb, var(--error) ${Math.round(8 + lvl * 82)}%, var(--surface-2))`);
        else if (lvl >= 0) node.style.setProperty('--heat', `color-mix(in srgb, var(--warning) ${Math.round(10 + lvl * 80)}%, var(--surface-2))`);
        else node.style.setProperty('--heat', `color-mix(in srgb, var(--accent) ${Math.round(10 + -lvl * 70)}%, var(--surface-2))`);
        if (lvl > 0.55) node.classList.add('is-hot');
      }
      return node;
    };
    ROWS.forEach((row, r) => {
      root.append(el('div', { class: `hm-row hm-row--${r}` }, [...row].map((k) => makeKey(k))));
    });
    root.append(el('div', { class: 'hm-row' }, [makeKey(' ', ' hm-key--space')]));
  }

  function heatLegend(view) {
    if (view === 'errors') {
      return el('div', { class: 'hm-legend' }, [el('span', { text: '0%' }), el('i', { class: 'hm-legend__bar hm-legend__bar--err' }), el('span', { text: '15%+ errors' })]);
    }
    return el('div', { class: 'hm-legend' }, [el('span', { text: 'faster' }), el('i', { class: 'hm-legend__bar hm-legend__bar--speed' }), el('span', { text: 'slower than your average' })]);
  }

  /** A heatmap block with an errors / speed switch. */
  function heatmapBlock(keys, language) {
    labelLang = language || 'english';
    const wrap = el('div', { class: 'hm' });
    const board = el('div', { class: 'hm-board' });
    const legendSlot = el('div');
    let view = 'errors';
    const buttons = ['errors', 'speed'].map((v) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(v === view), text: v,
      onclick: () => { view = v; buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === v))); draw(); }
    }));
    const drawLang = language || 'english';
    function draw() {
      labelLang = drawLang;
      renderHeatmap(board, keys, view);
      legendSlot.textContent = '';
      legendSlot.append(heatLegend(view));
    }
    wrap.append(el('div', { class: 'hm-switch' }, buttons), board, legendSlot);
    draw();
    return wrap;
  }

  /* ======================= rendering: fingers ======================= */

  function fingerBlock(keys) {
    const stats = fingerStats(keys);
    const avg = globalAvgMs(keys || {});
    const node = (f) => {
      const e = stats[f.id];
      const has = total(e) >= 3;
      const rate = errRate(e);
      const lvl = has ? Math.min(1, rate / 0.12) : 0;
      const slow = has && e[3] && avg ? avgMs(e) / avg : 0;
      return el('div', {
        class: `finger${has ? '' : ' is-empty'}${f.id === 'th' ? ' finger--thumb' : ''}`,
        title: has ? `${f.name}: ${round(rate * 100, 1)}% errors, avg ${Math.round(avgMs(e))} ms (${Math.round(total(e))} presses)` : `${f.name}: no data`
      }, [
        el('div', {
          class: 'finger__shape',
          style: `--h:${f.h}%;--heat:color-mix(in srgb, var(--error) ${Math.round(10 + lvl * 80)}%, var(--surface-2))`
        }, [el('span', { class: 'finger__pct', text: has ? `${round(rate * 100, 1)}%` : '—' })]),
        el('span', { class: 'finger__ms', text: has && e[3] ? `${Math.round(avgMs(e))}ms` : '' }),
        slow > 1.15 ? el('span', { class: 'finger__slow', text: 'slow' }) : null
      ]);
    };

    const left = FINGERS.filter((f) => f.hand === 'L');
    const right = FINGERS.filter((f) => f.hand === 'R');
    const thumb = FINGERS.find((f) => f.id === 'th');

    // Verdict: weakest finger by error rate (ignores fingers with little data)
    const ranked = FINGERS.filter((f) => f.id !== 'th' && total(stats[f.id]) >= 10)
      .map((f) => ({ f, rate: errRate(stats[f.id]), ms: avgMs(stats[f.id]) }))
      .sort((a, b) => b.rate - a.rate);
    let verdict = 'Not enough data yet — type a bit more.';
    if (ranked.length) {
      const worst = ranked[0];
      const slowest = ranked.slice().sort((a, b) => b.ms - a.ms)[0];
      verdict = worst.rate > 0
        ? `Weakest finger: ${worst.f.name} (${round(worst.rate * 100, 1)}% errors).`
        : 'No finger errors — clean!';
      if (slowest && slowest.ms) verdict += ` Slowest: ${slowest.f.name} (${Math.round(slowest.ms)} ms).`;
    }

    return el('div', { class: 'fingers' }, [
      el('div', { class: 'hands' }, [
        el('div', { class: 'hand hand--left' }, [...left.map(node)]),
        el('div', { class: 'hand hand--thumb' }, [node(thumb)]),
        el('div', { class: 'hand hand--right' }, [...right.map(node)])
      ]),
      el('div', { class: 'hands__labels' }, [el('span', { text: 'left hand' }), el('span', { text: 'right hand' })]),
      el('p', { class: 'analysis__verdict', text: verdict })
    ]);
  }

  /* ======================= rendering: fatigue chart ======================= */

  const charts = {};
  function drawFatigue(container, textNode, result) {
    const f = fatigue(result);
    textNode.textContent = fatigueText(f);
    textNode.className = 'analysis__verdict' + (f.ok && f.drop >= 8 ? ' is-bad' : f.ok ? ' is-good' : '');
    if (!f.ok) {
      if (charts[container.id]) { charts[container.id].destroy(); delete charts[container.id]; }
      container.textContent = '';
      container.append(el('div', { class: 'chart__empty', text: 'Take a 30s or longer test to see your fatigue curve.' }));
      return;
    }
    const labels = f.raw.map((_, i) => `${i + 1}s`);
    const base = f.raw.map(() => round(f.baseline, 1));
    const options = {
      labels,
      series: [
        { name: 'raw', data: f.raw.map((v) => round(v, 1)), color: '--chart-2', width: 1, dashed: true },
        { name: 'trend', data: f.smooth.map((v) => round(v, 1)), color: f.drop >= 8 ? '--chart-3' : '--chart-1', fill: true, width: 2.5 },
        { name: 'start pace', data: base, color: '--warning', width: 1.2, dashed: true }
      ],
      left: { min: 0 },
      animate: true,
      tooltip: (i) => `<div>${labels[i]}${f.onset && i + 1 === f.onset ? ' — slowdown starts' : ''}</div>` +
        `trend: <b>${Math.round(f.smooth[i])}</b><br>raw: <b>${Math.round(f.raw[i])}</b><br>start pace: <b>${Math.round(f.baseline)}</b>`
    };
    if (charts[container.id] && charts[container.id].container === container) charts[container.id].update(options);
    else { container.textContent = ''; charts[container.id] = new TA.Chart(container, options); }
  }

  /* ======================= rendering: weak-spot list ======================= */

  function weakList(items, avg, isKeys) {
    if (!items.length) return el('p', { class: 'muted small', text: 'Nothing weak detected yet.' });
    const max = items[0].score;
    return el('ol', { class: 'rank-list weak-list' }, items.map((x) => el('li', { title: keyTitle(x.k, x.e) }, [
      el('span', { class: 'rank-key', text: isKeys ? keyLabel(x.k) : x.k }),
      el('span', { class: 'rank-bar', style: `width:${Math.max(6, (x.score / max) * 100)}%` }),
      el('span', { class: 'rank-count weak-meta', text: `${round(errRate(x.e) * 100, 1)}%${x.e[3] && avg ? ` · ${Math.round(avgMs(x.e))}ms` : ''}` })
    ])));
  }

  /* ======================= public API ======================= */

  const Analysis = {
    FINGERS,
    createRecorder: (language) => new Recorder(language),
    createPracticeGenerator,
    weakSpots,
    fatigue,
    get profile() { return profile; },

    /** Called after a saved test: merge its stats into the long-term profile. */
    record(result, recorder) {
      if (!recorder) return;
      mergeInto(profile.keys, recorder.keys);
      mergeInto(profile.pairs, recorder.pairs);
      profile.tests++;
      const f = fatigue(result);
      if (f.ok && f.n >= 30) {
        profile.fatigue.push({ ts: result.ts, drop: f.drop, onset: f.onset, n: f.n });
        profile.fatigue = profile.fatigue.slice(-30);
      }
      TA.Storage.set(TA.Storage.KEYS.analysis, profile);
    },

    reload() { profile = TA.Storage.get(TA.Storage.KEYS.analysis, EMPTY_PROFILE, sanitizeProfile); },

    reset() {
      profile = JSON.parse(JSON.stringify(EMPTY_PROFILE));
      TA.Storage.remove(TA.Storage.KEYS.analysis);
    },

    /** Results page: analysis of one test. */
    renderResult(result) {
      const root = $('#resultAnalysis');
      if (!root) return;
      const keys = result.analysis && result.analysis.keys;
      $('#anaHeatmap').textContent = '';
      $('#anaFingers').textContent = '';
      if (keys) {
        $('#anaHeatmap').append(heatmapBlock(keys, result.language));
        $('#anaFingers').append(fingerBlock(keys));
      } else {
        const msg = 'Key analysis is only available for tests taken after the analysis update.';
        $('#anaHeatmap').append(el('p', { class: 'muted small', text: msg }));
        $('#anaFingers').append(el('p', { class: 'muted small', text: msg }));
      }
      drawFatigue($('#anaFatigueChart'), $('#anaFatigueText'), result);
    },

    /** Dashboard → Analysis tab: long-term profile. */
    renderDashboard() {
      const root = $('#analysisDash');
      if (!root) return;
      root.textContent = '';
      const keysTyped = Math.round(Object.values(profile.keys).reduce((s, e) => s + total(e), 0));
      if (keysTyped < 20) {
        root.append(el('div', { class: 'empty' }, [
          el('p', { text: 'No analysis data yet. Finish a few tests and your keyboard, finger and weak-spot analysis will appear here.' }),
          el('a', { class: 'btn btn--primary', href: '#test', text: 'Start typing' })
        ]));
        return;
      }
      const spots = weakSpots(profile, 8);
      labelLang = TA.App.getConfig().language;
      const ready = keysTyped >= MIN_PROFILE_KEYS;

      // Fatigue summary over recent long tests
      const fat = profile.fatigue.slice(-10);
      let fatText = 'Take tests of 30 seconds or longer to measure fatigue.';
      if (fat.length) {
        const avgDrop = mean(fat.map((f) => f.drop));
        const onsets = fat.map((f) => f.onset).filter(Boolean);
        fatText = avgDrop >= 5
          ? `In your last ${fat.length} long tests you lost on average ${Math.round(avgDrop)}% speed by the end` +
            (onsets.length ? `, usually after ~${Math.round(mean(onsets))}s.` : '.')
          : `In your last ${fat.length} long tests your speed stayed steady (avg change ${avgDrop > 0 ? '-' : '+'}${Math.abs(Math.round(avgDrop))}%).`;
      }

      root.append(
        el('div', { class: 'panel analysis-cta' }, [
          el('div', {}, [
            el('h2', { class: 'panel__title', text: 'Smart practice' }),
            el('p', { class: 'analysis-cta__text' }, ready && (spots.pairs.length || spots.keys.length)
              ? ['Your focus right now: ', ...[...spots.pairs.slice(0, 4).map((x) => x.k), ...spots.keys.slice(0, 3).map((x) => keyLabel(x.k))].map((k) => el('kbd', { class: 'focus-key', text: k }))]
              : [`Collecting data… ${Math.min(keysTyped, MIN_PROFILE_KEYS)}/${MIN_PROFILE_KEYS} keystrokes before practice becomes personal.`])
          ]),
          el('button', { type: 'button', class: 'btn btn--primary', text: 'Practice weak spots', onclick: () => TA.App.startPractice() })
        ]),
        el('div', { class: 'panel' }, [
          el('h2', { class: 'panel__title', text: `Keyboard heatmap (all tests, ${keysTyped.toLocaleString('en-US')} keys)` }),
          heatmapBlock(profile.keys, TA.App.getConfig().language)
        ]),
        el('div', { class: 'dash-grid' }, [
          el('div', { class: 'panel' }, [el('h2', { class: 'panel__title', text: 'Fingers' }), fingerBlock(profile.keys)]),
          el('div', { class: 'panel' }, [
            el('h2', { class: 'panel__title', text: 'Fatigue' }),
            el('p', { class: 'analysis__verdict', text: fatText }),
            fat.length ? el('div', { class: 'fatigue-bars' }, fat.map((f) => el('span', {
              class: f.drop >= 8 ? 'is-bad' : '',
              style: `--v:${Math.min(100, Math.max(4, Math.abs(f.drop) * 3))}%`,
              title: `${TA.Utils.formatShortDate(f.ts)} — ${f.drop > 0 ? '-' : '+'}${Math.abs(Math.round(f.drop))}%${f.onset ? ` after ${f.onset}s` : ''}`
            }))) : null
          ])
        ]),
        el('div', { class: 'dash-grid' }, [
          el('div', { class: 'panel' }, [el('h2', { class: 'panel__title', text: 'Weakest letter pairs' }), weakList(spots.pairs, spots.avg)]),
          el('div', { class: 'panel' }, [el('h2', { class: 'panel__title', text: 'Weakest keys' }), weakList(spots.keys, spots.avg, true)])
        ]),
        el('div', { class: 'center' }, [el('button', {
          type: 'button', class: 'btn btn--danger btn--sm', text: 'Reset analysis data',
          onclick: async () => {
            const ok = await TA.UI.confirm({ title: 'Reset analysis data?', text: 'Heatmap, finger and weak-spot data will be cleared. Your test history stays.', confirmLabel: 'Reset' });
            if (!ok) return;
            Analysis.reset();
            Analysis.renderDashboard();
            TA.UI.toast({ title: 'Analysis data cleared' });
          }
        })])
      );
    }
  };

  TA.Analysis = Analysis;
})(window.TA = window.TA || {});
