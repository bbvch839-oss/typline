# BBVCH type — offline typing test

Monkeytype'dan ilhomlangan, lekin to'liq original dizayn va koddagi shaxsiy typing-test ilovasi.
HTML + CSS + Vanilla JS. Backend yo'q, internet yo'q, framework yo'q.

---

## 1. Ishga tushirish

1. `typing-app` papkasini istalgan joyga qo'ying.
2. `index.html` ni brauzerda oching (ikki marta bosish kifoya). Server shart emas.
3. Tayyor. Birinchi harfni bosganingizda timer boshlanadi.

> ES-modullar `file://` orqali ishlamagani uchun barcha fayllar oddiy `<script>` sifatida yuklanadi va
> bitta global nom maydoniga (`window.TA`) yoziladi. Shuning uchun `index.html` dagi skriptlar tartibi muhim.

---

## 2. Arxitektura va fayllar vazifasi

```
typing-app/
├── index.html            SPA skeleti: 4 sahifa (Test, Results, Dashboard, Settings), modallar
├── css/
│   ├── themes.css        Faqat rang tokenlari (--bg, --text, --accent, --error …) — 6 ta tema
│   ├── style.css         Barcha komponentlar (typing area, caret, panel, jadval, modal …)
│   └── responsive.css    Tablet (≤1024), telefon (≤720, ≤480), touch, reduced-motion
├── data/
│   ├── words.js          2800+ inglizcha so'z: common / easy / medium / advanced
│   └── quotes.js         Quote'lar: short / medium / long (public-domain yoki original)
├── js/
│   ├── utils.js          DOM helperlar, shuffle, sana/vaqt formatlash, throttle/debounce
│   ├── storage.js        localStorage ning YAGONA egasi: xavfsiz o'qish, export/import/reset
│   ├── ui.js             Modal (focus-trap), confirm(), toast bildirishnomalar
│   ├── settings.js       Sozlamalar sxemasi, default qiymatlar, Settings sahifasini generatsiya
│   ├── sound.js          Web Audio orqali sintez qilingan klik tovushi (audio fayl yo'q)
│   ├── charts.js         O'zimizning canvas grafik kutubxonasi (line / bar / scatter, tooltip)
│   ├── statistics.js     Barcha formulalar (WPM, raw, accuracy, consistency, streak, PB …)
│   ├── timer.js          Drift-siz 1 soniyalik timer (performance.now asosida)
│   ├── keyboard.js       Virtual klaviatura (ixtiyoriy, default OFF)
│   ├── words.js          So'z generatori: shuffle-bag, punctuation, numbers, quote tanlash
│   ├── typing.js         TYPING ENGINE: input, harflarni baholash, caret, qatorlar scroll
│   ├── achievements.js   22 ta achievement, tekshirish va notification
│   ├── history.js        Natijalar tarixi, PB keshi, History jadvali (sort/filter/delete)
│   ├── results.js        Results sahifasi: raqamlar, grafik, xatolar tahlili
│   ├── dashboard.js      Streak, goals, heatmap, bests/averages/totals, grafiklar
│   └── app.js            Hammasini bog'laydi: routing, config bar, HUD, shortcutlar, data
└── assets/icons/favicon.svg
```

(So'ralgan strukturaga bir nechta qo'shimcha modul qo'shildi — `ui.js`, `charts.js`, `sound.js`,
`words.js`, `results.js` — har bir fayl bitta vazifani bajarishi uchun.)

## 3. Data flow

```
data/words.js ─► WordSource ─► TypingEngine.prepare() ─► DOM (so'zlar bir marta render)
                                     │
  klaviatura ─► hidden <input> ─► diff ─► typeChar / deleteChar / submitWord
                                     │           │
                                     │           └─► faqat joriy so'z klasslari + caret transform
                                     ├─► Timer (har 1s) ─► per-second sample (wpm, raw, acc, err)
                                     └─► onLive (throttled ~8/s) ─► HUD
test tugadi ─► result obyekti ─► History.add() ─► localStorage (bir marta)
                                   ├─► PB qayta hisoblanadi
                                   ├─► Achievements.evaluate() ─► toast
                                   ├─► Results.show()
                                   └─► Dashboard.invalidate() (ko'ringanda qayta chiziladi)
```

## 4. localStorage tuzilishi

Hamma kalitlar `tapline.v1.` prefiksi bilan (ichki nom, eski ma'lumotlar yo'qolmasligi uchun o'zgartirilmagan):

| Kalit | Tarkib |
|---|---|
| `settings` | `{ theme, font, fontSize, caret, animations, liveWpm, liveAcc, liveDetails, focusMode, confirmRestart, sound, volume, keyboard, keyHint }` |
| `config` | `{ mode, time, words, quoteLength, punctuation, numbers, wordList, language, difficulty, custom:{type,time,words,text} }` |
| `history` | `[ result, … ]` (eng ko'pi 5000; oxirgi 300 tasi uchun per-second grafik saqlanadi) |
| `pbs` | `{ "time-60": { wpm, raw, acc, consistency, ts, id }, "words-25": … }` — history'dan qayta quriladi |
| `achievements` | `{ "wpm-100": 1790000000000, … }` (ochilgan vaqt) |
| `goals` | `{ wpm: 80, acc: 97 }` |

Bitta `result`:
```js
{ id, ts, mode:'time', mode2:'60', language, wordList, punctuation, numbers, difficulty, quote,
  duration, wpm, raw, acc, consistency,
  chars:[correct, incorrect, extra, missed], keystrokes:[correct, wrong], errors, wordsTyped,
  samples:{ wpm:[], raw:[], acc:[], err:[] }, missedKeys:{e:8}, missedWords:{their:2}, failed? }
```

Har bir o'qish `try/catch` + sanitizer orqali o'tadi: JSON buzilgan bo'lsa ilova crash bo'lmaydi,
default holatga qaytadi. localStorage butunlay bloklangan bo'lsa — xotirada ishlaydi va ogohlantiradi.

## 5. Typing engine qanday ishlaydi

* Yashirin `<input>` doim `" " + joriy so'z` qiymatini saqlaydi. Boshidagi bo'sh joy — **sentinel**:
  u yo'qolsa, foydalanuvchi bo'sh so'zda Backspace bosgan (telefon klaviaturalarida ham ishlaydi).
* Har `input` hodisasida yangi matn eski matn bilan solishtiriladi (diff) va o'chirish/qo'shish
  sifatida qayta o'ynaladi — tez yozish, autocorrect, IME bir xil yo'l bilan ishlaydi.
* Holatlar: **correct**, **incorrect** (kutilgan harf qizil ko'rinadi), **extra** (so'zdan ortiq harflar,
  max 20), **missed** (probel bosilganda yozilmay qolgan harflar), **incorrect word** (tagiga chiziq).
* Backspace: joriy so'zda harf o'chiradi; bo'sh so'zda — oldingi so'z **xato bo'lsa** unga qaytadi
  (to'g'ri so'zga qaytib bo'lmaydi). `Ctrl/Alt+Backspace` — butun so'zni o'chiradi.
* So'zlar test boshida bir marta render qilinadi; har bosishda faqat joriy so'z harflarining klassi
  yangilanadi, caret esa `transform` bilan suriladi. 3 qator ko'rinadi, faol qator doim 2-qatorda.
* Time rejimida so'zlar tugab qolmasligi uchun kerak bo'lganda 60 tadan qo'shiladi.
* Difficulty: Easy — oddiy; Medium — xato so'z yuborilsa test tugaydi; Hard — bitta xato harf ham tugatadi.

## 6. Formulalar

```
WPM         = (to'g'ri belgilar / 5) / daqiqa          (to'g'ri yozilgan so'zlardan keyingi probellar ham kiradi)
Raw WPM     = (barcha yozilgan belgilar / 5) / daqiqa   (xato va extra ham)
Accuracy    = to'g'ri bosishlar / jami bosishlar * 100  (keyin o'chirilgan xatolar ham hisobda)
Consistency = 100 * (1 − σ/μ), har soniyadagi raw WPM bo'yicha, 0‥100 oralig'ida
```
Live WPM ~8 marta/soniya yangilanadi; grafik uchun har soniyada sample olinadi.

## 7. Dashboard

Streak (joriy / eng uzun / faol kunlar), maqsadlar (oxirgi 10 test o'rtachasi bo'yicha progress),
yillik activity heatmap, best / average (hammasi va oxirgi 10) / totals, har rejim uchun PB kartalari,
4 ta grafik: WPM tarixi (+10 lik o'rtacha), accuracy tarixi, kunlik testlar (30 kun), haftalik progress (12 hafta).
History tabida: sana/rejim/davr/min-wpm bo'yicha filtr, ustun bosib sort, qatorni o'chirish, Clear History (tasdiq bilan).
Qatorni bosish — o'sha natijani grafigi bilan ochadi.

## 8. Offline tizim

`fetch`, CDN, Google Fonts, tashqi API — **hech biri yo'q**. Shriftlar tizim shriftlari, ikonalar inline SVG,
tovush Web Audio bilan generatsiya qilinadi, grafiklar o'zimizning canvas kodida. Export — `Blob` orqali,
Import — `FileReader` orqali. Faqat `index.html` ni ochish yetarli.

## 9. Responsive tizim

* `>1024px` — to'liq layout; `≤1024px` — dashboard 2 ustun;
* `≤720px` — nav faqat ikonalar, bitta ustun, klaviatura vizualizatori yashirin, shrift kichrayadi;
* `≤480px` — formalar bitta ustunda; touch qurilmalarda tugmalar ≥40px.
* Telefonda typing area'ga bosing — klaviatura ochiladi (input `font-size:16px`, iOS zoom qilmaydi).

---

## Ovoz va animatsiyalar

**Ovozlar** (hammasi Web Audio bilan generatsiya qilinadi, audio fayl yo'q — `js/sound.js`):
* 6 ta klaviatura profili: Soft click, Mechanical (default), Typewriter, Bubble, Retro 8-bit, Melodic (har harf pentatonik nota).
* Alohida xato tovushi, Backspace tovushi, probel uchun pastroq tovush.
* Test tugashi — qo'ng'iroq akkordi; yangi personal best — fanfara; fail — pasayuvchi ohang;
  achievement — ikki qo'ng'iroq; time rejimida oxirgi 3 soniyada tik-tak; ixtiyoriy UI kliklari.
* Settings → Sound: har birini alohida yoqish/o'chirish, balandlik, profil tanlanganda preview.

**Animatsiyalar** (`css/style.css` oxiridagi "ANIMATIONS & EFFECTS" bo'limi + `js/effects.js`):
* Harf to'g'ri yozilganda "pop", xato bo'lsa silkinadi, extra harf tushib keladi; xato so'z siljiydi.
* Yangi testda so'zlar ketma-ket blur bilan kirib keladi; caret yorug'lik beradi va "nafas oladi".
* Oxirgi 5 soniyada timer qizarib pulsatsiya qiladi; fail bo'lsa matn maydoni silkinadi.
* Results: raqamlar 0 dan sanab chiqadi, bloklar ketma-ket ko'tariladi, grafik chapdan o'ngga chiziladi,
  PB'da konfetti + nishon porlaydi. Dashboard: panellar ketma-ket paydo bo'ladi, progress bar to'ladi,
  streak raqami porlaydi, grafik va barlar o'sadi. Tema almashganda ranglar silliq o'tadi.
* Settings → Appearance: Animations (hammasi), Typing effects, Celebrations (konfetti).
  Tizimda "reduce motion" yoqilgan bo'lsa animatsiyalar avtomatik o'chadi.

Yangi ovoz profili qo'shish: `js/sound.js` dagi `PROFILES` ga funksiya yozing, keyin
`js/settings.js` dagi `soundProfile` variantlariga qo'shing.

---

## Tahlil va o'rgatish tizimi (`js/analysis.js`, `css/analysis.css`)

- **Klaviatura issiqlik xaritasi** — Results sahifasida va Dashboard → Analysis'da. `errors` rejimi: qaysi tugmada xato ko'p (qizil). `speed` rejimi: qaysi tugma o'rtachadan sekin (sariq) yoki tez (yashil). Tugma ustiga sichqoncha olib borilsa aniq raqamlar chiqadi.
- **Barmoq tahlili** — har bir tugma QWERTY bo'yicha qaysi barmoqqa tegishli ekanini biladi. Xato foizi va o'rtacha vaqt har bir barmoq uchun ko'rsatiladi, eng zaif va eng sekin barmoq yozib beriladi.
- **Aqlli mashq (`practice` rejimi)** — so'zlar sizning eng zaif harf va harf juftliklaringiz (masalan `po`, `sh`) ko'p uchraydigan so'zlardan tuziladi (75 %), qolgani oddiy so'zlar. Kamida ~150 ta bosish yig'ilgandan keyin shaxsiylashadi.
- **Charchoq grafigi** — 15 s dan uzun testlarda boshlang'ich tezlik bilan oxirgi 30 % solishtiriladi: "After 15s your speed dropped by 12%". Dashboard'da oxirgi 10 ta uzun test bo'yicha umumiy xulosa bor.

Ma'lumot: har bir natijada `analysis.keys` (shu testdagi tugmalar), localStorage'dagi `tapline.v1.analysis` kalitida esa uzoq muddatli profil (tugmalar, harf juftliklari, charchoq). Eski ma'lumot har testda 3 % "so'nadi", shuning uchun profil hozirgi zaif joylaringizni ko'rsatadi. Export/import va "Reset all data" bu kalitni ham qamraydi.

## Tillar, klaviatura yo'riqchisi va daraxt

- **Yozish tillari** — english, o'zbek (lotin, `o'`/`g'` apostrof bilan), русский. Test sahifasidagi til tugmalari bilan tanlanadi. So'zlar: `data/words-uz.js`, `data/words-ru.js`; iqtiboslar: `data/quotes-intl.js`.
- **Interfeys tili** — EN / UZ / RU (yuqoridagi globus tugmasi yoki Sozlamalar → Language). Tarjimalar `data/i18n.js` da: har qator `[English, O'zbekcha, Русский]`. `js/i18n.js` sahifadagi inglizcha matnlarni avtomatik almashtiradi, shuning uchun yangi matn qo'shsangiz faqat lug'atga qator qo'shish kifoya. Konsolda `TA.I18n.missing()` hali tarjima qilinmagan matnlarni ko'rsatadi.
- **Klaviatura + qo'llar** (`js/layout.js`, `js/keyboard.js`, `css/guide.css`) — matn ostida TypingClub'ga o'xshash klaviatura: keyingi tugma yonadi, kerakli barmoq o'sha tugmaga boradi, katta harf/belgi uchun Shift va qarama-qarshi jimjiloq ham ko'rsatiladi. Rus tilida ЙЦУКЕН joylashuvi chiqadi. Sozlamalar → Keyboard guide: qo'llar bilan / faqat klaviatura / o'chiq.
- **O'sadigan daraxt** (`js/tree.js`) — bir kunda jami 60 soniya yozsangiz daraxt "sug'oriladi" va o'sadi (urug' → nihol → ko'chat → yosh daraxt → daraxt → 21 kundan gullaydi → 45 kundan meva beradi). Bir kun o'tkazib yuborish kechiriladi, keyin har kuni suv 25 % kamayadi: barglar sarg'ayadi va to'kiladi, 0 % da daraxt quriydi va o'sishining yarmini yo'qotadi. Statistika → Overview va har test natijasida ko'rinadi.

## Arvoh poyga va sertifikat

- **Arvoh poyga** (`js/ghost.js`) — har bir test yozuvi (qaysi millisekundda nechanchi belgida edingiz) saqlanadi. Har bir rejim + til uchun eng tez natija "arvoh" bo'ladi. Keyingi shunday testda binafsha arvoh kursor o'sha natijani xuddi o'sha tezlik va to'xtashlar bilan qaytaradi, HUD'da esa necha belgi oldinda/ortda ekaningiz ko'rinadi. Arvohni yutsangiz, yangi natija arvohga aylanadi. Sozlamalar → Ghost race bilan o'chiriladi.
- **Sertifikat imtihoni** (`js/exam.js`, `js/certificate.js`) — sertifikat oddiy testlar uchun BERILMAYDI, faqat imtihondan o'tganda. Imtihon 10 ta testdan keyin ochiladi, kuniga 3 ta urinish. 2 raund × 60 s (so'zlar; tinish belgilari + raqamlar), yo'riqchi/arvoh yashiriladi, qayta boshlab bo'lmaydi. Boshqa oynaga o'tish, matn qo'yish, avto-yozuvchi (tugma bosilmasdan yozish), mashinadek bir xil ritm yoki imkonsiz tezlik urinishni bekor qiladi. Darajalar (tezlik VA aniqlik): Boshlovchi 30/92%, O'rta 45/94%, Yuqori 60/95%, Ekspert 80/96%, Usta 100/97%. Ism imtihon boshida yoziladi va o'zgarmaydi; sertifikatda tekshiruv kodi (BT-XXXX-XXXX-XXXX) bor. Eslatma: ilova offline bo'lgani uchun to'liq himoya faqat server bilan mumkin.

## Rank, daraja (LVL) va animatsiyalar

- **Rank** (`js/progress.js`) — mahoratni o'lchaydi. Reyting = tezlik × aniqlik³, oxirgi 10 ta jiddiy testning (15 s+, yiqilmagan) o'rtachasi. Avval 3 ta saralash testi kerak. Ranklar: Bronza 0 · Kumush 25 · Oltin 40 · Platina 55 · Olmos 70 · Usta 90 · Grandmaster 110; har birida III → II → I pog'onalar.
- **Daraja (LVL / XP)** — mehnatni o'lchaydi: har bir so'z 1 XP, 95%/98% aniqlik uchun +20%/+40%, test tugatish +10, kunning birinchi testi +25, ketma-ketlik har kuni +3, yangi rekord +50. n → n+1 daraja uchun 100 + 20·(n−1) XP.
- Hammasi tarixdan hisoblanadi (eksport/import saqlaydi). Yuqori menyuda rank nishoni + LVL, natijalarda XP halqasi va rank kartasi, Statistika → "Rank & level" bo'limi, daraja/rank oshganda to'liq ekranli bayram animatsiyasi.
- **Silliq animatsiyalar** (`js/motion.js`, `css/motion.css`) — macOS uslubidagi prujinali harakatlar: sahifalar blur bilan paydo bo'ladi, menyu va tablar ostida siljiydigan "tabletka", panellar ketma-ket chiqadi, tugmalarda to'lqin (ripple), panellarda sichqonchani kuzatuvchi yorug'lik, modal oynalar orqasi xiralashadi. Sozlamalar → Animations = Off hammasini o'chiradi.

## Klaviatura yorliqlari

| Tugma | Amal |
|---|---|
| `Tab` | Yangi test (results sahifasida ham) |
| `Esc` | Modalni yopish / testni o'sha so'zlar bilan qayta boshlash |
| `Ctrl + Enter` | Custom test oynasi |
| `Ctrl + D` | Dashboard |
| `Ctrl + ,` | Settings |
| `Ctrl/Alt + Backspace` | So'zni o'chirish |

---

## Qanday qilib…

### Yangi so'z qo'shish
`data/words.js` ni oching va kerakli ro'yxatga (`common`, `easy`, `medium`, `advanced`) kichik harfli so'z
qo'shing: `"keyboard", "rhythm",`. Takrorlar va bo'sh joyli yozuvlar avtomatik o'tkazib yuboriladi.
Yangi til: `english` yonida `uzbek: { common: [...], easy: [...], medium: [...], advanced: [...] }` qo'shing —
u Custom test oynasidagi Language ro'yxatida o'zi paydo bo'ladi. Quote qo'shish: `data/quotes.js` ga
`{ id: 300, length: "medium", source: "…", text: "…" }`.

### Yangi theme qo'shish
1. `css/themes.css` da bitta blokni nusxalang, selektorni `[data-theme="ocean"]` qiling va ranglarni o'zgartiring
   (barcha tokenlar bo'lishi kerak).
2. `js/settings.js` dagi `THEMES` ro'yxatiga `{ value: 'ocean', label: 'Ocean', swatch: '#…', bg: '#…' }` qo'shing.

### Yangi typing mode qo'shish
1. `index.html` config bar'iga `<button class="chip" data-mode="mymode">mymode</button>` qo'shing.
2. `js/app.js` → `OPTIONS.modes` ga `'mymode'` qo'shing va `renderConfigBar()` da uning qiymat chiplarini chizing.
3. `js/typing.js` → `buildPlan()` ga `case 'mymode':` qo'shing. Plan quyidagilarni qaytarishi kerak:
   `mode`, `mode2`, `limitType` (`'time'` yoki `'words'`), `limit`, ixtiyoriy `fixedWords` (tayyor so'zlar)
   yoki `loopWords`. Engine, natijalar, PB va history qolganini o'zi qiladi.
4. `js/history.js` → `MODES` ga va `statistics.js` → `modeLabel()` ga yangi rejimni qo'shing.

### Data export / import
Settings → **Data**:
* **Export data** — `bbvch-type-backup-YYYY-MM-DD.json` faylini yuklab oladi (history, settings, config, PB, achievements, goals).
* **Import data** — shu faylni tanlang, tasdiqlang; joriy ma'lumotlar backup bilan almashtiriladi.
* **Reset all data** — tasdiqdan so'ng hamma narsani o'chiradi.

Eslatma: localStorage brauzer va papka joyiga bog'liq. Boshqa brauzer yoki kompyuterga o'tsangiz — Export/Import qiling.
