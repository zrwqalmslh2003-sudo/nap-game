const STORAGE_KEY = "nap_game_prefs_v1";
const TIE_BREAKER_DURATION = 30;
const TURN_COUNTDOWN_SECONDS = 3;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}

const state = {
  screen: "home",
  mode: "local",
  settings: { roundDuration: 60, totalRounds: 5, userName: "", botCount: 3 },
  playerNames: [],         // legacy key, kept as an empty array so saved prefs keep their shape
  players: [],            // [{id, name, totalScore, isHuman?, isBot?, botSubmitAt?, botSubmitted?}]
  round: { number: 0, letter: null, lastLetter: null },
  answers: {},             // playerId -> {name, animal, plant, object, country}
  roundScores: {},          // playerId -> per-category score result (current round)
  roundHistory: [],         // [{number, letter, scores, players}]
  // countdown: the ~3s "get ready" phase before a turn. No game time is consumed here.
  countdown: { endAt: null, intervalId: null, secondsLeft: TURN_COUNTDOWN_SECONDS },
  // turn: the actual per-player answering window. Always timestamp based so a player
  // can never inherit time left over from a previous player, and drift/refresh can't grant extra time.
  turn: { endAt: null, duration: 0, intervalId: null, locked: false },
  tieBreaker: { active: false, candidateIds: [] },
  dictionaryMissing: false,
  userNameError: ""
};

/* ---------------- game lifecycle ---------------- */

function randomBotSubmitAt() { return 0.35 + Math.random() * 0.45; }   // fraction of the round, [0.35, 0.8]

// One human followed by `botCount` bots with distinct Arabic names.
function buildPlayers() {
  const userName = (state.settings.userName || "").trim();
  const botCount = state.settings.botCount;
  const botNames = window.ai.names(botCount, [userName]);
  const players = [{ id: 1, name: userName || "أنت", totalScore: 0, isHuman: true }];
  botNames.forEach(function (name, i) {
    players.push({ id: i + 2, name: name, totalScore: 0, isBot: true, botSubmitAt: randomBotSubmitAt(), botSubmitted: false });
  });
  return players;
}

function humanPlayer() {
  return state.players.filter(function (p) { return p.isHuman; })[0] || null;
}

async function startGame() {
  if (typeof loadAvailableLetters === "function") {
    try { await loadAvailableLetters(); } catch (e) { console.warn("letters manifest failed, using current pools"); }
  }
  resetForNewGame();
  startRound();
}

// Rebuilds players/state without starting a round yet (used by "play again" before startRound()).
function resetForNewGame() {
  state.players = buildPlayers();
  state.round = { number: 0, letter: null, lastLetter: null };
  state.roundHistory = [];
  state.tieBreaker = { active: false, candidateIds: [] };
}

function activeRoundPlayers() {
  if (state.tieBreaker.active) {
    return state.players.filter(function (p) { return state.tieBreaker.candidateIds.indexOf(p.id) !== -1; });
  }
  return state.players;
}

function currentTurnDuration() {
  return state.tieBreaker.active ? TIE_BREAKER_DURATION : state.settings.roundDuration;
}

async function startRound() {
  if (!AVAILABLE_LETTERS.length && typeof loadAvailableLetters === "function") {
    try { await loadAvailableLetters(); } catch (e) {}
  }
  if (!AVAILABLE_LETTERS.length) {
    alert("لا توجد حروف متاحة");
    goTo("home");
    return;
  }
  state.round.number += 1;
  const letter = getRandomLetter(state.round.lastLetter);
  state.round.letter = letter;
  state.round.lastLetter = letter;

  const players = activeRoundPlayers();
  state.answers = {};
  players.forEach(function (p) { state.answers[p.id] = emptyAnswers(); });

  const dict = await loadDictionary(letter);
  state.dictionaryMissing = (dict === null);

  players.forEach(function (p) {
    if (!p.isBot) return;
    state.answers[p.id] = window.ai.answers(letter, dict, CATEGORIES);
    p.botSubmitted = false;
    p.botSubmitAt = randomBotSubmitAt();
  });

  startTurnCountdown();
}

function emptyAnswers() {
  const a = {};
  CATEGORIES.forEach(function (c) { a[c.key] = ""; });
  return a;
}

/* ---------------- the human's turn (bots answer in the background) ---------------- */

// The ~3s "get ready" phase shown before every round.
// No inputs exist on this screen, and no game time is consumed while it runs.
function startTurnCountdown() {
  clearInterval(state.countdown.intervalId);
  clearInterval(state.turn.intervalId);
  state.turn.locked = true; // inputs are never active during countdown
  state.countdown.secondsLeft = TURN_COUNTDOWN_SECONDS;
  state.countdown.endAt = Date.now() + TURN_COUNTDOWN_SECONDS * 1000;
  goTo("roundReady");

  state.countdown.intervalId = setInterval(function () {
    const remainingMs = state.countdown.endAt - Date.now();
    const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
    state.countdown.secondsLeft = secondsLeft;
    if (remainingMs <= 0) {
      clearInterval(state.countdown.intervalId);
      startPlayerTurn();
      return;
    }
    renderCountdownOnly();
  }, 100);
}

// Grants the human the full configured duration.
function startPlayerTurn() {
  clearInterval(state.turn.intervalId);
  state.turn.locked = false;
  state.turn.duration = currentTurnDuration();
  state.turn.endAt = Date.now() + state.turn.duration * 1000;
  goTo("playing");
  runTurnTimer();
}

function runTurnTimer() {
  clearInterval(state.turn.intervalId);
  state.turn.intervalId = setInterval(function () {
    const remainingMs = state.turn.endAt - Date.now();
    if (remainingMs <= 0) {
      renderTimerOnly(0);
      finishPlayerTurn(true);
      return;
    }
    renderTimerOnly(Math.ceil(remainingMs / 1000));
  }, 200);
}

// After a page reload: keep the ORIGINAL deadline (turn.endAt is an absolute timestamp),
// so refreshing can never grant extra time. If it already passed, the turn ends now.
function resumePlayerTurn() {
  clearInterval(state.turn.intervalId);
  state.turn.locked = false;
  if (!state.turn.endAt || state.turn.endAt <= Date.now()) {
    finishPlayerTurn(true);
    return;
  }
  goTo("playing");
  runTurnTimer();
}

function turnSecondsRemaining() {
  if (!state.turn.endAt) return state.turn.duration;
  return Math.max(0, Math.ceil((state.turn.endAt - Date.now()) / 1000));
}

// Only the human calls this. isTimeout=true when the clock hit zero; false when they pressed "done" and confirmed.
function finishPlayerTurn(isTimeout) {
  if (state.turn.locked) return;
  state.turn.locked = true;
  clearInterval(state.turn.intervalId);
  finishRound();
}

/* ---------------- round + game completion ---------------- */

function finishRound() {
  const players = activeRoundPlayers();
  state.roundScores = calculateRoundScores(state.round.letter, players, state.answers);
  players.forEach(function (p) {
    p.totalScore += roundTotalForPlayer(state.roundScores[p.id]);
  });
  state.roundHistory.push({
    number: state.round.number,
    letter: state.round.letter,
    scores: state.roundScores,
    players: players.map(function (p) { return p.id; })
  });
  goTo("review");
}

function nextRound() {
  startRound();
}

function finishGame() {
  goTo("finalResults");
}

function isGameOver() {
  return !state.tieBreaker.active && state.round.number >= state.settings.totalRounds;
}

function calculateFinalScores() {
  return getRanking();
}

function getRanking() {
  return state.players.slice().sort(function (a, b) { return b.totalScore - a.totalScore; });
}

function getTiedLeaders() {
  const ranked = getRanking();
  if (!ranked.length) return [];
  const top = ranked[0].totalScore;
  return ranked.filter(function (p) { return p.totalScore === top; });
}

// The tie-break is over once the human is no longer among the tied leaders.
function tieBreakerResolved() {
  const tied = getTiedLeaders();
  return tied.length < 2 || !tied.some(function (p) { return p.isHuman; });
}

function startTieBreaker() {
  const tied = getTiedLeaders();
  state.tieBreaker = { active: true, candidateIds: tied.map(function (p) { return p.id; }) };
  startRound();
}

/* ---------------- setup helpers ---------------- */

function validateUserName() {
  const len = (state.settings.userName || "").trim().length;
  const ok = len >= 2 && len <= 20;
  state.userNameError = ok ? "" : "من 2 إلى 20 حرفًا";
  return ok;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
