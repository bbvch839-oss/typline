/*
 * charts.js — a tiny canvas chart renderer (line / bar / scatter),
 * written from scratch so the app has zero external dependencies.
 *
 *   const chart = new TA.Chart(container, {
 *     labels: ['1s', '2s'],                 // x labels (optional)
 *     series: [{ name: 'wpm', data: [..], color: '--chart-1', type: 'line', axis: 'left', fill: true }],
 *     left:  { min: 0, suffix: '' },        // left axis options
 *     right: { min: 0, max: 100, suffix: '%' }, // right axis (optional)
 *     tooltip: (index) => 'html'            // optional
 *   });
 *   chart.update(newOptions);
 *
 * Charts redraw on resize (ResizeObserver) and when the theme changes.
 */
(function (TA) {
  'use strict';
  const { el } = TA.Utils;

  const registry = new Set();
  const DPR_CAP = 2;

  class Chart {
    constructor(container, options) {
      this.container = container;
      this.canvas = el('canvas');
      this.tip = el('div', { class: 'chart__tip', hidden: true });
      this.empty = el('div', { class: 'chart__empty', hidden: true, text: 'No data yet' });
      container.textContent = '';
      container.append(this.canvas, this.tip, this.empty);
      this.ctx = this.canvas.getContext('2d');
      this.hoverIndex = -1;
      this.options = options;
      this.layout = null;
      this.startAnimation();

      this.onMove = this.onMove.bind(this);
      this.onLeave = this.onLeave.bind(this);
      this.canvas.addEventListener('pointermove', this.onMove);
      this.canvas.addEventListener('pointerleave', this.onLeave);

      this.frame = 0;
      this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
      this.resizeObserver.observe(container);
      registry.add(this);
      this.scheduleDraw();
    }

    update(options) {
      this.options = options;
      this.startAnimation();
      this.hoverIndex = -1;
      this.tip.hidden = true;
      this.scheduleDraw();
    }

    destroy() {
      this.resizeObserver.disconnect();
      cancelAnimationFrame(this.frame);
      this.canvas.removeEventListener('pointermove', this.onMove);
      this.canvas.removeEventListener('pointerleave', this.onLeave);
      registry.delete(this);
      this.container.textContent = '';
    }

    /** Draw-in animation (lines reveal left→right, bars grow) when options.animate is set. */
    startAnimation() {
      this.animStart = this.options.animate && TA.Effects && TA.Effects.on ? performance.now() : 0;
    }

    scheduleDraw() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw());
    }

    get length() {
      return Math.max(0, ...this.options.series.map((s) => s.data.length));
    }

    draw() {
      const { canvas, ctx, options } = this;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const n = this.length;
      this.empty.hidden = n > 0;
      if (!n) { this.layout = null; return; }

      const css = getComputedStyle(document.documentElement);
      const color = (v) => (v && v.startsWith('--') ? css.getPropertyValue(v).trim() : v);
      const muted = color('--muted');
      const border = color('--border');
      const font = `11px ${css.getPropertyValue('--font-mono')}`;

      const series = options.series;
      const hasRight = series.some((s) => s.axis === 'right');
      const pad = { top: 10, right: hasRight ? 42 : 12, bottom: 24, left: 42 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const banded = series.some((s) => s.type === 'bar');

      const scale = (axisName) => {
        const axisOpts = options[axisName] || {};
        const values = series.filter((s) => (s.axis || 'left') === axisName).flatMap((s) => s.data).filter(Number.isFinite);
        let min = axisOpts.min !== undefined ? axisOpts.min : Math.min(0, ...values);
        let max = axisOpts.max !== undefined ? axisOpts.max : Math.max(...values, min + 1);
        if (axisOpts.fit && values.length) {
          min = Math.max(axisOpts.floor !== undefined ? axisOpts.floor : -Infinity, Math.floor((Math.min(...values) - 2) / 5) * 5);
        }
        if (axisOpts.max === undefined) max = niceMax(max, min, axisOpts.integer);
        return { min, max, suffix: axisOpts.suffix || '' };
      };
      const axes = { left: scale('left') };
      if (hasRight) axes.right = scale('right');
      // private axes for series with axis: 'none' (e.g. error markers)
      series.forEach((s, i) => {
        if (s.axis === 'none') {
          const max = Math.max(1, ...s.data.filter(Number.isFinite));
          axes['none' + i] = { min: 0, max: max * 1.6 };
        }
      });

      const xAt = (i) => (banded
        ? pad.left + (i + 0.5) * (plotW / n)
        : pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW));
      const yAt = (v, axis) => pad.top + plotH - ((v - axis.min) / (axis.max - axis.min || 1)) * plotH;

      // Grid + axis labels
      ctx.font = font;
      ctx.lineWidth = 1;
      ctx.textBaseline = 'middle';
      const ticks = 4;
      for (let t = 0; t <= ticks; t++) {
        const y = Math.round(pad.top + (plotH / ticks) * t) + 0.5;
        ctx.strokeStyle = border;
        ctx.globalAlpha = t === ticks ? 1 : 0.6;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = muted;
        const lv = axes.left.max - ((axes.left.max - axes.left.min) / ticks) * t;
        ctx.textAlign = 'right';
        ctx.fillText(formatTick(lv) + axes.left.suffix, pad.left - 8, y);
        if (hasRight) {
          const rv = axes.right.max - ((axes.right.max - axes.right.min) / ticks) * t;
          ctx.textAlign = 'left';
          ctx.fillText(formatTick(rv) + axes.right.suffix, width - pad.right + 8, y);
        }
      }

      // X labels (at most ~7, evenly spaced)
      const labels = options.labels || [];
      if (labels.length) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = muted;
        const maxLabels = Math.max(2, Math.floor(plotW / 70));
        const step = Math.max(1, Math.ceil(n / maxLabels));
        for (let i = 0; i < n; i += step) {
          if (labels[i] !== undefined) ctx.fillText(labels[i], xAt(i), height - pad.bottom + 7);
        }
      }

      // Draw-in progress (0‥1)
      let progress = 1;
      if (this.animStart) {
        const raw = Math.min(1, (performance.now() - this.animStart) / (options.animDuration || 750));
        progress = 1 - (1 - raw) ** 3;
        if (raw >= 1) this.animStart = 0;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pad.left + plotW * progress + 6, height);
      ctx.clip();

      // Series
      series.forEach((s, si) => {
        const axis = s.axis === 'none' ? axes['none' + si] : axes[s.axis || 'left'];
        const c = color(s.color) || muted;
        const type = s.type || 'line';

        if (type === 'bar') {
          const bw = Math.min(36, Math.max(2, (plotW / n) * 0.62));
          ctx.fillStyle = c;
          s.data.forEach((v, i) => {
            if (!Number.isFinite(v) || v <= 0) return;
            const x = xAt(i) - bw / 2;
            const y = yAt(axis.min + (v - axis.min) * progress, axis);
            const h = pad.top + plotH - y;
            roundRect(ctx, x, y, bw, h, Math.min(3, bw / 2));
            ctx.globalAlpha = this.hoverIndex === -1 || this.hoverIndex === i ? 1 : 0.55;
            ctx.fill();
            ctx.globalAlpha = 1;
          });
          return;
        }

        if (type === 'scatter') {
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.8;
          s.data.forEach((v, i) => {
            if (!Number.isFinite(v) || v <= 0) return;
            const x = xAt(i), y = yAt(v, axis), r = 3.5;
            ctx.beginPath();
            ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
            ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
            ctx.stroke();
          });
          return;
        }

        // line
        const points = [];
        s.data.forEach((v, i) => { if (Number.isFinite(v)) points.push([xAt(i), yAt(v, axis)]); });
        if (!points.length) return;
        if (s.fill && points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(points[0][0], pad.top + plotH);
          points.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(points[points.length - 1][0], pad.top + plotH);
          ctx.closePath();
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.1;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = c;
        ctx.lineWidth = s.width || 2;
        ctx.lineJoin = 'round';
        ctx.setLineDash(s.dashed ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.points || points.length === 1) {
          ctx.fillStyle = c;
          points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); });
        }
      });

      ctx.restore();
      if (this.animStart) this.frame = requestAnimationFrame(() => this.draw());

      // Hover crosshair + highlighted points
      if (this.hoverIndex >= 0 && this.hoverIndex < n) {
        const x = Math.round(xAt(this.hoverIndex)) + 0.5;
        if (!banded) {
          ctx.strokeStyle = muted;
          ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
          ctx.globalAlpha = 1;
          series.forEach((s, si) => {
            if ((s.type || 'line') !== 'line') return;
            const v = s.data[this.hoverIndex];
            if (!Number.isFinite(v)) return;
            const axis = s.axis === 'none' ? axes['none' + si] : axes[s.axis || 'left'];
            ctx.fillStyle = color(s.color);
            ctx.beginPath(); ctx.arc(x, yAt(v, axis), 4, 0, Math.PI * 2); ctx.fill();
          });
        }
      }

      this.layout = { xAt, n, pad, plotW, banded, width };
    }

    onMove(event) {
      if (!this.layout) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const { pad, plotW, n, banded } = this.layout;
      let index = banded
        ? Math.floor(((x - pad.left) / plotW) * n)
        : Math.round(((x - pad.left) / plotW) * (n - 1));
      index = TA.Utils.clamp(index, 0, n - 1);
      if (index !== this.hoverIndex) {
        this.hoverIndex = index;
        this.draw();
      }
      const html = this.tooltipHtml(index);
      if (!html) { this.tip.hidden = true; return; }
      this.tip.innerHTML = html;
      this.tip.hidden = false;
      const px = this.layout.xAt(index);
      const tipW = this.tip.offsetWidth;
      const clampedX = TA.Utils.clamp(px, tipW / 2 + 4, this.layout.width - tipW / 2 - 4);
      this.tip.style.left = `${clampedX}px`;
      this.tip.style.top = `${pad.top + 4}px`;
    }

    onLeave() {
      this.hoverIndex = -1;
      this.tip.hidden = true;
      this.draw();
    }

    tooltipHtml(index) {
      if (this.options.tooltip) return this.options.tooltip(index);
      const label = (this.options.labels || [])[index];
      const rows = this.options.series
        .filter((s) => Number.isFinite(s.data[index]))
        .map((s) => `${escapeHtml(s.name)}: <b>${formatTick(s.data[index])}${s.suffix || ''}</b>`);
      return (label !== undefined ? `<div>${escapeHtml(String(label))}</div>` : '') + rows.join('<br>');
    }
  }

  function niceMax(max, min, integer) {
    const range = Math.max(1, max - min);
    const raw = range / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (integer) step = Math.max(1, Math.ceil(step));
    return min + step * 4 < max ? Math.ceil(max / step) * step : min + step * 4;
  }

  function formatTick(v) {
    if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v));
    return String(Math.round(v * 10) / 10);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  Chart.redrawAll = () => registry.forEach((c) => c.scheduleDraw());
  Chart.escapeHtml = escapeHtml;

  TA.Chart = Chart;
})(window.TA = window.TA || {});
