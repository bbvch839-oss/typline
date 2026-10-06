/*
 * history.js — result history: persistence, personal bests cache,
 * and the sortable / filterable History table in the Dashboard.
 */
(function (TA) {
  'use strict';
  const { $, el, formatDateTime, round } = TA.Utils;
  const { Storage, Statistics } = TA;

  const MAX_RESULTS = 5000;         // oldest results are dropped beyond this
  const KEEP_SAMPLES_FOR = 300;     // per-second graphs kept for the newest N tests
  const PAGE_SIZE = 50;
  const MODES = ['time', 'words', 'quote', 'custom', 'practice'];

  const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

  function sanitizeResult(r) {
    if (!r || typeof r !== 'object') return null;
    if (!Number.isFinite(r.wpm) || !Number.isFinite(r.ts) || !MODES.includes(r.mode)) return null;
    const chars = Array.isArray(r.chars) && r.chars.length === 4 && r.chars.every(Number.isFinite) ? r.chars : [0, 0, 0, 0];
    const samples = r.samples && Array.isArray(r.samples.wpm) ? r.samples : null;
    return {
      id: typeof r.id === 'string' ? r.id : TA.Utils.uid(),
      ts: r.ts,
      mode: r.mode,
      mode2: String(r.mode2 === undefined ? '' : r.mode2),
      language: typeof r.language === 'string' ? r.language : 'english',
      wordList: typeof r.wordList === 'string' ? r.wordList : null,
      punctuation: !!r.punctuation,
      numbers: !!r.numbers,
      difficulty: ['easy', 'medium', 'hard'].includes(r.difficulty) ? r.difficulty : 'easy',
      quote: r.quote && typeof r.quote === 'object' ? r.quote : null,
      duration: num(r.duration),
      wpm: r.wpm,
      raw: num(r.raw, r.wpm),
      acc: num(r.acc, 100),
      consistency: num(r.consistency),
      chars,
      keystrokes: Array.isArray(r.keystrokes) ? r.keystrokes : [chars[0], chars[1]],
      errors: num(r.errors),
      wordsTyped: num(r.wordsTyped),
      samples,
      missedKeys: r.missedKeys && typeof r.missedKeys === 'object' ? r.missedKeys : {},
      missedWords: r.missedWords && typeof r.missedWords === 'object' ? r.missedWords : {},
      analysis: r.analysis && r.analysis.keys && typeof r.analysis.keys === 'object' ? { keys: r.analysis.keys } : null,
      failed: r.failed ? true : undefined,
      failReason: r.failed ? String(r.failReason || '') : undefined
    };
  }

  function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) throw new Error('history is not an array');
    return raw.map(sanitizeResult).filter(Boolean).sort((a, b) => a.ts - b.ts);
  }

  let results = Storage.get(Storage.KEYS.history, [], sanitizeHistory);
  let pbs = {};
  const listeners = new Set();

  function persist() {
    if (results.length > MAX_RESULTS) results = results.slice(-MAX_RESULTS);
    const cutoff = results.length - KEEP_SAMPLES_FOR;
    results.forEach((r, i) => { if (i < cutoff && r.samples) r.samples = null; });
    Storage.set(Storage.KEYS.history, results);
    rebuildPbs();
    listeners.forEach((fn) => fn());
  }

  function rebuildPbs() {
    pbs = Statistics.personalBests(results);
    Storage.set(Storage.KEYS.pbs, pbs);
  }

  rebuildPbs();

  const History = {
    all() { return results; },
    latest() { return results[results.length - 1] || null; },
    get(id) { return results.find((r) => r.id === id) || null; },
    personalBests() { return pbs; },
    onChange(fn) { listeners.add(fn); },

    /** Save a finished result. Returns info about personal bests. */
    add(result) {
      const clean = sanitizeResult(result);
      if (!clean) return { isPb: false };
      const key = Statistics.modeKey(clean);
      const previous = pbs[key] ? pbs[key].wpm : null;
      results.push(clean);
      persist();
      const isPb = !clean.failed && (previous === null || clean.wpm > previous);
      return { isPb, previous, saved: clean };
    },

    remove(id) {
      const before = results.length;
      results = results.filter((r) => r.id !== id);
      if (results.length !== before) persist();
    },

    clear() { results = []; persist(); },

    reload() {
      results = Storage.get(Storage.KEYS.history, [], sanitizeHistory);
      rebuildPbs();
      listeners.forEach((fn) => fn());
    }
  };

  /* ================= History table (Dashboard → History tab) ================= */

  const view = { sort: 'date', dir: 'desc', limit: PAGE_SIZE, onOpen: null };

  const HistoryView = {
    init({ onOpen }) {
      view.onOpen = onOpen;
      const rerender = () => { view.limit = PAGE_SIZE; HistoryView.render(); };
      $('#historyFilterMode').addEventListener('change', rerender);
      $('#historyFilterPeriod').addEventListener('change', rerender);
      $('#historyFilterMinWpm').addEventListener('input', TA.Utils.debounce(rerender, 200));
      $('#btnHistoryMore').addEventListener('click', () => { view.limit += PAGE_SIZE; HistoryView.render(); });

      document.querySelectorAll('#historyTable .sort').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.sort;
          if (view.sort === key) view.dir = view.dir === 'asc' ? 'desc' : 'asc';
          else { view.sort = key; view.dir = key === 'mode' ? 'asc' : 'desc'; }
          HistoryView.render();
        });
      });

      $('#btnClearHistory').addEventListener('click', async () => {
        if (!results.length) { TA.UI.toast({ title: 'History is already empty' }); return; }
        const ok = await TA.UI.confirm({
          title: 'Clear all history?',
          text: `This permanently deletes ${results.length} test result(s) and resets personal bests and streaks. Achievements are kept.`,
          confirmLabel: 'Clear history'
        });
        if (ok) { History.clear(); TA.UI.toast({ title: 'History cleared' }); }
      });

      $('#historyBody').addEventListener('click', async (event) => {
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        const id = row.dataset.id;
        if (event.target.closest('.row-del')) {
          event.stopPropagation();
          const r = History.get(id);
          const ok = await TA.UI.confirm({
            title: 'Delete this test?',
            text: r ? `${formatDateTime(r.ts)} — ${Math.round(r.wpm)} wpm, ${Statistics.modeLabel(r)}` : '',
            confirmLabel: 'Delete'
          });
          if (ok) History.remove(id);
          return;
        }
        if (view.onOpen) view.onOpen(id);
      });
      $('#historyBody').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.target.tagName !== 'TR') return;
        if (view.onOpen) view.onOpen(event.target.dataset.id);
      });
    },

    filtered() {
      const mode = $('#historyFilterMode').value;
      const period = $('#historyFilterPeriod').value;
      const minWpm = Number($('#historyFilterMinWpm').value) || 0;
      let since = 0;
      if (period !== 'all') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (Number(period) - 1));
        since = d.getTime();
      }
      const list = results.filter((r) => (mode === 'all' || r.mode === mode) && r.ts >= since && r.wpm >= minWpm);
      const dir = view.dir === 'asc' ? 1 : -1;
      const getters = {
        date: (r) => r.ts,
        mode: (r) => Statistics.modeLabel(r),
        time: (r) => r.duration,
        wpm: (r) => r.wpm,
        acc: (r) => r.acc,
        consistency: (r) => r.consistency,
        raw: (r) => r.raw
      };
      const get = getters[view.sort] || getters.date;
      return list.slice().sort((a, b) => {
        const va = get(a), vb = get(b);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return (a.ts - b.ts) * -1;
      });
    },

    render() {
      const list = HistoryView.filtered();
      const body = $('#historyBody');
      const pbIds = new Set(Object.values(pbs).map((p) => p.id));
      body.textContent = '';
      const frag = document.createDocumentFragment();
      for (const r of list.slice(0, view.limit)) {
        const label = Statistics.modeLabel(r) + (r.punctuation ? ' · punct' : '') + (r.numbers ? ' · num' : '');
        frag.append(el('tr', { 'data-id': r.id, tabindex: '0', title: 'Open result' }, [
          el('td', { text: formatDateTime(r.ts) }),
          el('td', {}, [label, r.failed ? el('span', { class: 'badge badge--bad', style: 'margin-left:.4rem', text: 'failed' }) : null]),
          el('td', { class: 'num', text: `${round(r.duration, 1)}s` }),
          el('td', { class: 'num wpm' }, [String(Math.round(r.wpm)), pbIds.has(r.id) ? el('span', { class: 'pb-dot', title: 'Personal best', text: '★' }) : null]),
          el('td', { class: 'num', text: `${round(r.acc, 1)}%` }),
          el('td', { class: 'num', text: `${Math.round(r.consistency)}%` }),
          el('td', { class: 'num', text: String(Math.round(r.raw)) }),
          el('td', {}, [el('button', { type: 'button', class: 'icon-btn row-del', 'aria-label': 'Delete this test', title: 'Delete', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' })])
        ]));
      }
      body.append(frag);
      $('#historyEmpty').hidden = list.length > 0;
      $('#btnHistoryMore').hidden = list.length <= view.limit;
      $('#historyCount').textContent = `${list.length} of ${results.length} tests`;
      document.querySelectorAll('#historyTable .sort').forEach((btn) => {
        if (btn.dataset.sort === view.sort) btn.dataset.dir = view.dir; else delete btn.dataset.dir;
        btn.closest('th').setAttribute('aria-sort', btn.dataset.sort === view.sort ? (view.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }
  };

  TA.History = History;
  TA.HistoryView = HistoryView;
})(window.TA = window.TA || {});
