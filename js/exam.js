/*
 * exam.js — Certification exam. Certificates are ONLY issued by this exam.
 *
 * Rules
 *  - Unlocked after 10 saved tests (so the exam is not someone's first try).
 *  - Max 3 attempts per day. Starting an attempt uses it up (also if you quit).
 *  - Your name is fixed when the exam starts and cannot be edited later.
 *  - 2 rounds × 60 seconds on a fresh random text in the chosen language:
 *      round 1 — plain words, round 2 — punctuation and numbers.
 *  - Keyboard guide, ghost and hints are hidden; restarting is not possible.
 *  - Switching window / tab or leaving the test page voids the attempt.
 *  - Anti-cheat: input without real key presses (paste, auto-typers),
 *    machine-like perfectly even rhythm, or impossible speed void the attempt.
 *  - Result = average speed of both rounds + overall accuracy. A level is
 *    passed only if BOTH the speed and the accuracy requirement are met, and
 *    no single round falls more than 2 % under the accuracy requirement.
 */
(function (TA) {
  'use strict';
  const { $, el, round, mean, stdDev, dayKey, uid } = TA.Utils;

  const LEVELS = [
    { name: 'Beginner', wpm: 30, acc: 92 },
    { name: 'Intermediate', wpm: 45, acc: 94 },
    { name: 'Advanced', wpm: 60, acc: 95 },
    { name: 'Expert', wpm: 80, acc: 96 },
    { name: 'Master', wpm: 100, acc: 97 }
  ];
  const ROUNDS = [
    { label: 'Round 1 — words', punctuation: false, numbers: false },
    { label: 'Round 2 — punctuation and numbers', punctuation: true, numbers: true }
  ];
  const ROUND_SEC = 60;
  const MAX_ATTEMPTS = 3;
  const UNLOCK_TESTS = 10;
  const SALT = 'bbvch-type/exam/v1';

  let state = null; // running exam

  /* ======================= storage ======================= */

  const K = TA.Storage.KEYS;
  function attemptsToday() {
    const a = TA.Storage.get(K.exam, {}, (x) => (x && typeof x === 'object' ? x : {}));
    return a.day === dayKey() ? a.attempts || 0 : 0;
  }
  function useAttempt() {
    TA.Storage.set(K.exam, { day: dayKey(), attempts: attemptsToday() + 1 });
  }
  function certificates() {
    return TA.Storage.get(K.certificates, [], (x) => (Array.isArray(x) ? x.filter((c) => c && Number.isFinite(c.wpm) && typeof c.name === 'string') : []));
  }

  /** Short verification code tied to the certificate data (changing any field breaks it). */
  function codeFor(c) {
    const text = `${SALT}|${c.id}|${c.name}|${c.wpm}|${c.acc}|${c.level}|${c.ts}|${c.language}`;
    let h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ ch, 0x5bd1e995) >>> 0;
    }
    const s = (h1.toString(36) + h2.toString(36)).toUpperCase().padEnd(12, '7').slice(0, 12);
    return `BT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  }

  /* ======================= status ======================= */

  function status() {
    const tests = TA.History.all().length;
    const left = Math.max(0, MAX_ATTEMPTS - attemptsToday());
    return { tests, unlocked: tests >= UNLOCK_TESTS, left, needTests: UNLOCK_TESTS };
  }

  /* ======================= running the exam ======================= */

  function banner() {
    const b = $('#examBanner');
    if (!state) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = '';
    b.append(
      el('span', { class: 'exam-banner__dot' }),
      el('b', { text: 'Certification exam' }),
      el('span', { class: 'exam-banner__round', text: ROUNDS[state.round].label }),
      el('span', { class: 'exam-banner__warn', text: 'Do not switch windows — the attempt will be voided.' })
    );
  }

  function onLeave() {
    if (state && TA.App.engine.inProgress) Exam.fail('You switched to another window or tab during the exam.');
  }
  function onVisibility() { if (document.hidden) onLeave(); }

  function startRound(i) {
    state.round = i;
    const r = ROUNDS[i];
    banner();
    TA.App.runExamRound({
      mode: 'exam', examRound: i + 1, language: state.language, wordList: 'common',
      punctuation: r.punctuation, numbers: r.numbers, difficulty: 'easy', time: ROUND_SEC
    });
  }

  function modal(children, { onClose } = {}) {
    const body = $('#examModalBody');
    body.textContent = '';
    body.append(...children.filter(Boolean));
    // buttons wake up after a moment so keys still being typed can't press them
    const buttons = [...body.querySelectorAll('button')].filter((b) => !b.disabled);
    buttons.forEach((b) => { b.disabled = true; });
    setTimeout(() => buttons.forEach((b) => { b.disabled = false; }), 1300);
    TA.UI.Modal.open('examModal', { onClose });
  }

  function roundCard(r, i) {
    return el('div', { class: 'exam-round' }, [
      el('span', { class: 'exam-round__n', text: String(i + 1) }),
      el('div', {}, [el('b', { 'data-no-i18n': '', text: `${Math.round(r.wpm)} wpm` }), el('span', { 'data-no-i18n': '', text: ` · ${round(r.acc, 1)}%` })])
    ]);
  }

  /** Detect paste / auto-typers / robotic rhythm. Returns a reason or null. */
  function cheatCheck(result, engine) {
    const typed = result.keystrokes[0] + result.keystrokes[1];
    if (engine.kd < typed * 0.9) return 'Typing without real key presses was detected (paste or an auto-typer).';
    const gaps = engine.kdGaps.filter((g) => g > 5 && g < 1000);
    if (gaps.length >= 60) {
      const cv = stdDev(gaps) / mean(gaps);
      if (cv < 0.12) return 'Your typing rhythm is too perfectly even — it looks automated.';
    }
    if (result.wpm > 250) return 'This speed is not humanly possible.';
    if (result.duration < ROUND_SEC - 1) return 'The round did not run for the full time.';
    return null;
  }

  function evaluate() {
    const rs = state.results;
    const wpm = mean(rs.map((r) => r.wpm));
    const correct = rs.reduce((s, r) => s + r.keystrokes[0], 0);
    const total = rs.reduce((s, r) => s + r.keystrokes[0] + r.keystrokes[1], 0);
    const acc = total ? (correct / total) * 100 : 0;
    const minAcc = Math.min(...rs.map((r) => r.acc));
    let level = -1;
    LEVELS.forEach((L, i) => { if (wpm >= L.wpm && acc >= L.acc && minAcc >= L.acc - 2) level = i; });
    return { wpm: round(wpm, 1), acc: round(acc, 2), minAcc, level, consistency: round(mean(rs.map((r) => r.consistency)), 1) };
  }

  function finishExam() {
    const res = evaluate();
    const rounds = state.results.map((r, i) => roundCard(r, i));
    const name = state.name;
    const language = state.language;
    Exam.end();
    if (res.level < 0) {
      const need = LEVELS[0];
      modal([
        el('div', { class: 'exam-result exam-result--fail' }, [
          el('div', { class: 'exam-result__icon', text: '✕' }),
          el('h2', { text: 'Not passed' }),
          el('p', { class: 'exam-result__big', 'data-no-i18n': '', text: `${Math.round(res.wpm)} wpm · ${round(res.acc, 1)}%` }),
          el('p', { class: 'muted', text: 'The lowest certificate level needs:' }),
          el('p', { 'data-no-i18n': '', text: `${need.wpm} wpm · ${need.acc}%` }),
          el('div', { class: 'exam-rounds' }, rounds),
          el('p', { class: 'muted small' }, [el('span', { text: 'attempts left today' }), ' ', el('b', { 'data-no-i18n': '', text: String(status().left) })]),
          el('button', { type: 'button', class: 'btn', text: 'Close', onclick: () => { TA.UI.Modal.close('examModal'); TA.App.openCertificates(); } })
        ])
      ]);
      TA.Sound.event('fail');
      return;
    }
    const cert = {
      id: uid(), exam: true, name, language, ts: Date.now(),
      wpm: res.wpm, acc: res.acc, consistency: res.consistency, level: res.level, rounds: ROUNDS.length
    };
    cert.code = codeFor(cert);
    const list = certificates();
    list.push(cert);
    TA.Storage.set(K.certificates, list);
    modal([
      el('div', { class: 'exam-result exam-result--pass' }, [
        el('div', { class: 'exam-result__icon', text: '✓' }),
        el('h2', { text: 'Exam passed!' }),
        el('p', { class: 'exam-result__level', text: LEVELS[res.level].name }),
        el('p', { class: 'exam-result__big', 'data-no-i18n': '', text: `${Math.round(res.wpm)} wpm · ${round(res.acc, 1)}%` }),
        el('div', { class: 'exam-rounds' }, rounds),
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Open certificate',
          onclick: () => { TA.UI.Modal.close('examModal'); setTimeout(() => TA.Certificate.open(cert), 250); }
        })
      ])
    ]);
    TA.Sound.event('pb');
    setTimeout(() => TA.Effects.confetti(), 300);
    TA.Certificate.renderDashboard();
  }

  /* ======================= public ======================= */

  const Exam = {
    LEVELS,
    ROUNDS,
    ROUND_SEC,
    MAX_ATTEMPTS,
    status,
    certificates,
    codeFor,
    get active() { return !!state; },

    start(name, language) {
      const st = status();
      if (!st.unlocked || !st.left || state) return;
      useAttempt();
      state = { name: name.trim().slice(0, 40), language, round: 0, results: [] };
      document.body.classList.add('is-exam');
      window.addEventListener('blur', onLeave);
      document.addEventListener('visibilitychange', onVisibility);
      startRound(0);
    },

    /** Called by app.js when a round (60 s) finishes. */
    roundFinished(result, engine) {
      if (!state) return;
      const reason = cheatCheck(result, engine);
      if (reason) { Exam.fail(reason); return; }
      state.results.push(result);
      if (state.round + 1 < ROUNDS.length) {
        const next = state.round + 1;
        const last = result;
        let started = false;
        let ready = false;
        const btn = el('button', { type: 'button', class: 'btn btn--primary', text: 'Continue', disabled: true });
        const go = () => { if (started || !state) return; started = true; TA.UI.Modal.close('examModal'); startRound(next); };
        btn.addEventListener('click', () => { if (ready) go(); });
        // keys still being typed when time ran out must not skip this screen
        setTimeout(() => { ready = true; btn.disabled = false; btn.focus(); }, 1500);
        const show = () => modal([
          el('div', { class: 'exam-result' }, [
            el('p', { class: 'exam-result__kicker', text: 'Round complete' }),
            el('p', { class: 'exam-result__big', 'data-no-i18n': '', text: `${Math.round(last.wpm)} wpm · ${round(last.acc, 1)}%` }),
            el('p', { class: 'muted', text: ROUNDS[next].label }),
            el('p', { class: 'muted small', text: 'The round starts with your first key press. Take a breath.' }),
            btn
          ])
        ], { onClose: () => { if (!started && state) setTimeout(show, 0); } }); // cannot be dismissed, only continued
        TA.App.engine.dom.input.blur();
        show();
        return;
      }
      finishExam();
    },

    /** Void the attempt. */
    fail(reason) {
      if (!state) return;
      TA.App.engine.abort();
      Exam.end();
      modal([
        el('div', { class: 'exam-result exam-result--fail' }, [
          el('div', { class: 'exam-result__icon', text: '!' }),
          el('h2', { text: 'Attempt voided' }),
          el('p', { text: reason }),
          el('p', { class: 'muted small' }, [el('span', { text: 'attempts left today' }), ' ', el('b', { 'data-no-i18n': '', text: String(status().left) })]),
          el('button', { type: 'button', class: 'btn', text: 'Close', onclick: () => { TA.UI.Modal.close('examModal'); TA.App.openCertificates(); } })
        ])
      ]);
      TA.Sound.event('fail');
    },

    async requestAbort() {
      const ok = await TA.UI.confirm({ title: 'Quit the exam?', text: 'The attempt will be lost and counts towards today\'s limit.', confirmLabel: 'Quit exam' });
      if (ok) Exam.fail('Exam cancelled.');
      else TA.App.engine.focus();
    },

    end() {
      state = null;
      document.body.classList.remove('is-exam');
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      banner();
      TA.App.endExam();
    }
  };

  TA.Exam = Exam;
})(window.TA = window.TA || {});
