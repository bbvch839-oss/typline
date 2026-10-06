/*
 * achievements.js — achievement definitions, unlocking and rendering.
 * To add one: push a new object into DEFINITIONS with a unique id and a
 * `test(ctx)` function. ctx = { result, history, summary, streak }.
 */
(function (TA) {
  'use strict';
  const { el, formatDate } = TA.Utils;
  const { Storage, Statistics } = TA;

  // A result only counts for speed/accuracy achievements if it was a real effort
  const serious = (r) => r && !r.failed && r.duration >= 15;

  const DEFINITIONS = [
    { id: 'first-test', icon: '✦', name: 'First Steps', desc: 'Complete your first test.', test: (c) => c.summary.count >= 1 },
    { id: 'tests-10', icon: '⌁', name: 'Warming Up', desc: 'Complete 10 tests.', test: (c) => c.summary.count >= 10 },
    { id: 'tests-50', icon: '⌬', name: 'Regular', desc: 'Complete 50 tests.', test: (c) => c.summary.count >= 50 },
    { id: 'tests-100', icon: '❖', name: 'Centurion', desc: 'Complete 100 tests.', test: (c) => c.summary.count >= 100 },
    { id: 'tests-500', icon: '♛', name: 'Devoted', desc: 'Complete 500 tests.', test: (c) => c.summary.count >= 500 },

    { id: 'wpm-50', icon: '➶', name: '50 WPM', desc: 'Reach 50 WPM in a test of at least 15 seconds.', test: (c) => serious(c.result) && c.result.wpm >= 50 },
    { id: 'wpm-75', icon: '➹', name: '75 WPM', desc: 'Reach 75 WPM in a test of at least 15 seconds.', test: (c) => serious(c.result) && c.result.wpm >= 75 },
    { id: 'wpm-100', icon: '⚡', name: '100 WPM', desc: 'Reach 100 WPM in a test of at least 15 seconds.', test: (c) => serious(c.result) && c.result.wpm >= 100 },
    { id: 'wpm-120', icon: '☄', name: '120 WPM', desc: 'Reach 120 WPM in a test of at least 15 seconds.', test: (c) => serious(c.result) && c.result.wpm >= 120 },
    { id: 'wpm-150', icon: '✺', name: '150 WPM', desc: 'Reach 150 WPM in a test of at least 15 seconds.', test: (c) => serious(c.result) && c.result.wpm >= 150 },

    { id: 'acc-95', icon: '◎', name: 'Sharp', desc: '95% accuracy or more (at least 15 s, 30+ wpm).', test: (c) => serious(c.result) && c.result.wpm >= 30 && c.result.acc >= 95 },
    { id: 'acc-99', icon: '◉', name: 'Precise', desc: '99% accuracy or more (at least 15 s, 30+ wpm).', test: (c) => serious(c.result) && c.result.wpm >= 30 && c.result.acc >= 99 },
    { id: 'acc-100', icon: '✔', name: 'Flawless', desc: '100% accuracy in a 30 s+ test (30+ wpm).', test: (c) => c.result && !c.result.failed && c.result.duration >= 30 && c.result.wpm >= 30 && c.result.acc >= 100 },
    { id: 'consistency-85', icon: '≋', name: 'Metronome', desc: '85% consistency in a 30 s+ test.', test: (c) => c.result && !c.result.failed && c.result.duration >= 30 && c.result.consistency >= 85 },

    { id: 'time-1h', icon: '◷', name: '1 Hour Typing', desc: 'Spend 1 hour typing in total.', test: (c) => c.summary.totals.time >= 3600 },
    { id: 'time-10h', icon: '◶', name: '10 Hours Typing', desc: 'Spend 10 hours typing in total.', test: (c) => c.summary.totals.time >= 36000 },

    { id: 'streak-3', icon: '☀', name: 'On a Roll', desc: 'Type 3 days in a row.', test: (c) => c.streak.longest >= 3 },
    { id: 'streak-7', icon: '☼', name: 'Week Streak', desc: 'Type 7 days in a row.', test: (c) => c.streak.longest >= 7 },
    { id: 'streak-30', icon: '✹', name: 'Habit Formed', desc: 'Type 30 days in a row.', test: (c) => c.streak.longest >= 30 },

    { id: 'quote', icon: '❝', name: 'Well Quoted', desc: 'Finish a quote test.', test: (c) => c.result && c.result.mode === 'quote' && !c.result.failed },
    { id: 'marathon', icon: '∞', name: 'Marathon', desc: 'Finish a 120 second test.', test: (c) => c.result && c.result.mode === 'time' && c.result.mode2 === '120' && !c.result.failed },
    { id: 'hard-mode', icon: '✚', name: 'No Mistakes Allowed', desc: 'Finish a Hard difficulty test of 25+ words.', test: (c) => c.result && c.result.difficulty === 'hard' && !c.result.failed && c.result.wordsTyped >= 25 }
  ];

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad achievements');
    const clean = {};
    for (const [id, ts] of Object.entries(raw)) if (Number.isFinite(ts)) clean[id] = ts;
    return clean;
  }

  let unlocked = Storage.get(Storage.KEYS.achievements, {}, sanitize);

  const Achievements = {
    DEFINITIONS,

    reload() { unlocked = Storage.get(Storage.KEYS.achievements, {}, sanitize); },

    isUnlocked(id) { return id in unlocked; },
    unlockedCount() { return DEFINITIONS.filter((d) => d.id in unlocked).length; },

    /** Check all achievements after a test; returns newly unlocked ones. */
    evaluate(result, history) {
      const ctx = {
        result,
        history,
        summary: Statistics.summary(history),
        streak: Statistics.streaks(history)
      };
      const fresh = [];
      for (const def of DEFINITIONS) {
        if (def.id in unlocked) continue;
        let ok = false;
        try { ok = def.test(ctx); } catch (err) { ok = false; }
        if (ok) {
          unlocked[def.id] = Date.now();
          fresh.push(def);
        }
      }
      if (fresh.length) {
        Storage.set(Storage.KEYS.achievements, unlocked);
        setTimeout(() => {
          TA.Sound.event('achievement');
          TA.Effects.confetti({ count: 70, origin: { x: 0.85, y: 0.85 } });
        }, 1200);
        fresh.forEach((def, i) => setTimeout(() => {
          TA.UI.toast({ title: `Achievement unlocked: ${def.name}`, text: def.desc, icon: def.icon, type: 'achievement', duration: 5000 });
        }, 400 + i * 350));
      }
      return fresh;
    },

    render(grid, summaryEl) {
      grid.textContent = '';
      const frag = document.createDocumentFragment();
      for (const def of DEFINITIONS) {
        const ts = unlocked[def.id];
        frag.append(el('li', { class: `ach ${ts ? 'is-unlocked' : 'is-locked'}` }, [
          el('span', { class: 'ach__icon', 'aria-hidden': 'true', text: ts ? def.icon : '?' }),
          el('div', {}, [
            el('div', { class: 'ach__name', text: def.name }),
            el('div', { class: 'ach__desc', text: def.desc }),
            ts ? el('div', { class: 'ach__date', text: `unlocked ${formatDate(ts)}` }) : el('span', { class: 'visually-hidden', text: 'locked' })
          ])
        ]));
      }
      grid.append(frag);
      if (summaryEl) summaryEl.textContent = `${Achievements.unlockedCount()} of ${DEFINITIONS.length} unlocked`;
    }
  };

  TA.Achievements = Achievements;
})(window.TA = window.TA || {});
