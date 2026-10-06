/*
 * typing.js — the typing engine.
 *
 * Input model: a hidden <input> always contains " " + <current word input>.
 * The leading space is a sentinel: when it disappears the user pressed
 * Backspace on an empty word (this also works on mobile keyboards, which
 * often do not report key codes). Every `input` event is turned into a
 * diff (deletions + insertions) against the previous state, so fast typing,
 * autocorrect and IME input are handled the same way.
 *
 * DOM model: words are rendered once per test. On each keystroke only the
 * current word's letter classes are touched, and the caret is moved with
 * a CSS transform — no full re-render, no layout thrash.
 */
(function (TA) {
  'use strict';
  const { el, round } = TA.Utils;
  const { Statistics } = TA;

  const MAX_EXTRA = 20;              // max extra letters allowed per word
  const TIME_MODE_BUFFER = 40;       // keep at least this many words ahead in time mode
  const LIVE_THROTTLE_MS = 120;

  /* ------------------------------------------------------------
   * Test plan: turns the saved config into concrete test rules.
   * To add a new mode, add a case here and a button in index.html.
   * ------------------------------------------------------------ */
  function buildPlan(config) {
    const base = {
      language: config.language,
      wordList: config.wordList,
      punctuation: config.punctuation,
      numbers: config.numbers,
      difficulty: config.difficulty
    };
    switch (config.mode) {
      case 'words':
        return Object.assign(base, { mode: 'words', mode2: String(config.words), limitType: 'words', limit: config.words });
      case 'quote': {
        const quote = TA.WordSource.randomQuote(config.language, config.quoteLength);
        const words = TA.WordSource.splitText(quote.text);
        return Object.assign(base, {
          mode: 'quote', mode2: config.quoteLength, limitType: 'words', limit: words.length,
          fixedWords: words, quote, punctuation: true, numbers: false
        });
      }
      case 'custom': {
        const c = config.custom;
        const textWords = TA.WordSource.splitText(c.text);
        if (textWords.length) {
          if (c.type === 'time') {
            return Object.assign(base, { mode: 'custom', mode2: `time-${c.time}`, limitType: 'time', limit: c.time, loopWords: textWords, isCustomText: true });
          }
          return Object.assign(base, { mode: 'custom', mode2: 'text', limitType: 'words', limit: textWords.length, fixedWords: textWords, isCustomText: true });
        }
        return c.type === 'time'
          ? Object.assign(base, { mode: 'custom', mode2: `time-${c.time}`, limitType: 'time', limit: c.time })
          : Object.assign(base, { mode: 'custom', mode2: `words-${c.words}`, limitType: 'words', limit: c.words });
      }
      case 'exam':
        // Certification exam round (exam.js): fixed 60 s, fresh random text, no custom options
        return Object.assign(base, { mode: 'exam', mode2: `round-${config.examRound}`, limitType: 'time', limit: config.time, wordList: 'common', difficulty: 'easy', exam: true });
      case 'practice':
        // Smart practice: words built from your weak keys / letter pairs (analysis.js)
        return Object.assign(base, { mode: 'practice', mode2: String(config.practiceWords), limitType: 'words', limit: config.practiceWords, practice: true, punctuation: false, numbers: false });
      case 'time':
      default:
        return Object.assign(base, { mode: 'time', mode2: String(config.time), limitType: 'time', limit: config.time });
    }
  }

  /** Cycles through a fixed word list forever (custom text in time mode). */
  function loopingGenerator(words) {
    let i = 0;
    return { next: () => words[i++ % words.length], take(n) { const a = []; for (let k = 0; k < n; k++) a.push(this.next()); return a; } };
  }

  class TypingEngine {
    constructor({ input, viewport, track, wordsEl, caret, area, overlay }, callbacks) {
      this.dom = { input, viewport, track, wordsEl, caret, area, overlay };
      this.cb = Object.assign({ onStart() {}, onFinish() {}, onLive() {}, onFail() {} }, callbacks);
      this.timer = new TA.Timer({ onTick: (sec) => this.onTick(sec) });
      this.plan = null;
      this.initialWords = [];
      this.idleTimer = null;
      this.composing = false;
      this.liveFrame = 0;
      this.lastLive = 0;
      this.lineHeight = 0;
      this.scrollOffset = 0;

      this.handleInput = this.handleInput.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      input.addEventListener('input', this.handleInput);
      input.addEventListener('keydown', this.handleKeydown);
      input.addEventListener('compositionstart', () => { this.composing = true; });
      input.addEventListener('compositionend', () => { this.composing = false; this.handleInput(); });
      input.addEventListener('paste', (e) => e.preventDefault());
      input.addEventListener('drop', (e) => e.preventDefault());
      input.addEventListener('focus', () => this.setFocused(true));
      input.addEventListener('blur', () => this.setFocused(false));
      viewport.addEventListener('mousedown', (e) => { e.preventDefault(); this.focus(); });
      overlay.addEventListener('click', () => this.focus());

      // Re-measure when the layout changes (window resize, font size, theme font)
      this.resizeObserver = new ResizeObserver(TA.Utils.throttle(() => this.relayout(), 60));
      this.resizeObserver.observe(viewport);
      TA.Settings.onChange((key) => {
        if (key === 'caret' || key === '*') this.applyCaretStyle();
        if (['font', 'fontSize', '*'].includes(key)) requestAnimationFrame(() => this.relayout());
      });
      this.applyCaretStyle();
    }

    /* ======================= setup ======================= */

    /** Build a new test. `repeat` reuses the exact same words as the last test. */
    prepare(config, { repeat = false } = {}) {
      this.timer.reset();
      const keepPlan = repeat && this.plan;
      if (!keepPlan) this.plan = buildPlan(config);
      const plan = this.plan;

      this.generator = null;
      if (plan.loopWords) this.generator = loopingGenerator(plan.loopWords);
      else if (plan.practice) {
        // Falls back to normal words until there is enough analysis data
        const practice = keepPlan ? null : TA.Analysis.createPracticeGenerator(plan);
        if (!keepPlan) plan.focus = practice ? practice.focus : null;
        this.generator = practice || TA.WordSource.createGenerator(plan);
      } else if (!plan.fixedWords) this.generator = TA.WordSource.createGenerator(plan);

      if (keepPlan && this.initialWords.length) {
        this.words = this.initialWords.slice();
        if (plan.loopWords) this.generator.take(this.words.length); // keep loop position consistent
      } else if (plan.fixedWords) {
        this.words = plan.fixedWords.slice();
      } else if (plan.limitType === 'words') {
        this.words = this.generator.take(plan.limit);
      } else {
        this.words = this.generator.take(Math.max(80, Math.min(plan.limit * 3, 300)));
      }
      this.initialWords = this.words.slice();

      this.resetState();
      this.render();
      this.setFailedVisual(false);
      this.emitLive(true);
      return plan;
    }

    resetState() {
      this.index = 0;
      this.current = '';
      this.inputs = [];
      this.wordStats = [];
      this.started = false;
      this.finished = false;
      this.failed = false;
      this.keys = { total: 0, correct: 0, incorrect: 0 };
      this.committed = { correct: 0, incorrect: 0, extra: 0, missed: 0, spaces: 0, correctSpaces: 0 };
      this.sec = { keys: 0, errors: 0 };
      this.samples = { wpm: [], raw: [], acc: [], err: [] };
      this.missedKeys = {};
      this.missedWords = {};
      this.rec = TA.Analysis.createRecorder(this.plan && this.plan.language);
      this.trace = [];
      this.offsets = null;
      this.kd = 0;
      this.kdGaps = [];
      this.lastKd = 0;
      this.scrollOffset = 0;
      this.dom.input.value = ' ';
    }

    render() {
      const { wordsEl, track } = this.dom;
      this.wordEls = [];
      wordsEl.textContent = '';
      track.style.transform = 'translateY(0)';
      wordsEl.append(this.buildWords(this.words));
      // Staggered slide-in of the first visible words
      clearTimeout(this.enterTimer);
      wordsEl.classList.remove('is-entering');
      if (TA.Effects.on && document.documentElement.dataset.effects === 'on') {
        this.wordEls.slice(0, 45).forEach((w, i) => w.style.setProperty('--i', i));
        void wordsEl.offsetWidth;
        wordsEl.classList.add('is-entering');
        this.enterTimer = setTimeout(() => wordsEl.classList.remove('is-entering'), 1000);
      }
      this.wordEls[0] && this.wordEls[0].classList.add('is-active');
      this.lineHeight = 0;
      this.setIdle(true);
      requestAnimationFrame(() => this.relayout());
    }

    buildWords(words) {
      const frag = document.createDocumentFragment();
      for (const word of words) {
        const node = el('div', { class: 'word' });
        for (const ch of word) node.append(el('span', { class: 'ch', text: ch }));
        this.wordEls.push(node);
        frag.append(node);
      }
      return frag;
    }

    appendWords(count) {
      this.offsets = null;
      const extra = this.generator.take(count);
      this.words.push(...extra);
      this.dom.wordsEl.append(this.buildWords(extra));
    }

    applyCaretStyle() {
      const style = TA.Settings.get('caret');
      this.dom.caret.className = `caret caret--${style}` + (this.started ? '' : ' is-idle');
      this.moveCaret();
    }

    /* ======================= focus ======================= */

    focus() {
      if (this.finished) return;
      this.dom.input.focus({ preventScroll: true });
      const len = this.dom.input.value.length;
      try { this.dom.input.setSelectionRange(len, len); } catch (e) { /* ignore */ }
    }

    get isFocused() { return document.activeElement === this.dom.input; }

    setFocused(focused) {
      clearTimeout(this.blurTimer);
      if (focused) {
        this.dom.area.classList.remove('is-blurred');
        this.dom.overlay.hidden = true;
      } else {
        // small delay avoids flicker when focus moves between elements
        this.blurTimer = setTimeout(() => {
          if (this.isFocused || this.finished) return;
          this.dom.area.classList.add('is-blurred');
          this.dom.overlay.hidden = false;
        }, 400);
      }
    }

    /* ======================= input ======================= */

    handleKeydown(event) {
      if ((event.ctrlKey || event.altKey || event.metaKey) && event.key === 'Backspace') {
        event.preventDefault();
        this.deleteWord();
        this.syncInput();
        return;
      }
      if (event.key === 'Enter') event.preventDefault();
      // real key presses (the exam compares them with typed characters to catch paste / auto-typers)
      if (event.key.length === 1 || event.key === 'Backspace') {
        this.kd++;
        const now = performance.now();
        if (event.key.length === 1) { if (this.lastKd) this.kdGaps.push(now - this.lastKd); this.lastKd = now; }
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        TA.Keyboard.press(event.key, this.expectedChar() !== undefined && event.key !== this.expectedChar());
      }
    }

    handleInput() {
      if (this.composing || this.finished) { if (this.finished) this.syncInput(); return; }
      const value = this.dom.input.value;

      if (!value.startsWith(' ')) {
        // Sentinel removed → backspace on an empty word (or the whole value was replaced)
        const rest = value.replace(/^\s+/, '');
        if (this.current === '' && rest === '') this.goBack();
        else this.applyText(rest);
      } else {
        this.applyText(value.slice(1));
      }
      this.syncInput();
    }

    /** Diff new input text against current word and replay it as keystrokes. */
    applyText(text) {
      const old = this.current;
      let prefix = 0;
      const max = Math.min(old.length, text.length);
      while (prefix < max && old[prefix] === text[prefix]) prefix++;
      for (let i = old.length; i > prefix; i--) this.deleteChar();
      for (const ch of text.slice(prefix)) {
        if (this.finished) break;
        if (ch === ' ' || ch === '\n' || ch === '\t') this.submitWord();
        else this.typeChar(ch);
      }
    }

    syncInput() {
      const v = ' ' + this.current;
      if (this.dom.input.value !== v) {
        this.dom.input.value = v;
        // keep the text cursor at the end so the next character is appended
        try { this.dom.input.setSelectionRange(v.length, v.length); } catch (e) { /* ignore */ }
      }
    }

    expectedChar() {
      const target = this.words[this.index];
      if (target === undefined) return undefined;
      return this.current.length < target.length ? target[this.current.length] : ' ';
    }

    typeChar(ch) {
      const target = this.words[this.index];
      if (target === undefined) return;
      if (this.current.length >= target.length + MAX_EXTRA) return;
      if (!this.started) this.start();

      const expected = target[this.current.length];
      const correct = ch === expected;
      this.keys.total++;
      this.sec.keys++;
      if (correct) this.keys.correct++;
      else {
        this.keys.incorrect++;
        this.sec.errors++;
        if (expected !== undefined) this.missedKeys[expected] = (this.missedKeys[expected] || 0) + 1;
      }
      this.rec.key(expected, correct, this.current.length ? target[this.current.length - 1] : ' ');
      this.current += ch;
      TA.Sound.play(correct ? 'key' : 'error', ch);
      this.updateWord(this.index, false);
      this.afterKeystroke();

      if (!correct && this.plan.difficulty === 'hard') return this.fail('Hard mode: a wrong key ends the test.');

      // Finish as soon as the last word is typed correctly (no trailing space needed)
      if (this.isLastWord() && this.current === target) this.finish();
    }

    deleteChar() {
      if (!this.current.length) { this.goBack(); return; }
      this.current = this.current.slice(0, -1);
      this.rec.touch();
      TA.Sound.play('back');
      this.updateWord(this.index, false);
      this.afterKeystroke();
    }

    deleteWord() {
      if (this.finished) return;
      this.rec.touch();
      if (!this.current.length) {
        if (!this.goBack()) return;
      }
      this.current = '';
      this.updateWord(this.index, false);
      this.afterKeystroke();
    }

    submitWord() {
      if (!this.current.length) return; // ignore leading / double spaces
      const target = this.words[this.index];
      const spaceOk = this.current.length >= target.length;
      this.keys.total++;
      this.sec.keys++;
      if (spaceOk) this.keys.correct++;
      else {
        this.keys.incorrect++;
        this.sec.errors++;
        const expected = target[this.current.length];
        this.missedKeys[expected] = (this.missedKeys[expected] || 0) + 1;
      }
      this.rec.key(spaceOk ? ' ' : target[this.current.length], spaceOk, this.current[this.current.length - 1]);

      const stats = Statistics.compareWord(target, this.current, true);
      this.wordStats[this.index] = stats;
      this.inputs[this.index] = this.current;
      this.addCommitted(stats, 1);
      if (!stats.isCorrect) this.missedWords[target] = (this.missedWords[target] || 0) + 1;

      this.updateWord(this.index, true);
      this.wordEls[this.index].classList.remove('is-active');
      TA.Sound.play(stats.isCorrect ? 'space' : 'error');

      if (!stats.isCorrect && this.plan.difficulty === 'medium') {
        this.current = '';
        return this.fail('Medium mode: a submitted word had a mistake.');
      }

      this.index++;
      this.current = '';

      if (this.plan.limitType === 'words' && this.index >= this.words.length) {
        this.finish();
        return;
      }
      if (this.plan.limitType === 'time' && this.words.length - this.index < TIME_MODE_BUFFER) this.appendWords(60);

      this.wordEls[this.index].classList.add('is-active');
      this.afterKeystroke();
    }

    /** Move back into the previous word — only allowed if it contains a mistake. */
    goBack() {
      if (this.index === 0) return false;
      const prev = this.index - 1;
      const stats = this.wordStats[prev];
      if (!stats || stats.isCorrect) return false;
      this.addCommitted(stats, -1);
      this.wordEls[this.index] && this.wordEls[this.index].classList.remove('is-active');
      this.index = prev;
      this.current = this.inputs[prev] || '';
      this.wordStats[prev] = null;
      this.wordEls[prev].classList.add('is-active');
      this.updateWord(prev, false);
      this.afterKeystroke();
      return true;
    }

    addCommitted(stats, sign) {
      const c = this.committed;
      c.correct += sign * stats.correct;
      c.incorrect += sign * stats.incorrect;
      c.extra += sign * stats.extra;
      c.missed += sign * stats.missed;
      c.spaces += sign;
      if (stats.isCorrect) c.correctSpaces += sign;
    }

    isLastWord() {
      return this.plan.limitType === 'words' && this.index === this.words.length - 1;
    }

    /* ======================= DOM updates ======================= */

    /** Update classes of one word. `complete` = the word has been submitted. */
    updateWord(i, complete) {
      const node = this.wordEls[i];
      const target = this.words[i];
      const typed = i === this.index && !complete ? this.current : (this.inputs[i] || '');
      const letters = node.children;

      for (let j = 0; j < target.length; j++) {
        let cls = 'ch';
        if (j < typed.length) cls = typed[j] === target[j] ? 'ch ok' : 'ch bad';
        else if (complete) cls = 'ch missed';
        if (letters[j].className !== cls) letters[j].className = cls;
      }
      // extra letters
      const extraTyped = typed.length > target.length ? typed.slice(target.length) : '';
      let extraNodes = letters.length - target.length;
      while (extraNodes > extraTyped.length) { node.lastChild.remove(); extraNodes--; }
      for (let j = 0; j < extraTyped.length; j++) {
        const existing = letters[target.length + j];
        if (existing) { if (existing.textContent !== extraTyped[j]) existing.textContent = extraTyped[j]; }
        else node.append(el('span', { class: 'ch extra', text: extraTyped[j] }));
      }
      node.classList.toggle('is-error', complete && typed !== target);
      if (!complete) node.classList.remove('is-error');
    }

    afterKeystroke() {
      this.recordTrace();
      this.moveCaret();
      this.setIdle(false);
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.setIdle(true), 1000);
      TA.Keyboard.setNext(this.expectedChar());
      this.emitLive();
    }

    /* ---------- ghost race support (ghost.js) ---------- */

    /** Character position in the whole text (committed words + spaces + current word). */
    progressPos() {
      if (!this.offsets || this.offsets.length !== this.words.length) {
        this.offsets = [];
        let acc = 0;
        for (const w of this.words) { this.offsets.push(acc); acc += w.length + 1; }
      }
      const word = this.words[this.index] || '';
      return (this.offsets[this.index] || 0) + Math.min(this.current.length, word.length);
    }

    /** Store [ms since start, position] for every change — the replay of this run. */
    recordTrace() {
      if (!this.started || !this.trace) return;
      const t = Math.round(performance.now() - this.startedPerf);
      const pos = this.progressPos();
      const last = this.trace[this.trace.length - 1];
      if (last && last[1] === pos) return;
      if (last && last[0] === t) { last[1] = pos; return; }
      if (this.trace.length < 6000) this.trace.push([t, pos]);
    }

    /** Pixel position (inside the track) of a character position, or null if not rendered. */
    positionOf(pos) {
      this.progressPos(); // refresh offsets
      const offs = this.offsets;
      let lo = 0, hi = offs.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= pos) lo = mid; else hi = mid - 1; }
      const node = this.wordEls[lo];
      if (!node) return null;
      const word = this.words[lo];
      const ci = Math.min(pos - offs[lo], word.length);
      const letters = node.children;
      let x;
      if (ci < word.length && letters[ci]) x = node.offsetLeft + letters[ci].offsetLeft;
      else { const l = letters[Math.min(word.length, letters.length) - 1]; x = node.offsetLeft + (l ? l.offsetLeft + l.offsetWidth : 0); }
      return { x, y: node.offsetTop, word: lo };
    }

    setIdle(idle) {
      this.dom.caret.classList.toggle('is-idle', idle);
    }

    relayout() {
      if (!this.wordEls || !this.wordEls.length) return;
      this.lineHeight = this.wordEls[0].offsetHeight;
      if (this.lineHeight) this.dom.viewport.style.height = `${this.lineHeight * 3}px`;
      this.scrollOffset = -1; // force recompute
      this.moveCaret();
    }

    moveCaret() {
      if (!this.wordEls || !this.wordEls.length) return;
      const wordNode = this.wordEls[Math.min(this.index, this.wordEls.length - 1)];
      if (!wordNode) return;
      const letters = wordNode.children;
      const pos = this.current.length;
      let x, width;
      if (pos < letters.length) {
        const letter = letters[pos];
        x = wordNode.offsetLeft + letter.offsetLeft;
        width = letter.offsetWidth;
      } else {
        const last = letters[letters.length - 1];
        x = wordNode.offsetLeft + (last ? last.offsetLeft + last.offsetWidth : 0);
        width = last ? last.offsetWidth : 10;
      }
      const y = wordNode.offsetTop;
      const caret = this.dom.caret;
      if (!caret.classList.contains('caret--line')) caret.style.width = `${width}px`;
      else caret.style.width = '';
      caret.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

      // Keep the active line as the 2nd visible line (3 lines are visible)
      const lh = this.lineHeight || wordNode.offsetHeight;
      const offset = y > lh ? y - lh : 0;
      if (offset !== this.scrollOffset) {
        this.scrollOffset = offset;
        this.dom.track.style.transform = `translateY(${-offset}px)`;
      }
    }

    setFailedVisual(failed) {
      this.dom.area.classList.toggle('is-failed', failed);
    }

    /* ======================= timing ======================= */

    start() {
      this.started = true;
      this.startedAt = Date.now();
      this.startedPerf = performance.now();
      this.timer.start();
      this.dom.caret.classList.remove('is-idle');
      this.cb.onStart(this.plan);
    }

    onTick(second) {
      if (this.finished) return;
      this.pushSample(1000, second * 1000);
      if (this.plan.limitType === 'time' && second >= this.plan.limit) {
        this.finish(true);
        return;
      }
      this.emitLive(true);
    }

    /** Record one per-second sample. `spanMs` = duration covered by this sample. */
    pushSample(spanMs, totalMs) {
      const correctNow = this.liveCorrectChars();
      this.samples.wpm.push(round(Statistics.wpm(correctNow, totalMs), 1));
      this.samples.raw.push(round(Statistics.wpm(this.sec.keys, spanMs), 1));
      this.samples.acc.push(round(Statistics.accuracy(this.keys.correct, this.keys.total), 1));
      this.samples.err.push(this.sec.errors);
      this.sec.keys = 0;
      this.sec.errors = 0;
    }

    liveCorrectChars() {
      const partial = Statistics.compareWord(this.words[this.index] || '', this.current, false);
      return this.committed.correct + this.committed.correctSpaces + partial.correct;
    }

    liveSnapshot() {
      const elapsed = this.started ? this.timer.elapsed() : 0;
      const plan = this.plan;
      let timerText;
      if (plan.limitType === 'time') {
        const remaining = this.started ? Math.max(0, plan.limit - Math.floor(elapsed / 1000)) : plan.limit;
        timerText = String(remaining);
      } else {
        timerText = `${Math.min(this.index, this.words.length)}/${this.words.length}`;
      }
      const expected = this.expectedChar();
      return {
        started: this.started,
        timerText,
        timerLabel: plan.limitType === 'time' ? 'seconds' : 'words',
        wpm: elapsed > 500 ? Math.round(Statistics.wpm(this.liveCorrectChars(), elapsed)) : 0,
        acc: Math.floor(Statistics.accuracy(this.keys.correct, this.keys.total)),
        word: this.words[this.index] || '—',
        nextKey: expected === undefined ? '—' : expected === ' ' ? 'space' : expected,
        typed: this.keys.total,
        correct: this.keys.correct,
        incorrect: this.keys.incorrect
      };
    }

    /** Throttled live-stats callback (never more than ~8 times per second). */
    emitLive(force = false) {
      const now = performance.now();
      if (force || now - this.lastLive >= LIVE_THROTTLE_MS) {
        this.lastLive = now;
        cancelAnimationFrame(this.liveFrame);
        this.liveFrame = 0;
        this.cb.onLive(this.liveSnapshot());
      } else if (!this.liveFrame) {
        this.liveFrame = requestAnimationFrame(() => {
          this.liveFrame = 0;
          this.lastLive = performance.now();
          this.cb.onLive(this.liveSnapshot());
        });
      }
    }

    /* ======================= finish ======================= */

    fail(reason) {
      this.failed = true;
      this.failReason = reason;
      this.setFailedVisual(true);
      this.finish();
    }

    finish(byTimer = false) {
      if (this.finished) return;
      this.finished = true;
      this.timer.stop();
      clearTimeout(this.idleTimer);
      cancelAnimationFrame(this.liveFrame);

      const plan = this.plan;
      let elapsed = byTimer ? plan.limit * 1000 : this.timer.elapsed();
      if (!this.started) elapsed = 0;

      // Partial last second (words / quote mode, or early finish)
      if (!byTimer && this.started) {
        const covered = this.samples.wpm.length * 1000;
        const rest = elapsed - covered;
        if (rest >= 200 || this.samples.wpm.length === 0) this.pushSample(Math.max(rest, 1), Math.max(elapsed, 1));
      }

      const partial = Statistics.compareWord(this.words[this.index] || '', this.current, false);
      const c = this.committed;
      const chars = {
        correct: c.correct + partial.correct,
        incorrect: c.incorrect + partial.incorrect,
        extra: c.extra + partial.extra,
        missed: c.missed
      };
      const correctChars = chars.correct + c.correctSpaces;
      const rawChars = chars.correct + chars.incorrect + chars.extra + c.spaces;
      const minutesMs = Math.max(elapsed, 1);

      const result = {
        id: TA.Utils.uid(),
        ts: Date.now(),
        mode: plan.mode,
        mode2: plan.mode2,
        language: plan.language,
        wordList: plan.fixedWords ? null : plan.wordList,
        punctuation: !!plan.punctuation,
        numbers: !!plan.numbers,
        difficulty: plan.difficulty,
        quote: plan.quote ? { id: plan.quote.id, source: plan.quote.source } : null,
        duration: round(elapsed / 1000, 2),
        wpm: round(Statistics.wpm(correctChars, minutesMs), 2),
        raw: round(Statistics.wpm(rawChars, minutesMs), 2),
        acc: round(Statistics.accuracy(this.keys.correct, this.keys.total), 2),
        consistency: round(Statistics.consistency(this.samples.raw), 2),
        chars: [chars.correct, chars.incorrect, chars.extra, chars.missed],
        keystrokes: [this.keys.correct, this.keys.incorrect],
        errors: this.keys.incorrect,
        wordsTyped: c.spaces + (this.current.length ? 1 : 0),
        samples: this.samples,
        missedKeys: Object.fromEntries(Statistics.topEntries(this.missedKeys, 12)),
        missedWords: Object.fromEntries(Statistics.topEntries(this.missedWords, 12)),
        analysis: this.rec.export(),
        failed: this.failed || undefined,
        failReason: this.failed ? this.failReason : undefined
      };

      this.dom.input.blur();
      TA.Keyboard.setNext(null);
      this.cb.onFinish(result, { valid: this.started && this.keys.total > 0 });
    }

    /** Stop everything without producing a result (used on navigation). */
    abort() {
      this.timer.stop();
      this.finished = true;
      clearTimeout(this.idleTimer);
    }

    get inProgress() { return this.started && !this.finished; }
  }

  TA.TypingEngine = TypingEngine;
  TA.buildPlan = buildPlan;
})(window.TA = window.TA || {});
