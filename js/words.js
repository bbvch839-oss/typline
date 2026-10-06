/*
 * words.js — builds the text for a test from the local databases in /data.
 *  - Shuffle-bag selection: every word of a list is used once before any
 *    word repeats, and the same word never appears twice within a short window.
 *  - Optional punctuation (.,!?;:'"-()) and numbers.
 *  - Falls back to a built-in list if data/words.js is missing or empty.
 */
(function (TA) {
  'use strict';
  const { shuffle, pick, chance, randInt } = TA.Utils;

  const FALLBACK_WORDS = ('the be of and a to in he have it that for they with as not on she at by this we you do but from or which ' +
    'one would all will there say who make when can more if no man out other so what time up go about than into could state only new ' +
    'year some take come these know see use get like then first any work now may such give over think most even find day also after way ' +
    'many must look before great back through long where much should well people down own just because good each those feel seem how high ' +
    'too place little world very still nation hand old life tell write become here show house both between need mean call develop under ' +
    'last right move thing general school never same another begin while number part turn real leave might want point form off child few ' +
    'small since against ask late home interest large person end open public follow during present without again hold govern around possible ' +
    'head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line').split(' ');

  const FALLBACK_QUOTE = { id: 0, length: 'short', source: 'BBVCH type', text: 'Practice makes progress, and progress makes practice a pleasure.' };

  const LIST_NAMES = ['common', 'easy', 'medium', 'advanced'];

  function db() { return (window.TA_DATA && window.TA_DATA.words) || {}; }
  function quotesDb() { return (window.TA_DATA && window.TA_DATA.quotes) || {}; }

  function cleanList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const w of list) {
      if (typeof w !== 'string') continue;
      const word = w.trim();
      if (!word || /\s/.test(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
    return out;
  }

  const cache = new Map();
  function getList(language, listName) {
    const key = `${language}:${listName}`;
    if (cache.has(key)) return cache.get(key);
    const lang = db()[language] || db().english || {};
    let list = cleanList(lang[listName]);
    if (list.length < 10) list = cleanList([].concat(...LIST_NAMES.map((n) => lang[n] || [])));
    if (list.length < 10) list = FALLBACK_WORDS.slice();
    cache.set(key, list);
    return list;
  }

  class WordGenerator {
    constructor({ language = 'english', wordList = 'common', punctuation = false, numbers = false } = {}) {
      this.source = getList(language, wordList);
      this.punctuation = punctuation;
      this.numbers = numbers;
      this.bag = [];
      this.recent = [];
      this.capitalizeNext = true;
      this.recentWindow = Math.min(12, Math.floor(this.source.length / 2));
    }

    drawBase() {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (!this.bag.length) this.bag = shuffle(this.source);
        const word = this.bag.pop();
        if (!this.recent.includes(word) || attempt === 19) {
          this.recent.push(word);
          if (this.recent.length > this.recentWindow) this.recent.shift();
          return word;
        }
        this.bag.unshift(word); // try again later
      }
      return pick(this.source);
    }

    randomNumber() {
      const r = Math.random();
      if (r < 0.35) return String(randInt(0, 9));
      if (r < 0.65) return String(randInt(10, 99));
      if (r < 0.85) return String(randInt(100, 999));
      if (r < 0.93) return String(randInt(1900, 2030));
      return String(randInt(1000, 9999));
    }

    next() {
      let word = this.numbers && chance(0.12) ? this.randomNumber() : this.drawBase();
      if (!this.punctuation) return word;

      const isNumber = /^\d+$/.test(word);
      if (this.capitalizeNext && !isNumber) word = word[0].toUpperCase() + word.slice(1);
      this.capitalizeNext = false;

      const r = Math.random();
      if (r < 0.09) { word += '.'; this.capitalizeNext = true; }
      else if (r < 0.17) word += ',';
      else if (r < 0.195) { word += '!'; this.capitalizeNext = true; }
      else if (r < 0.22) { word += '?'; this.capitalizeNext = true; }
      else if (r < 0.235) word += ';';
      else if (r < 0.25) word += ':';
      else if (r < 0.28) word = `"${word}"`;
      else if (r < 0.30) word = `(${word})`;
      else if (r < 0.32 && !isNumber) word = `${word}-${this.drawBase()}`;
      else if (r < 0.335 && !isNumber && /[a-z]$/.test(word)) word += "'s";
      return word;
    }

    take(count) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(this.next());
      return out;
    }
  }

  let lastQuoteId = null;

  const WordSource = {
    LIST_NAMES,

    languages() {
      const langs = Object.keys(db()).filter((k) => db()[k] && typeof db()[k] === 'object');
      return langs.length ? langs : ['english'];
    },

    createGenerator(options) { return new WordGenerator(options); },

    /** Every word of a language (all lists merged) — used by practice mode. */
    allWords(language = 'english') {
      const lang = db()[language] || db().english || {};
      const list = cleanList([].concat(...LIST_NAMES.map((n) => lang[n] || [])));
      return list.length >= 10 ? list : FALLBACK_WORDS.slice();
    },

    /** length: 'short' | 'medium' | 'long' | 'all' */
    randomQuote(language = 'english', length = 'all') {
      const all = (quotesDb()[language] || quotesDb().english || [])
        .filter((q) => q && typeof q.text === 'string' && q.text.trim());
      let pool = length === 'all' ? all : all.filter((q) => q.length === length);
      if (!pool.length) pool = all;
      if (!pool.length) return FALLBACK_QUOTE;
      const choices = pool.length > 1 ? pool.filter((q) => q.id !== lastQuoteId) : pool;
      const quote = pick(choices);
      lastQuoteId = quote.id;
      return quote;
    },

    splitText(text) {
      return String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 2000);
    }
  };

  TA.WordSource = WordSource;
})(window.TA = window.TA || {});
