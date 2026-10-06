/*
 * sound.js — every sound is synthesized with the Web Audio API.
 * No audio files and no network: works fully offline.
 *
 *   Sound.play('key' | 'error' | 'space' | 'back', char)  — keystrokes
 *   Sound.event('finish' | 'pb' | 'fail' | 'achievement' | 'tick' | 'ui' | 'start')
 *
 * Keyboard profiles live in PROFILES below. To add a new one, write a
 * function (t, opts) that schedules sounds, then register it in
 * settings.js (soundProfile options).
 */
(function (TA) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      ctx = new AudioCtx();
      // master → compressor → speakers (prevents clipping when sounds overlap)
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  const vol = () => (TA.Settings.get('volume') / 100) * 0.9;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------------- synthesis primitives ---------------- */

  /** Filtered noise burst with an exponential decay. */
  function noise(t, { dur = 0.03, type = 'bandpass', freq = 2000, q = 1, gain = 0.5 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = rand(0.9, 1.1);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.15, dur + 0.02);
  }

  /** Oscillator with pitch sweep and attack/decay envelope. */
  function tone(t, { type = 'sine', f0 = 440, f1 = null, dur = 0.08, gain = 0.3, attack = 0.002, sweep = null } = {}) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + (sweep || dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Soft bell: fundamental + inharmonic partial. */
  function bell(t, freq, { dur = 0.6, gain = 0.25 } = {}) {
    tone(t, { type: 'sine', f0: freq, dur, gain, attack: 0.004 });
    tone(t, { type: 'sine', f0: freq * 2.76, dur: dur * 0.5, gain: gain * 0.35, attack: 0.002 });
    tone(t, { type: 'triangle', f0: freq * 2, dur: dur * 0.3, gain: gain * 0.2, attack: 0.002 });
  }

  const note = (semitonesFromA4) => 440 * 2 ** (semitonesFromA4 / 12);
  const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // C major pentatonic, two octaves
  const C5 = 3; // semitones from A4

  /* ---------------- keyboard profiles ---------------- */
  // opts: { kind: 'key'|'space'|'back', char, pitch, gain }

  const PROFILES = {
    soft(t, o) {
      const low = o.kind === 'space';
      noise(t, { type: 'bandpass', freq: low ? 900 : rand(2000, 2800) * o.pitch, q: 0.9, dur: 0.03, gain: 0.5 * o.gain });
      tone(t, { f0: (low ? 260 : rand(400, 480)) * o.pitch, f1: 200, dur: 0.06, gain: 0.3 * o.gain });
    },

    mechanical(t, o) {
      const low = o.kind === 'space';
      // bottom-out thock
      noise(t, { type: 'lowpass', freq: (low ? 700 : 1300) * o.pitch, q: 0.7, dur: low ? 0.07 : 0.045, gain: (low ? 1 : 0.8) * o.gain });
      tone(t, { f0: (low ? 110 : rand(150, 175)) * o.pitch, f1: 70, dur: 0.07, gain: 0.45 * o.gain });
      // switch click on release
      noise(t + rand(0.018, 0.03), { type: 'highpass', freq: 3200, q: 0.8, dur: 0.012, gain: 0.25 * o.gain });
    },

    typewriter(t, o) {
      if (o.kind === 'space') {
        noise(t, { type: 'bandpass', freq: 260, q: 1.2, dur: 0.09, gain: 0.9 * o.gain });
        tone(t, { type: 'triangle', f0: 120, f1: 80, dur: 0.08, gain: 0.3 * o.gain });
        return;
      }
      noise(t, { type: 'highpass', freq: 2600 * o.pitch, q: 0.7, dur: 0.018, gain: 0.9 * o.gain });
      tone(t, { type: 'square', f0: rand(1600, 1900) * o.pitch, f1: 1100, dur: 0.012, gain: 0.06 * o.gain });
      noise(t + 0.004, { type: 'bandpass', freq: 420, q: 1, dur: 0.05, gain: 0.45 * o.gain });
    },

    bubble(t, o) {
      const base = (o.kind === 'space' ? 260 : rand(480, 760)) * o.pitch;
      tone(t, { type: 'sine', f0: base, f1: base * 1.9, sweep: 0.05, dur: 0.09, gain: 0.45 * o.gain, attack: 0.004 });
    },

    retro(t, o) {
      const code = o.char ? o.char.toLowerCase().charCodeAt(0) : 97;
      const f = o.kind === 'space' ? 220 : 440 * 2 ** (((code - 97) % 12) / 12);
      tone(t, { type: 'square', f0: f * o.pitch, dur: 0.045, gain: 0.12 * o.gain, attack: 0.001 });
    },

    melodic(t, o) {
      const code = o.char ? o.char.toLowerCase().charCodeAt(0) : 0;
      const step = o.kind === 'space' ? -12 : PENTATONIC[code % PENTATONIC.length];
      const f = note(C5 + step) * o.pitch;
      tone(t, { type: 'triangle', f0: f, dur: 0.28, gain: 0.22 * o.gain, attack: 0.004 });
      tone(t, { type: 'sine', f0: f * 2, dur: 0.14, gain: 0.07 * o.gain, attack: 0.003 });
    }
  };

  function errorSound(t) {
    const profile = TA.Settings.get('soundProfile');
    if (profile === 'melodic' || profile === 'bubble') {
      tone(t, { type: 'sine', f0: 330, f1: 150, dur: 0.14, gain: 0.3 });
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /* ---------------- event sounds ---------------- */

  const EVENTS = {
    start(t) { tone(t, { f0: note(C5), f1: note(C5 + 7), sweep: 0.08, dur: 0.12, gain: 0.12 }); },
    tick(t) { tone(t, { f0: 1320, dur: 0.05, gain: 0.14, attack: 0.001 }); },
    ui(t) { noise(t, { type: 'highpass', freq: 4000, dur: 0.012, gain: 0.18 }); },
    finish(t) {
      [0, 4, 7].forEach((s, i) => bell(t + i * 0.09, note(C5 + s), { dur: 0.55, gain: 0.2 }));
    },
    pb(t) {
      [0, 4, 7, 12].forEach((s, i) => bell(t + i * 0.1, note(C5 + s), { dur: 0.7, gain: 0.22 }));
      [16, 19, 24].forEach((s, i) => bell(t + 0.45 + i * 0.06, note(C5 + s), { dur: 0.9, gain: 0.12 }));
    },
    fail(t) {
      [7, 3, 0].forEach((s, i) => tone(t + i * 0.12, { type: 'triangle', f0: note(C5 - 12 + s), dur: 0.3, gain: 0.22, attack: 0.005 }));
    },
    achievement(t) {
      bell(t, note(C5 + 16), { dur: 0.6, gain: 0.2 });
      bell(t + 0.12, note(C5 + 23), { dur: 0.9, gain: 0.18 });
    }
  };

  function ready() {
    if (!TA.Settings.get('sound') || TA.Settings.get('volume') === 0) return false;
    if (!ensureContext()) return false;
    master.gain.value = vol();
    return true;
  }

  const Sound = {
    PROFILES: Object.keys(PROFILES),

    /** Keystroke sound. kind: 'key' | 'error' | 'space' | 'back' */
    play(kind = 'key', char = '') {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      if (kind === 'error' && TA.Settings.get('errorSound')) { errorSound(t); return; }
      const profile = PROFILES[TA.Settings.get('soundProfile')] || PROFILES.soft;
      profile(t, {
        kind: kind === 'error' ? 'key' : kind,
        char,
        pitch: kind === 'back' ? 0.8 : rand(0.97, 1.03),
        gain: kind === 'back' ? 0.6 : 1
      });
    },

    /** Non-typing sounds (result, achievement, countdown, UI). */
    event(name) {
      if (!ready()) return;
      if (name === 'ui' && !TA.Settings.get('uiSounds')) return;
      if (name !== 'ui' && !TA.Settings.get('eventSounds')) return;
      const fn = EVENTS[name];
      if (fn) fn(ctx.currentTime + 0.005);
    },

    /** Short demo used when the user changes a sound setting. */
    preview() {
      if (!ready()) return;
      const demo = 'type';
      [...demo].forEach((ch, i) => setTimeout(() => Sound.play('key', ch), i * 90));
      setTimeout(() => Sound.play('space'), demo.length * 90);
    }
  };

  TA.Settings.onChange((key) => {
    if (key === 'soundProfile' || key === 'volume' || (key === 'sound' && TA.Settings.get('sound'))) Sound.preview();
    if (key === 'errorSound' && TA.Settings.get('errorSound')) Sound.play('error');
    if (key === 'eventSounds' && TA.Settings.get('eventSounds')) Sound.event('finish');
  });

  TA.Sound = Sound;
})(window.TA = window.TA || {});
