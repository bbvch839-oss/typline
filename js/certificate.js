/*
 * certificate.js — downloadable certificate for a test result.
 *
 * Drawn on a <canvas> (1600×1130, landscape A4 ratio) entirely offline:
 * border ornaments, your name, WPM / accuracy / level, test details, a gold
 * seal and a certificate number. The text follows the interface language
 * (English / O'zbekcha / Русский). "Download PNG" saves it as an image.
 */
(function (TA) {
  'use strict';
  const { $, round } = TA.Utils;

  const W = 1600;
  const H = 1130;
  const NAVY = '#1f2a44';
  const GOLD = '#c19a45';
  const GOLD_LIGHT = '#e6c77a';
  const INK = '#3b4152';
  const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';
  const SANS = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

  const TEXT = {
    en: {
      title: 'CERTIFICATE', sub: 'of typing speed', certifies: 'This is to certify that',
      passed: 'has completed the BBVCH type typing test with the following result',
      wpm: 'words per minute', acc: 'accuracy', level: 'level', consistency: 'consistency',
      mode: 'Mode', language: 'Language', date: 'Date', issued: 'Issued by', no: 'No.', noName: 'Your name',
      levels: ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'], locale: 'en-GB'
    },
    uz: {
      title: 'SERTIFIKAT', sub: "yozish tezligi bo'yicha", certifies: 'Ushbu sertifikat bilan tasdiqlanadiki,',
      passed: 'BBVCH type yozish testini quyidagi natija bilan muvaffaqiyatli topshirdi',
      wpm: "so'z / daqiqa", acc: 'aniqlik', level: 'daraja', consistency: 'barqarorlik',
      mode: 'Rejim', language: 'Til', date: 'Sana', issued: 'Beruvchi', no: '№', noName: 'Ismingiz',
      levels: ["Yangi o'rganuvchi", 'Boshlovchi', "O'rta", 'Yuqori', 'Ekspert', 'Usta'], locale: 'uz-UZ'
    },
    ru: {
      title: 'СЕРТИФИКАТ', sub: 'скорости печати', certifies: 'Настоящим подтверждается, что',
      passed: 'успешно прошел(а) тест печати BBVCH type со следующим результатом',
      wpm: 'слов в минуту', acc: 'точность', level: 'уровень', consistency: 'стабильность',
      mode: 'Режим', language: 'Язык', date: 'Дата', issued: 'Выдан', no: '№', noName: 'Ваше имя',
      levels: ['Новичок', 'Начинающий', 'Средний', 'Продвинутый', 'Эксперт', 'Мастер'], locale: 'ru-RU'
    }
  };

  function levelIndex(wpm) {
    if (wpm >= 100) return 5;
    if (wpm >= 80) return 4;
    if (wpm >= 60) return 3;
    if (wpm >= 40) return 2;
    if (wpm >= 25) return 1;
    return 0;
  }

  let result = null;
  let name = (TA.Storage.get(TA.Storage.KEYS.profile, {}, (p) => (p && typeof p === 'object' ? p : {})).name) || '';

  /* ======================= drawing helpers ======================= */

  function spaced(ctx, text, x, y, spacing) {
    // letter-spaced text centred on x
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = x - total / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
    ctx.textAlign = 'center';
  }

  function fitFont(ctx, text, weightStyle, size, family, maxWidth) {
    let s = size;
    do { ctx.font = `${weightStyle} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxWidth && s > 20);
  }

  function corner(ctx, x, y, sx, sy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 90); ctx.lineTo(0, 0); ctx.lineTo(90, 0);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI / 2);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(22, 10); ctx.lineTo(34, 22); ctx.lineTo(22, 34); ctx.lineTo(10, 22); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function seal(ctx, cx, cy, r, big, small) {
    ctx.save();
    // star-burst edge
    ctx.beginPath();
    const spikes = 36;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 ? r : r * 0.9;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, GOLD_LIGHT); g.addColorStop(1, GOLD);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#fff8e6';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = NAVY;
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(r * 0.5)}px ${SERIF}`;
    ctx.fillText(big, cx, cy + r * 0.12);
    fitFont(ctx, small.toUpperCase(), 'bold', Math.round(r * 0.17), SANS, r * 1.2);
    ctx.fillText(small.toUpperCase(), cx, cy + r * 0.42);
    ctx.restore();
  }

  function keyboardIcon(ctx, x, y, s) {
    ctx.save();
    ctx.strokeStyle = NAVY; ctx.fillStyle = NAVY; ctx.lineWidth = s * 0.08;
    const w = s * 1.6, h = s;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, s * 0.18); else ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.stroke();
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * s * 0.36, y - s * 0.12, s * 0.07, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - s * 0.4, y + s * 0.2); ctx.lineTo(x + s * 0.4, y + s * 0.2); ctx.stroke();
    ctx.restore();
  }

  /* ======================= the certificate ======================= */

  function draw(canvas, r, who) {
    // Certificates are always issued in English, whatever the interface language
    const T = TEXT.en;
    const t = (s) => s;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // paper
    const bg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
    bg.addColorStop(0, '#fffdf7'); bg.addColorStop(1, '#f3ead6');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // faint guilloche pattern
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, 120 + i * 26, 70 + i * 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // borders
    ctx.strokeStyle = NAVY; ctx.lineWidth = 16;
    ctx.strokeRect(34, 34, W - 68, H - 68);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
    ctx.strokeRect(62, 62, W - 124, H - 124);
    ctx.lineWidth = 1;
    ctx.strokeRect(72, 72, W - 144, H - 144);
    corner(ctx, 86, 86, 1, 1);
    corner(ctx, W - 86, 86, -1, 1);
    corner(ctx, 86, H - 86, 1, -1);
    corner(ctx, W - 86, H - 86, -1, -1);

    // brand
    keyboardIcon(ctx, W / 2 - 92, 150, 34);
    ctx.fillStyle = NAVY;
    ctx.font = `bold 34px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText('BBVCH', W / 2 - 58, 162);
    const bw = ctx.measureText('BBVCH ').width;
    ctx.fillStyle = GOLD;
    ctx.fillText('type', W / 2 - 58 + bw, 162);
    ctx.textAlign = 'center';

    // title
    ctx.fillStyle = NAVY;
    ctx.font = `bold 92px ${SERIF}`;
    spaced(ctx, T.title, W / 2, 285, 16);
    ctx.fillStyle = GOLD;
    ctx.font = `italic 34px ${SERIF}`;
    ctx.fillText(T.sub, W / 2, 338);
    // divider
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 220, 368); ctx.lineTo(W / 2 - 20, 368); ctx.moveTo(W / 2 + 20, 368); ctx.lineTo(W / 2 + 220, 368); ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(W / 2, 358); ctx.lineTo(W / 2 + 10, 368); ctx.lineTo(W / 2, 378); ctx.lineTo(W / 2 - 10, 368); ctx.closePath(); ctx.fill();

    // name
    ctx.fillStyle = INK;
    ctx.font = `28px ${SERIF}`;
    ctx.fillText(T.certifies, W / 2, 432);
    const shown = who && who.trim() ? who.trim() : T.noName;
    ctx.fillStyle = who && who.trim() ? NAVY : '#a9a293';
    fitFont(ctx, shown, 'italic bold', 78, SERIF, 1000);
    ctx.fillText(shown, W / 2, 522);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 380, 548); ctx.lineTo(W / 2 + 380, 548); ctx.stroke();
    ctx.fillStyle = INK;
    const passedText = r.exam ? 'has passed the BBVCH type certification exam with the following result' : T.passed;
    fitFont(ctx, passedText, '', 26, SERIF, 1150);
    ctx.fillText(passedText, W / 2, 596);

    // stats row
    // exam certificates carry the passed exam level (0 = Beginner … 4 = Master)
    const lvl = r.exam ? r.level + 1 : levelIndex(r.wpm);
    const stats = [
      [String(Math.round(r.wpm)), T.wpm],
      [`${Math.floor(r.acc)}%`, T.acc],
      [`${Math.round(r.consistency)}%`, T.consistency]
    ];
    const boxW = 300, gap = 40, startX = W / 2 - (boxW * 3 + gap * 2) / 2;
    stats.forEach(([value, label], i) => {
      const x = startX + i * (boxW + gap);
      ctx.fillStyle = 'rgba(193, 154, 69, 0.09)';
      ctx.strokeStyle = 'rgba(193, 154, 69, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, 632, boxW, 170, 18); else ctx.rect(x, 632, boxW, 170);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = NAVY;
      ctx.font = `bold ${i === 0 ? 96 : 76}px ${SERIF}`;
      ctx.fillText(value, x + boxW / 2, i === 0 ? 742 : 734);
      ctx.fillStyle = INK;
      fitFont(ctx, label.toUpperCase(), '600', 20, SANS, boxW - 30);
      ctx.fillText(label.toUpperCase(), x + boxW / 2, 780);
    });

    // details
    const locale = T.locale;
    let dateText;
    try { dateText = new Date(r.ts).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { dateText = TA.Utils.formatDate(r.ts); }
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const modeText = r.exam ? `Certification exam, ${r.rounds || 2} × 60 s` : t(TA.Statistics.modeLabel(r));
    const details = `${T.mode}: ${modeText}   ·   ${T.language}: ${cap(t(r.language))}   ·   ${T.date}: ${dateText}`;
    ctx.fillStyle = INK;
    fitFont(ctx, details, '', 24, SANS, 1000);
    ctx.fillText(details, W / 2, 852);

    // signature (left) and number
    ctx.textAlign = 'center';
    ctx.fillStyle = NAVY;
    ctx.font = `italic 44px ${SERIF}`;
    ctx.fillText('BBVCH type', 330, 960);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(190, 980); ctx.lineTo(470, 980); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `20px ${SANS}`;
    ctx.fillText(T.issued, 330, 1008);
    ctx.fillText(`${T.no} ${String(r.id).toUpperCase()}`, W / 2, r.code ? 985 : 1008);
    if (r.code) {
      ctx.font = `600 20px ${SANS}`;
      ctx.fillStyle = NAVY;
      ctx.fillText(`Verification code: ${r.code}`, W / 2, 1015);
    }

    // seal (right)
    seal(ctx, W - 310, 975, 100, String(Math.round(r.wpm)), `${T.levels[lvl]}`);
  }

  /* ======================= modal ======================= */

  /* ======================= dashboard: "Certificates" section ======================= */

  /* ======================= dashboard: "Certificates" section ======================= */

  /** Level name in the interface language (certificates themselves stay English). */
  function levelName(i) {
    const lang = (TA.I18n && TA.I18n.lang) || 'en';
    return (TEXT[lang] || TEXT.en).levels[i + 1];
  }

  let examLang = null;

  function renderDashboard() {
    const box = $('#certDash');
    if (!box || !TA.Exam) return;
    const { el, formatDate } = TA.Utils;
    const Exam = TA.Exam;
    const st = Exam.status();
    const progress = TA.Progress.compute(TA.History.all());
    if (!examLang) examLang = TA.App.getConfig().language;
    box.textContent = '';

    // ---- 1. what the exam is
    box.append(el('div', { class: 'panel exam-hero' }, [
      el('div', { class: 'exam-hero__seal', 'aria-hidden': 'true', text: '★' }),
      el('div', {}, [
        el('h2', { class: 'exam-hero__title', text: 'Certification exam' }),
        el('p', { class: 'muted', text: 'A certificate is not given for normal tests. You must pass a supervised exam that proves you really type this fast.' })
      ])
    ]));

    // ---- 2. rules
    const rules = [
      ['2 rounds × 60 seconds', 'Round 1: plain words. Round 2: punctuation and numbers. A fresh random text every time.'],
      ['No help', 'The keyboard guide, ghost and hints are hidden. You cannot restart a round.'],
      ['Stay in the window', 'Switching to another window, tab or page voids the attempt immediately.'],
      ['Only real typing counts', 'Pasting, auto-typers and machine-like rhythm are detected and void the attempt.'],
      ['3 attempts per day', 'Every started attempt counts, even if you quit.'],
      ['Your name is fixed', 'The name is written when the exam starts and cannot be changed on the certificate.']
    ];
    box.append(el('div', { class: 'panel' }, [
      el('h2', { class: 'panel__title', text: 'Exam rules' }),
      el('ol', { class: 'cert-steps' }, rules.map(([title, text], i) => el('li', {}, [
        el('span', { class: 'cert-steps__n', text: String(i + 1) }),
        el('div', {}, [el('b', { text: title }), el('p', { text: text })])
      ])))
    ]));

    // ---- 3. level requirements
    const table = el('div', { class: 'exam-levels' }, Exam.LEVELS.map((L, i) => {
      const ready = progress.avgWpm >= L.wpm && progress.avgAcc >= L.acc;
      return el('div', { class: `exam-level${ready ? ' is-ready' : ''}`, style: `--i:${i}` }, [
        el('b', { class: 'exam-level__name', 'data-no-i18n': '', text: levelName(i) }),
        el('span', { class: 'exam-level__req', 'data-no-i18n': '', text: `${L.wpm}+ wpm` }),
        el('span', { class: 'exam-level__req', 'data-no-i18n': '', text: `${L.acc}%+` }),
        el('span', { class: 'exam-level__hint', text: ready ? 'your average is enough' : 'keep practising' })
      ]);
    }));
    box.append(el('div', { class: 'panel' }, [
      el('h2', { class: 'panel__title', text: 'Levels — both speed and accuracy are required' }),
      el('p', { class: 'muted small', text: 'Speed = average of both rounds. Accuracy = all key presses of the exam. No single round may be more than 2% below the accuracy requirement.' }),
      table
    ]));

    // ---- 4. start
    const nameInput = el('input', { type: 'text', id: 'examName', maxlength: '40', placeholder: 'Full name for the certificate', autocomplete: 'name', value: name });
    const startBtn = el('button', { type: 'button', class: 'btn btn--primary btn--lg exam-start', text: 'Start the exam' });
    const langBox = el('div', { class: 'seg exam-langs' }, TA.WordSource.languages().map((lang) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(lang === examLang), 'data-no-i18n': '',
      text: { english: 'English', uzbek: "O'zbek", russian: 'Русский' }[lang] || lang,
      onclick: () => { examLang = lang; renderDashboard(); }
    })));
    let lockText = '';
    if (!st.unlocked) lockText = `Finish ${st.needTests} tests first to unlock the exam (${st.tests}/${st.needTests}).`;
    else if (!st.left) lockText = 'No attempts left today. Come back tomorrow.';
    const sync = () => {
      startBtn.disabled = !!lockText || nameInput.value.trim().length < 2;
    };
    nameInput.addEventListener('input', () => {
      name = nameInput.value.slice(0, 40);
      TA.Storage.set(TA.Storage.KEYS.profile, { name });
      sync();
    });
    startBtn.addEventListener('click', () => { if (!startBtn.disabled) Exam.start(nameInput.value, examLang); });
    sync();
    box.append(el('div', { class: 'panel exam-start-panel' }, [
      el('h2', { class: 'panel__title', text: 'Take the exam' }),
      el('div', { class: 'exam-start-grid' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Your name' }), nameInput]),
        el('div', { class: 'field' }, [el('span', { text: 'Typing language' }), langBox])
      ]),
      el('div', { class: 'exam-start-row' }, [
        startBtn,
        el('span', { class: 'exam-attempts' }, [el('span', { text: 'attempts left today' }), ' ', el('b', { 'data-no-i18n': '', text: `${st.left}/${Exam.MAX_ATTEMPTS}` })])
      ]),
      lockText ? el('p', { class: 'exam-lock', text: lockText }) : null
    ]));

    // ---- 5. earned certificates
    const list = Exam.certificates().slice().reverse();
    box.append(el('div', { class: 'panel' }, [
      el('h2', { class: 'panel__title', text: 'Your certificates' }),
      list.length
        ? el('div', { class: 'my-certs' }, list.map((c, i) => el('div', { class: 'my-cert', style: `--i:${i}` }, [
          el('div', { class: 'my-cert__seal', 'data-no-i18n': '', text: String(Math.round(c.wpm)) }),
          el('div', { class: 'my-cert__info' }, [
            el('b', { 'data-no-i18n': '', text: levelName(c.level) }),
            el('span', { 'data-no-i18n': '', text: `${Math.round(c.wpm)} wpm · ${round(c.acc, 1)}% · ${formatDate(c.ts)}` }),
            el('code', { 'data-no-i18n': '', text: c.code })
          ]),
          el('button', { type: 'button', class: 'btn btn--sm', text: 'Download', onclick: () => Certificate.open(c) })
        ])))
        : el('p', { class: 'muted', text: 'No certificates yet. Pass the exam to earn your first one.' })
    ]));
  }

  const Certificate = {
    renderDashboard,
    init() {
      const input = $('#certName');
      input.addEventListener('input', () => {
        if (result && result.exam) return;
        name = input.value.slice(0, 40);
        TA.Storage.set(TA.Storage.KEYS.profile, { name });
        if (result) draw($('#certCanvas'), result, name);
      });
      $('#certDownload').addEventListener('click', Certificate.download);
    },

    /** Can this result get a certificate? (saved, not failed, at least 15 s) */

    open(r) {
      if (!r) return;
      result = r;
      const input = $('#certName');
      // exam certificates keep the name written when the exam started
      input.value = r.name || name;
      input.readOnly = !!r.exam;
      draw($('#certCanvas'), r, input.value);
      TA.UI.Modal.open('certModal');
    },

    download() {
      if (!result) return;
      const canvas = $('#certCanvas');
      draw(canvas, result, result.exam ? result.name : name);
      const file = `bbvch-certificate-${Math.round(result.wpm)}wpm-${TA.Utils.dayKey(new Date(result.ts))}.png`;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        TA.UI.toast({ title: 'Certificate saved', text: file });
      }, 'image/png');
    },

    draw
  };

  TA.Certificate = Certificate;
})(window.TA = window.TA || {});
