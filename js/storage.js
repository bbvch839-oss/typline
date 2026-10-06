/*
 * storage.js — the only module that touches localStorage.
 * Every read is wrapped in try/catch + sanitizer, so corrupted or
 * hand-edited data can never crash the app: it falls back to defaults.
 */
(function (TA) {
  'use strict';

  // Internal key prefix (kept from the first version so existing data is not lost).
  const PREFIX = 'tapline.v1.';
  const SCHEMA_VERSION = 1;

  const KEYS = {
    settings: 'settings',       // user preferences (theme, font, caret …)
    config: 'config',           // last test configuration (mode, length …)
    history: 'history',         // array of finished test results
    pbs: 'pbs',                 // personal bests cache keyed by mode
    achievements: 'achievements', // { id: unlockedTimestamp }
    goals: 'goals',             // { wpm, acc }
    analysis: 'analysis',       // long-term key / letter-pair / fatigue profile (analysis.js)
    ghosts: 'ghosts',           // best-run replays for the ghost race (ghost.js)
    profile: 'profile',         // { name } shown on certificates (certificate.js)
    exam: 'exam',               // { day, attempts } — daily exam attempt limit (exam.js)
    certificates: 'certificates' // certificates earned in the exam (exam.js)
  };

  let available = true;
  try {
    const probe = PREFIX + '__probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch (err) {
    available = false;
  }

  // In-memory fallback so the app still works (without persistence) in
  // browsers that block storage for file:// pages or private windows.
  const memory = new Map();

  function rawGet(key) {
    if (!available) return memory.has(key) ? memory.get(key) : null;
    try { return localStorage.getItem(PREFIX + key); } catch (err) { return null; }
  }

  function rawSet(key, value) {
    if (!available) { memory.set(key, value); return true; }
    try {
      localStorage.setItem(PREFIX + key, value);
      return true;
    } catch (err) {
      console.warn('[storage] write failed', key, err);
      return false;
    }
  }

  function rawRemove(key) {
    if (!available) { memory.delete(key); return; }
    try { localStorage.removeItem(PREFIX + key); } catch (err) { /* ignore */ }
  }

  const Storage = {
    KEYS,
    SCHEMA_VERSION,
    get isPersistent() { return available; },

    /**
     * Read and parse a key. `sanitize(value)` must return a valid value
     * or throw; on any failure `fallback` (cloned) is returned.
     */
    get(key, fallback, sanitize) {
      const text = rawGet(key);
      if (text === null) return clone(fallback);
      try {
        const parsed = JSON.parse(text);
        return sanitize ? sanitize(parsed) : parsed;
      } catch (err) {
        console.warn(`[storage] "${key}" is corrupted — using defaults.`, err);
        return clone(fallback);
      }
    },

    set(key, value) {
      let text;
      try { text = JSON.stringify(value); } catch (err) { return false; }
      const ok = rawSet(key, text);
      if (!ok && key === KEYS.history && Array.isArray(value)) {
        // Quota exceeded: drop per-second samples from older tests and retry.
        const slim = value.map((r, i) => (i < value.length - 50 ? Object.assign({}, r, { samples: undefined }) : r));
        return rawSet(key, JSON.stringify(slim));
      }
      return ok;
    },

    remove(key) { rawRemove(key); },

    /** Collect every key into one serialisable object. */
    exportAll() {
      const data = {};
      for (const key of Object.values(KEYS)) {
        const text = rawGet(key);
        if (text === null) continue;
        try { data[key] = JSON.parse(text); } catch (err) { /* skip corrupted key */ }
      }
      return {
        app: 'bbvch-type',
        schema: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data
      };
    },

    /** Restore from an export object. Throws on an invalid file. */
    importAll(payload) {
      if (!payload || typeof payload !== 'object' || !['bbvch-type', 'tapline'].includes(payload.app) || typeof payload.data !== 'object') {
        throw new Error('This file is not a BBVCH type export.');
      }
      for (const key of Object.values(KEYS)) {
        if (key in payload.data) rawSet(key, JSON.stringify(payload.data[key]));
      }
    },

    resetAll() {
      for (const key of Object.values(KEYS)) rawRemove(key);
    }
  };

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  TA.Storage = Storage;
})(window.TA = window.TA || {});
