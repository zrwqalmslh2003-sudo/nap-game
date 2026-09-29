(function () {
  "use strict";

  const screenEl = document.getElementById("screen");
  const roundBadge = document.getElementById("roundBadge");
  const modalRoot = document.getElementById("modalRoot");

  let lastCountdownValue = null;
  let tickTimer = null;

  /* ---------- hash routing + local-game persistence ---------- */
  const SESSION_KEY = "nap_game_session_v1";
  const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const LOCAL_SCREENS = ["home", "setup", "roundReady", "playing", "review", "roundResults", "finalResults"];
  const TIMED_SCREENS = ["roundReady", "playing"];
  const ONLINE_MENU_SCREENS = ["onlineMenu", "onlineCreate", "onlineJoin", "onlinePublicRooms"];
  const SNAPSHOT_KEYS = ["settings", "playerNames", "players", "round",
    "answers", "roundScores", "roundHistory", "tieBreaker", "dictionaryMissing", "userNameError"];
  let saveTimer = null;

  function screenFromHash() {
    const m = /^#\/([A-Za-z]+)/.exec(window.location.hash || "");
    return m ? m[1] : null;
  }
  function writeHash(screen) {
    const h = "#/" + screen;
    if (window.location.hash === h) return;
    try { window.history.replaceState(null, "", h); } catch (e) { window.location.hash = h; }
  }
  function saveSession() {
    if (state.mode === "online" || state.screen === "home") return;
    try {
      const data = {};
      SNAPSHOT_KEYS.forEach(function (k) { data[k] = state[k]; });
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        screen: state.screen,
        data: data,
        turn: { endAt: state.turn.endAt, duration: state.turn.duration },
        countdown: { endAt: state.countdown.endAt }
      }));
    } catch (e) { /* storage full or blocked: the game still works, it just can't resume */ }
  }
  function clearSession() {
    clearTimeout(saveTimer);
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 250);
  }
  // Invite links: <page>#/join/ABCDE  -> join screen with the room code pre-filled.
  function inviteCodeFromHash() {
    const m = /^#\/join\/([A-Za-z0-9]{5})\/?$/.exec(window.location.hash || "");
    return m ? m[1].toUpperCase() : null;
  }
  function showResumePlaceholder() {
    state.mode = "online";
    state.screen = "onlineResume";
    screenEl.innerHTML = '<div class="card center-text"><p class="muted">جارٍ استعادة الغرفة…</p></div>';
  }
  function openInvite(code, fromInit) {
    if (!window.Online) return false;
    if (window.Online.hasSession && window.Online.hasSession()) {
      if (!confirm("لديك غرفة أونلاين سابقة. هل تريد تركها والانضمام إلى الغرفة الجديدة؟")) {
        if (fromInit) {
          showResumePlaceholder();
          return true;
        }
        return false;
      }
      window.Online.clearSession();
    }
    window.Online.prefillCode = code;
    state.mode = "online";
    goTo("onlineJoin");
    return true;
  }
  // Can this local screen be shown with the data currently in state?
  function screenReady(screen) {
    switch (screen) {
      case "home": case "setup": return true;
      case "roundReady": case "playing":
        return !!humanPlayer() && !!state.round.letter && !!state.answers && !!state.answers[humanPlayer().id];
      case "review": case "roundResults":
        return !!humanPlayer() && Object.keys(state.roundScores || {}).length > 0;
      case "finalResults": return !!humanPlayer();
      default: return false;
    }
  }

  window.goTo = function goTo(screen) {
    if (window.beep && screen !== "playing" && screen !== "onlinePlaying") window.beep.reset();
    state.screen = screen;
    writeHash(screen);
    if (state.mode !== "online") {
      if (screen === "home") clearSession(); else saveSession();
    }
    render();
  };
  function waitForActivation(worker, timeoutMs) {
    return new Promise(function (resolve) {
      if (!worker || worker.state === "activated") return resolve();
      const timer = setTimeout(resolve, timeoutMs);
      worker.addEventListener("statechange", function () {
        if (worker.state === "activated" || worker.state === "redundant") { clearTimeout(timer); resolve(); }
      });
    });
  }
  async function refreshPage() {
    const button = document.getElementById("pageRefresh");
    if (!button || button.disabled) return;
    saveSession(); // make sure the latest answers survive the reload
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "…";
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.update();
          const pending = registration.installing || registration.waiting;
          if (pending) {
            pending.postMessage("SKIP_WAITING");
            await waitForActivation(pending, 4000);
          }
        }
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
    } catch (e) {
      console.warn("refresh cleanup failed", e);
    }
    // Reload; if the page is still here after a moment, give the button back.
    setTimeout(function () { button.disabled = false; button.innerHTML = original; }, 5000);
    window.location.reload();
  }

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
        '<p class="subtitle">اختبروا سرعتكم ومعرفتكم بالحروف، العب ضد لاعبين آليين، أو أونلاين مع أصدقائك</p>' +
        '<button class="btn btn-primary" id="btnStart">ابدأ اللعبة</button>' +
        '<button class="btn btn-secondary" id="btnOnline">لعب أونلاين</button>' +
        '<button class="btn btn-ghost" id="btnRules" style="align-self:center;">طريقة اللعب</button>' +
      '</div>';
    document.getElementById("btnStart").onclick = function () {
      const prefs = loadPrefs();
      if (prefs && prefs.settings) {
        state.settings = Object.assign({}, state.settings, prefs.settings);
        state.settings.botCount = Math.min(5, Math.max(1, parseInt(state.settings.botCount, 10) || 3));
      }
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
            '<strong>اللعب المحلي</strong><br>' +
            'يظهر حرف متاح عشوائيًا في كل جولة. تلعب ضد لاعبين آليين (من 1 إلى 5) يختارون كلماتهم من القاموس. اكتب كلمة تبدأ بهذا الحرف في الخانات الست: اسم ولد، اسم بنت، حيوان، نبات، جماد، وبلاد، ثم اضغط «انتهيت» قبل انتهاء الوقت. لا يجيب اللاعبون الآليون في خانة «جماد».' +
            '<br><br>' +
            '<strong>اللعب أونلاين</strong><br>' +
            'أنشئ غرفة وشارك رمزها مع أصدقائك، أو انضم إلى غرفة باستخدام الرمز. يبدأ المضيف الجولة، ويجيب جميع اللاعبين في الوقت نفسه. بعد انتهاء الجولة تظهر شاشة المراجعة؛ يضغط المضيف «الجولة التالية»، بينما ينتقل الجميع تلقائيًا إذا لم يتدخل المضيف خلال دقيقة.' +
            '<br><br>' +
            '<strong>النقاط والإجابات</strong><br>' +
            'الإجابة الصحيحة والفريدة تُحسب 10 نقاط، والإجابة الصحيحة المكررة مع لاعب آخر تُحسب 5 نقاط، والإجابة الخاطئة أو الفارغة تُحسب صفرًا. يجب أن يبدأ كل جواب بالحرف الظاهر، ويُتحقق من أسماء الذكور والإناث في الخانة الصحيحة.' +
            '<br><br>' +
            '<strong>الاعتراضات</strong><br>' +
            'يمكن للاعب الاعتراض على إجابته إذا لم تكن موجودة في القاموس، من شاشة المراجعة. يراجع المضيف الاعتراض ويقبله لإضافة 10 نقاط أو يرفضه دون تغيير النتيجة.' +
            '<br><br>' +
            'بعد انتهاء عدد الجولات المحدد يفوز صاحب أعلى مجموع نقاط.' +
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
          '<label class="field-label" for="setupName">اسمك</label>' +
          '<input type="text" id="setupName" class="' + (state.userNameError ? 'invalid' : '') + '" value="' + esc(s.userName) + '" maxlength="20" placeholder="اكتب اسمك">' +
          '<div class="error-text">' + esc(state.userNameError) + '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">عدد اللاعبين الآليين</span>' +
          '<div class="stepper">' +
            '<button id="decBots" aria-label="إنقاص عدد اللاعبين الآليين">−</button>' +
            '<span class="value" id="botsVal">' + s.botCount + '</span>' +
            '<button id="incBots" aria-label="زيادة عدد اللاعبين الآليين">+</button>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="field-label">مدة الجولة (ثانية)</span>' +
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
          '<span class="field-label">الفئات</span>' +
          '<div class="cat-list">' +
            CATEGORIES.map(function (c) { return '<span class="cat-chip">' + c.label + '</span>'; }).join("") +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary" id="btnStartGame">متابعة</button>' +
        '<button class="btn btn-ghost" id="btnBackHome" style="align-self:center;">رجوع</button>' +
      '</div>';

    document.getElementById("setupName").oninput = function (e) { s.userName = e.target.value; };
    document.getElementById("decBots").onclick = function () {
      s.botCount = Math.max(1, s.botCount - 1);
      renderSetup();
    };
    document.getElementById("incBots").onclick = function () {
      s.botCount = Math.min(5, s.botCount + 1);
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
    document.getElementById("btnStartGame").onclick = function () {
      if (!validateUserName()) { renderSetup(); return; }
      s.userName = s.userName.trim();
      savePrefs({ settings: state.settings, playerNames: [] });
      startGame();
    };
    document.getElementById("btnBackHome").onclick = function () { goTo("home"); };
  }

  /* ---------- ROUND READY (3s countdown before every round) ---------- */
  function renderRoundReady() {
    if (window.beep) window.beep.reset();
    screenEl.innerHTML =
      '<div class="card center-text">' +
        (state.tieBreaker.active ? '<div class="tie-banner">تعادل! جولة فاصلة</div>' : '') +
        '<p class="muted">الحرف</p>' +
        '<div class="letter-hero">' + esc(state.round.letter) + '</div>' +
        '<p class="muted" id="readyLabel">استعد…</p>' +
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

  /* ---------- BOT STATUS ---------- */
  // Marks bots as submitted once the round has progressed past their botSubmitAt fraction.
  // Returns true if any bot changed state.
  function syncBotSubmissions() {
    const total = state.turn.duration || 1;
    const progress = Math.max(0, Math.min(1, 1 - turnSecondsRemaining() / total));
    let dirty = false;
    activeRoundPlayers().forEach(function (p) {
      if (!p.isBot || p.botSubmitted) return;
      if (progress >= p.botSubmitAt) { p.botSubmitted = true; dirty = true; }
    });
    return dirty;
  }
  function botStripHtml() {
    return activeRoundPlayers().filter(function (p) { return p.isBot; }).map(function (p) {
      return '<div class="leaderboard-row" style="padding:6px 4px;">' +
        '<span class="lb-name">' + esc(p.name) + '</span>' +
        '<span class="muted">' + (p.botSubmitted ? 'أرسل ✓' : 'يكتب…') + '</span>' +
      '</div>';
    }).join("");
  }
  window.updateBotStrip = function updateBotStrip() {
    const el = document.getElementById("botStrip");
    if (el) el.innerHTML = botStripHtml();
  };

  /* ---------- PLAYING (the human answers; bots have already picked theirs) ---------- */
  function renderPlaying() {
    const player = humanPlayer();
    const ans = state.answers[player.id];
    const remaining = turnSecondsRemaining();
    syncBotSubmissions();

    screenEl.innerHTML =
      '<div class="card">' +
        (state.dictionaryMissing ? '<div class="tie-banner">⚠️ القاموس غير محمّل — التحقق بالحرف فقط</div>' : '') +
        '<div class="play-top">' +
          '<span class="letter-chip">' + esc(state.round.letter) + '</span>' +
          '<span class="timer' + (remaining <= 10 ? ' urgent' : '') + '" id="timerDisplay" aria-live="polite">' + fmtTime(remaining) + '</span>' +
        '</div>' +
        '<div id="botStrip" style="margin:2px 0 14px;">' + botStripHtml() + '</div>' +
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
      showFinishConfirm();
    };
  }

  function showFinishConfirm() {
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="finishBackdrop">' +
        '<div class="modal">' +
          '<h3>هل أنت متأكد من إنهاء الجولة؟</h3>' +
          '<p>' + 'لن تتمكن من تعديل إجاباتك بعد ذلك، وستنتهي الجولة فورًا.' + '</p>' +
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
    if (window.beep) window.beep.tick(remainingSeconds);
    const el = document.getElementById("timerDisplay");
    if (!el) return;
    const becameUrgent = remainingSeconds <= 10 && !el.classList.contains("urgent");
    el.textContent = fmtTime(remainingSeconds);
    el.classList.toggle("urgent", remainingSeconds <= 10);
    if (becameUrgent) {
      el.classList.add("shake");
      setTimeout(function () { el.classList.remove("shake"); }, 200);
    }
    if (syncBotSubmissions()) { window.updateBotStrip(); scheduleSave(); }
    if (remainingSeconds <= 0) {
      // lock inputs visually the instant time hits zero, even before finishPlayerTurn() re-renders
      Array.prototype.forEach.call(document.querySelectorAll('#screen input, #screen button'), function (n) { n.disabled = true; });
    }
  };

  /* ---------- REVIEW ---------- */
  function renderReview() {
    const players = activeRoundPlayers();
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
    const players = activeRoundPlayers();
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
      if (stillTied.length > 1 && stillTied.some(function (p) { return p.isHuman; })) {
        state.tieBreaker.candidateIds = stillTied.map(function (p) { return p.id; });
        renderTieAgainPrompt();
        return;
      }
      state.tieBreaker.active = false;
    } else {
      const tied = getTiedLeaders();
      if (tied.length > 1 && tied.some(function (p) { return p.isHuman; })) {
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

  // Save typed answers/settings shortly after any interaction (handlers run first, then this).
  ["input", "change", "click"].forEach(function (evt) {
    screenEl.addEventListener(evt, function () { if (state.mode !== "online") scheduleSave(); });
  });
  window.addEventListener("pagehide", saveSession);

  async function restoreLocalSession(target) {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { snap = null; }
    if (!snap || snap.v !== 1 || snap.screen !== target || !snap.data) return false;
    if (Date.now() - snap.savedAt > SESSION_MAX_AGE_MS) return false;

    SNAPSHOT_KEYS.forEach(function (k) { if (snap.data[k] !== undefined) state[k] = snap.data[k]; });
    state.turn.endAt = (snap.turn && snap.turn.endAt) || null;
    state.turn.duration = (snap.turn && snap.turn.duration) || state.turn.duration;
    state.countdown.endAt = (snap.countdown && snap.countdown.endAt) || null;
    state.mode = "local";
    if (!screenReady(target)) return false;

    if (TIMED_SCREENS.indexOf(target) !== -1) {
      try { if (typeof loadAvailableLetters === "function") await loadAvailableLetters(); } catch (e) { /* keep current pools */ }
      const dict = await loadDictionary(state.round.letter);
      state.dictionaryMissing = (dict === null);
    }
    if (target === "roundReady") startTurnCountdown();
    else if (target === "playing") resumePlayerTurn();
    else goTo(target);
    return true;
  }

  // Manual hash edits / external navigation. Timed screens and online games are never left this way.
  window.addEventListener("hashchange", function () {
    const invite = inviteCodeFromHash();
    if (invite) {
      const canOpen = TIMED_SCREENS.indexOf(state.screen) === -1 &&
        (state.mode !== "online" || ONLINE_MENU_SCREENS.indexOf(state.screen) !== -1);
      if (canOpen && openInvite(invite, false)) return;
      writeHash(state.screen);
      return;
    }
    const target = screenFromHash();
    if (!target || target === state.screen) return;
    const allowed = state.mode !== "online" &&
      TIMED_SCREENS.indexOf(state.screen) === -1 &&
      LOCAL_SCREENS.indexOf(target) !== -1 &&
      TIMED_SCREENS.indexOf(target) === -1 &&
      screenReady(target);
    if (allowed) goTo(target); else writeHash(state.screen);
  });

  async function init() {
    if (pageRefreshButton) pageRefreshButton.onclick = refreshPage;
    const invite = inviteCodeFromHash();
    if (invite && openInvite(invite, true)) return;
    const target = screenFromHash();

    if (target && target.indexOf("online") === 0) {
      state.mode = "online";
      if (ONLINE_MENU_SCREENS.indexOf(target) !== -1) return goTo(target);
      if (window.Online && window.Online.hasSession && window.Online.hasSession()) {
        // online.js resumes the room on window load and routes to the right screen.
        showResumePlaceholder();
        return;
      }
      state.mode = "local";
    } else if (target && target !== "home" && LOCAL_SCREENS.indexOf(target) !== -1) {
      try { if (await restoreLocalSession(target)) return; } catch (e) { console.warn("restore failed", e); }
      clearSession();
    }
    state.mode = "local";
    goTo("home");
  }

  const pageRefreshButton = document.getElementById("pageRefresh");
  init();
})();
