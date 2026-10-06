/*
 * effects.js — JavaScript-driven animations: number count-up, confetti,
 * replaying CSS reveal animations. Everything respects the "Animations"
 * setting and the OS "reduce motion" preference.
 */
(function (TA) {
  'use strict';

  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const easeOutCubic = (x) => 1 - (1 - x) ** 3;
  const running = new WeakMap();

  const Effects = {
    get on() { return TA.Settings.get('animations') && !reduceMotion.matches; },

    /** Animate an element's number from 0 (or `from`) to `to`. */
    countUp(el, to, { from = 0, decimals = 0, suffix = '', duration = 800, delay = 0 } = {}) {
      const format = (v) => (decimals ? v.toFixed(decimals) : String(Math.round(v))) + suffix;
      cancelAnimationFrame(running.get(el));
      if (!Effects.on || !Number.isFinite(to)) { el.textContent = format(to); return; }
      el.textContent = format(from);
      const start = performance.now() + delay;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - start) / duration));
        el.textContent = format(from + (to - from) * easeOutCubic(p));
        if (p < 1) running.set(el, requestAnimationFrame(step));
      };
      running.set(el, requestAnimationFrame(step));
    },

    /** Restart a CSS animation class on an element (e.g. staggered reveal). */
    replay(el, className) {
      if (!el) return;
      el.classList.remove(className);
      if (!Effects.on) return;
      void el.offsetWidth; // force reflow so the animation starts again
      el.classList.add(className);
    },

    /** Lightweight canvas confetti burst. */
    confetti({ count = 140, origin = { x: 0.5, y: 0.35 } } = {}) {
      if (!Effects.on || !TA.Settings.get('confetti')) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'confetti';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.append(canvas);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const css = getComputedStyle(document.documentElement);
      const colors = ['--accent', '--warning', '--success', '--chart-3', '--text']
        .map((v) => css.getPropertyValue(v).trim()).filter(Boolean);

      const particles = Array.from({ length: count }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 9;
        return {
          x: w * origin.x, y: h * origin.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 6,
          size: 4 + Math.random() * 5,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
          color: colors[Math.floor(Math.random() * colors.length)],
          shape: Math.random() < 0.3 ? 'circle' : 'rect'
        };
      });

      const start = performance.now();
      const life = 2200;
      let last = start;
      const frame = (now) => {
        const dt = Math.min(2, (now - last) / 16.67);
        last = now;
        const t = (now - start) / life;
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        for (const p of particles) {
          p.vy += 0.28 * dt;
          p.vx *= 0.985;
          p.vy *= 0.985;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
        if (t < 1) requestAnimationFrame(frame);
        else canvas.remove();
      };
      requestAnimationFrame(frame);
    }
  };

  TA.Effects = Effects;
})(window.TA = window.TA || {});
