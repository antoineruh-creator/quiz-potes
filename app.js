'use strict';
/* ==========================================================================
   Quiz entre potes — interface et déroulement des parties
   ========================================================================== */
const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ALL_THEMES = Object.keys(THEMES);
const SPORT_THEMES = ['foot', 'nba', 'sports'];
const COLORS = ['#ff5c7a', '#3fa7ff', '#2fd27f', '#ffd24a', '#c77dff', '#ff8a3d', '#38e0d0', '#b0b8c8'];

/* ---------- réglages mémorisés ---------- */
const DEFAULTS = { players: ['Joueur 1', 'Joueur 2'], themes: ALL_THEMES.slice(), mode: 'quiz', count: 10, timer: 20, alternate: true, rounds: 3, levels: { foot: 2, nba: 2, sports: 2, music: 1, cinema: 1 } };
let cfg = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('qp.cfg') || '{}') }; } catch { return { ...DEFAULTS }; } })();
cfg.levels = { ...DEFAULTS.levels, ...(cfg.levels || {}) };
const saveCfg = () => { try { localStorage.setItem('qp.cfg', JSON.stringify(cfg)); } catch { } };

/* ---------- minuteur et audio ---------- */
let tm = null, tmStart = 0, tmSec = 0, aud = null;
function stopTimer() { if (tm) clearInterval(tm); tm = null; }
function startTimer(sec, onEnd) {
  stopTimer(); tmSec = sec; tmStart = Date.now();
  if (!sec) return;
  tm = setInterval(() => {
    const left = sec - (Date.now() - tmStart) / 1000;
    const bar = document.getElementById('tbar'), lbl = document.getElementById('tlbl');
    if (bar) { bar.style.width = Math.max(0, left / sec * 100) + '%'; bar.classList.toggle('low', left < 5); }
    if (lbl) lbl.textContent = Math.max(0, Math.ceil(left)) + ' s';
    if (left <= 0) { stopTimer(); onEnd(); }
  }, 100);
}
const timeFrac = () => tmSec ? Math.max(0, 1 - (Date.now() - tmStart) / 1000 / tmSec) : 0;
function stopAudio() { if (aud) { aud.pause(); aud = null; } }
const timerHtml = () => cfg.timer ? `<div class="timer"><div id="tbar"></div></div><div class="tlbl" id="tlbl">${cfg.timer} s</div>` : '';

/* ---------- enchaînement des thèmes ---------- */
function themeSeq(n) {
  const th = cfg.themes.length ? cfg.themes : ALL_THEMES;
  if (th.length === 1) return Array(n).fill(th[0]);
  if (cfg.alternate) { const order = shuffle(th); return Array.from({ length: n }, (_, i) => order[i % order.length]); }
  return Array.from({ length: n }, () => pick(th));
}
const newSession = () => ({ used: new Set(), recent: [], bad: new Set() });
const themeBadge = t => `<span class="badge" style="--tc:${THEMES[t].c}">${THEMES[t].e} ${THEMES[t].n}</span>`;
const setTheme = t => document.documentElement.style.setProperty('--tc', THEMES[t] ? THEMES[t].c : '#7c9cff');

/* ---------- affichage ---------- */
function show(html) { document.body.classList.remove('is-home'); $app.innerHTML = html; window.scrollTo(0, 0); }
let playing = false; // une partie est en cours (pour demander confirmation avant de quitter)
function modal(html) { closeModal(); const d = document.createElement('div'); d.id = 'modal'; d.innerHTML = `<div class="box">${html}</div>`; document.body.appendChild(d); }
function closeModal() { const d = document.getElementById('modal'); if (d) d.remove(); }
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
document.getElementById('homebtn').addEventListener('click', () => {
  if (!playing) return home();
  modal(`<h3>Quitter la partie ?</h3><p class="muted">La partie en cours sera perdue.</p>
    <div class="row"><button class="btn" data-act="closeModal">Continuer</button><button class="btn bad" data-act="goHome">Retour à l'accueil</button></div>`);
});
function loading(msg) { show(`<div class="center"><div class="spin"></div><p class="muted">${esc(msg)}</p></div>`); }
function errorScreen(msg, retryAct, backAct = 'home') {
  show(`<div class="center"><div class="big">😕</div><h2>Oups</h2><p class="muted">${esc(msg)}</p>
  <p class="muted small">Vérifie ta connexion : les questions viennent de Wikipédia/Wikidata.</p>
  <div class="row">${retryAct ? `<button class="btn primary" data-act="${retryAct}">Réessayer</button>` : ''}<button class="btn" data-act="${backAct}">Accueil</button></div></div>`);
}

/* ==========================================================================
   ACCUEIL
   ========================================================================== */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (document.getElementById('install')) document.getElementById('install').hidden = false; });

function home() {
  stopTimer(); stopAudio(); setTheme(''); playing = false;
  const th = cfg.themes;
  const multi = th.length > 1;
  show(`
  <header class="hero"><div class="logo">🎯</div><h1>Quiz entre potes</h1><p class="muted">Des questions fraîches, tirées de Wikipédia en direct.</p>
  <button class="btn small" id="install" data-act="install" hidden>📲 Installer l'appli</button></header>

  <section class="card"><h3>👥 Joueurs</h3>
    <div id="plist">${cfg.players.map((p, i) => playerRow(p, i)).join('')}</div>
    ${cfg.players.length < 8 ? `<button class="btn small" data-act="addPlayer">+ Ajouter un joueur</button>` : ''}
  </section>

  <section class="card"><div class="shead"><h3>🎨 Thématiques</h3>${th.length ? `<button class="mini-btn" data-act="clearThemes">✖ Tout désélectionner</button>` : ''}</div>
    <div class="chips">${ALL_THEMES.map(t => `<button class="chip ${th.includes(t) ? 'on' : ''}" style="--tc:${THEMES[t].c}" data-act="toggleTheme" data-v="${t}">${THEMES[t].e} ${THEMES[t].n}</button>`).join('')}</div>
    <div class="row wrap">
      <button class="btn small" data-act="presetSports">🏆 Tous les sports</button>
      <button class="btn small" data-act="presetAll">🎲 Tout mélangé</button>    </div>
    <div class="lvls">${th.map(t => `<div class="lvl"><span style="--tc:${THEMES[t].c}">${THEMES[t].e} ${THEMES[t].n}</span><div class="seg mini">${LEVEL_NAMES.map((n, i) => `<button class="${cfg.levels[t] === i ? 'on' : ''}" data-act="setLevel" data-t="${t}" data-v="${i}">${n}</button>`).join('')}</div></div>`).join('')}</div>
    ${th.length ? `<p class="muted small">Le niveau règle la notoriété des sujets, pour les questions comme pour les listes.</p>` : ''}
    ${multi ? `<div class="seg"><button class="${cfg.alternate ? 'on' : ''}" data-act="setAlt" data-v="1">🔁 Alterner les thèmes</button><button class="${!cfg.alternate ? 'on' : ''}" data-act="setAlt" data-v="0">🎲 Au hasard</button></div>
    <p class="muted small">${cfg.alternate ? 'À chaque question (ou manche) on passe au thème suivant : ' + th.map(t => THEMES[t].e).join(' → ') + ' …' : 'Le thème est tiré au sort à chaque fois.'}</p>` : (th.length ? `<p class="muted small">Seulement ${THEMES[th[0]].e} ${THEMES[th[0]].n}.</p>` : `<p class="muted small">Aucune thématique sélectionnée : choisis-en au moins une pour jouer.</p>`)}
  </section>

  <section class="card"><h3>🕹️ Mode de jeu</h3>
    <div class="seg"><button class="${cfg.mode === 'quiz' ? 'on' : ''}" data-act="setMode" data-v="quiz">❓ QCM</button><button class="${cfg.mode === 'enum' ? 'on' : ''}" data-act="setMode" data-v="enum">📝 Énumération</button><button class="${cfg.mode === 'mix' ? 'on' : ''}" data-act="setMode" data-v="mix">🔀 Mixte</button></div>
    <p class="muted small">${cfg.mode === 'quiz'
      ? 'Une question par joueur à tour de rôle : 4 réponses possibles, intrus, années… Plus on répond vite, plus on marque.'
      : cfg.mode === 'enum'
        ? "On donne une liste à citer (effectif d'un club, albums, films…). À tour de rôle chacun cite un nom, et on le touche dans la liste : un trou de mémoire et on est éliminé !"
        : "Des questions à choix et des manches d'énumération en alternance, sur les thèmes choisis. Les points s'additionnent."}</p>
    <div class="grid${cfg.mode === 'mix' ? 3 : 2}">
      ${cfg.mode !== 'enum' ? `<label>Questions<select data-act="setCount">${[6, 10, 15, 20, 30].map(n => `<option ${cfg.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
      ${cfg.mode !== 'quiz' ? `<label>Manches<select data-act="setRounds">${[1, 2, 3, 5, 8].map(n => `<option ${cfg.rounds === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
      <label>Chrono<select data-act="setTimer">${[[0, 'Sans'], [10, '10 s'], [15, '15 s'], [20, '20 s'], [30, '30 s'], [45, '45 s']].map(([v, l]) => `<option value="${v}" ${cfg.timer === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
  </section>

  <div class="stack">
    <button class="btn primary big" data-act="start">▶ Lancer la partie</button>
    ${cfg.mode === 'enum' ? `<button class="btn" data-act="custom">✍️ Je choisis moi-même (club + année, film, artiste…)</button>` : ''}
    <button class="btn ghost small" data-act="clearCache">🧹 Vider le cache des questions</button>
  </div>`);
  document.body.classList.add('is-home');
  if (installEvt) document.getElementById('install').hidden = false;
}
function playerRow(p, i) {
  return `<div class="prow"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span><input class="pname" data-i="${i}" value="${esc(p)}" maxlength="16" aria-label="Joueur ${i + 1}">${cfg.players.length > 1 ? `<button class="x" data-act="delPlayer" data-v="${i}" aria-label="Retirer">✕</button>` : ''}</div>`;
}

/* ==========================================================================
   MODE QUIZ
   ========================================================================== */
let G = null;

function startQuiz() {
  const players = cfg.players.map((n, i) => ({ name: n.trim() || 'Joueur ' + (i + 1), score: 0, ok: 0 }));
  G = { kind: 'quiz', players, n: cfg.count, i: 0, seq: themeSeq(cfg.count), session: newSession(), qs: [], q: null };
  playing = true; getQ(0); getQ(1);
  turnScreen();
}
function getQ(i) {
  if (i >= G.n) return null;
  if (!G.qs[i]) {
    const g = G;
    const themes = cfg.themes.length ? cfg.themes : ALL_THEMES;
    G.qs[i] = (async () => {
      const order = [g.seq[i], ...shuffle(themes.filter(t => t !== g.seq[i]))];
      let err;
      for (const t of order) { try { return await generateQuestion(t, g.session); } catch (e) { err = e; } }
      throw err;
    })();
    G.qs[i].catch(() => { });
  }
  return G.qs[i];
}
const cur = () => G.players[G.i % G.players.length];
function turnScreen() {
  stopTimer(); stopAudio();
  const p = cur(), pi = G.i % G.players.length, t = G.seq[G.i];
  setTheme(t);
  show(`<div class="center turn">
    <div class="count">Question ${G.i + 1} / ${G.n}</div>
    <div class="avatar" style="background:${COLORS[pi % COLORS.length]}">${esc(p.name[0].toUpperCase())}</div>
    <h2>À ${esc(p.name)} de jouer !</h2>
    ${themeBadge(t)}
    ${scoreStrip()}
    <button class="btn primary big" data-act="qGo">Je suis prêt</button>
    <button class="btn ghost small" data-act="home">Quitter</button></div>`);
}
const scoreStrip = () => `<div class="strip">${G.players.map((p, i) => `<span><i class="dot" style="background:${COLORS[i % COLORS.length]}"></i>${esc(p.name)} <b>${p.score}</b></span>`).join('')}</div>`;

async function qGo() {
  loading('Je prépare la question…');
  try { G.q = await getQ(G.i); } catch (e) { return errorScreen('Impossible de générer la question. ' + (e && e.message || ''), 'qGo'); }
  getQ(G.i + 1);
  renderQuestion();
}
function renderQuestion() {
  const q = G.q, p = cur(), pi = G.i % G.players.length;
  setTheme(q.theme);
  G.answered = false;
  show(`<div class="qhead"><span>${G.i + 1}/${G.n}</span>${themeBadge(q.theme)}<span class="who"><i class="dot" style="background:${COLORS[pi % COLORS.length]}"></i>${esc(p.name)}</span></div>
  ${timerHtml()}
  <h2 class="qtext">${esc(q.text)}</h2>
  ${q.audio ? `<button class="btn play" data-act="play" id="playbtn">▶ Écouter l'extrait</button>` : ''}
  <div class="opts">${q.options.map((o, i) => `<button class="opt" data-act="answer" data-v="${i}">${esc(o)}</button>`).join('')}</div>
  <div id="fb"></div>`);
  if (q.audio) { stopAudio(); aud = new Audio(q.audio); aud.play().then(() => setPlayLabel(true)).catch(() => { }); aud.onended = () => setPlayLabel(false); }
  startTimer(cfg.timer, () => answer(-1));
}
function setPlayLabel(on) { const b = document.getElementById('playbtn'); if (b) b.textContent = on ? '⏸ Pause' : '▶ Écouter l\'extrait'; }
function togglePlay() { if (!aud) return; if (aud.paused) { aud.play(); setPlayLabel(true); } else { aud.pause(); setPlayLabel(false); } }

function answer(idx) {
  if (G.answered) return; G.answered = true;
  const frac = timeFrac(); stopTimer(); stopAudio();
  const q = G.q, p = cur(), good = idx === q.correct;
  let pts = 0;
  if (good) { pts = 10 + Math.round(5 * frac); p.score += pts; p.ok++; }
  document.querySelectorAll('.opt').forEach((b, i) => { b.disabled = true; if (i === q.correct) b.classList.add('good'); else if (i === idx) b.classList.add('bad'); });
  const last = G.mix ? MX.k + 1 >= MX.steps.length : G.i + 1 >= G.n;
  document.getElementById('fb').innerHTML = `<div class="fb ${good ? 'ok' : 'ko'}">${good ? `✅ Bravo ! +${pts} pts` : (idx < 0 ? '⏰ Temps écoulé !' : '❌ Raté !')}<br><b>${esc(q.options[q.correct])}</b>${q.info ? `<br><span class="small">${esc(q.info)}</span>` : ''}</div>
  <button class="btn primary big" data-act="${G.mix ? (last ? 'mixEnd' : 'mixNext') : (last ? 'qEnd' : 'qNext')}">${last ? 'Voir les résultats 🏆' : (G.mix ? 'Suite →' : 'Question suivante →')}</button>`;
}
function qNext() { G.i++; turnScreen(); }
function ranking(players) {
  const r = players.map((p, i) => ({ ...p, c: COLORS[i % COLORS.length] })).sort((a, b) => b.score - a.score);
  return `<div class="rank">${r.map((p, i) => `<div class="rrow ${i === 0 ? 'gold' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="nm"><i class="dot" style="background:${p.c}"></i>${esc(p.name)}</span><span class="sc">${p.score} pts${p.ok !== undefined ? ` <small>(${p.ok} ✓)</small>` : ''}</span></div>`).join('')}</div>`;
}
function qEnd() {
  setTheme(''); playing = false;
  const best = Math.max(...G.players.map(p => p.score));
  const winners = G.players.filter(p => p.score === best).map(p => p.name);
  show(`<div class="center"><div class="big">🏆</div><h2>${winners.length > 1 ? 'Égalité : ' + esc(winners.join(' & ')) : esc(winners[0]) + ' gagne !'}</h2>
  ${ranking(G.players)}
  <div class="stack"><button class="btn primary big" data-act="start">🔁 Rejouer</button><button class="btn" data-act="home">Changer les réglages</button></div></div>`);
}

/* ==========================================================================
   MODE ÉNUMÉRATION
   ========================================================================== */
let E = null;

function startEnum(custom) {
  const players = cfg.players.map((n, i) => ({ name: n.trim() || 'Joueur ' + (i + 1), score: 0, alive: true }));
  const n = custom ? 1 : cfg.rounds;
  E = { kind: 'enum', players, n, r: 0, seq: themeSeq(n), session: newSession(), rs: [], round: null, turn: 0, custom };
  playing = true;
  if (custom) E.rs[0] = Promise.resolve(custom);
  else { getRound(0); getRound(1); }
  roundIntro();
}
function getRound(r) {
  if (r >= E.n) return null;
  if (!E.rs[r]) {
    const e = E, themes = cfg.themes.length ? cfg.themes : ALL_THEMES;
    E.rs[r] = (async () => {
      const order = [e.seq[r], ...shuffle(themes.filter(t => t !== e.seq[r]))];
      let err;
      for (const t of order) { try { return await randomEnum(t, e.session); } catch (x) { err = x; } }
      throw err;
    })();
    E.rs[r].catch(() => { });
  }
  return E.rs[r];
}
function roundIntro() {
  stopTimer();
  setTheme(E.seq[E.r]);
  show(`<div class="center"><div class="count">Manche ${E.r + 1} / ${E.n}</div>${E.custom ? '' : themeBadge(E.seq[E.r])}
  <div class="big">📝</div><h2>On tire une liste…</h2><div class="spin"></div></div>`);
  eGo();
}
async function eGo() {
  let data;
  try { data = await getRound(E.r); } catch (e) { return errorScreen('Impossible de charger la liste. ' + (e && e.message || ''), 'eRetry'); }
  getRound(E.r + 1);
  E.players.forEach(p => p.alive = true);
  E.round = { data, items: data.items.slice().sort((a, b) => a.localeCompare(b, 'fr')).map(label => ({ label, found: -1 })), found: 0, last: null };
  E.turn = E.r % E.players.length;
  setTheme(data.theme);
  show(`<div class="center"><div class="count">Manche ${E.r + 1} / ${E.n}</div>${themeBadge(data.theme)}
  <h2>${esc(data.title)}</h2><p class="muted">${esc(data.sub)}</p>
  <div class="bignum">${data.items.length}</div><p class="muted">noms à trouver</p>
  <p class="small muted">La liste est visible. Chacun son tour cite un nom à voix haute, puis on le touche dans la liste : +1 point. Trou de mémoire ou chrono dépassé = éliminé. Le dernier en lice gagne +3.</p>
  <button class="btn primary big" data-act="eStart">C'est parti !</button></div>`);
}
function eRetry() { E.rs[E.r] = null; roundIntro(); }
const aliveIdx = () => E.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
function nextAlive(from) { for (let k = 1; k <= E.players.length; k++) { const j = (from + k) % E.players.length; if (E.players[j].alive) return j; } return from; }

function renderEnum(msg, keep) {
  const R = E.round, d = R.data, p = E.players[E.turn], y = window.scrollY;
  show(`<div class="qhead"><span>Manche ${E.r + 1}/${E.n}</span>${themeBadge(d.theme)}<span>${R.found}/${R.items.length}</span></div>
  <h3 class="etitle">${esc(d.title)}</h3><p class="muted small center-t">${esc(d.sub)}</p>
  ${timerHtml()}
  <div class="eturn"><i class="dot" style="background:${COLORS[E.turn % COLORS.length]}"></i> <b>${esc(p.name)}</b>, à toi !<br><span class="small muted">Cite un nom, puis touche-le dans la liste.</span></div>
  <div id="emsg">${msg || ''}</div>
  <div class="slots pick">${R.items.map((it, i) => it.found >= 0
    ? `<span class="slot got" style="--pc:${COLORS[it.found % COLORS.length]}">${esc(it.label)}</span>`
    : `<button class="slot tap" data-act="eTap" data-v="${i}">${esc(it.label)}</button>`).join('')}</div>
  <div class="row wrap">
    <button class="btn small" data-act="eGiveUp">🙈 Je sèche</button>
    <button class="btn small" data-act="eBonus">➕ Nom valable hors liste</button>
    ${R.last ? `<button class="btn small" data-act="eUndo">↩ Annuler le dernier</button>` : ''}
  </div>
  <div class="strip">${E.players.map((q, i) => `<span class="${q.alive ? '' : 'out'}"><i class="dot" style="background:${COLORS[i % COLORS.length]}"></i>${esc(q.name)} <b>${q.score}</b>${q.alive ? '' : ' ✗'}</span>`).join('')}</div>`);
  if (keep) window.scrollTo(0, y);
  startTimer(cfg.timer, () => eFail('⏰ Temps écoulé !'));
}
function eStart() { renderEnum(); }
function eTap(v) {
  const R = E.round, it = R.items[+v]; if (!it || it.found >= 0) return;
  stopTimer();
  it.found = E.turn; R.found++; E.players[E.turn].score++;
  R.last = { idx: +v, turn: E.turn };
  if (R.found >= R.items.length) return roundEnd(true);
  E.turn = nextAlive(E.turn);
  renderEnum(`<div class="fb ok">✅ ${esc(it.label)}</div>`, true);
}
function eUndo() { // annule le dernier nom touché (erreur de clic)
  const R = E.round, L = R.last; if (!L) return;
  stopTimer();
  R.items[L.idx].found = -1; R.found--; E.players[L.turn].score--;
  R.last = null; E.turn = L.turn;
  renderEnum('<div class="fb">↩ Dernier nom annulé</div>', true);
}
function eBonus() { // nom valable mais absent de la liste (qui peut être incomplète) : +1 point, la liste ne bouge pas
  stopTimer();
  E.players[E.turn].score++; E.round.last = null;
  E.turn = nextAlive(E.turn);
  renderEnum('<div class="fb ok">✅ Nom accepté hors liste</div>', true);
}
function eGiveUp() { eFail('🙈 Trou de mémoire !'); }
function eFail(msg) {
  stopTimer();
  const R = E.round; R.last = null;
  const p = E.players[E.turn]; p.alive = false;
  const alive = aliveIdx();
  const solo = E.players.length === 1;
  if (alive.length <= (solo ? 0 : 1)) return roundEnd(false, `${msg}`);
  const prev = E.turn; E.turn = nextAlive(prev);
  renderEnum(`<div class="fb ko">${msg}<br><b>${esc(p.name)}</b> est éliminé.</div>`);
}
function roundEnd(complete, lastMsg) {
  stopTimer(); setTheme(E.round.data.theme);
  const R = E.round, alive = aliveIdx();
  let bonus = '';
  if (!complete && E.players.length > 1 && alive.length === 1) { E.players[alive[0]].score += 3; bonus = `<p class="fb ok">🏅 ${esc(E.players[alive[0]].name)} reste en lice : +3 points !</p>`; }
  if (complete) bonus = '<p class="fb ok">🎉 Liste complète ! Bravo à tous !</p>';
  const last = E.mix ? MX.k + 1 >= MX.steps.length : E.r + 1 >= E.n;
  show(`<div class="center"><h2>Fin de la manche</h2>${lastMsg ? `<p class="muted">${lastMsg}</p>` : ''}${bonus}
  <h3 class="etitle">${esc(R.data.title)}</h3>
  <div class="slots">${R.items.map(it => it.found >= 0 ? `<span class="slot got" style="--pc:${COLORS[it.found % COLORS.length]}">${esc(it.label)}</span>` : `<span class="slot miss">${esc(it.label)}</span>`).join('')}</div>
  <p class="muted small">En couleur : cité par un joueur. En gris : personne n'y a pensé.</p>
  ${ranking(E.players)}
  <button class="btn primary big" data-act="${E.mix ? (last ? 'mixEnd' : 'mixNext') : (last ? 'eEnd' : 'eNext')}">${last ? 'Résultats finaux 🏆' : (E.mix ? 'Suite →' : 'Manche suivante →')}</button></div>`);
}
function eNext() { E.r++; roundIntro(); }
function eEnd() {
  setTheme(''); playing = false;
  const best = Math.max(...E.players.map(p => p.score));
  const winners = E.players.filter(p => p.score === best).map(p => p.name);
  show(`<div class="center"><div class="big">🏆</div><h2>${winners.length > 1 ? 'Égalité : ' + esc(winners.join(' & ')) : esc(winners[0]) + ' gagne !'}</h2>
  ${ranking(E.players)}
  <div class="stack"><button class="btn primary big" data-act="start">🔁 Rejouer</button><button class="btn" data-act="home">Changer les réglages</button></div></div>`);
}

/* ==========================================================================
   MODE MIXTE : questions à choix et manches d'énumération en alternance
   ========================================================================== */
let MX = null;
function startMix() {
  const players = cfg.players.map((n, i) => ({ name: n.trim() || 'Joueur ' + (i + 1), score: 0, ok: 0, alive: true }));
  const nq = cfg.count, ne = cfg.rounds, steps = [];
  let e = 0;
  for (let i = 1; i <= nq; i++) { steps.push('q'); if (e < ne && i === Math.max(1, Math.round((e + 1) * nq / (ne + 1)))) { steps.push('e'); e++; } }
  while (e < ne) { steps.push('e'); e++; }
  const qseq = themeSeq(nq), eseq = themeSeq(ne); // les thèmes alternent séparément pour les questions et pour les manches
  MX = { players, steps, k: 0, qseq, eseq, nq, ne, qi: 0, ei: 0, qs: [], rs: [], session: newSession() };
  playing = true;
  runStep();
}
function runStep() {
  if (MX.steps[MX.k] === 'q') {
    G = { kind: 'quiz', mix: true, players: MX.players, n: MX.nq, i: MX.qi++, seq: MX.qseq, session: MX.session, qs: MX.qs, q: null };
    getQ(G.i); getQ(G.i + 1);
    turnScreen();
  } else {
    E = { kind: 'enum', mix: true, players: MX.players, n: MX.ne, r: MX.ei++, seq: MX.eseq, session: MX.session, rs: MX.rs, round: null, turn: 0, custom: null };
    roundIntro();
  }
}
function mixNext() { MX.k++; runStep(); }
function mixEnd() {
  setTheme(''); playing = false;
  const best = Math.max(...MX.players.map(p => p.score));
  const winners = MX.players.filter(p => p.score === best).map(p => p.name);
  show(`<div class="center"><div class="big">🏆</div><h2>${winners.length > 1 ? 'Égalité : ' + esc(winners.join(' & ')) : esc(winners[0]) + ' gagne !'}</h2>
  ${ranking(MX.players)}
  <div class="stack"><button class="btn primary big" data-act="start">🔁 Rejouer</button><button class="btn" data-act="home">Changer les réglages</button></div></div>`);
}

/* ---------- manche « je choisis moi-même » ---------- */
const CUSTOM_TYPES = {
  club: { n: '⚽ Joueurs d\'un club (5 grands championnats) ou d\'une équipe NBA + année', ph: 'Ex : Real Madrid, Lakers, Olympique de Marseille…', year: true },
  albums: { n: '💿 Albums d\'un artiste ou d\'un groupe', ph: 'Ex : Daft Punk, Queen, Stromae…' },
  members: { n: '🎸 Membres d\'un groupe', ph: 'Ex : Queen, NTM, Les Beatles…' },
  films: { n: '🎬 Films d\'un réalisateur', ph: 'Ex : Tarantino, Nolan, Spielberg…' },
  cast: { n: '🍿 Acteurs d\'un film', ph: 'Ex : Pulp Fiction, Titanic…' }
};
let CU = { type: 'club', sel: null, year: '', results: [] };
function custom() {
  setTheme('');
  show(`<h2>✍️ Ma propre manche</h2>
  <section class="card">
    <label>Type de liste<select id="cutype">${Object.entries(CUSTOM_TYPES).map(([k, v]) => `<option value="${k}" ${CU.type === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></label>
    <label>Recherche<input id="cusearch" placeholder="${esc(CUSTOM_TYPES[CU.type].ph)}" autocomplete="off"></label>
    <div id="curesults">${customResults()}</div>
    ${CUSTOM_TYPES[CU.type].year ? `<label>Année de début de saison <small class="muted">(ex : 2010 pour 2010-11 — vide = toutes époques)</small><input id="cuyear" type="number" inputmode="numeric" min="1950" max="2030" value="${esc(CU.year)}"></label>` : ''}
  </section>
  <div class="stack"><button class="btn primary big" data-act="cuGo" ${CU.sel ? '' : 'disabled'} id="cugo">▶ Lancer cette manche</button><button class="btn" data-act="home">Retour</button></div>`);
}
function customResults() {
  if (CU.sel) return `<div class="sel">✔ <b>${esc(CU.sel.label)}</b> <small class="muted">${esc(CU.sel.desc)}</small> <button class="x" data-act="cuClear">✕</button></div>`;
  return CU.results.map((r, i) => `<button class="res" data-act="cuPick" data-v="${i}"><b>${esc(r.label)}</b><small>${esc(r.desc)}</small></button>`).join('');
}
let cuTimer = null;
function cuSearch(term) {
  clearTimeout(cuTimer);
  if (term.trim().length < 2) { CU.results = []; document.getElementById('curesults').innerHTML = ''; return; }
  cuTimer = setTimeout(async () => {
    try { CU.results = await searchEntities(term.trim()); } catch { CU.results = []; }
    const el = document.getElementById('curesults'); if (el && !CU.sel) el.innerHTML = customResults() || '<p class="muted small">Aucun résultat.</p>';
  }, 300);
}
async function cuGo() {
  if (!CU.sel) return;
  loading('Je récupère la liste…');
  const { id, label } = CU.sel, y = parseInt(CU.year, 10);
  try {
    let data;
    if (CU.type === 'club') {
      if (!(await isAllowedTeam(id))) throw new Error('« ' + label + ' » n\'est pas dans les 5 grands championnats européens (ni en NBA).');
      data = await enumRoster(id, label, isNaN(y) ? 0 : y, 'foot');
    }
    else if (CU.type === 'albums') data = await enumAlbums(id, label);
    else if (CU.type === 'members') data = await enumMembers(id, label);
    else if (CU.type === 'films') data = await enumFilms(id, label);
    else data = await enumCast(id, label);
    startEnum(data);
  } catch (e) { errorScreen((e && e.message) || 'Liste introuvable', null, 'custom'); }
}

/* ==========================================================================
   ÉVÉNEMENTS
   ========================================================================== */
function start() {
  if (!cfg.themes.length) return toast('Choisis au moins une thématique 🙂');
  Object.assign(LEVELS, cfg.levels);
  cfg.players = cfg.players.map((n, i) => n.trim() || 'Joueur ' + (i + 1));
  saveCfg();
  if (cfg.mode === 'enum') startEnum(); else if (cfg.mode === 'mix') startMix(); else startQuiz();
}
const ACTS = {
  home, start, qGo, closeModal, goHome: () => { closeModal(); home(); }, answer: v => answer(+v), qNext, qEnd, play: togglePlay,
  mixNext, mixEnd, eStart, eTap: v => eTap(v), eUndo, eBonus, eGiveUp, eNext, eEnd, eRetry, custom, cuGo,
  install: async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } },
  clearCache: async () => { await DB.clear(); CATS.forEach(c => { c._p = {}; }); blindCache.clear(); toast('Cache vidé : les questions seront rechargées.'); },
  addPlayer: () => { cfg.players.push('Joueur ' + (cfg.players.length + 1)); saveCfg(); home(); },
  delPlayer: v => { cfg.players.splice(+v, 1); saveCfg(); home(); },
  toggleTheme: v => { const i = cfg.themes.indexOf(v); if (i >= 0) cfg.themes.splice(i, 1); else cfg.themes.push(v); cfg.themes = ALL_THEMES.filter(t => cfg.themes.includes(t)); saveCfg(); home(); },
  clearThemes: () => { cfg.themes = []; saveCfg(); home(); },
  presetSports: () => { cfg.themes = SPORT_THEMES.slice(); saveCfg(); home(); },
  presetAll: () => { cfg.themes = ALL_THEMES.slice(); cfg.alternate = true; saveCfg(); home(); },
  setAlt: v => { cfg.alternate = v === '1'; saveCfg(); home(); },
  setLevel: (v, el) => { cfg.levels[el.dataset.t] = +v; saveCfg(); home(); },
  setMode: v => { cfg.mode = v; saveCfg(); home(); },
  cuPick: v => { CU.sel = CU.results[+v]; custom(); },
  cuClear: () => { CU.sel = null; custom(); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return;
  const f = ACTS[el.dataset.act]; if (f) f(el.dataset.v, el);
});
document.addEventListener('change', e => {
  const el = e.target, a = el.dataset && el.dataset.act;
  if (a === 'setCount') { cfg.count = +el.value; saveCfg(); }
  else if (a === 'setRounds') { cfg.rounds = +el.value; saveCfg(); }
  else if (a === 'setTimer') { cfg.timer = +el.value; saveCfg(); }
  else if (el.id === 'cutype') { CU = { type: el.value, sel: null, year: '', results: [] }; custom(); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList.contains('pname')) { cfg.players[+el.dataset.i] = el.value; saveCfg(); }
  else if (el.id === 'cusearch') cuSearch(el.value);
  else if (el.id === 'cuyear') CU.year = el.value;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
home();
