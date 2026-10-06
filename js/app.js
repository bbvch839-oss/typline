/*
 * app.js — bootstraps the app and wires every module together:
 * routing, test configuration bar, live HUD, keyboard shortcuts,
 * custom-test modal, data export / import / reset.
 */
(function (TA) {
  'use strict';
  const { $, $$, el, dayKey } = TA.Utils;
  const { Storage, Settings, History, Results, Dashboard, Achievements, UI } = TA;

  /* ======================= test configuration ======================= */

  const OPTIONS = {
    time: [15, 30, 60, 120],
    words: [10, 25, 50, 100],
    practice: [25, 50, 100],
    quoteLength: ['all', 'short', 'medium', 'long'],
    wordList: ['common', 'easy', 'medium', 'advanced'],
    difficulty: ['easy', 'medium', 'hard'],
    modes: ['time', 'words', 'quote', 'custom', 'practice']
  };

  const DEFAULT_CONFIG = {
    mode: 'time',
    time: 60,
    words: 25,
    practiceWords: 50,
    quoteLength: 'all',
    punctuation: false,
    numbers: false,
    wordList: 'common',
    language: 'english',
    difficulty: 'easy',
    custom: { type: 'time', time: 60, words: 50, text: '' }
  };

  function sanitizeConfig(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('bad config');
    const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (OPTIONS.modes.includes(raw.mode)) c.mode = raw.mode;
    if (OPTIONS.time.includes(raw.time)) c.time = raw.time;
    if (OPTIONS.words.includes(raw.words)) c.words = raw.words;
    if (OPTIONS.practice.includes(raw.practiceWords)) c.practiceWords = raw.practiceWords;
    if (OPTIONS.quoteLength.includes(raw.quoteLength)) c.quoteLength = raw.quoteLength;
    if (OPTIONS.wordList.includes(raw.wordList)) c.wordList = raw.wordList;
    if (OPTIONS.difficulty.includes(raw.difficulty)) c.difficulty = raw.difficulty;
    if (typeof raw.language === 'string' && TA.WordSource.languages().includes(raw.language)) c.language = raw.language;
    c.punctuation = !!raw.punctuation;
    c.numbers = !!raw.numbers;
    if (raw.custom && typeof raw.custom === 'object') {
      const cu = raw.custom;
      if (cu.type === 'time' || cu.type === 'words') c.custom.type = cu.type;
      if (Number.isFinite(cu.time)) c.custom.time = TA.Utils.clamp(Math.round(cu.time), 5, 3600);
      if (Number.isFinite(cu.words)) c.custom.words = TA.Utils.clamp(Math.round(cu.words), 1, 1000);
      if (typeof cu.text === 'string') c.custom.text = cu.text.slice(0, 20000);
    }
    return c;
  }

  let config = Storage.get(Storage.KEYS.config, DEFAULT_CONFIG, sanitizeConfig);
  const saveConfig = () => Storage.set(Storage.KEYS.config, config);

  function updateConfig(patch) {
    Object.assign(config, patch);
    saveConfig();
    renderConfigBar();
    newTest();
  }

  function renderConfigBar() {
    $$('#testConfig [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === config.mode)));
    const forcedOff = config.mode === 'quote' || config.mode === 'practice';
    $$('#testConfig [data-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!forcedOff && !!config[b.dataset.toggle]));
      b.disabled = forcedOff;
      b.style.opacity = forcedOff ? '0.35' : '';
    });

    const values = $('#configValues');
    values.textContent = '';
    const addChip = (label, pressed, onClick, title) => {
      values.append(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), title, onclick: onClick, text: label }));
    };
    if (config.mode === 'time') OPTIONS.time.forEach((t) => addChip(String(t), config.time === t, () => updateConfig({ time: t }), `${t} seconds`));
    if (config.mode === 'words') OPTIONS.words.forEach((w) => addChip(String(w), config.words === w, () => updateConfig({ words: w }), `${w} words`));
    if (config.mode === 'practice') OPTIONS.practice.forEach((w) => addChip(String(w), config.practiceWords === w, () => updateConfig({ practiceWords: w }), `${w} practice words`));
    if (config.mode === 'quote') OPTIONS.quoteLength.forEach((q) => addChip(q, config.quoteLength === q, () => updateConfig({ quoteLength: q }), `${q} quotes`));
    if (config.mode === 'custom') {
      const cu = config.custom;
      const label = cu.text.trim() ? 'custom text' : cu.type === 'time' ? `${cu.time}s` : `${cu.words} words`;
      addChip(label, true, openCustomModal, 'Edit custom test (Ctrl+Enter)');
      addChip('edit…', false, openCustomModal, 'Edit custom test (Ctrl+Enter)');
    }
    renderLanguageChips();
    if (config.mode !== 'quote' && config.mode !== 'practice' && !(config.mode === 'custom' && config.custom.text.trim())) {
      addChip(config.wordList, false, cycleWordList, 'Word list (click to change)');
    }
  }

  /* Typing language (english / uzbek / russian) — independent from the interface language */
  const LANG_NAMES = { english: 'english', uzbek: "o'zbek", russian: 'русский' };
  function renderLanguageChips() {
    const box = $('#configLang');
    box.textContent = '';
    TA.WordSource.languages().forEach((lang) => {
      box.append(el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(config.language === lang), 'data-no-i18n': '',
        title: `${LANG_NAMES[lang] || lang}`, text: LANG_NAMES[lang] || lang,
        onclick: () => { if (config.language !== lang) updateConfig({ language: lang }); }
      }));
    });
  }

  /** Small tip under the text for languages that need a special keyboard. */
  function renderLayoutHint(plan) {
    const hint = $('#layoutHint');
    const lang = plan.language;
    const texts = {
      russian: 'Switch your computer keyboard to the Russian layout (ЙЦУКЕН) — Alt+Shift or Win+Space.',
      uzbek: "o' and g' are typed with the apostrophe key (') right after the letter."
    };
    hint.hidden = !texts[lang];
    hint.textContent = texts[lang] || '';
  }

  function cycleWordList() {
    const i = OPTIONS.wordList.indexOf(config.wordList);
    updateConfig({ wordList: OPTIONS.wordList[(i + 1) % OPTIONS.wordList.length] });
  }

  /* ======================= engine & HUD ======================= */

  const hud = {
    timer: $('#hudTimer'), timerLabel: $('#hudTimerLabel'), wpm: $('#hudWpm'), acc: $('#hudAcc'),
    word: $('#hudWord'), char: $('#hudChar'), typed: $('#hudTyped'), correct: $('#hudCorrect'), incorrect: $('#hudIncorrect')
  };
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  let lastCountdown = null;
  const timerStat = $('.hud__stat--timer');

  function renderHud(s) {
    // Last seconds of a time test: pulse the timer and tick 3‥2‥1
    const remaining = s.timerLabel === 'seconds' && s.started ? Number(s.timerText) : null;
    timerStat.classList.toggle('is-warning', remaining !== null && remaining <= 5 && remaining > 0);
    if (remaining !== null && remaining <= 3 && remaining > 0 && remaining !== lastCountdown) TA.Sound.event('tick');
    lastCountdown = remaining;
    setText(hud.timer, s.timerText);
    setText(hud.timerLabel, s.timerLabel);
    setText(hud.wpm, String(s.wpm));
    setText(hud.acc, String(s.acc));
    setText(hud.word, s.word);
    setText(hud.char, s.nextKey);
    setText(hud.typed, String(s.typed));
    setText(hud.correct, String(s.correct));
    setText(hud.incorrect, String(s.incorrect));
  }

  function applyHudSettings() {
    $('#hudWpmWrap').hidden = !Settings.get('liveWpm');
    $('#hudAccWrap').hidden = !Settings.get('liveAcc');
    $('#hudDetails').hidden = !Settings.get('liveDetails');
  }

  const engine = new TA.TypingEngine({
    input: $('#typingInput'),
    viewport: $('#wordsViewport'),
    track: $('#wordsTrack'),
    wordsEl: $('#words'),
    caret: $('#caret'),
    area: $('#typingArea'),
    overlay: $('#focusOverlay')
  }, {
    onStart() {
      TA.Ghost.start();
      if (Settings.get('focusMode')) document.body.classList.add('is-typing');
      $('#typingNotice').textContent = '';
    },
    onLive: renderHud,
    onFinish: handleFinish
  });

  let examConfig = null; // set while a certification exam round is running (exam.js)

  function newTest({ repeat = false } = {}) {
    document.body.classList.remove('is-typing');
    const plan = engine.prepare(examConfig || config, { repeat: repeat && !examConfig });
    const source = $('#quoteSource');
    source.hidden = !plan.quote;
    if (plan.quote) source.textContent = plan.quote.source;
    renderPracticeFocus(plan);
    TA.Ghost.prepare(plan);
    renderLayoutHint(plan);
    TA.Keyboard.setLanguage(plan.language);
    TA.Keyboard.setNext(engine.expectedChar());
    $('#typingNotice').textContent = '';
    if (currentPage === 'test') requestAnimationFrame(() => engine.focus());
  }

  /** Practice mode: show which weak keys / letter pairs this text targets. */
  function renderPracticeFocus(plan) {
    const box = $('#practiceFocus');
    box.textContent = '';
    box.hidden = !plan.practice;
    if (!plan.practice) return;
    if (plan.focus && plan.focus.length) {
      box.append('practicing your weak spots: ', ...plan.focus.map((k) => el('kbd', { class: 'focus-key', text: k })));
    } else {
      box.append('Not enough data yet — finish a few normal tests first. Using regular words for now.');
    }
  }

  /* ---------- certification exam hooks (exam.js) ---------- */
  function runExamRound(cfg) {
    examConfig = cfg;
    if (currentPage !== 'test') navigate('test');
    newTest();
  }
  function endExam() {
    examConfig = null;
    newTest();
  }
  function openCertificates() {
    navigate('dashboard');
    setTimeout(() => Dashboard.selectTab('certificates'), 30);
  }

  function startPractice() {
    if (config.mode !== 'practice') updateConfig({ mode: 'practice' });
    else newTest();
    navigate('test');
  }

  function handleFinish(result, { valid }) {
    document.body.classList.remove('is-typing');
    if (result.mode === 'exam') {
      timerStat.classList.remove('is-warning');
      if (valid) TA.Exam.roundFinished(result, engine); else newTest();
      return;
    }
    if (!valid) { newTest({ repeat: true }); return; }

    const longEnough = result.duration >= 2 && result.keystrokes[0] + result.keystrokes[1] >= 5;
    if (result.failed) $('#typingNotice').textContent = result.failReason;

    TA.Ghost.finish(result, engine.trace, longEnough && !result.failed);
    let info = { invalid: !longEnough };
    let shown = result;
    if (longEnough) {
      const before = History.all().slice();
      const saved = History.add(result);
      info = saved;
      shown = saved.saved || result;
      Achievements.evaluate(shown, History.all());
      TA.Analysis.record(result, engine.rec);
      TA.Tree.noteResult(shown, before);
      TA.Progress.noteResult(shown, before);
    }
    Results.show(shown, info);
    Results.toggleDetails(false);
    timerStat.classList.remove('is-warning');

    if (result.failed) TA.Sound.event('fail');
    else if (info.isPb && History.all().length > 1) {
      TA.Sound.event('pb');
      setTimeout(() => TA.Effects.confetti(), 250);
    } else TA.Sound.event('finish');
    // brief pause on a failed test so the user can see where it happened
    setTimeout(() => navigate('results'), result.failed ? 900 : 0);
  }

  async function requestRestart({ repeat = false } = {}) {
    if (TA.Exam.active) { TA.Exam.requestAbort(); return; }
    if (engine.inProgress && Settings.get('confirmRestart')) {
      const ok = await UI.confirm({ title: 'Restart the test?', text: 'Your current progress will be lost.', confirmLabel: 'Restart' });
      if (!ok) { engine.focus(); return; }
    }
    if (currentPage !== 'test') navigate('test');
    newTest({ repeat });
  }

  /* ======================= routing ======================= */

  const PAGES = ['test', 'results', 'dashboard', 'settings'];
  let currentPage = null;

  function navigate(page) {
    if (location.hash !== `#${page}`) location.hash = page;
    else showPage(page);
  }

  function showPage(page) {
    if (!PAGES.includes(page)) page = 'test';
    if (page === currentPage) return;
    const previous = currentPage;
    currentPage = page;

    if (previous === 'test' && TA.Exam.active) TA.Exam.fail('You left the test page during the exam.');
    if (previous === 'test' && engine.inProgress) { engine.abort(); newTest({ repeat: true }); }
    document.body.classList.remove('is-typing');

    PAGES.forEach((p) => { $(`#page-${p}`).hidden = p !== page; });
    $$('.nav__link').forEach((a) => {
      if (a.dataset.route === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (page === 'test') {
      if (engine.finished) newTest();
      requestAnimationFrame(() => { engine.relayout(); engine.focus(); });
    }
    if (page === 'results') {
      if (!Results.current) {
        const latest = History.latest();
        if (latest) Results.show(latest, {}); else Results.showEmpty();
      }
      requestAnimationFrame(() => TA.Chart.redrawAll());
    }
    Dashboard.setVisible(page === 'dashboard');
    if (page !== 'test') $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));

  /* ======================= custom test modal ======================= */

  function openCustomModal() {
    const form = $('#customForm');
    const cu = config.custom;
    form.customType.value = cu.type;
    form.customTime.value = cu.time;
    form.customWords.value = cu.words;
    form.language.value = config.language;
    form.wordList.value = config.wordList;
    form.difficulty.value = config.difficulty;
    form.punctuation.value = config.punctuation ? 'on' : 'off';
    form.numbers.value = config.numbers ? 'on' : 'off';
    form.customText.value = cu.text;
    UI.Modal.open('customModal', { onClose: () => { if (currentPage === 'test') engine.focus(); } });
  }

  function setupCustomModal() {
    const select = $('#customLanguage');
    TA.WordSource.languages().forEach((lang) => select.append(el('option', { value: lang, text: lang[0].toUpperCase() + lang.slice(1) })));
    $('#customForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const time = TA.Utils.clamp(Math.round(Number(form.customTime.value) || 60), 5, 3600);
      const words = TA.Utils.clamp(Math.round(Number(form.customWords.value) || 50), 1, 1000);
      config = sanitizeConfig(Object.assign({}, config, {
        mode: 'custom',
        language: form.language.value,
        wordList: form.wordList.value,
        difficulty: form.difficulty.value,
        punctuation: form.punctuation.value === 'on',
        numbers: form.numbers.value === 'on',
        custom: { type: form.customType.value, time, words, text: form.customText.value }
      }));
      saveConfig();
      UI.Modal.close('customModal');
      renderConfigBar();
      navigate('test');
      newTest();
    });
  }

  /* ======================= keyboard shortcuts ======================= */

  function onGlobalKeydown(event) {
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;

    if (key === 'Escape') {
      if (UI.Modal.closeTop()) { event.preventDefault(); return; }
      event.preventDefault();
      if (currentPage === 'test' || currentPage === 'results') requestRestart({ repeat: true });
      else navigate('test');
      return;
    }
    if (UI.Modal.isOpen()) return;

    if (ctrl && key === 'Enter') { event.preventDefault(); openCustomModal(); return; }
    if (ctrl && (key === 'd' || key === 'D') && !event.shiftKey) { event.preventDefault(); navigate('dashboard'); return; }
    if (ctrl && key === ',') { event.preventDefault(); navigate('settings'); return; }

    if (key === 'Tab' && !event.shiftKey && !ctrl && !event.altKey) {
      const active = document.activeElement;
      const neutral = !active || active === document.body || active === $('#main') || active.id === 'typingInput';
      // On the results page Tab always starts a new test (Shift+Tab still moves focus).
      if ((currentPage === 'test' && neutral) || currentPage === 'results') {
        event.preventDefault();
        requestRestart();
      }
      return;
    }

    // Typing while the input is not focused: focus it and replay the key
    if (currentPage === 'test' && !engine.isFocused && !engine.finished && key.length === 1 && !ctrl && !event.altKey &&
        !TA.Utils.isEditableTarget(event.target) && !(event.target && event.target.closest && event.target.closest('button, a'))) {
      event.preventDefault();
      engine.focus();
      engine.applyText(engine.current + key);
      engine.syncInput();
    }
  }

  /* ======================= data: export / import / reset ======================= */

  function reloadEverything() {
    Settings.reload();
    History.reload();
    Achievements.reload();
    Dashboard.reloadGoals();
    TA.Analysis.reload();
    TA.Ghost.reload();
    TA.Progress.reload();
    config = Storage.get(Storage.KEYS.config, DEFAULT_CONFIG, sanitizeConfig);
    Results.showEmpty();
    renderConfigBar();
    applyHudSettings();
    newTest();
    Dashboard.invalidate();
  }

  function setupDataControls() {
    $('#btnExport').addEventListener('click', () => {
      const payload = Storage.exportAll();
      TA.Utils.downloadText(`bbvch-type-backup-${dayKey()}.json`, JSON.stringify(payload, null, 2));
      UI.toast({ title: 'Data exported', text: `${History.all().length} tests saved to a JSON file.` });
    });

    const fileInput = $('#importFile');
    $('#btnImport').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const payload = JSON.parse(await TA.Utils.readFileText(file));
        const count = payload && payload.data && Array.isArray(payload.data.history) ? payload.data.history.length : 0;
        const ok = await UI.confirm({
          title: 'Import data?',
          text: `This replaces your current data with the backup (${count} tests). Consider exporting first.`,
          confirmLabel: 'Import'
        });
        if (!ok) return;
        Storage.importAll(payload);
        reloadEverything();
        UI.toast({ title: 'Data imported', text: `${History.all().length} tests restored.` });
      } catch (err) {
        UI.toast({ title: 'Import failed', text: err.message || 'The file is not valid JSON.', type: 'error', duration: 5000 });
      }
    });

    $('#btnResetAll').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Reset all data?',
        text: 'History, personal bests, achievements, goals and settings will be permanently deleted from this browser.',
        confirmLabel: 'Reset everything'
      });
      if (!ok) return;
      Storage.resetAll();
      reloadEverything();
      UI.toast({ title: 'All data has been reset' });
    });
  }

  /* ======================= init ======================= */

  function init() {
    TA.Keyboard.init($('#keyboardViz'));
    TA.Ghost.init(engine);
    TA.Progress.init();
    Settings.render($('#settingsList'));
    Dashboard.init();
    TA.HistoryView.init({
      onOpen(id) {
        const r = History.get(id);
        if (!r) return;
        Results.show(r, {});
        Results.toggleDetails(false);
        navigate('results');
      }
    });
    setupCustomModal();
    setupDataControls();

    // Config bar
    $$('#testConfig [data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode === 'custom' && config.mode === 'custom') { openCustomModal(); return; }
      updateConfig({ mode: b.dataset.mode });
    }));
    $$('#testConfig [data-toggle]').forEach((b) => b.addEventListener('click', () => updateConfig({ [b.dataset.toggle]: !config[b.dataset.toggle] })));

    // Buttons
    $('#btnRestart').addEventListener('click', () => requestRestart());
    $('#btnResRestart').addEventListener('click', () => requestRestart({ repeat: true }));
    $('#btnResNew').addEventListener('click', () => requestRestart());
    $('#btnResDetails').addEventListener('click', () => Results.toggleDetails());
    $('#btnResPractice').addEventListener('click', () => startPractice());
    $('#btnResCert').addEventListener('click', openCertificates);
    TA.Certificate.init();
    $('#themeToggle').addEventListener('click', () => Settings.cycleTheme());
    const UI_LANGS = ['en', 'uz', 'ru'];
    const langLabel = () => { $('#langToggleLabel').textContent = Settings.get('uiLang').toUpperCase(); };
    $('#langToggle').addEventListener('click', () => {
      Settings.set('uiLang', UI_LANGS[(UI_LANGS.indexOf(Settings.get('uiLang')) + 1) % UI_LANGS.length]);
    });
    Settings.onChange((key) => { if (key === 'uiLang' || key === '*') langLabel(); });
    langLabel();

    document.addEventListener('keydown', onGlobalKeydown);
    // Optional interface click sound
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button, .nav__link, .brand, select')) TA.Sound.event('ui');
    });
    // Moving the mouse brings the UI back during a test
    document.addEventListener('mousemove', TA.Utils.throttle((e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) document.body.classList.remove('is-typing');
    }, 200));

    Settings.onChange((key) => {
      applyHudSettings();
      if (key === 'theme' || key === '*') TA.Chart.redrawAll();
      if (key === 'focusMode' && !Settings.get('focusMode')) document.body.classList.remove('is-typing');
    });

    if (!Storage.isPersistent) {
      UI.toast({ title: 'Storage unavailable', text: 'Your browser blocks localStorage here — results will not be saved after closing the tab.', type: 'error', duration: 8000 });
    }

    applyHudSettings();
    renderConfigBar();
    newTest();
    showPage(location.hash.slice(1) || 'test');
    TA.Motion.init();
  }

  init();
  TA.App = { navigate, newTest, startPractice, runExamRound, endExam, openCertificates, getConfig: () => Object.assign({}, config), engine };
})(window.TA = window.TA || {});
