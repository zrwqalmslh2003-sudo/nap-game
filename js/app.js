(function () {
  "use strict";

  const screenEl = document.getElementById("screen");
  const roundBadge = document.getElementById("roundBadge");
  const modalRoot = document.getElementById("modalRoot");

  let lastCountdownValue = null;
  let tickTimer = null;

  window.goTo = function goTo(screen) {
    state.screen = screen;
    render();
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render() {
    updateRoundBadge();
    if (state.mode === "online" && window.Online) return window.Online.render(state.screen);
    switch (state.screen) {
      case "home": return renderHome();
      case "setup": return renderSetup();
      case "players": return renderPlayers();
      case "roundReady": return renderRoundReady();
      case "playing": return renderPlaying();
      case "review": return renderReview();
      case "roundResults": return renderRoundResults();
      case "finalResults": return renderFinalResults();
      default: return renderHome();
    }
  }

  function updateRoundBadge() {
    const showOn = ["roundReady", "playing", "review", "roundResults"];
    if (showOn.indexOf(state.screen) !== -1 && state.round.number > 0) {
      const totalLabel = state.tieBreaker.active ? "فاصلة" : state.settings.totalRounds;
      roundBadge.textContent = "الجولة " + state.round.number + " / " + totalLabel;
      roundBadge.classList.remove("hidden");
    } else {
      roundBadge.classList.add("hidden");
    }
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    screenEl.innerHTML =
      '<div class="card stack center-text">' +
        '<h1 class="hero">اسم حيوان نبات<br>جماد بلاد</h1>' +
        '<p class="subtitle">اختبروا سرعتكم ومعرفتكم بالحروف، لعبة تناوب محلية لغاية 6 لاعبين</p>' +
        '<button class="btn btn-primary" id="btnStart">ابدأ اللعبة</button> +
        '<button class="btn btn-secondary" id="btnOnline">لعب أونلاين</button>' +
        '<button class="btn btn-ghost" id="btnRules" style="align-self:center;">طريقة اللعب</button>' +
      '</div>';
    document.getElementById("btnStart").onclick = function () {
      const prefs = loadPrefs();
      if (prefs) {
        state.settings = prefs.settings || state.settings;
        if (!state.settings.difficulty) state.settings.difficulty = "easy";
        state.playerNames = prefs.playerNames || state.playerNames;
      }
      syncPlayerNamesLength();
      goTo("setup");
    };
    document.getElementById("btnOnline").onclick = function () { state.mode = "online"; goTo("onlineMenu"); };
    document.getElementById("btnRules").onclick = showRulesModal;
  }

  function showRulesModal() {
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="rulesBackdrop">' +
        '<div class="modal">' +
          '<h3>طريقة اللعب</h3>' +
          '<p>' +
            'يظهر حرف عشوائي لكل جولة، ويأخذ كل لاعب دوره الكامل بمفرده على نفس الجهاز، فيكتب كلمة تبدأ بهذا الحرف في كل خانة: اسم ولد، اسم بنت، حيوان، نبات، جماد، بلاد، قبل انتهاء وقته الخاص.' +
            '<br><br>' +
            'الإجابة الصحيحة والفريدة تُحسب 10 نقاط، والإجابة الصحيحة المكررة مع لاعب آخر تُحسب 5 نقاط، والإجابة الخاطئة أو الفارغة تُحسب صفرًا.' +
            '<br><br>' +
            'بعد عدد الجولات المحدد يفوز صاحب أعلى مجموع نقاط. وفي حال التعادل على المركز الأول تُلعب جولة فاصلة مدتها 30 ثانية.' +
            '<br><br>' +
            'في وضع "صعب" تُضاف ثلاثة أحرف إضافية (ث، ذ، ظ) إلى مجموعة الحروف.' +
          '</p>' +
          '<button class="btn btn-primary" id="closeRules">فهمت</button>' +
        '</div>' +
      '</div>';
    document.getElementById("closeRules").onclick = closeModal;
    document.getElementById("rulesBackdrop").onclick = function (e) { if (e.target.id === "rulesBackdrop") closeModal(); };
  }
  function closeModal() { modalRoot.innerHTML = ""; }

  /* ---------- SETUP ---------- */
  function renderSetup() {
    const s = state.settings;
    screenEl.innerHTML =
      '<div class="card stack">' +
        '<div>' +
          '<span class="field-label">عدد اللاعبين</span>' +
          '<div class="stepper">' +
            '<button id="decPlayers" aria-label="إنقاص عدد اللاعبين">−</button>' +
            '<span class="value" id="playersVal">' + s.playersCount + '</span>' +
            '<button id="incPlayers" aria-label="زيادة عدد اللاعبين">+</button>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">مدة دور كل لاعب (ثانية)</span>' +
          '<div class="choice-row" id="durationRow">' +
            [30, 60, 90].map(function (d) {
              return '<div class="choice' + (s.roundDuration === d ? ' active' : '') + '" data-val="' + d + '">' + d + '</div>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">عدد الجولات</span>' +
          '<div class="choice-row" id="roundsRow">' +
            [3, 5, 10].map(function (r) {
              return '<div class="choice' + (s.totalRounds === r ? ' active' : '') + '" data-val="' + r + '">' + r + '</div>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">مستوى الصعوبة</span>' +
          '<div class="choice-row" id="difficultyRow">' +
            '<div class="choice' + (s.difficulty !== "hard" ? ' active' : '') + '" data-val="easy">سهل</div>' +
            '<div class="choice' + (s.difficulty === "hard" ? ' active' : '') + '" data-val="hard">صعب</div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">الفئات</span>' +
          '<div class="cat-list">' +
            CATEGORIES.map(function (c) { return '<span class="cat-chip">' + c.label + '</span>'; }).join("") +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary" id="btnToPlayers">متابعة</button>' +
        '<button class="btn btn-ghost" id="btnBackHome" style="align-self:center;">رجوع</button>' +
      '</div>';

    document.getElementById("decPlayers").onclick = function () {
      s.playersCount = Math.max(1, s.playersCount - 1);
      syncPlayerNamesLength();
      renderSetup();
    };
    document.getElementById("incPlayers").onclick = function () {
      s.playersCount = Math.min(6, s.playersCount + 1);
      syncPlayerNamesLength();
      renderSetup();
    };
    document.getElementById("durationRow").onclick = function (e) {
      const t = e.target.closest(".choice");
      if (!t) return;
      s.roundDuration = parseInt(t.dataset.val, 10);
      renderSetup();
    };
    document.getElementById("roundsRow").onclick = function (e) {
      const t = e.target.closest(".choice");
      if (!t) return;
      s.totalRounds = parseInt(t.dataset.val, 10);
      renderSetup();
    };
    document.getElementById("difficultyRow").onclick = function (e) {
      const t = e.target.closest(".choice");
      if (!t) return;
      s.difficulty = t.dataset.val;
      renderSetup();
    };
    document.getElementById("btnToPlayers").onclick = function () { goTo("players"); };
    document.getElementById("btnBackHome").onclick = function () { goTo("home"); };
  }

  /* ---------- PLAYERS ---------- */
  function renderPlayers() {
    syncPlayerNamesLength();
    if (!state.nameErrors.length) state.nameErrors = state.playerNames.map(function () { return ""; });

    const rows = state.playerNames.map(function (name, i) {
      return (
        '<div class="player-row">' +
          '<label class="field-label" for="playerInput' + i + '">اللاعب ' + (i + 1) + '</label>' +
          '<input type="text" id="playerInput' + i + '" data-idx="' + i + '" class="playerInput' + (state.nameErrors[i] ? ' invalid' : '') + '" ' +
            'value="' + esc(name) + '" maxlength="20" placeholder="اكتب الاسم">' +
          '<div class="error-text">' + esc(state.nameErrors[i] || "") + '</div>' +
        '</div>'
      );
    }).join("");

    screenEl.innerHTML =
      '<div class="card stack">' +
        '<span class="field-label" style="font-size:16px;">أسماء اللاعبين</span>' +
        rows +
        '<button class="btn btn-primary" id="btnToRound">متابعة</button>' +
        '<button class="btn btn-ghost" id="btnBackSetup" style="align-self:center;">رجوع</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll(".playerInput"), function (input) {
      input.oninput = function () {
        state.playerNames[parseInt(input.dataset.idx, 10)] = input.value;
      };
    });
    document.getElementById("btnBackSetup").onclick = function () { goTo("setup"); };
    document.getElementById("btnToRound").onclick = function () {
      if (!validatePlayerNames()) { renderPlayers(); return; }
      savePrefs({ settings: state.settings, playerNames: state.playerNames });
      startGame();
    };
  }

  /* ---------- ROUND / TURN READY (3s countdown before EVERY player's turn) ---------- */
  function renderRoundReady() {
    const player = currentTurnPlayer();
    const isFirstOfRound = state.currentPlayerIndex === 0;
    screenEl.innerHTML =
      '<div class="card center-text">' +
        (state.tieBreaker.active && isFirstOfRound ? '<div class="tie-banner">تعادل! جولة فاصلة</div>' : '') +
        '<p class="muted">الحرف</p>' +
        '<div class="letter-hero">' + esc(state.round.letter) + '</div>' +
        '<p class="muted" id="readyLabel">استعد يا <strong style="color:var(--ink);">' + esc(player ? player.name : "") + '</strong>...</p>' +
        '<div class="countdown-num" id="countdownNum" aria-live="polite">' + state.countdown.secondsLeft + '</div>' +
      '</div>';
  }

  window.renderCountdownOnly = function renderCountdownOnly() {
    if (state.screen !== "roundReady") return;
    const el = document.getElementById("countdownNum");
    if (!el) return;
    const value = state.countdown.secondsLeft > 0 ? String(state.countdown.secondsLeft) : "ابدأ!";
    el.textContent = value;
    if (value === lastCountdownValue) return;
    lastCountdownValue = value;
    el.classList.remove("tick");
    void el.offsetWidth;
    el.classList.add("tick");
    clearTimeout(tickTimer);
    tickTimer = setTimeout(function () {
      el.classList.remove("tick");
    }, 200);
  };

  /* ---------- PLAYING (one player's own full turn) ---------- */
  function renderPlaying() {
    const player = currentTurnPlayer();
    const players = state.turnOrder;
    const ans = state.answers[player.id];
    const remaining = turnSecondsRemaining();

    screenEl.innerHTML =
      '<div class="card">' +
        (state.dictionaryMissing ? '<div class="tie-banner">⚠️ القاموس غير محمّل — التحقق بالحرف فقط</div>' : '') +
        '<div class="play-top">' +
          '<span class="letter-chip">' + esc(state.round.letter) + '</span>' +
          '<span class="timer' + (remaining <= 10 ? ' urgent' : '') + '" id="timerDisplay" aria-live="polite">' + fmtTime(remaining) + '</span>' +
        '</div>' +
        '<p class="center-text muted" style="margin:2px 0 14px;">دور: <strong style="color:var(--ink);">' + esc(player.name) + '</strong> (' + (state.currentPlayerIndex + 1) + ' / ' + players.length + ')</p>' +
        CATEGORIES.map(function (c) {
          return (
            '<div class="answer-block">' +
              '<label for="f_' + c.key + '">' + c.label + '</label>' +
              '<input type="text" id="f_' + c.key + '" data-key="' + c.key + '" value="' + esc(ans[c.key]) + '" placeholder="' + esc(state.round.letter) + '..." ' + (state.turn.locked ? 'disabled' : '') + '>' +
            '</div>'
          );
        }).join("") +
        '<button class="btn btn-primary" id="btnFinish"' + (state.turn.locked ? ' disabled' : '') + '>انتهيت ✓</button>' +
      '</div>';

    CATEGORIES.forEach(function (c) {
      const el = document.getElementById("f_" + c.key);
      el.oninput = function () { ans[c.key] = el.value; };
    });

    document.getElementById("btnFinish").onclick = function () {
      if (state.turn.locked) return;
      showFinishConfirm(player, players);
    };
  }

  function showFinishConfirm(player, players) {
    const isLast = state.currentPlayerIndex >= players.length - 1;
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="finishBackdrop">' +
        '<div class="modal">' +
          '<h3>هل أنت متأكد من إنهاء دورك؟</h3>' +
          '<p>' + (isLast ? 'لن تتمكن من تعديل إجاباتك بعد ذلك، وستُقفل الجولة لجميع اللاعبين.' : 'لن تتمكن من تعديل إجاباتك، وسينتقل الدور الكامل للاعب التالي.') + '</p>' +
          '<div class="btn-row">' +
            '<button class="btn btn-secondary" id="cancelFinish">إلغاء</button>' +
            '<button class="btn btn-primary" id="confirmFinish">انتهيت</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.getElementById("cancelFinish").onclick = closeModal;
    document.getElementById("confirmFinish").onclick = function () {
      closeModal();
      finishPlayerTurn(false);
    };
  }

  // Called every tick from the timestamp-based interval in game.js.
  window.renderTimerOnly = function renderTimerOnly(remainingSeconds) {
    if (state.screen !== "playing") return;
    const el = document.getElementById("timerDisplay");
    if (!el) return;
    const becameUrgent = remainingSeconds <= 10 && !el.classList.contains("urgent");
    el.textContent = fmtTime(remainingSeconds);
    el.classList.toggle("urgent", remainingSeconds <= 10);
    if (becameUrgent) {
      el.classList.add("shake");
      setTimeout(function () { el.classList.remove("shake"); }, 200);
    }
    if (remainingSeconds <= 0) {
      // lock inputs visually the instant time hits zero, even before finishPlayerTurn() re-renders
      Array.prototype.forEach.call(document.querySelectorAll('#screen input, #screen button'), function (n) { n.disabled = true; });
    }
  };

  /* ---------- REVIEW ---------- */
  function renderReview() {
    const players = state.turnOrder.map(function (id) {
      return state.players.filter(function (p) { return p.id === id; })[0];
    });
    const rows = players.map(function (p) {
      const sc = state.roundScores[p.id];
      const total = roundTotalForPlayer(sc);
      const catsHtml = CATEGORIES.map(function (c) {
        const cell = sc[c.key];
        const cls = cell.points === 10 ? "unique" : cell.points === 5 ? "dup" : "zero";
        const shown = cell.value && cell.value.trim() ? esc(cell.value) : "—";
        const reason = cell.status === "invalid" ? "حرف خاطئ" : cell.status === "not_in_dict" ? "غير مدرجة" : "";
        return (
          '<div>' +
            '<div class="review-row">' +
              '<span class="cat">' + c.label + '</span>' +
              '<span class="ans">' + shown + '</span>' +
              '<span class="pts ' + cls + '">+' + cell.points + '</span>' +
            '</div>' +
            (reason ? '<div class="muted" style="font-size:12px; padding:0 0 4px;">' + reason + '</div>' : '') +
          '</div>'
        );
      }).join("");
      return (
        '<div class="review-player">' +
          '<div class="review-player-name"><span>' + esc(p.name) + '</span></div>' +
          catsHtml +
          '<div class="round-total">مجموع الجولة: ' + total + '</div>' +
        '</div>'
      );
    }).join("");

    screenEl.innerHTML =
      '<div class="card">' +
        '<p class="center-text muted">نتائج الجولة — الحرف <strong style="color:var(--accent-deep); font-family:\'Cairo\',sans-serif; font-weight:800; font-size:20px;">' + esc(state.round.letter) + '</strong></p>' +
        rows +
        '<button class="btn btn-primary" id="btnToResults">النتائج</button>' +
      '</div>';

    document.getElementById("btnToResults").onclick = function () { goTo("roundResults"); };
  }

  /* ---------- ROUND RESULTS ---------- */
  function renderRoundResults() {
    const players = state.turnOrder.map(function (id) {
      return state.players.filter(function (p) { return p.id === id; })[0];
    });
    const ranked = players.slice().sort(function (a, b) {
      return roundTotalForPlayer(state.roundScores[b.id]) - roundTotalForPlayer(state.roundScores[a.id]);
    });
    const medals = ["🥇", "🥈", "🥉"];
    const rows = ranked.map(function (p, i) {
      return (
        '<div class="leaderboard-row">' +
          '<span class="rank-medal">' + (medals[i] || (i + 1)) + '</span>' +
          '<span class="lb-name">' + esc(p.name) + '<br><span class="muted" style="font-size:12px;">المجموع: ' + p.totalScore + '</span></span>' +
          '<span class="lb-score">+' + roundTotalForPlayer(state.roundScores[p.id]) + '</span>' +
        '</div>'
      );
    }).join("");

    const gameOver = state.tieBreaker.active ? tieBreakerResolved() : isGameOver();
    const btnLabel = gameOver ? "النتائج النهائية" : "الجولة التالية";

    screenEl.innerHTML =
      '<div class="card">' +
        '<p class="center-text muted" style="margin-bottom:10px;">🏆 نتائج الجولة</p>' +
        rows +
        '<button class="btn btn-primary" id="btnNext" style="margin-top:16px;">' + btnLabel + '</button>' +
      '</div>';

    document.getElementById("btnNext").onclick = function () {
      if (gameOver) { finishGame(); } else { nextRound(); }
    };
  }

  /* ---------- FINAL RESULTS ---------- */
  function renderFinalResults() {
    if (state.tieBreaker.active) {
      const stillTied = getTiedLeaders();
      if (stillTied.length > 1) {
        state.tieBreaker.candidateIds = stillTied.map(function (p) { return p.id; });
        renderTieAgainPrompt();
        return;
      }
      state.tieBreaker.active = false;
    } else {
      const tied = getTiedLeaders();
      if (tied.length > 1) {
        renderTiePrompt(tied);
        return;
      }
    }

    const ranked = calculateFinalScores();
    const medals = ["🥇", "🥈", "🥉"];
    const rows = ranked.map(function (p, i) {
      return (
        '<div class="leaderboard-row">' +
          '<span class="rank-medal">' + (medals[i] || (i + 1)) + '</span>' +
          '<span class="lb-name">' + esc(p.name) + '</span>' +
          '<span class="lb-score">' + p.totalScore + '</span>' +
        '</div>'
      );
    }).join("");

    screenEl.innerHTML =
      '<div class="card">' +
        '<div class="final-title"><span class="trophy">🏆</span><h2 style="font-family:\'Cairo\',sans-serif; font-weight:800; margin:0 0 14px;">انتهت اللعبة</h2></div>' +
        rows +
        '<div class="btn-row" style="margin-top:18px;">' +
          '<button class="btn btn-primary" id="btnReplay">لعب مرة أخرى</button>' +
          '<button class="btn btn-secondary" id="btnHome">الرئيسية</button>' +
        '</div>' +
      '</div>';

    document.getElementById("btnReplay").onclick = function () {
      resetForNewGame();
      startRound();
    };
    document.getElementById("btnHome").onclick = function () {
      state.round = { number: 0, letter: null, lastLetter: null };
      state.tieBreaker = { active: false, candidateIds: [] };
      goTo("home");
    };
  }

  function renderTiePrompt(tied) {
    screenEl.innerHTML =
      '<div class="card center-text">' +
        '<div class="tie-banner">تعادل بين ' + tied.map(function (p) { return esc(p.name); }).join(" و ") + '</div>' +
        '<p class="muted">تُلعب جولة فاصلة مدتها 30 ثانية لكسر التعادل. اللاعبون غير المتعادلين لا يشاركون ونتائجهم لا تتغير.</p>' +
        '<button class="btn btn-primary" id="btnTieStart">ابدأ الجولة الفاصلة</button>' +
      '</div>';
    document.getElementById("btnTieStart").onclick = function () { startTieBreaker(); };
  }

  function renderTieAgainPrompt() {
    const names = state.tieBreaker.candidateIds.map(function (id) {
      const p = state.players.filter(function (pp) { return pp.id === id; })[0];
      return p ? p.name : "";
    });
    screenEl.innerHTML =
      '<div class="card center-text">' +
        '<div class="tie-banner">ما زال التعادل قائمًا بين ' + names.map(esc).join(" و ") + '</div>' +
        '<p class="muted">جولة فاصلة إضافية (30 ثانية)</p>' +
        '<button class="btn btn-primary" id="btnTieAgain">جولة فاصلة أخرى</button>' +
      '</div>';
    document.getElementById("btnTieAgain").onclick = function () { startRound(); };
  }

  /* init */
  render();
})();
