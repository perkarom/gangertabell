'use strict';

/* ---------- Konstanter & ren logik (testbar i node) ---------- */
const APP_VERSION = '27';
// Nyheter som visas en gång per spelare efter en uppdatering (bara sådant som rör barnet)
const NEWS = [
  { v: 21, items: ['📅 I <b>Min statistik</b> ser du nu hur mycket du övat <b>varje dag</b>.'] },
  { v: 22, items: ['👑 Tabeller du redan kan får en <b>krona</b>. De ger inga poäng – välj en svårare så växer målet!'] },
  { v: 24, items: ['🔊 Tryck på högtalaren uppe till höger när du övar för att stänga av eller slå på ljudet.'] },
];
function newsFor(seen) {
  return NEWS.filter((n) => n.v > seen).flatMap((n) => n.items);
} // höj tillsammans med CACHE i sw.js
const ROUND_LEN = 20;
const TIME_LIMIT = 60; // sekunder
const SLOW_MS = 6000;

const key = (a, b) => a + 'x' + b;
// Statistiknyckel: 7×8 och 8×7 räknas som samma tal
const skey = (a, b) => key(Math.min(a, b), Math.max(a, b));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// a = tabellen, b = 1..10. "flip" = visa b × a istället.
function combos(tables) {
  const out = [];
  for (const a of tables) for (let b = 1; b <= 10; b++) out.push({ a, b });
  return out;
}

function withFlip(q) {
  return { ...q, flip: Math.random() < 0.5 };
}

// Fyll en omgång på n frågor ur listan, så jämnt som möjligt, utan samma fråga två gånger i rad.
function buildRound(pool, n = ROUND_LEN) {
  const out = [];
  while (out.length < n) {
    let batch = shuffle(pool);
    const last = out[out.length - 1];
    if (last && batch.length > 1 && key(batch[0].a, batch[0].b) === key(last.a, last.b)) {
      batch.push(batch.shift());
    }
    out.push(...batch);
  }
  return out.slice(0, n).map(withFlip);
}

const RECENT = 5; // bara de senaste svaren räknas för urval och färger

// Slå ihop gammal statistik där 7×8 och 8×7 sparades var för sig
function mergeStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) {
    const [a, b] = k.split('x').map(Number);
    const nk = skey(a, b);
    const m = out[nk];
    if (!m) { out[nk] = { ...v, recent: recentOf(v) }; continue; }
    const n = m.right + v.right;
    m.avgMs = n ? Math.round((m.avgMs * m.right + v.avgMs * v.right) / n) : 0;
    m.right += v.right;
    m.wrong += v.wrong;
    m.recent = m.recent.concat(recentOf(v)).slice(-RECENT);
  }
  return out;
}

// Senaste svaren per tal: 1 = rätt, 0 = fel (äldst först).
// Äldre sparad statistik utan "recent" översätts ungefärligt (fel räknas som senast).
function recentOf(s) {
  if (!s) return [];
  if (Array.isArray(s.recent)) return s.recent;
  const r = [];
  for (let i = 0; i < Math.min(s.right, RECENT); i++) r.push(1);
  for (let i = 0; i < Math.min(s.wrong, RECENT); i++) r.push(0);
  return r.slice(-RECENT);
}

function addResult(s, ok) {
  s.recent = recentOf(s).concat(ok ? 1 : 0).slice(-RECENT);
}

function weightFor(s) {
  const r = recentOf(s);
  if (!r.length) return 2; // ej övat — lite extra
  const right = r.filter((x) => x).length;
  const wrong = r.length - right;
  let w = 1 + wrong * 3 - right * 0.4;
  if (s.avgMs > SLOW_MS) w += 2;
  return Math.max(0.3, w);
}

function weightedPick(items, weights) {
  const total = weights.reduce((x, y) => x + y, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function buildHardRound(stats, n = ROUND_LEN) {
  // 55 unika tal (a ≤ b) så att 6×6 inte kommer hälften så ofta som 7×8/8×7
  const pool = combos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).filter((q) => q.a <= q.b);
  const weights = pool.map((q) => weightFor(stats[skey(q.a, q.b)]));
  const out = [];
  while (out.length < n) {
    const q = weightedPick(pool, weights);
    const last = out[out.length - 1];
    if (last && last.a === q.a && last.b === q.b) continue;
    out.push(withFlip(q));
  }
  return out;
}

function randomQuestion(prev) {
  let q;
  do {
    q = { a: 1 + Math.floor(Math.random() * 10), b: 1 + Math.floor(Math.random() * 10) };
  } while (prev && prev.a === q.a && prev.b === q.b);
  return withFlip(q);
}

function starsFor(correct, total) {
  const p = total ? correct / total : 0;
  return p >= 1 ? 3 : p >= 0.85 ? 2 : p >= 0.6 ? 1 : 0;
}

function level(s) {
  const r = recentOf(s);
  if (!r.length) return 'none';
  const right = r.filter((x) => x).length;
  const acc = right / r.length;
  if (acc === 1 && right >= 3 && s.avgMs <= SLOW_MS) return 'good';
  if (acc >= 0.7) return 'ok';
  return 'bad';
}

/* Säkerhetskopia av statistiken */
function makeBackup(d) {
  return {
    app: 'gangerkungen', version: 1, saved: new Date().toISOString(),
    stats: d.stats, records: d.records, stars: d.stars, totalRight: d.totalRight, days: d.days || {},
  };
}

// Returnerar rensad data, eller kastar ett fel med ett begripligt meddelande.
function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new Error('Filen går inte att läsa.'); }
  if (!b || b.app !== 'gangerkungen' || typeof b.stats !== 'object' || !b.stats) {
    throw new Error('Det här är ingen statistikfil från Gångerkungen.');
  }
  const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  const stats = {};
  for (const [k, v] of Object.entries(b.stats)) {
    const m = /^(10|[1-9])x(10|[1-9])$/.exec(k);
    if (!m || !v || typeof v !== 'object') continue;
    const s = { right: num(v.right), wrong: num(v.wrong), avgMs: num(v.avgMs) };
    if (Array.isArray(v.recent)) s.recent = v.recent.filter((x) => x === 0 || x === 1).slice(-RECENT);
    stats[k] = s;
  }
  return {
    stats: mergeStats(stats),
    records: { time: num(b.records && b.records.time) },
    stars: num(b.stars),
    totalRight: num(b.totalRight),
    days: cleanDays(b.days),
  };
}

/* Dag för dag: { 'ÅÅÅÅ-MM-DD': { r: rätt, w: fel, ms: övad tid } } */
const DAYS_KEEP = 365;
function cleanDays(days) {
  const out = {};
  if (!days || typeof days !== 'object') return out;
  const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  for (const [k, v] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
    out[k] = { r: num(v.r), w: num(v.w), ms: num(v.ms) };
  }
  return trimDays(out);
}
function trimDays(days) {
  const keys = Object.keys(days).sort();
  keys.slice(0, Math.max(0, keys.length - DAYS_KEEP)).forEach((k) => delete days[k]);
  return days;
}
// De senaste n dagarna (äldst först), även dagar utan övning
function daySummary(p, n, date = todayStr()) {
  const goals = new Set(p.goalDays || []);
  const out = [];
  let d = date;
  for (let i = 0; i < n; i++) {
    const v = (p.days && p.days[d]) || { r: 0, w: 0, ms: 0 };
    out.unshift({ date: d, r: v.r, w: v.w, ms: v.ms, goal: goals.has(d) });
    d = prevDay(d);
  }
  return out;
}

// En tabell är "kunnad" när alla 10 tal i den är gröna
function tableMastered(stats, t) {
  for (let b = 1; b <= 10; b++) if (level(stats[skey(t, b)]) !== 'good') return false;
  return true;
}

/* Spelare */
const AVATARS = ['🦁', '🐯', '🐼', '🦊', '🐸', '🐵', '🦄', '🐲', '🐬', '🦖', '🐱', '🐶', '🐰', '🐨', '🐧', '🐙'];
const NAME_MAX = 12;

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function newPlayer(name, avatar) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: cleanName(name), avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
    stats: {}, records: { time: 0 }, stars: 0, totalRight: 0, picked: [],
    goal: { ...DEFAULT_GOAL }, daily: null, goalDays: [], streakDays: [], bestStreak: 0, days: {},
    seenNews: Number(APP_VERSION), // ny spelare: inga gamla nyheter
  };
}

/* Dagsmål */
const DEFAULT_GOAL = { type: 'right', value: 30 };
const GOAL_VALUES = { right: [20, 30, 50, 75, 100], time: [5, 10, 15, 20, 30] }; // rätt svar / minuter
const MAX_Q_MS = 30000; // max tid som räknas per fråga (appen kan ligga öppen utan att man övar)

function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fixGoal(g) {
  if (g && g.type === 'off') return { type: 'off', value: 0 };
  if (g && GOAL_VALUES[g.type] && GOAL_VALUES[g.type].includes(g.value)) return { type: g.type, value: g.value };
  return { ...DEFAULT_GOAL };
}

// Dagens räkning för spelaren; börjar om från noll när datumet byts.
function dailyOf(p, date = todayStr()) {
  if (!p.daily || p.daily.date !== date) p.daily = { date, right: 0, ms: 0, done: false };
  return p.daily;
}

function fmtMinSec(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// extraMs = pågående fråga som ännu inte besvarats (för en levande nedräkning)
function goalProgress(p, extraMs = 0, date = todayStr()) {
  const g = fixGoal(p.goal);
  if (g.type === 'off') return { type: 'off', done: false, frac: 0, short: '', text: '' };
  const d = dailyOf(p, date);
  if (g.type === 'right') {
    const done = d.done || d.right >= g.value;
    return {
      type: 'right', done, frac: Math.min(1, d.right / g.value),
      short: '🎯 ' + Math.min(d.right, g.value) + '/' + g.value,
      text: done ? '✅ Dagens mål klart! ' + d.right + ' rätt idag' : '🎯 ' + d.right + ' av ' + g.value + ' rätt idag',
    };
  }
  const goalMs = g.value * 60000;
  const used = d.ms + Math.min(Math.max(0, extraMs), MAX_Q_MS);
  const done = d.done || used >= goalMs;
  return {
    type: 'time', done, frac: Math.min(1, used / goalMs),
    short: done ? '⏱️ klart!' : '⏱️ ' + fmtMinSec(goalMs - used) + ' kvar',
    text: done ? '✅ Dagens mål klart! ' + g.value + ' minuter övade' : '⏱️ ' + fmtMinSec(goalMs - used) + ' kvar idag',
  };
}

/* Dagar i rad */
function prevDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d - 1)); // Date hanterar månads-/årsskiften och sommartid
}

// Dag som räknas för sviten: målet nått (eller, utan mål, minst ett rätt svar)
function markStreakDay(p, date) {
  p.streakDays = p.streakDays || [];
  if (!p.streakDays.includes(date)) p.streakDays = p.streakDays.concat(date).slice(-400);
  p.bestStreak = Math.max(p.bestStreak || 0, streakInfo(p, date).count);
}

// Sviten lever hela dagen: räknas från idag om dagen är klar, annars från igår.
function streakInfo(p, date = todayStr()) {
  const set = new Set(p.streakDays || []);
  const todayDone = set.has(date);
  let d = todayDone ? date : prevDay(date);
  let count = 0;
  while (set.has(d)) { count++; d = prevDay(d); }
  return { count, todayDone, best: Math.max(p.bestStreak || 0, count) };
}

function streakText(n) {
  return '🔥 ' + n + (n === 1 ? ' dag' : ' dagar') + ' i rad';
}

// Registrera ett svar. Returnerar true om dagens mål nåddes precis nu.
// counts = false: tabell som barnet redan kan, syns i dag-för-dag men ger inga poäng till målet/sviten
function recordDaily(p, ok, ms, date = todayStr(), counts = true) {
  const used = Math.min(Math.max(0, ms), MAX_Q_MS);
  p.days = p.days || {};
  const day = p.days[date] || (p.days[date] = { r: 0, w: 0, ms: 0 });
  if (ok) day.r++; else day.w++;
  day.ms += used;
  if (Object.keys(p.days).length > DAYS_KEEP) trimDays(p.days);
  if (!counts) return false;
  const d = dailyOf(p, date);
  if (ok) d.right++;
  d.ms += used;
  const g = fixGoal(p.goal);
  if (g.type === 'off') {
    if (ok) markStreakDay(p, date);
    return false;
  }
  if (d.done) return false;
  if (goalProgress(p, 0, date).done) {
    d.done = true;
    p.goalDays = (p.goalDays || []).concat(date).slice(-400);
    markStreakDay(p, date);
    return true;
  }
  return false;
}

// Läser sparad data (v2 = med spelare). Finns bara gammal v1-data blir den en spelare utan namn.
function loadStore(v2text, v1text) {
  const empty = { players: [], current: null, sound: true };
  try {
    const r = JSON.parse(v2text);
    if (r && Array.isArray(r.players)) {
      r.players.forEach((p) => {
        p.stats = mergeStats(p.stats);
        p.records = p.records || { time: 0 };
        p.goal = fixGoal(p.goal);
        p.goalDays = p.goalDays || [];
        if (!Array.isArray(p.streakDays)) p.streakDays = p.goalDays.slice(); // dagar med nått mål räknas
        p.bestStreak = p.bestStreak || 0;
        p.days = cleanDays(p.days);
        if (!Number.isFinite(p.seenNews)) p.seenNews = 20; // fanns före nyhetsrutan
        // Dagens siffror fanns innan dag-för-dag-statistiken: ta med dem
        if (p.daily && p.daily.date && !p.days[p.daily.date] && (p.daily.right || p.daily.ms)) {
          p.days[p.daily.date] = { r: p.daily.right || 0, w: 0, ms: p.daily.ms || 0 };
        }
      });
      if (!r.players.some((p) => p.id === r.current)) r.current = r.players[0] ? r.players[0].id : null;
      if (typeof r.sound !== 'boolean') r.sound = true;
      return r;
    }
  } catch (e) { /* ingen v2 */ }
  try {
    const d = JSON.parse(v1text);
    if (d && d.stats) {
      const p = newPlayer('', AVATARS[0]);
      Object.assign(p, {
        stats: mergeStats(d.stats), records: d.records || { time: 0 },
        stars: d.stars || 0, totalRight: d.totalRight || 0, picked: d.picked || [],
      });
      return { players: [p], current: p.id, sound: d.sound !== false };
    }
  } catch (e) { /* ingen v1 */ }
  return empty;
}

if (typeof module !== 'undefined') {
  module.exports = { newsFor, NEWS, tableMastered, cleanDays, trimDays, daySummary, prevDay, markStreakDay, streakInfo, streakText, todayStr, fixGoal, dailyOf, goalProgress, recordDaily, fmtMinSec, GOAL_VALUES, AVATARS, cleanName, newPlayer, loadStore, makeBackup, parseBackup, combos, buildRound, buildHardRound, randomQuestion, starsFor, level, weightFor, key, skey, recentOf, addResult, mergeStats };
}

/* ---------- UI ---------- */
if (typeof document !== 'undefined') {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  /* Lagring: root = alla spelare + inställningar, data = aktiv spelare */
  const STORE = 'gangerkungen-v2';
  const OLD_STORE = 'gangertabell-v1'; // lämnas orörd som reserv
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  const root = loadStore(readLS(STORE), readLS(OLD_STORE));
  let data = root.players.find((p) => p.id === root.current) || null;
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(root)); } catch (e) { /* ignorera */ }
  }

  /* Ljud */
  let audio;
  // Android/Chrome tillåter bara ljud efter ett "riktigt" tryck (när fingret släpps),
  // så vi skapar/väcker ljudet då.
  function unlockAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== 'running') audio.resume();
    } catch (e) { /* inget ljud */ }
  }
  ['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));

  function beep(ok) {
    if (!root.sound) return;
    try {
      unlockAudio();
      if (!audio) return;
      const notes = ok ? [660, 880] : [220, 180];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = ok ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        const t = audio.currentTime + i * 0.11;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(ok ? 0.25 : 0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.2);
      });
    } catch (e) { /* inget ljud */ }
  }

  /* Vyer */
  let prevView = 'home';
  let pendingReload = false; // ny version kom under en övning: ladda om när den är klar
  function show(name) {
    if (pendingReload && name !== 'play' && name !== 'result') { location.reload(); return; }
    const cur = document.querySelector('.view.active');
    if (name === 'help' && cur && cur.id !== 'view-help') prevView = cur.id.replace('view-', '');
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'home') renderHome();
    if (name === 'stats') renderStats();
    if (name === 'pick') renderPick();
    if (name === 'players') renderPlayers();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      stopTimer();
      show(go.dataset.go);
      if (go.dataset.go === 'help') openHelp(go.dataset.open);
    }
    const m = e.target.closest('[data-mode]');
    if (m) startGame(m.dataset.mode);
  });

  function renderHome() {
    if (!data) return;
    setTimeout(showNews, 400);
    $('#chip-avatar').textContent = data.avatar;
    $('#chip-name').textContent = data.name;
    $('#chip-stars').textContent = '⭐ ' + data.stars;
    const gp = goalProgress(data);
    $('#goal-card').hidden = gp.type === 'off';
    $('#goal-card').classList.toggle('done', gp.done);
    $('#goal-text').textContent = gp.text;
    $('#goal-fill').style.width = gp.frac * 100 + '%';
    const sk = streakInfo(data);
    const el = $('#streak');
    el.hidden = sk.count === 0;
    el.classList.toggle('pending', !sk.todayDone);
    $('#streak-count').textContent = streakText(sk.count);
    $('#streak-hint').textContent = sk.todayDone ? '' :
      (gp.type === 'off' ? 'Öva idag så fortsätter det!' : 'Klara dagens mål så fortsätter det!');
    $('#sound-toggle').textContent = root.sound ? '🔊 Ljud på' : '🔇 Ljud av';
  }
  // Ljud av/på direkt under övningen
  function renderMute() {
    $('#mute').textContent = root.sound ? '🔊' : '🔇';
    $('#mute').classList.toggle('off', !root.sound);
  }
  $('#mute').addEventListener('click', () => {
    root.sound = !root.sound; save(); renderMute();
    if (root.sound) { unlockAudio(); beep(true); }
  });
  $('#sound-toggle').addEventListener('click', () => {
    root.sound = !root.sound; save(); renderHome();
    if (root.sound) { unlockAudio(); beep(true); }
  });

  /* Välj tabell */
  let picked = new Set();
  function renderPick() {
    picked = new Set(data.picked || []);
    const g = $('#pick-grid');
    g.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement('button');
      b.textContent = i;
      const crown = tableMastered(data.stats, i);
      b.classList.toggle('crown', crown);
      b.classList.toggle('on', picked.has(i));
      b.addEventListener('click', () => {
        picked.has(i) ? picked.delete(i) : picked.add(i);
        b.classList.toggle('on', picked.has(i));
        $('#pick-start').disabled = picked.size === 0;
        if (crown && picked.has(i)) {
          openModal({
            icon: '👑', title: 'Du kan redan ' + i + ':an!',
            html: 'Den ger <b>inga poäng</b> till dagens mål eller stjärnor.<br>Välj en tabell som inte är helt grön, så växer målet! 💪',
            yes: 'Välj en annan', no: 'Öva ändå',
            onYes: () => { picked.delete(i); b.classList.remove('on'); $('#pick-start').disabled = picked.size === 0; },
          });
        }
      });
      g.appendChild(b);
    }
    $('#pick-start').disabled = picked.size === 0;
  }
  $('#pick-start').addEventListener('click', () => {
    data.picked = [...picked].sort((a, b) => a - b); save();
    startGame('tables');
  });

  /* Spel */
  let game = null;
  let timerId = null;

  function startGame(mode) {
    stopTimer();
    game = { mode, idx: 0, correct: 0, answered: 0, input: '', locked: false, reinserted: new Set(), start: Date.now() };
    game.noPoints = new Set(mode === 'tables' ? data.picked.filter((t) => tableMastered(data.stats, t)) : []);
    if (mode === 'tables') game.queue = buildRound(combos(data.picked));
    else if (mode === 'mixed') game.queue = buildRound(combos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    else if (mode === 'hard') game.queue = buildHardRound(data.stats);
    else if (mode === 'time') {
      game.queue = [randomQuestion()];
      game.endAt = Date.now() + TIME_LIMIT * 1000;
    }
    game.total = game.queue.length;
    show('play');
    const bar = $('#play-bar');
    bar.classList.toggle('timer', mode === 'time');
    bar.classList.remove('low');
    if (mode === 'time') {
      bar.style.transition = 'none';
      bar.style.width = '100%';
      void bar.offsetWidth;
      bar.style.transition = '';
      tick();
      timerId = setInterval(tick, 250);
    }
    nextQuestion(true);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function tick() {
    const left = Math.max(0, game.endAt - Date.now());
    const sec = Math.ceil(left / 1000);
    $('#play-progress').textContent = '⏱️ ' + sec + ' s';
    $('#play-bar').style.width = (left / (TIME_LIMIT * 1000)) * 100 + '%';
    $('#play-bar').classList.toggle('low', sec <= 10);
    if (left <= 0) { stopTimer(); finish(); }
  }

  function current() { return game.queue[game.idx]; }

  function nextQuestion(first) {
    renderMute();
    if (!first) game.idx++;
    if (game.mode === 'time') {
      if (game.idx >= game.queue.length) game.queue.push(randomQuestion(game.queue[game.queue.length - 1]));
    } else if (game.idx >= game.queue.length) {
      return finish();
    }
    const q = current();
    game.input = '';
    game.locked = false;
    game.qStart = Date.now();
    $('#question').textContent = q.flip ? q.b + ' × ' + q.a : q.a + ' × ' + q.b;
    $('#answer').innerHTML = '&nbsp;';
    $('#feedback').innerHTML = '&nbsp;';
    $('#question-card').className = 'card';
    updateHeader();
    updateGoalLine();
  }

  function updateHeader() {
    if (game.mode === 'time') {
      $('#play-score').textContent = '✅ ' + game.correct;
    } else {
      const n = Math.min(game.answered + 1, game.total);
      $('#play-progress').textContent = 'Fråga ' + n + ' av ' + game.total;
      $('#play-score').textContent = '⭐ ' + game.correct;
      $('#play-bar').style.width = (game.answered / game.total) * 100 + '%';
    }
  }

  function press(k) {
    if (!game || game.locked) return;
    if (k === 'del') game.input = game.input.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (game.input.length < 3) game.input = (game.input === '0' ? '' : game.input) + k;
    $('#answer').textContent = game.input || ' ';
  }
  $('#keypad').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    press(b.dataset.k);
  });
  document.addEventListener('keydown', (e) => {
    if (!$('#view-play').classList.contains('active')) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  });

  const PRAISE = ['Rätt! 🎉', 'Snyggt! ⭐', 'Bra jobbat! 👏', 'Superbra! 🚀', 'Klockrent! ✨', 'Grymt! 💪'];

  function submit() {
    if (game.input === '') return;
    const q = current();
    const ans = q.a * q.b;
    const ok = parseInt(game.input, 10) === ans;
    const ms = Date.now() - game.qStart;
    const isRetry = game.reinserted.has(game.idx);
    game.locked = true;

    // statistik
    const k = skey(q.a, q.b);
    const s = data.stats[k] || { right: 0, wrong: 0, avgMs: 0 };
    if (ok) {
      s.avgMs = s.right ? Math.round(s.avgMs * 0.7 + Math.min(ms, 20000) * 0.3) : Math.min(ms, 20000);
      s.right++;
      data.totalRight++;
    } else {
      s.wrong++;
    }
    addResult(s, ok);
    data.stats[k] = s;
    const goalNow = recordDaily(data, ok, ms, undefined, !game.noPoints.has(q.a));
    save();
    if (goalNow) setTimeout(celebrateGoal, 350);

    if (!isRetry) game.answered++;
    if (ok && !isRetry) game.correct++;

    const card = $('#question-card');
    if (ok) {
      card.className = 'card right bump';
      $('#feedback').textContent = PRAISE[Math.floor(Math.random() * PRAISE.length)];
    } else {
      card.className = 'card wrong';
      $('#answer').textContent = ans;
      $('#feedback').textContent = 'Rätt svar är ' + ans;
      // lägg tillbaka frågan lite senare (inte i tidsutmaningen)
      if (game.mode !== 'time' && !isRetry) {
        const pos = Math.min(game.idx + 3, game.queue.length);
        game.queue.splice(pos, 0, { ...q, flip: !q.flip });
        // flytta index för redan återinlagda frågor som hamnar efter pos
        game.reinserted = new Set([...game.reinserted].map((i) => (i >= pos ? i + 1 : i)));
        game.reinserted.add(pos);
      }
    }
    beep(ok);
    updateHeader();
    updateGoalLine();
    const delay = ok ? (game.mode === 'time' ? 450 : 700) : (game.mode === 'time' ? 1100 : 1500);
    setTimeout(() => {
      if (!game || !$('#view-play').classList.contains('active')) return;
      if (game.mode === 'time' && Date.now() >= game.endAt) return;
      nextQuestion();
    }, delay);
  }

  /* Dagsmål under övningen */
  function updateGoalLine() {
    if (!game || !data) return;
    const live = game.locked ? 0 : Date.now() - game.qStart;
    const q = current();
    const noPts = q && game.noPoints && game.noPoints.has(q.a);
    const gp = goalProgress(data, noPts ? 0 : live);
    const el = $('#goal-line');
    el.hidden = gp.type === 'off' && !noPts;
    el.textContent = noPts ? '👑 ger inga poäng' : gp.short;
    el.classList.toggle('done', gp.done && !noPts);
  }
  setInterval(() => {
    if ($('#view-play').classList.contains('active') && !document.hidden) updateGoalLine();
  }, 1000);

  function celebrateGoal() {
    const t = $('#toast');
    const s = streakInfo(data);
    t.textContent = '🎉 Dagens mål klart, ' + data.name + '!' + (s.count > 1 ? '\n' + streakText(s.count) + '!' : '');
    t.classList.add('show');
    confetti();
    if (root.sound) setTimeout(() => beep(true), 150);
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  $('#play-quit').addEventListener('click', () => {
    stopTimer();
    game = null;
    show('home');
  });

  function finish() {
    stopTimer();
    if (!game) return;
    const g = game;
    game.locked = true;
    let stars, title, text, extra = '';
    if (g.mode === 'time') {
      const rec = data.records.time || 0;
      const isRec = g.correct > rec;
      if (isRec) data.records.time = g.correct;
      stars = g.correct >= 25 ? 3 : g.correct >= 15 ? 2 : g.correct >= 8 ? 1 : 0;
      title = isRec && g.correct > 0 ? 'Nytt rekord, ' + data.name + '! 🏆' : 'Tiden är ute!';
      text = g.correct + ' rätt på ' + TIME_LIMIT + ' sekunder';
      extra = isRec ? (rec ? 'Förra rekordet var ' + rec : '') : 'Ditt rekord: ' + rec;
      if (isRec && g.correct > 0) confetti();
    } else {
      stars = starsFor(g.correct, g.total);
      const secs = Math.round((Date.now() - g.start) / 1000);
      const allKnown = g.mode === 'tables' && data.picked.length > 0 && data.picked.every((t) => g.noPoints.has(t));
      title = ['Bra kämpat, ', 'Bra jobbat, ', 'Jättebra, ', 'Du är gångerkungen, '][stars] + data.name + '! ' + ['💪', '👍', '🌟', '👑'][stars];
      text = g.correct + ' av ' + g.total + ' rätt direkt';
      extra = 'Tid: ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      if (allKnown) {
        stars = 0;
        title = 'Bra repeterat, ' + data.name + '! 👑';
        extra = '👑 Du kunde redan de här, så de ger inga stjärnor. Prova en svårare tabell!';
      } else if (stars === 3) confetti();
    }
    data.stars += stars;
    save();
    $('#result-stars').innerHTML = [0, 1, 2]
      .map((i) => '<span class="' + (i < stars ? '' : 'dim') + '" style="animation-delay:' + i * 0.2 + 's">⭐</span>')
      .join('');
    $('#result-title').textContent = title;
    $('#result-text').textContent = text;
    $('#result-extra').textContent = extra;
    const gp = goalProgress(data);
    $('#result-goal').hidden = gp.type === 'off';
    $('#result-goal').textContent = gp.text;
    $('#result-again').onclick = () => (g.mode === 'tables' ? againTables(stars === 3) : startGame(g.mode));
    show('result');
  }

  /* Statistik */
  function renderStats() {
    $('#stats-title').textContent = data.avatar + ' ' + data.name;
    let practiced = 0, good = 0;
    for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) {
      const l = level(data.stats[skey(a, b)]);
      if (l !== 'none') practiced++;
      if (l === 'good') good++;
    }
    $('#stats-summary').innerHTML =
      '<div class="stat-box"><b>' + good + '/100</b><small>kan du</small></div>' +
      '<div class="stat-box"><b>' + (data.records.time || 0) + '</b><small>rekord 60 s</small></div>' +
      '<div class="stat-box"><b>' + data.stars + '</b><small>stjärnor</small></div>' +
      '<div class="stat-box"><b>🔥 ' + streakInfo(data).best + '</b><small>bästa svit</small></div>';
    const g = $('#stats-grid');
    let html = '<div class="hd">×</div>';
    for (let b = 1; b <= 10; b++) html += '<div class="hd">' + b + '</div>';
    for (let a = 1; a <= 10; a++) {
      html += '<div class="hd">' + a + '</div>';
      for (let b = 1; b <= 10; b++) {
        html += '<div class="s-' + level(data.stats[skey(a, b)]) + '">' + a * b + '</div>';
      }
    }
    g.innerHTML = html;
    renderDays();
  }

  /* Dag för dag */
  const WD = ['S', 'M', 'T', 'O', 'T', 'F', 'L'];
  const WDLONG = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const dateOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const mins = (ms) => { const m = Math.round(ms / 60000); return ms > 0 && m < 1 ? '<1 min' : m + ' min'; };
  function dayLabel(s, today) {
    if (s === today) return 'Idag';
    if (s === prevDay(today)) return 'Igår';
    const d = dateOf(s);
    return WDLONG[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
  }
  function renderDays() {
    const today = todayStr();
    const days = daySummary(data, 14, today);
    const week = days.slice(-7);
    const wr = week.reduce((t, d) => t + d.r, 0);
    const wms = week.reduce((t, d) => t + d.ms, 0);
    const wn = week.filter((d) => d.r + d.w > 0).length;
    const any = days.some((d) => d.r + d.w > 0);
    $('#days-week').innerHTML = any
      ? 'Senaste 7 dagarna: <b>' + wr + ' rätt</b> · ' + mins(wms) + ' · ' + wn + (wn === 1 ? ' dag' : ' dagar') + ' övade'
      : 'Här ser du hur mycket du övar varje dag. Börja öva så kommer första stapeln!';
    const max = Math.max(10, ...days.map((d) => d.r + d.w));
    $('#days-chart').innerHTML = days.map((d) => {
      const tot = d.r + d.w;
      return '<div class="day' + (d.date === today ? ' today' : '') + '">' +
        '<span class="day-goal">' + (d.goal ? '✅' : '') + '</span>' +
        '<span class="day-n">' + (tot ? d.r : '') + '</span>' +
        '<div class="day-bar" style="height:' + (tot / max * 100).toFixed(1) + '%">' +
        (d.w ? '<i class="w" style="flex:' + d.w + '"></i>' : '') + (d.r ? '<i class="r" style="flex:' + d.r + '"></i>' : '') + '</div>' +
        '<span class="day-wd">' + WD[dateOf(d.date).getDay()] + '</span></div>';
    }).join('');
    $('#days-chart').hidden = !any;
    $('#days-list').innerHTML = days.filter((d) => d.r + d.w > 0).reverse().map((d) => {
      const pct = Math.round(d.r / (d.r + d.w) * 100);
      return '<li><b>' + dayLabel(d.date, today) + '</b><span>' + d.r + ' rätt · ' + d.w + ' fel · ' + pct + ' % · ' +
        mins(d.ms) + (d.goal ? ' ✅' : '') + '</span></li>';
    }).join('');
  }
  $('#stats-reset').addEventListener('click', () => {
    if (!confirm('Vill du verkligen nollställa all statistik, rekord och stjärnor?')) return;
    data.stats = {}; data.records = { time: 0 }; data.stars = 0; data.totalRight = 0; data.days = {};
    save(); renderStats();
  });

  /* Spara / hämta statistik */
  $('#backup-save').addEventListener('click', async () => {
    const text = JSON.stringify({ ...makeBackup(data), name: data.name, avatar: data.avatar }, null, 1);
    const safe = data.name.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '').toLowerCase() || 'spelare';
    const name = 'gangerkungen-' + safe + '-' + new Date().toISOString().slice(0, 10) + '.json';
    // Mobilen: dela-menyn (spara i Filer/Drive, skicka till sig själv). Annars: vanlig nedladdning.
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Gångerkungen – statistik' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // användaren stängde dela-menyn
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  $('#backup-load').addEventListener('click', () => $('#backup-file').click());
  $('#backup-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const b = parseBackup(await f.text());
      const n = Object.keys(b.stats).length;
      if (!confirm('Hämta statistiken från filen till ' + data.name + '?\n\n' + n + ' övade tal, ' + b.stars + ' stjärnor, rekord ' +
        b.records.time + '.\n\nDet ersätter ' + data.name + 's statistik som finns i appen nu.')) return;
      Object.assign(data, b);
      save(); renderStats();
      alert('Klart! Statistiken är hämtad. 👑');
    } catch (err) {
      alert(err.message || 'Filen gick inte att läsa.');
    }
  });

  /* Spela igen på Välj tabell: kan barnet tabellen (eller fick alla rätt) föreslås en svårare */
  const tablesText = (ts) => ts.map((t) => t + ':an').join(', ').replace(/, ([^,]*)$/, ' och $1');
  function againTables(perfect) {
    const known = data.picked.filter((t) => tableMastered(data.stats, t));
    if (!known.length && !perfect) return startGame('tables');
    const toPick = () => {
      data.picked = data.picked.filter((t) => !known.includes(t)); save();
      show('pick');
    };
    if (known.length) {
      openModal({
        icon: '👑', title: 'Du kan redan ' + tablesText(known) + '!',
        html: (known.length > 1 ? 'De ger' : 'Den ger') + ' <b>inga poäng</b> till dagens mål eller stjärnor.<br>Välj en tabell som inte är helt grön, så växer målet! 💪',
        yes: 'Välj en annan', no: 'Öva ändå', onYes: toPick, onNo: () => startGame('tables'),
      });
    } else {
      openModal({
        icon: '🌟', title: 'Alla rätt på ' + tablesText(data.picked) + '!',
        html: 'Snyggt! Vill du prova en <b>svårare tabell</b>?<br>Klarar du alla rätt några gånger till får tabellen en 👑.',
        yes: 'Välj en annan', no: 'Kör igen', onYes: toPick, onNo: () => startGame('tables'),
      });
    }
  }

  /* Nytt i appen: visas en gång per spelare efter en uppdatering */
  function showNews() {
    if (!data || !$('#view-home').classList.contains('active') || !$('#modal').hidden) return;
    const items = newsFor(data.seenNews);
    if (!items.length) return;
    const who = data;
    openModal({
      icon: '🎉', title: 'Nytt i Gångerkungen!',
      html: '<ul class="news">' + items.map((t) => '<li>' + t + '</li>').join('') + '</ul>',
      yes: 'Coolt! 👍',
      // Räknas som sedd först när man stänger rutan (försvinner den ändå kommer den igen)
      onYes: () => { who.seenNews = Number(APP_VERSION); save(); },
    });
  }

  /* Pop-up */
  let modalYes = null, modalNo = null;
  function openModal({ icon, title, html, yes, no, onYes, onNo }) {
    $('#modal-icon').textContent = icon || '';
    $('#modal-title').textContent = title;
    $('#modal-text').innerHTML = html;
    $('#modal-yes').textContent = yes;
    $('#modal-no').textContent = no || '';
    $('#modal-no').hidden = !no;
    modalYes = onYes || null;
    modalNo = onNo || null;
    $('#modal').hidden = false;
  }
  function closeModal(yes) {
    $('#modal').hidden = true;
    const cb = yes ? modalYes : modalNo;
    modalYes = null; modalNo = null;
    if (cb) cb();
    // En ny version väntade på att rutan skulle stängas
    if (pendingReload && $('#view-home').classList.contains('active')) location.reload();
  }
  $('#modal-yes').addEventListener('click', () => closeModal(true));
  $('#modal-no').addEventListener('click', () => closeModal(false));

  /* Konfetti */
  function confetti() {
    const box = $('#confetti');
    const colors = ['#ff7a59', '#3bb4f2', '#f5b700', '#e0457b', '#4caf7a', '#6c4cf5'];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      p.style.animationDelay = Math.random() * 0.6 + 's';
      box.appendChild(p);
      setTimeout(() => p.remove(), 4500);
    }
  }

  /* Spelare: välj / ny / ändra */
  function renderPlayers() {
    const list = $('#player-list');
    list.innerHTML = '';
    root.players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (data && p.id === data.id ? ' on' : '');
      const pick = document.createElement('button');
      pick.className = 'player-pick';
      const av = document.createElement('span'); av.className = 'pav'; av.textContent = p.avatar;
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = p.name;
      const st = document.createElement('span'); st.className = 'pstars'; st.textContent = '⭐ ' + p.stars;
      pick.append(av, nm, st);
      pick.addEventListener('click', () => {
        data = p; root.current = p.id; save(); show('home');
      });
      const edit = document.createElement('button');
      edit.className = 'player-edit';
      edit.setAttribute('aria-label', 'Ändra ' + p.name);
      edit.textContent = '✏️';
      edit.addEventListener('click', () => openEdit(p));
      row.append(pick, edit);
      list.appendChild(row);
    });
  }
  $('#player-add').addEventListener('click', () => openEdit(null));

  let editing = null; // spelaren som ändras, eller null för ny
  let editAvatar = AVATARS[0];
  let editGoal = { ...DEFAULT_GOAL };
  function renderGoalEdit() {
    $$('#goal-type button').forEach((b) => b.classList.toggle('on', b.dataset.t === editGoal.type));
    const box = $('#goal-value');
    box.innerHTML = '';
    box.hidden = editGoal.type === 'off';
    (GOAL_VALUES[editGoal.type] || []).forEach((v) => {
      const b = document.createElement('button');
      b.textContent = v + (editGoal.type === 'time' ? ' min' : '');
      b.classList.toggle('on', v === editGoal.value);
      b.addEventListener('click', () => { editGoal.value = v; renderGoalEdit(); });
      box.appendChild(b);
    });
  }
  $$('#goal-type button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === editGoal.type) return;
    editGoal = t === 'off' ? { type: 'off', value: 0 } : { type: t, value: t === 'time' ? 10 : 30 };
    renderGoalEdit();
  }));
  function openEdit(p) {
    editing = p || null;
    const used = new Set(root.players.map((x) => x.avatar));
    editAvatar = p ? p.avatar : (AVATARS.find((a) => !used.has(a)) || AVATARS[0]);
    const first = !root.players.some((x) => x.name);
    $('#edit-title').textContent = p && p.name ? 'Ändra spelare' : first ? 'Vad heter du?' : 'Ny spelare';
    $('#edit-name').value = p ? p.name : '';
    $('#edit-delete').hidden = !p || !p.name;
    // Utan namngiven spelare finns inget att gå tillbaka till
    $('#edit-back').hidden = !root.players.some((x) => x.name) || Boolean(p && !p.name);
    editGoal = p ? fixGoal(p.goal) : { ...DEFAULT_GOAL };
    renderAvatars();
    renderGoalEdit();
    checkEdit();
    show('edit');
  }
  function renderAvatars() {
    const g = $('#avatar-grid');
    g.innerHTML = '';
    AVATARS.forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a;
      b.classList.toggle('on', a === editAvatar);
      b.addEventListener('click', () => { editAvatar = a; renderAvatars(); });
      g.appendChild(b);
    });
  }
  function checkEdit() {
    $('#edit-save').disabled = cleanName($('#edit-name').value) === '';
  }
  $('#edit-name').addEventListener('input', checkEdit);
  $('#edit-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#edit-name').blur(); }
  });
  $('#edit-back').addEventListener('click', () => show(root.players.length > 1 ? 'players' : 'home'));
  $('#edit-save').addEventListener('click', () => {
    const name = cleanName($('#edit-name').value);
    if (!name) return;
    if (editing) {
      editing.name = name;
      editing.avatar = editAvatar;
    } else {
      editing = newPlayer(name, editAvatar);
      root.players.push(editing);
    }
    const oldGoal = fixGoal(editing.goal);
    editing.goal = fixGoal(editGoal);
    // nytt mål: räkna om dagens status mot det nya målet (redan gjorda svar och tid räknas)
    if (oldGoal.type !== editing.goal.type || oldGoal.value !== editing.goal.value) {
      const d = dailyOf(editing);
      d.done = false;
      editing.goalDays = (editing.goalDays || []).filter((x) => x !== d.date);
      if (goalProgress(editing).done) { d.done = true; editing.goalDays.push(d.date); markStreakDay(editing, d.date); }
    }
    data = editing; root.current = editing.id;
    save();
    show('home');
  });
  $('#edit-delete').addEventListener('click', () => {
    if (!editing) return;
    if (!confirm('Ta bort ' + editing.name + ' och all ' + editing.name + 's statistik?')) return;
    root.players = root.players.filter((p) => p !== editing);
    if (data === editing) data = root.players[0] || null;
    root.current = data ? data.id : null;
    save();
    if (data) show('players'); else openEdit(null);
  });

  // Androids tillbaka-knapp: gå till start istället för att stänga appen
  history.replaceState({ v: 'root' }, '');
  history.pushState({ v: 'app' }, '');
  window.addEventListener('popstate', () => {
    if (!$('#view-home').classList.contains('active')) {
      // på namnsidan utan spelare finns ingen start att gå till
      if ($('#view-edit').classList.contains('active') && $('#edit-back').hidden) {
        history.pushState({ v: 'app' }, '');
        return;
      }
      stopTimer(); game = null; show('home');
      history.pushState({ v: 'app' }, '');
    }
  });

  // Första start (eller gammal data utan namn): fråga efter namn
  if (!data || !data.name) openEdit(data);
  else renderHome();

  /* Installera-knapp */
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let installEvt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!standalone) $('#install-btn').hidden = false;
  if (isIOS) {
    // Rätt instruktion beroende på webbläsare (Chrome = CriOS, Firefox = FxiOS, Edge = EdgiOS)
    const ua = navigator.userAgent;
    $('#install-help-ios').innerHTML = /CriOS/.test(ua)
      ? 'Tryck på <b>Dela</b> <span class="ios-share">⬆︎</span> uppe till höger i adressfältet ' +
        '(eller <b>⋯</b> → <b>Dela</b>) och välj <b>Lägg till på hemskärmen</b>.'
      : /FxiOS|EdgiOS/.test(ua)
        ? 'Tryck på menyn <b>☰</b> eller <b>⋯</b> → <b>Dela</b> <span class="ios-share">⬆︎</span> ' +
          'och välj <b>Lägg till på hemskärmen</b>.'
        : 'Tryck på <b>Dela</b> <span class="ios-share">⬆︎</span> och välj <b>Lägg till på hemskärmen</b>.' +
          '<br><small>Se till att <b>Öppna som webbapp</b> är påslaget.</small>';
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (installEvt && !isIOS) {
      installEvt.prompt();
      const r = await installEvt.userChoice;
      installEvt = null;
      if (r.outcome === 'accepted') $('#install-btn').hidden = true;
    } else {
      const help = $(isIOS ? '#install-help-ios' : '#install-help');
      help.hidden = !help.hidden;
    }
  });
  window.addEventListener('appinstalled', () => {
    $('#install-btn').hidden = true;
    $('#install-help').hidden = true;
    $('#install-help-ios').hidden = true;
  });

  /* Statusrad längst ner: är appen uppdaterad? */
  const verEl = $('#app-version');
  function setUpdateStatus(state) {
    const txt = {
      checking: 'Söker efter uppdatering…',
      ok: '✓ Appen är uppdaterad (v' + APP_VERSION + ')',
      offline: 'Utan internet · v' + APP_VERSION + ' (appen fungerar ändå)',
      updating: '🔄 Hämtar ny version…',
      ready: '🔄 Ny version finns – tryck här',
    }[state];
    verEl.textContent = txt;
    verEl.classList.toggle('ready', state === 'ready');
    verEl.disabled = state !== 'ready';
  }
  verEl.addEventListener('click', () => location.reload());
  setUpdateStatus(navigator.onLine === false ? 'offline' : 'checking');

  /* Hjälp: öppna ett visst avsnitt (t.ex. färgerna från statistiken), annars det första */
  function openHelp(id) {
    const all = $$('#view-help details');
    all.forEach((d, i) => { d.open = id ? d.id === id : i === 0; });
    if (id && $('#' + id)) setTimeout(() => $('#' + id).scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }
  $('#help-back').addEventListener('click', () => show(prevView || 'home'));
  $('#goal-card').addEventListener('click', () => data && openEdit(data));

  if ('serviceWorker' in navigator) {
    // Ny version installerad: ladda om en gång så att den syns direkt (inte vid allra första installationen)
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const isBusy = () => !!document.querySelector('#view-play.active, #view-result.active') || !$('#modal').hidden;
    function reloadWhenFree() {
      if (reloaded) return;
      if (isBusy()) { pendingReload = true; setUpdateStatus('ready'); return; }
      reloaded = true;
      location.reload();
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Inte mitt i en omgång eller medan en ruta (t.ex. nyheterna) är öppen
      if (hadController) reloadWhenFree();
    });
    // Jämför versionen på nätet med den som körs
    // Körs vid start, när appen kommer fram på skärmen igen och var 15:e minut medan den är öppen
    let lastCheck = 0, checking = false;
    async function checkUpdate(reg) {
      if (pendingReload || reloaded || checking) return;
      if (navigator.onLine === false) { setUpdateStatus('offline'); return; }
      if (!lastCheck) setUpdateStatus('checking');
      lastCheck = Date.now(); checking = true;
      try {
        const res = await fetch('sw.js?x=' + Date.now(), { cache: 'no-store' });
        const m = (await res.text()).match(/gangertabell-v(\d+)/);
        if (!m || m[1] === APP_VERSION) { setUpdateStatus('ok'); return; }
        setUpdateStatus('updating');
        if (reg) reg.update().catch(() => {});
        // Normalt laddar controllerchange om; annars (ingen SW, eller den var redan bytt) gör vi det själva
        setTimeout(reloadWhenFree, reg ? 8000 : 0);
      } catch (e) { setUpdateStatus('offline'); } finally { checking = false; }
    }
    let swReg = null;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => { swReg = reg; checkUpdate(reg); })
        .catch(() => checkUpdate(null));
    });
    window.addEventListener('online', () => checkUpdate(swReg));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastCheck > 60000) checkUpdate(swReg);
    });
    setInterval(() => { if (!document.hidden) checkUpdate(swReg); }, 15 * 60000);
    window.addEventListener('offline', () => { if (!pendingReload) setUpdateStatus('offline'); });
  }
}
