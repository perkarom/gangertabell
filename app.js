'use strict';

/* ---------- Konstanter & ren logik (testbar i node) ---------- */
const ROUND_LEN = 20;
const TIME_LIMIT = 60; // sekunder
const SLOW_MS = 6000;

const key = (a, b) => a + 'x' + b;

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

function weightFor(s) {
  if (!s) return 2; // ej övat — lite extra
  let w = 1 + s.wrong * 3 - s.right * 0.4;
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
  const pool = combos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const weights = pool.map((q) => weightFor(stats[key(q.a, q.b)]));
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
  if (!s || s.right + s.wrong === 0) return 'none';
  const acc = s.right / (s.right + s.wrong);
  if (acc >= 0.9 && s.right >= 3 && s.avgMs <= SLOW_MS) return 'good';
  if (acc >= 0.7) return 'ok';
  return 'bad';
}

if (typeof module !== 'undefined') {
  module.exports = { combos, buildRound, buildHardRound, randomQuestion, starsFor, level, weightFor, key };
}

/* ---------- UI ---------- */
if (typeof document !== 'undefined') {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  /* Lagring */
  const STORE = 'gangertabell-v1';
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && d.stats) return d;
    } catch (e) { /* ignorera */ }
    return { stats: {}, records: { time: 0 }, stars: 0, totalRight: 0, sound: true, picked: [] };
  }
  const data = load();
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* ignorera */ }
  }

  /* Ljud */
  let audio;
  function beep(ok) {
    if (!data.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
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
  function show(name) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'home') renderHome();
    if (name === 'stats') renderStats();
    if (name === 'pick') renderPick();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { stopTimer(); show(go.dataset.go); }
    const m = e.target.closest('[data-mode]');
    if (m) startGame(m.dataset.mode);
  });

  function renderHome() {
    $('#home-stars').textContent = '⭐ ' + data.stars + (data.stars === 1 ? ' stjärna' : ' stjärnor');
    $('#sound-toggle').textContent = data.sound ? '🔊 Ljud på' : '🔇 Ljud av';
  }
  $('#sound-toggle').addEventListener('click', () => {
    data.sound = !data.sound; save(); renderHome();
  });

  /* Välj tabell */
  let picked = new Set(data.picked || []);
  function renderPick() {
    const g = $('#pick-grid');
    g.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement('button');
      b.textContent = i;
      b.classList.toggle('on', picked.has(i));
      b.addEventListener('click', () => {
        picked.has(i) ? picked.delete(i) : picked.add(i);
        b.classList.toggle('on', picked.has(i));
        $('#pick-start').disabled = picked.size === 0;
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
    const k = key(q.a, q.b);
    const s = data.stats[k] || { right: 0, wrong: 0, avgMs: 0 };
    if (ok) {
      s.avgMs = s.right ? Math.round(s.avgMs * 0.7 + Math.min(ms, 20000) * 0.3) : Math.min(ms, 20000);
      s.right++;
      data.totalRight++;
    } else {
      s.wrong++;
    }
    data.stats[k] = s;
    save();

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
    const delay = ok ? (game.mode === 'time' ? 450 : 700) : (game.mode === 'time' ? 1100 : 1500);
    setTimeout(() => {
      if (!game || !$('#view-play').classList.contains('active')) return;
      if (game.mode === 'time' && Date.now() >= game.endAt) return;
      nextQuestion();
    }, delay);
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
      title = isRec && g.correct > 0 ? 'Nytt rekord! 🏆' : 'Tiden är ute!';
      text = g.correct + ' rätt på ' + TIME_LIMIT + ' sekunder';
      extra = isRec ? (rec ? 'Förra rekordet var ' + rec : '') : 'Ditt rekord: ' + rec;
      if (isRec && g.correct > 0) confetti();
    } else {
      stars = starsFor(g.correct, g.total);
      const secs = Math.round((Date.now() - g.start) / 1000);
      title = ['Bra kämpat! 💪', 'Bra jobbat! 👍', 'Jättebra! 🌟', 'Perfekt! 🏆'][stars];
      text = g.correct + ' av ' + g.total + ' rätt direkt';
      extra = 'Tid: ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      if (stars === 3) confetti();
    }
    data.stars += stars;
    save();
    $('#result-stars').innerHTML = [0, 1, 2]
      .map((i) => '<span class="' + (i < stars ? '' : 'dim') + '" style="animation-delay:' + i * 0.2 + 's">⭐</span>')
      .join('');
    $('#result-title').textContent = title;
    $('#result-text').textContent = text;
    $('#result-extra').textContent = extra;
    $('#result-again').onclick = () => startGame(g.mode);
    show('result');
  }

  /* Statistik */
  function renderStats() {
    let practiced = 0, good = 0;
    for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) {
      const l = level(data.stats[key(a, b)]);
      if (l !== 'none') practiced++;
      if (l === 'good') good++;
    }
    $('#stats-summary').innerHTML =
      '<div class="stat-box"><b>' + good + '/100</b><small>kan du</small></div>' +
      '<div class="stat-box"><b>' + (data.records.time || 0) + '</b><small>rekord 60 s</small></div>' +
      '<div class="stat-box"><b>' + data.stars + '</b><small>stjärnor</small></div>';
    const g = $('#stats-grid');
    let html = '<div class="hd">×</div>';
    for (let b = 1; b <= 10; b++) html += '<div class="hd">' + b + '</div>';
    for (let a = 1; a <= 10; a++) {
      html += '<div class="hd">' + a + '</div>';
      for (let b = 1; b <= 10; b++) {
        html += '<div class="s-' + level(data.stats[key(a, b)]) + '">' + a * b + '</div>';
      }
    }
    g.innerHTML = html;
  }
  $('#stats-reset').addEventListener('click', () => {
    if (!confirm('Vill du verkligen nollställa all statistik, rekord och stjärnor?')) return;
    data.stats = {}; data.records = { time: 0 }; data.stars = 0; data.totalRight = 0;
    save(); renderStats();
  });

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

  // Androids tillbaka-knapp: gå till start istället för att stänga appen
  history.replaceState({ v: 'root' }, '');
  history.pushState({ v: 'app' }, '');
  window.addEventListener('popstate', () => {
    if (!$('#view-home').classList.contains('active')) {
      stopTimer(); game = null; show('home');
      history.pushState({ v: 'app' }, '');
    }
  });

  renderHome();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
