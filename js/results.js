/*
 * results.js — renders a test result on the Results page:
 * headline stats, WPM/accuracy graph and the error analysis.
 */
(function (TA) {
  'use strict';
  const { $, el, round, formatDateTime } = TA.Utils;
  const { Statistics } = TA;

  let mainChart = null;
  let errorChart = null;
  let shown = null;

  function statItem(label, value, hint) {
    return el('div', { title: hint || '' }, [el('dt', { text: label }), el('dd', {}, value)]);
  }

  function renderRankList(list, entries, emptyText) {
    list.textContent = '';
    if (!entries.length) { list.append(el('li', {}, [el('span', { class: 'rank-empty', text: emptyText })])); return; }
    const max = entries[0][1];
    for (const [key, count] of entries) {
      list.append(el('li', {}, [
        el('span', { class: 'rank-key', text: key === ' ' ? 'space' : key }),
        el('span', { class: 'rank-bar', style: `width:${Math.max(6, (count / max) * 100)}%` }),
        el('span', { class: 'rank-count', text: String(count) })
      ]));
    }
  }

  const Results = {
    get current() { return shown; },

    /**
     * @param {object} result
     * @param {object} info { isPb, previous }
     */
    show(result, info = {}) {
      shown = result;
      $('#resultsEmpty').hidden = true;
      $('#resultsView').hidden = false;

      // ---- meta line
      const meta = $('#resultMeta');
      meta.textContent = '';
      const parts = [
        ['mode', Statistics.modeLabel(result)],
        result.wordList ? ['list', result.wordList] : null,
        ['language', result.language],
        result.punctuation ? ['', 'punctuation'] : null,
        result.numbers ? ['', 'numbers'] : null,
        result.difficulty !== 'easy' ? ['difficulty', result.difficulty] : null,
        result.quote ? ['quote', result.quote.source] : null,
        ['', formatDateTime(result.ts)]
      ].filter(Boolean);
      parts.forEach(([k, v]) => meta.append(el('span', {}, k ? [`${k} `, el('b', { text: v })] : [v])));

      // ---- badges
      const badges = $('#resultBadges');
      badges.textContent = '';
      if (result.failed) badges.append(el('span', { class: 'badge badge--bad', title: result.failReason || '', text: 'test failed' }));
      if (info.isPb) {
        const diff = info.previous !== null && info.previous !== undefined ? ` +${round(result.wpm - info.previous, 1)}` : '';
        badges.append(el('span', { class: 'badge badge--pb', text: `★ new personal best${diff}` }));
      }
      if (info.invalid) badges.append(el('span', { class: 'badge badge--bad', text: 'not saved (too short)' }));
      const ghostBadge = TA.Ghost.badge(result);
      if (ghostBadge) badges.append(ghostBadge);
      $('#btnResCert').title = 'Certificates are earned in the certification exam';

      // ---- headline numbers (count up from zero)
      const fx = TA.Effects;
      fx.countUp($('#resWpm'), Math.round(result.wpm), { duration: 900 });
      fx.countUp($('#resAcc'), Math.floor(result.acc), { suffix: '%', duration: 900, delay: 80 });
      $('#resWpm').title = `${round(result.wpm, 2)} wpm`;
      $('#resAcc').title = `${round(result.acc, 2)}% (${result.keystrokes[0]} correct / ${result.keystrokes[1]} wrong keystrokes)`;

      const [c, i, e, m] = result.chars;
      const stats = $('#resultStats');
      stats.textContent = '';
      const counter = (value, opts) => {
        const span = el('span', { text: '0' });
        fx.countUp(span, value, Object.assign({ duration: 700, delay: 150 }, opts));
        return span;
      };
      stats.append(
        statItem('raw wpm', counter(Math.round(result.raw)), `${round(result.raw, 2)} — all typed characters`),
        statItem('consistency', counter(Math.round(result.consistency), { suffix: '%' }), 'Stability of your speed second by second'),
        statItem('characters', [counter(c), el('small', { class: 'muted', text: ` / ${i} / ${e} / ${m}` })], 'correct / incorrect / extra / missed'),
        statItem('errors', counter(result.errors), 'Wrong keystrokes (including corrected ones)'),
        statItem('words', counter(result.wordsTyped)),
        statItem('time', counter(round(result.duration, 1), { decimals: result.duration % 1 ? 1 : 0, suffix: 's' }))
      );
      fx.replay($('#resultsView'), 'is-revealing');

      Results.renderChart(result);
      Results.renderDetails(result);
      TA.Analysis.renderResult(result);
      TA.Tree.renderResult(result);
      TA.Progress.renderResult(result);
    },

    showEmpty() {
      shown = null;
      $('#resultsEmpty').hidden = false;
      $('#resultsView').hidden = true;
    },

    renderChart(result) {
      const s = result.samples;
      const container = $('#resultChart');
      const legend = $('#resultChartLegend');
      if (!s || !s.wpm.length) {
        if (mainChart) { mainChart.destroy(); mainChart = null; }
        container.textContent = '';
        container.append(el('div', { class: 'chart__empty', text: 'Per-second graph not stored for this older test.' }));
        legend.textContent = '';
        return;
      }
      const labels = s.wpm.map((_, idx) => {
        const t = idx === s.wpm.length - 1 ? result.duration : idx + 1;
        return `${round(t, 1)}s`;
      });
      const options = {
        labels,
        series: [
          { name: 'raw', data: s.raw, color: '--chart-2', width: 1.5, dashed: true },
          { name: 'wpm', data: s.wpm, color: '--chart-1', fill: true, width: 2.5 },
          { name: 'accuracy', data: s.acc, color: '--warning', axis: 'right', width: 1.5, suffix: '%' },
          { name: 'errors', data: s.err, color: '--chart-3', type: 'scatter', axis: 'none' }
        ],
        left: { min: 0 },
        right: { max: 100, fit: true, floor: 0, suffix: '%' },
        animate: true,
        animDuration: 900,
        tooltip: (idx) => `<div>${labels[idx]}</div>` +
          `wpm: <b>${Math.round(s.wpm[idx])}</b><br>raw: <b>${Math.round(s.raw[idx])}</b><br>` +
          `accuracy: <b>${s.acc[idx]}%</b><br>errors: <b>${s.err[idx]}</b>`
      };
      if (mainChart && mainChart.container === container) mainChart.update(options);
      else mainChart = new TA.Chart(container, options);

      legend.innerHTML = '';
      [['wpm', '--chart-1'], ['raw', '--chart-2'], ['accuracy', '--warning'], ['errors', '--chart-3']].forEach(([name, v]) => {
        legend.append(el('span', {}, [el('i', { style: `background:var(${v})` }), name]));
      });
    },

    renderDetails(result) {
      const [c, i, e, m] = result.chars;
      const total = Math.max(1, c + i + e + m);
      const bar = $('#charBar');
      bar.textContent = '';
      const parts = [
        ['correct', c, 'var(--accent)'],
        ['incorrect', i, 'var(--error)'],
        ['extra', e, 'var(--error-extra)'],
        ['missed', m, 'var(--subtle)']
      ];
      parts.forEach(([, v, color]) => { if (v) bar.append(el('span', { style: `width:${(v / total) * 100}%;background:${color}` })); });
      const legend = $('#charLegend');
      legend.textContent = '';
      parts.forEach(([name, v, color]) => legend.append(el('span', {}, [el('i', { style: `background:${color}` }), name, el('b', { text: String(v) })])));

      renderRankList($('#missedKeys'), Statistics.topEntries(result.missedKeys, 8), 'No missed keys — nice!');
      renderRankList($('#missedWords'), Statistics.topEntries(result.missedWords, 8), 'No missed words.');

      const s = result.samples;
      const container = $('#errorChart');
      if (!s || !s.err.length) {
        if (errorChart) { errorChart.destroy(); errorChart = null; }
        container.textContent = '';
        container.append(el('div', { class: 'chart__empty', text: 'No per-second data.' }));
        return;
      }
      const options = {
        labels: s.err.map((_, idx) => `${idx + 1}s`),
        series: [
          { name: 'errors', data: s.err, color: '--chart-3', type: 'bar' },
          { name: 'raw wpm', data: s.raw, color: '--chart-2', axis: 'right', width: 1.5 }
        ],
        left: { min: 0 },
        right: { min: 0 },
        animate: true
      };
      if (errorChart && errorChart.container === container) errorChart.update(options);
      else errorChart = new TA.Chart(container, options);
    },

    toggleDetails(force) {
      const panel = $('#resultDetails');
      const btn = $('#btnResDetails');
      const open = force !== undefined ? force : panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open && errorChart) errorChart.scheduleDraw();
    }
  };

  TA.Results = Results;
})(window.TA = window.TA || {});
