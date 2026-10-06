/*
 * statistics.js — every formula lives here (pure functions, no DOM).
 *
 *   WPM         = (correct characters / 5) / elapsed minutes
 *   Raw WPM     = (all typed characters / 5) / elapsed minutes
 *   Accuracy    = correct keystrokes / total keystrokes * 100
 *   Consistency = 100 * (1 - σ/μ) of the per-second raw WPM, clamped 0‥100
 */
(function (TA) {
  'use strict';
  const { mean, stdDev, clamp, round, dayKey, addDays, startOfWeek } = TA.Utils;

  const Statistics = {
    wpm(chars, ms) {
      if (ms <= 0) return 0;
      return (chars / 5) / (ms / 60000);
    },

    accuracy(correct, total) {
      return total > 0 ? (correct / total) * 100 : 100;
    },

    consistency(rawPerSecond) {
      const values = rawPerSecond.filter(Number.isFinite);
      if (values.length < 2) return 100;
      const m = mean(values);
      if (m === 0) return 0;
      return clamp(100 * (1 - stdDev(values) / m), 0, 100);
    },

    /**
     * Compare typed text of one word with its target.
     * `complete` = word was submitted with space (untyped letters count as missed).
     */
    compareWord(target, typed, complete) {
      let correct = 0, incorrect = 0, extra = 0, missed = 0;
      const len = Math.min(target.length, typed.length);
      for (let i = 0; i < len; i++) {
        if (typed[i] === target[i]) correct++; else incorrect++;
      }
      if (typed.length > target.length) extra = typed.length - target.length;
      if (complete && target.length > typed.length) missed = target.length - typed.length;
      return { correct, incorrect, extra, missed, isCorrect: typed === target };
    },

    /** Key used to group personal bests: "time-60", "words-25", "quote-short", "custom-time-45" … */
    modeKey(result) {
      return `${result.mode}-${result.mode2}`;
    },

    modeLabel(result) {
      switch (result.mode) {
        case 'time': return `time ${result.mode2}s`;
        case 'words': return `words ${result.mode2}`;
        case 'quote': return `quote ${result.mode2}`;
        case 'practice': return `practice ${result.mode2}`;
        case 'custom': {
          const [type, value] = String(result.mode2).split('-');
          if (type === 'text') return 'custom text';
          return type === 'time' ? `custom ${value}s` : `custom ${value} words`;
        }
        default: return result.mode;
      }
    },

    /** Personal best per mode key (highest WPM, ties broken by accuracy). */
    personalBests(history) {
      const pbs = {};
      for (const r of history) {
        if (r.failed) continue;
        const key = Statistics.modeKey(r);
        const current = pbs[key];
        if (!current || r.wpm > current.wpm || (r.wpm === current.wpm && r.acc > current.acc)) {
          pbs[key] = { wpm: r.wpm, raw: r.raw, acc: r.acc, consistency: r.consistency, ts: r.ts, id: r.id };
        }
      }
      return pbs;
    },

    summary(history) {
      const valid = history.filter((r) => !r.failed);
      const pick = (field) => valid.map((r) => r[field]);
      const best = (field) => (valid.length ? Math.max(...pick(field)) : 0);
      const avg = (list, field) => (list.length ? mean(list.map((r) => r[field])) : 0);
      const recent = valid.slice(-10);
      const totalChars = history.reduce((s, r) => s + (r.chars ? r.chars[0] + r.chars[1] + r.chars[2] : 0), 0);
      return {
        count: history.length,
        best: { wpm: best('wpm'), acc: best('acc'), consistency: best('consistency'), raw: best('raw') },
        average: {
          wpm: avg(valid, 'wpm'), acc: avg(valid, 'acc'), consistency: avg(valid, 'consistency'), raw: avg(valid, 'raw')
        },
        recent: {
          wpm: avg(recent, 'wpm'), acc: avg(recent, 'acc'), consistency: avg(recent, 'consistency'), raw: avg(recent, 'raw')
        },
        totals: {
          tests: history.length,
          words: history.reduce((s, r) => s + (r.wordsTyped || 0), 0),
          chars: totalChars,
          time: history.reduce((s, r) => s + (r.duration || 0), 0)
        }
      };
    },

    /** Map of "YYYY-MM-DD" → number of tests that day. */
    activityByDay(history) {
      const map = new Map();
      for (const r of history) {
        const key = dayKey(r.ts);
        map.set(key, (map.get(key) || 0) + 1);
      }
      return map;
    },

    streaks(history) {
      const byDay = Statistics.activityByDay(history);
      const days = Array.from(byDay.keys()).sort();
      let longest = 0, run = 0, prev = null;
      for (const key of days) {
        const d = TA.Utils.dayFromKey(key);
        run = prev && dayKey(addDays(prev, 1)) === key ? run + 1 : 1;
        longest = Math.max(longest, run);
        prev = d;
      }
      // Current streak: counts back from today (or yesterday, if today is still empty)
      let current = 0;
      let cursor = new Date();
      if (!byDay.has(dayKey(cursor))) cursor = addDays(cursor, -1);
      while (byDay.has(dayKey(cursor))) { current++; cursor = addDays(cursor, -1); }
      return { current, longest, activeDays: byDay.size, byDay };
    },

    testsPerDay(history, days = 30) {
      const byDay = Statistics.activityByDay(history);
      const labels = [], data = [];
      const today = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = addDays(today, -i);
        labels.push(TA.Utils.formatShortDate(d));
        data.push(byDay.get(dayKey(d)) || 0);
      }
      return { labels, data };
    },

    weeklyProgress(history, weeks = 12) {
      const thisWeek = startOfWeek(new Date());
      const buckets = [];
      for (let i = weeks - 1; i >= 0; i--) buckets.push({ start: addDays(thisWeek, -7 * i), wpm: [], acc: [] });
      for (const r of history) {
        if (r.failed) continue;
        const ws = startOfWeek(new Date(r.ts)).getTime();
        const bucket = buckets.find((b) => b.start.getTime() === ws);
        if (bucket) { bucket.wpm.push(r.wpm); bucket.acc.push(r.acc); }
      }
      return {
        labels: buckets.map((b) => TA.Utils.formatShortDate(b.start)),
        wpm: buckets.map((b) => (b.wpm.length ? round(mean(b.wpm), 1) : NaN)),
        acc: buckets.map((b) => (b.acc.length ? round(mean(b.acc), 1) : NaN)),
        counts: buckets.map((b) => b.wpm.length)
      };
    },

    /** Simple moving average used as a trend line. */
    movingAverage(values, size = 10) {
      const out = [];
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= size) sum -= values[i - size];
        out.push(sum / Math.min(i + 1, size));
      }
      return out;
    },

    topEntries(map, limit = 8) {
      return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
    }
  };

  TA.Statistics = Statistics;
})(window.TA = window.TA || {});
