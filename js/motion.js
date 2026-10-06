/*
 * motion.js — macOS-style motion layer for the whole app.
 *
 *  - Sliding "glider" pill behind the active tab / nav item (spring easing).
 *  - Staggered reveal of panels whenever a page or dashboard tab is shown.
 *  - Magnetic hover + press ripple on buttons.
 *  - A soft spotlight that follows the mouse over panels.
 * Everything is purely visual and switches off with Settings → Animations
 * or the OS "reduce motion" setting (the CSS rules live under html[data-animations="on"]).
 */
(function (TA) {
  'use strict';
  const { $, $$ } = TA.Utils;
  const on = () => TA.Effects.on;

  /* ---------- sliding glider pills ---------- */
  function makeGlider(container, activeSelector) {
    if (!container) return () => {};
    container.classList.add('has-glider');
    const glider = document.createElement('span');
    glider.className = 'glider';
    glider.setAttribute('aria-hidden', 'true');
    container.prepend(glider);
    let first = true;
    const update = () => {
      const active = container.querySelector(activeSelector);
      if (!active || !active.offsetWidth) { glider.style.opacity = '0'; return; }
      glider.style.opacity = '1';
      if (first || !on()) glider.style.transition = 'none';
      glider.style.width = `${active.offsetWidth}px`;
      glider.style.height = `${active.offsetHeight}px`;
      glider.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      if (first || !on()) { void glider.offsetWidth; glider.style.transition = ''; first = false; }
    };
    new MutationObserver(update).observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current'] });
    window.addEventListener('resize', TA.Utils.throttle(update, 100));
    requestAnimationFrame(update);
    return update;
  }

  /* ---------- staggered reveal ---------- */
  function reveal(root) {
    if (!root || !on()) return;
    const items = $$(':scope .panel, :scope .results__top, :scope .stat-row, :scope .results__actions, :scope .page-head', root)
      .filter((n) => n.offsetParent !== null);
    items.forEach((n, i) => {
      n.classList.remove('reveal');
      n.style.setProperty('--d', String(Math.min(i, 8)));
    });
    void root.offsetWidth;
    items.forEach((n) => n.classList.add('reveal'));
  }

  function currentPage() { return $('.page:not([hidden])'); }

  /* ---------- press ripple ---------- */
  function ripple(e) {
    const btn = e.target.closest && e.target.closest('.btn, .chip, .tab, .option');
    if (!btn || !on() || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ripple';
    const size = Math.max(r.width, r.height) * 2.2;
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.left = `${e.clientX - r.left - size / 2}px`;
    dot.style.top = `${e.clientY - r.top - size / 2}px`;
    btn.append(dot);
    setTimeout(() => dot.remove(), 650);
  }

  /* ---------- spotlight on panels ---------- */
  function spotlight(e) {
    if (!on()) return;
    const panel = e.target.closest && e.target.closest('.panel');
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    panel.style.setProperty('--mx', `${e.clientX - r.left}px`);
    panel.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  const Motion = {
    init() {
      const nav = $('.nav');
      const tabs = $('.tabs');
      const updNav = makeGlider(nav, '[aria-current="page"]');
      const updTabs = makeGlider(tabs, '[aria-selected="true"]');
      window.addEventListener('hashchange', () => {
        requestAnimationFrame(() => { updNav(); updTabs(); reveal(currentPage()); });
      });
      if (tabs) tabs.addEventListener('click', () => requestAnimationFrame(() => { updTabs(); reveal($('.tabpanel:not([hidden])')); }));
      document.addEventListener('pointerdown', ripple);
      document.addEventListener('pointermove', TA.Utils.throttle(spotlight, 30));
      requestAnimationFrame(() => reveal(currentPage()));
    },
    reveal
  };

  TA.Motion = Motion;
})(window.TA = window.TA || {});
