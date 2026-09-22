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
  settings: { playersCount: 2, roundDuration: 60, totalRounds: 5, difficulty: "easy" },
  playerNames: ["", ""],
  players: [],            // [{id, name, totalScore}]
  round: { number: 0, letter: null, lastLetter: null },
  turnOrder: [],           // player ids taking part in the current round, in turn order
  currentPlayerIndex: 0,
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
  nameErrors: []
};

/* ---------------- game lifecycle ---------------- */

function startGame() {
  state.players = state.playerNames.slice(0, state.settings.playersCount).map(function (name, i) {
    return { id: i + 1, name: name.trim(), totalScore: 0 };
  });
  state.round = { number: 0, letter: null, lastLetter: null };
  state.roundHistory = [];
  state.tieBreaker = { active: false, candidateIds: [] };
  startRound();
}

// Rebuilds players/state without starting a round yet (used by "play again" before startRound()).
function resetForNewGame() {
  state.players = state.playerNames.slice(0, state.settings.playersCount).map(function (name, i) {
    return { id: i + 1, name: name.trim(), totalScore: 0 };
  });
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
  state.round.number += 1;
  const letter = getRandomLetter(state.round.lastLetter, state.settings.difficulty);
  state.round.letter = letter;
  state.round.lastLetter = letter;

  const players = activeRoundPlayers();
  state.turnOrder = players.map(function (p) { return p.id; });
  state.currentPlayerIndex = 0;

  state.answers = {};
  players.forEach(function (p) { state.answers[p.id] = { nameMale: "", nameFemale: "", animal: "", plant: "", object: "", country: "" }; });

  const dict = await loadDictionary(letter);
  state.dictionaryMissing = (dict === null);

  startTurnCountdown();
}

/* ---------------- per-player turn ---------------- */

function currentTurnPlayer() {
  const id = state.turnOrder[state.currentPlayerIndex];
  return state.players.filter(function (p) { return p.id === id; })[0] || null;
}

// The ~3s "get ready" phase shown before every single player's turn (not just the first).
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

// Grants the CURRENT player the full configured duration, independent of any previous player.
function startPlayerTurn() {
  clearInterval(state.turn.intervalId);
  state.turn.locked = false;
  state.turn.duration = currentTurnDuration();
  state.turn.endAt = Date.now() + state.turn.duration * 1000;
  goTo("playing");

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

function turnSecondsRemaining() {
  if (!state.turn.endAt) return state.turn.duration;
  return Math.max(0, Math.ceil((state.turn.endAt - Date.now()) / 1000));
}

// isTimeout=true when the clock hit zero; false when the player pressed "I'm done" and confirmed.
function finishPlayerTurn(isTimeout) {
  if (state.turn.locked) return;
  state.turn.locked = true;
  clearInterval(state.turn.intervalId);

  const isLastPlayer = state.currentPlayerIndex >= state.turnOrder.length - 1;
  if (isLastPlayer) {
    finishRound();
  } else {
    state.currentPlayerIndex += 1;
    startTurnCountdown();
  }
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

function tieBreakerResolved() {
  const scored = state.tieBreaker.candidateIds.map(function (id) {
    return roundTotalForPlayer(state.roundScores[id]);
  });
  return new Set(scored).size === scored.length;
}

function startTieBreaker() {
  const tied = getTiedLeaders();
  state.tieBreaker = { active: true, candidateIds: tied.map(function (p) { return p.id; }) };
  startRound();
}

/* ---------------- setup helpers ---------------- */

function syncPlayerNamesLength() {
  const n = state.settings.playersCount;
  while (state.playerNames.length < n) state.playerNames.push("");
  state.playerNames = state.playerNames.slice(0, n);
}

function validatePlayerNames() {
  const errors = state.playerNames.map(function () { return ""; });
  const seen = {};
  let ok = true;
  state.playerNames.forEach(function (name, i) {
    const trimmed = (name || "").trim();
    if (trimmed.length < 2) { errors[i] = "حرفان على الأقل"; ok = false; return; }
    if (trimmed.length > 20) { errors[i] = "20 حرفًا كحد أقصى"; ok = false; return; }
    const key = normalizeAnswer(trimmed);
    if (seen[key]) { errors[i] = "الاسم مكرر"; ok = false; return; }
    seen[key] = true;
  });
  state.nameErrors = errors;
  return ok;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
