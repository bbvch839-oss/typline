/*
 * dashboard.js — Overview (streaks, goals, heatmap, bests, averages,
 * totals, per-mode PBs, charts), tabs and the goals editor.
 * Rendering is lazy: the dashboard only rebuilds when it is visible.
 */
(function (TA) {
  'use strict';
  const { $, $$, el, round, dayKey, addDays, startOfWeek, formatDuration, formatNumber, formatDate, formatShortDate, monthName, clamp } = TA.Utils;
  const { Storage, Statistics, History } = TA;

  const GOAL_DEFAULTS = { wpm: 80, acc: 97 };
  const HISTORY_CHART_POINTS = 100;

  function sanitizeGoals(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('bad goals');
    return {
      wpm: Number.isFinite(raw.wpm) ? clamp(raw.wpm, 1, 400) : GOAL_DEFAULTS.wpm,
      acc: Number.isFinite(raw.acc) ? clamp(raw.acc, 1, 100) : GOAL_DEFAULTS.acc
    };
  }

  let goals = Storage.get(Storage.KEYS.goals, GOAL_DEFAULTS, sanitizeGoals);
  const charts = {};
  let dirty = true;
  let visible = false;
  let activeTab = 'overview';

  const PB_SLOTS = [
    ['time', '15'], ['time', '30'], ['time', '60'], ['time', '120'],
    ['words', '10'], ['words', '25'], ['words', '50'], ['words', '100'],
    ['quote', 'short'], ['quote', 'medium'], ['quote', 'long'], ['quote', 'all']
  ];

  function kv(target, rows) {
    target.textContent = '';
    for (const [label, value, sub] of rows) {
      target.append(el('dt', { text: label }), el('dd', {}, [value, sub ? el('span', { class: 'sub', text: sub }) : null]));
    }
  }

  function chart(id, options) {
    const container = document.getElementById(id);
    if (charts[id]) charts[id].update(options);
    else charts[id] = new TA.Chart(container, options);
  }

  const Dashboard = {
    init() {
      // Tabs (arrow keys supported)
      const tabs = $$('.tab');
      tabs.forEach((tab) => tab.addEventListener('click', () => Dashboard.selectTab(tab.dataset.tab)));
      $('.tabs').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = tabs.findIndex((t) => t.dataset.tab === activeTab);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        Dashboard.selectTab(next.dataset.tab);
        next.focus();
      });

      $('#btnEditGoals').addEventListener('click', Dashboard.editGoals);
      $('#goalsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        goals = sanitizeGoals({ wpm: Number(form.wpm.value), acc: Number(form.acc.value) });
        Storage.set(Storage.KEYS.goals, goals);
        TA.UI.Modal.close('goalsModal');
        Dashboard.renderGoals(Statistics.summary(History.all()));
        TA.UI.toast({ title: 'Goals saved' });
      });

      History.onChange(() => Dashboard.invalidate());
      // Some dashboard texts are built in JS (level names…): rebuild them after an interface-language switch
      TA.Settings.onChange((key) => { if (key === 'uiLang') Dashboard.invalidate(); });
    },

    reloadGoals() { goals = Storage.get(Storage.KEYS.goals, GOAL_DEFAULTS, sanitizeGoals); },

    invalidate() {
      dirty = true;
      if (visible) Dashboard.render();
    },

    setVisible(isVisible) {
      visible = isVisible;
      if (visible && dirty) Dashboard.render();
      if (visible) Object.values(charts).forEach((c) => c.scheduleDraw());
    },

    selectTab(name) {
      activeTab = name;
      $$('.tab').forEach((tab) => {
        const on = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      });
      $$('.tabpanel').forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
      Dashboard.renderActiveTab();
    },

    render() {
      dirty = false;
      Dashboard.renderActiveTab();
    },

    renderActiveTab() {
      if (activeTab === 'overview') Dashboard.renderOverview();
      else if (activeTab === 'history') TA.HistoryView.render();
      else if (activeTab === 'analysis') TA.Analysis.renderDashboard();
      else if (activeTab === 'rank') TA.Progress.renderDashboard();
      else if (activeTab === 'certificates') TA.Certificate.renderDashboard();
      else TA.Achievements.render($('#achievementGrid'), $('#achievementSummary'));
    },

    renderOverview() {
      const history = History.all();
      TA.Tree.renderDashboard();
      const summary = Statistics.summary(history);
      const streak = Statistics.streaks(history);

      TA.Effects.countUp($('#streakCurrent'), streak.current, { duration: 700 });
      TA.Effects.countUp($('#streakLongest'), streak.longest, { duration: 700, delay: 60 });
      TA.Effects.countUp($('#activeDays'), streak.activeDays, { duration: 700, delay: 120 });
      $('#streakCurrent').classList.toggle('is-hot', streak.current > 0);

      Dashboard.renderGoals(summary);
      Dashboard.renderHeatmap(streak.byDay);

      const f1 = (v) => String(round(v, 1));
      kv($('#dashBests'), [
        ['Best WPM', f1(summary.best.wpm)],
        ['Best accuracy', `${f1(summary.best.acc)}%`],
        ['Best consistency', `${f1(summary.best.consistency)}%`],
        ['Best raw WPM', f1(summary.best.raw)]
      ]);
      kv($('#dashAverages'), [
        ['Average WPM', f1(summary.average.wpm), f1(summary.recent.wpm)],
        ['Average accuracy', `${f1(summary.average.acc)}%`, `${f1(summary.recent.acc)}%`],
        ['Average consistency', `${f1(summary.average.consistency)}%`, `${f1(summary.recent.consistency)}%`],
        ['Average raw WPM', f1(summary.average.raw), f1(summary.recent.raw)]
      ]);
      kv($('#dashTotals'), [
        ['Tests completed', formatNumber(summary.totals.tests)],
        ['Words typed', formatNumber(summary.totals.words)],
        ['Characters typed', formatNumber(summary.totals.chars)],
        ['Time typing', formatDuration(summary.totals.time)]
      ]);

      Dashboard.renderPbGrid();
      Dashboard.renderCharts(history);
    },

    renderGoals(summary) {
      const box = $('#goals');
      box.textContent = '';
      const rows = [
        ['Target WPM', summary.recent.wpm, goals.wpm, ''],
        ['Target accuracy', summary.recent.acc, goals.acc, '%']
      ];
      for (const [label, current, target, unit] of rows) {
        const pct = target ? clamp((current / target) * 100, 0, 100) : 0;
        box.append(el('div', { class: 'goal' }, [
          el('div', { class: 'goal__head' }, [
            el('span', { text: `${label}: ${target}${unit}` }),
            el('span', { text: `${round(current, 1)}${unit} · ${Math.floor(pct)}%` })
          ]),
          el('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.floor(pct)) }, [
            el('div', { class: `progress__fill${pct >= 100 ? ' is-done' : ''}`, style: `width:${TA.Effects.on ? 0 : pct}%`, 'data-pct': String(pct) })
          ])
        ]));
      }
      Dashboard.fillProgress();
    },

    // (called after goals render) animate progress bars from 0 to their value
    fillProgress() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        $$('#goals .progress__fill').forEach((bar) => { bar.style.width = `${bar.dataset.pct}%`; });
      }));
    },

    editGoals() {
      const form = $('#goalsForm');
      form.wpm.value = goals.wpm;
      form.acc.value = goals.acc;
      TA.UI.Modal.open('goalsModal');
    },

    renderHeatmap(byDay) {
      const root = $('#heatmap');
      root.textContent = '';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = addDays(startOfWeek(today), -52 * 7);
      const todayKey = dayKey(today);

      const months = el('div', { class: 'heatmap__months', 'aria-hidden': 'true' });
      const grid = el('div', { class: 'heatmap__grid', role: 'grid', 'aria-label': 'Daily activity for the last year' });
      let lastMonth = -1;
      let lastLabelWeek = -9;
      let week = 0;
      for (let d = new Date(start); d <= addDays(startOfWeek(today), 6); d = addDays(d, 1)) {
        const weekday = (d.getDay() + 6) % 7;
        if (weekday === 0) {
          // label a column when a new month starts, keeping labels at least 3 columns apart
          let label = '';
          if (d.getMonth() !== lastMonth) {
            lastMonth = d.getMonth();
            const startsHere = week > 0 || d.getDate() <= 7;
            if (startsHere && week - lastLabelWeek >= 3) {
              label = monthName(d.getMonth());
              lastLabelWeek = week;
            }
          }
          months.append(el('span', { text: label, style: `grid-column:${week + 1}` }));
          week++;
        }
        if (d > today) { grid.append(el('span', { class: 'heat heat--empty' })); continue; }
        const key = dayKey(d);
        const count = byDay.get(key) || 0;
        const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
        grid.append(el('span', {
          class: `heat${key === todayKey ? ' heat--today' : ''}`,
          'data-l': String(level),
          role: 'gridcell',
          title: `${formatDate(d)}: ${count} test${count === 1 ? '' : 's'}`,
          'aria-label': `${formatDate(d)}: ${count} tests`
        }));
      }
      const days = el('div', { class: 'heatmap__days', 'aria-hidden': 'true' },
        ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t) => el('span', { text: t })));
      const legend = el('div', { class: 'heatmap__legend', 'aria-hidden': 'true' }, [
        el('span', { text: 'less' }),
        ...[0, 1, 2, 3, 4].map((l) => el('i', { class: 'heat', 'data-l': String(l) })),
        el('span', { text: 'more' })
      ]);
      root.append(el('div', { class: 'heatmap__inner' }, [months, el('div', { class: 'heatmap__body' }, [days, grid]), legend]));
      // show the most recent weeks on narrow screens
      root.scrollLeft = root.scrollWidth;
    },

    renderPbGrid() {
      const pbs = History.personalBests();
      const grid = $('#pbGrid');
      grid.textContent = '';
      const slots = PB_SLOTS.slice();
      Object.keys(pbs).forEach((key) => {
        if (key.startsWith('custom-')) slots.push(['custom', key.slice(7)]);
      });
      for (const [mode, mode2] of slots) {
        const pb = pbs[`${mode}-${mode2}`];
        const label = Statistics.modeLabel({ mode, mode2 });
        grid.append(el('div', { class: `pb${pb ? '' : ' pb--none'}`, title: pb ? `set on ${formatDate(pb.ts)}` : 'no result yet' }, [
          el('span', { class: 'pb__mode', text: label }),
          el('span', { class: 'pb__wpm' }, pb ? [String(Math.round(pb.wpm)), el('small', { text: ' wpm' })] : ['—']),
          el('span', { class: 'pb__acc', text: pb ? `${round(pb.acc, 1)}% acc · ${Math.round(pb.raw)} raw` : ' ' })
        ]));
      }
    },

    renderCharts(history) {
      const recent = history.filter((r) => !r.failed).slice(-HISTORY_CHART_POINTS);
      const wpm = recent.map((r) => round(r.wpm, 1));
      const acc = recent.map((r) => round(r.acc, 1));
      const labels = recent.map((r) => formatShortDate(r.ts));
      const tip = (field, unit) => (i) => {
        const r = recent[i];
        if (!r) return '';
        return `<div>${formatDate(r.ts)} · ${TA.Chart.escapeHtml(Statistics.modeLabel(r))}</div>${field}: <b>${round(r[field === 'wpm' ? 'wpm' : 'acc'], 1)}${unit}</b>`;
      };

      chart('chartWpm', {
        labels,
        series: [
          { name: 'wpm', data: wpm, color: '--chart-1', fill: true, points: wpm.length < 40 },
          { name: 'avg of 10', data: Statistics.movingAverage(wpm, 10).map((v) => round(v, 1)), color: '--chart-2', dashed: true, width: 1.5 }
        ],
        left: { min: 0 },
        animate: true,
        tooltip: tip('wpm', ' wpm')
      });
      chart('chartAcc', {
        labels,
        series: [
          { name: 'accuracy', data: acc, color: '--warning', points: acc.length < 40 },
          { name: 'avg of 10', data: Statistics.movingAverage(acc, 10).map((v) => round(v, 1)), color: '--chart-2', dashed: true, width: 1.5 }
        ],
        left: { max: 100, fit: true, floor: 0, suffix: '%' },
        animate: true,
        tooltip: tip('acc', '%')
      });

      const daily = Statistics.testsPerDay(history, 30);
      chart('chartDaily', {
        labels: daily.labels,
        series: [{ name: 'tests', data: history.length ? daily.data : [], color: '--chart-1', type: 'bar' }],
        left: { min: 0, integer: true },
        animate: true
      });

      const weekly = Statistics.weeklyProgress(history, 12);
      chart('chartWeekly', {
        labels: weekly.labels,
        series: [
          { name: 'avg wpm', data: history.length ? weekly.wpm.map((v) => (Number.isFinite(v) ? v : 0)) : [], color: '--chart-1', type: 'bar' },
          { name: 'avg accuracy', data: history.length ? weekly.acc : [], color: '--warning', axis: 'right', points: true, suffix: '%' }
        ],
        left: { min: 0 },
        right: { max: 100, fit: true, floor: 0, suffix: '%' },
        animate: true,
        tooltip: (i) => `<div>week of ${weekly.labels[i]}</div>tests: <b>${weekly.counts[i]}</b><br>avg wpm: <b>${Number.isFinite(weekly.wpm[i]) ? weekly.wpm[i] : '—'}</b><br>avg accuracy: <b>${Number.isFinite(weekly.acc[i]) ? weekly.acc[i] + '%' : '—'}</b>`
      });
    }
  };

  TA.Dashboard = Dashboard;
})(window.TA = window.TA || {});
