(function () {
  "use strict";

  var SUPABASE_URL = "https://vmutzynixcxmsoteidye.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdXR6eW5peGN4bXNvdGVpZHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTc0OTksImV4cCI6MjEwNTY3MzQ5OX0.5m9y6pFyuojOFkBmoThQs3McRyRYCy_lMosCxsKdERk";

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var MAX_ONLINE_PLAYERS = 20;
  var screenEl = document.getElementById("screen");
  var o = {
    room: null, me: null, players: [], round: null, answers: {},
    submitted: {}, presence: {}, scores: {}, roundHistory: [],
    objections: {}, accepting: {}, seenObjectionIds: {}, objectionQueue: [],
    channels: [], timerId: null, nextRoundTimer: null, clockId: null, pollId: null, submitDebounce: null, typingThrottle: null,
    closing: false, starting: false, submitting: false, joining: false, creating: false, lockedAt: 0,
    settings: { totalRounds: 3, roundDuration: 60 }
  };

  var clockSkewMs = 0;
  async function syncClock() {
    try {
      var r = await client.rpc("server_now");
      if (r.error || !r.data) return;
      clockSkewMs = new Date(r.data).getTime() - Date.now();
    } catch (e) { /* keep previous skew */ }
  }
  function serverNow() { return Date.now() + clockSkewMs; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }); }
  function code() { var chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", out = ""; for (var i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }
  function isHost() { return !!(o.room && o.me && o.room.host_id === o.me.id); }
  function currentRoundId() { return o.round && o.round.id; }
  function nowRemaining() { return o.round && o.round.ends_at ? Math.max(0, Math.ceil((new Date(o.round.ends_at).getTime() - serverNow()) / 1000)) : 0; }
  function fmt(sec) { var m = Math.floor(sec / 60), s = sec % 60; return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0"); }
  function playerName(id) { var p = o.players.filter(function (x) { return x.id === id; })[0]; return p ? p.name : ""; }
  function allSubmitted() { return o.players.length > 0 && o.players.every(function (p) { return !!o.submitted[p.id]; }); }

  function fail(message) {
    clearTimers();
    alert(message || "حدث خطأ في الاتصال بالغرفة");
    cleanup();
    if (window.goTo) window.goTo("onlineMenu");
  }
  function clearTimers() { clearInterval(o.timerId); clearTimeout(o.nextRoundTimer); clearInterval(o.clockId); clearInterval(o.pollId); clearTimeout(o.submitDebounce); clearTimeout(o.typingThrottle); o.timerId = null; o.nextRoundTimer = null; o.clockId = null; o.pollId = null; o.submitDebounce = null; o.typingThrottle = null; }
  function cleanup() {
    clearTimers();
    o.channels.forEach(function (ch) { client.removeChannel(ch); });
    o.channels = [];
    o.room = o.me = o.round = null; o.players = []; o.answers = {}; o.submitted = {}; o.presence = {}; o.scores = {}; o.roundHistory = []; o.objections = {}; o.accepting = {}; o.seenObjectionIds = {}; o.objectionQueue = []; o.closing = false; o.joining = false; o.creating = false;
  }
  function route(screen) { state.mode = "online"; window.goTo(screen); }
  function inputValue(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  function saveOnlineSession() { try { sessionStorage.setItem("nap.online.me", JSON.stringify({ id: o.me.id, name: o.me.name, roomCode: o.room.code })); } catch (e) {} }
  function clearOnlineSession() { try { sessionStorage.removeItem("nap.online.me"); } catch (e) {} }
  function readOnlineSession() { try { return JSON.parse(sessionStorage.getItem("nap.online.me") || "null"); } catch (e) { return null; } }
  async function resumeRoom() {
    var saved = readOnlineSession();
    if (!saved || !saved.roomCode || !saved.id) return;
    var r = await client.from("rooms").select("*").eq("code", saved.roomCode).in("status", ["waiting", "playing"]).maybeSingle();
    if (r.error || !r.data) { clearOnlineSession(); return alert("الغرفة السابقة غير متاحة"); }
    var p = await client.from("players").select("*").eq("id", saved.id).eq("room_id", r.data.id).maybeSingle();
    if (p.error || !p.data) { clearOnlineSession(); return alert("تعذر استئناف اللاعب السابق"); }
    o.room = r.data; o.me = p.data; setupRealtime();
    route(r.data.status === "waiting" ? "onlineWaiting" : "onlinePlaying");
    if (r.data.status === "playing") loadCurrentRound();
  }

  async function setupRealtime() {
    if (typeof loadAvailableLetters === "function" && !AVAILABLE_LETTERS.length) {
      try { await loadAvailableLetters(); } catch (e) { console.warn("letters manifest failed", e); }
    }
    syncClock();
    clearInterval(o.clockId);
    o.clockId = setInterval(syncClock, 30000);
    var roomChannel = client.channel("room-" + o.room.id, { config: { presence: { key: o.me.id } } });
    roomChannel.on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, function (p) {
      if (!p.new || p.new.id !== o.room.id) return;
      o.room = p.new;
      if (o.room.status === "done") { clearTimers(); route("onlineResults"); return; }
      if (o.room.status === "playing") loadCurrentRound();
    }).on("postgres_changes", { event: "*", schema: "public", table: "players" }, function (p) {
      if ((p.new && p.new.room_id === o.room.id) || (p.old && p.old.room_id === o.room.id)) loadPlayers();
    }).on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, function (p) {
      if (!p.new || p.new.room_id !== o.room.id) return;
      if (o.round && p.new.id === o.round.id && p.new.status === "locked") loadCurrentRound();
    }).on("postgres_changes", { event: "INSERT", schema: "public", table: "answers" }, function (p) {
      if (!o.round || p.new.round_id !== o.round.id) return;
      o.submitted[p.new.player_id] = true;
      updatePlayersStrip();
      clearTimeout(o.submitDebounce);
      o.submitDebounce = setTimeout(function () { if (allSubmitted()) closeRound(); }, 300);
    }).on("postgres_changes", { event: "INSERT", schema: "public", table: "pending_words" }, function (p) {
      if (!p.new || !o.room || p.new.room_id !== o.room.id) return;
      if (o.seenObjectionIds[p.new.id]) return;
      o.seenObjectionIds[p.new.id] = true;
      o.objections[p.new.id] = p.new;
      if (isHost()) { o.objectionQueue.push(p.new); showNextObjection(); }
      renderReview();
    }).on("presence", { event: "sync" }, function () {
      var stateByKey = roomChannel.presenceState(), next = {};
      Object.keys(stateByKey).forEach(function (key) { var last = stateByKey[key][stateByKey[key].length - 1]; if (last) next[key] = last; });
      o.presence = next; updatePlayersStrip();
    }).on("presence", { event: "join" }, updatePlayersStrip).on("presence", { event: "leave" }, updatePlayersStrip);
    roomChannel.subscribe(function (status) { if (status === "SUBSCRIBED") roomChannel.track({ player_id: o.me.id, typing: false, submitted: false }); });
    o.channels.push(roomChannel);
    loadPlayers();
    clearInterval(o.pollId);
    o.pollId = setInterval(async function () {
      if (!o.room || o.room.status === "done") return;
      try {
        var rr = await client.from("rooms").select("current_round,status").eq("id", o.room.id).maybeSingle();
        if (rr.error || !rr.data) return;
        if (o.round && o.round.status === "active") {
          var rs = await client.from("rounds").select("status").eq("id", o.round.id).maybeSingle();
          if (!rs.error && rs.data && rs.data.status !== o.round.status) { await loadCurrentRound(); return; }
        }
        if (state.screen === "onlineReview" && isHost() && o.round) {
          try {
            var pq = await client.from("pending_words").select("*").eq("room_id", o.room.id).eq("round_id", o.round.id).is("host_decision", null);
            if (!pq.error && pq.data) {
              pq.data.forEach(function (row) {
                if (o.seenObjectionIds[row.id]) return;
                o.seenObjectionIds[row.id] = true;
                o.objections[row.id] = row;
                o.objectionQueue.push(row);
              });
              if (pq.data.length) showNextObjection();
            }
          } catch (e) {}
        }
        var roundChanged = rr.data.current_round !== o.room.current_round;
        var statusChanged = rr.data.status !== o.room.status;
        if (!roundChanged && !statusChanged) return;
        o.room = Object.assign({}, o.room, rr.data);
        if (rr.data.status === "done") { clearTimers(); route("onlineResults"); return; }
        await loadCurrentRound();
      } catch (e) { /* ignore, retry next tick */ }
    }, 1500);
  }

  async function loadPlayers() {
    if (!o.room) return;
    var r = await client.from("players").select("*").eq("room_id", o.room.id).order("joined_at", { ascending: true });
    if (r.error) return fail(r.error.message);
    o.players = r.data || [];
    if (state.screen === "onlineWaiting") renderWaiting(); else updatePlayersStrip();
  }
  async function loadDictionaryWithRetry(letter) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var dict = await loadDictionary(letter);
      if (dict) return dict;
      if (attempt < 2) await new Promise(function (res) { setTimeout(res, 500 * (attempt + 1)); });
    }
    return null;
  }
  async function loadCurrentRound() {
    if (!o.room) return;
    var rr = await client.from("rooms").select("current_round,status").eq("id", o.room.id).maybeSingle();
    if (rr.error) return fail(rr.error.message);
    if (rr.data) {
      o.room = Object.assign({}, o.room, { current_round: rr.data.current_round, status: rr.data.status });
      if (rr.data.status === "done") { clearTimers(); route("onlineResults"); return; }
    }
    var r = await client.from("rounds").select("*").eq("room_id", o.room.id).eq("number", o.room.current_round).maybeSingle();
    if (r.error) return fail(r.error.message);
    if (!r.data) { setTimeout(loadCurrentRound, 500); return; }
    if (o.round && o.round.id === r.data.id && o.round.status === r.data.status) {
      if (o.round.status === "locked" && o.round.number < o.room.total_rounds && state.screen === "onlineReview" && serverNow() - o.lockedAt > 65000) startNextRound();
      else if (o.round.status === "locked") setTimeout(loadCurrentRound, 2000);
      return;
    }
    o.round = r.data; o.answers = {}; o.submitted = {}; o.scores = {}; o.closing = false; o.submitting = false;
    var dict = await loadDictionaryWithRetry(o.round.letter);
    if (!dict) return fail("تعذر تحميل قاموس هذا الحرف؛ لم تبدأ الجولة لتجنب قبول إجابات غير متحقق منها");
    if (o.round.status === "active") { route("onlinePlaying"); startOnlineTimer(); }
    else if (o.round.status === "locked") {
      o.lockedAt = serverNow();
      await loadRoundScores(); route("onlineReview");
      setTimeout(loadCurrentRound, 1000);
    }
  }
  async function loadRoundScores() {
    if (!o.round) return;
    var dict = await loadDictionaryWithRetry(o.round.letter);
    if (!dict) return fail("تعذر تحميل القاموس؛ لا يمكن حساب نتائج الجولة بأمان");
    var a = await client.from("answers").select("*").eq("round_id", o.round.id);
    if (a.error) return fail(a.error.message);
    var byPlayer = {};
    (a.data || []).forEach(function (row) { if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}; byPlayer[row.player_id][row.category] = row.value || ""; });
    o.scores = calculateRoundScores(o.round.letter, o.players, byPlayer);
    o.players.forEach(function (p) { if (!o.scores[p.id]) o.scores[p.id] = {}; });
    o.roundHistory.push({ number: o.round.number, letter: o.round.letter, scores: o.scores });
  }

  function startOnlineTimer() {
    clearInterval(o.timerId);
    o.timerId = setInterval(function () {
      var remaining = nowRemaining(), el = document.getElementById("oTimer");
      if (el) { el.textContent = fmt(remaining); el.classList.toggle("urgent", remaining <= 10); }
      if (remaining <= 0) { clearInterval(o.timerId); closeRound(); }
    }, 200);
  }
  function lockOnlineForm() { Array.prototype.forEach.call(document.querySelectorAll("#onlineForm input, #onlineForm button"), function (n) { n.disabled = true; }); }
  async function bumpPlayerScore(playerId, points) {
    for (var attempt = 0; attempt < 5; attempt++) {
      var cur = await client.from("players").select("total_score").eq("id", playerId).single();
      if (cur.error) return cur;
      var base = cur.data.total_score || 0;
      var upd = await client.from("players").update({ total_score: base + points }).eq("id", playerId).eq("total_score", base).select("id").maybeSingle();
      if (upd.error) return upd;
      if (upd.data) return { error: null, total_score: base + points };
    }
    return { error: { message: "تعذر تحديث النتيجة بعد عدة محاولات متزامنة" } };
  }
  async function closeRound() {
    if (o.closing || !o.round || o.round.status !== "active") return;
    o.closing = true; clearInterval(o.timerId); lockOnlineForm();
    var u = await client.from("rounds").update({ status: "locked" }).eq("id", o.round.id).eq("status", "active").select("id").maybeSingle();
    if (u.error) return fail(u.error.message);
    if (!u.data) { await loadCurrentRound(); return; }
    await loadRoundScores();
    for (var i = 0; i < o.players.length; i++) {
      var points = roundTotalForPlayer(o.scores[o.players[i].id] || {});
      var pu = await bumpPlayerScore(o.players[i].id, points);
      if (pu.error) return fail(pu.error.message);
      o.players[i].total_score = pu.total_score;
    }
    if (o.round.number >= o.room.total_rounds) {
      await client.from("rooms").update({ status: "done" }).eq("id", o.room.id);
    } else {
      route("onlineReview");
      clearTimeout(o.nextRoundTimer);
      o.nextRoundTimer = setTimeout(function () {
        if (state.screen === "onlineReview" && o.round && o.round.status === "locked") startNextRound();
      }, 60000);
    }

  }
  async function startNextRound() {
    clearTimeout(o.nextRoundTimer);
    o.nextRoundTimer = null;
    if (!o.room || o.room.status === "done") return;
    var nextNum = Number(o.room.current_round) + 1;
    var existing = await client.from("rounds").select("id").eq("room_id", o.room.id).eq("number", nextNum).maybeSingle();
    if (existing.error) return fail(existing.error.message);
    if (existing.data) { await loadCurrentRound(); return; }
    if (!AVAILABLE_LETTERS.length && typeof loadAvailableLetters === "function") {
      try { await loadAvailableLetters(); } catch (e) {}
    }
    var letter = getRandomLetter(o.round ? o.round.letter : null), ends = new Date(serverNow() + Number(o.room.round_duration) * 1000).toISOString();
    if (!letter) return fail("لا توجد حروف متاحة — تعذر تحميل قائمة الحروف");
    var ins = await client.from("rounds").insert({ room_id: o.room.id, number: nextNum, letter: letter, status: "active", started_at: new Date().toISOString(), ends_at: ends }).select().single();
    if (ins.error) {
      if (ins.error.code === "23505" || /duplicate key/i.test(ins.error.message || "")) { await loadCurrentRound(); return; }
      return fail(ins.error.message);
    }
    var up = await client.from("rooms").update({ current_round: nextNum }).eq("id", o.room.id);
    if (up.error) return fail(up.error.message);
    o.room = Object.assign({}, o.room, { current_round: nextNum, status: "playing" });
    o.round = null;
    o.lockedAt = 0;
    await loadCurrentRound();
  }

  async function submitOnline() {
    if (o.submitting || !o.round || o.round.status !== "active" || o.submitted[o.me.id]) return;
    o.submitting = true;
    var finishButton = document.getElementById("ofFinish");
    if (finishButton) finishButton.disabled = true;
    var check = await client.from("rounds").select("status").eq("id", o.round.id).maybeSingle();
    if (check.error) { o.submitting = false; if (finishButton) finishButton.disabled = false; return fail(check.error.message); }
    if (!check.data || check.data.status !== "active") { o.submitting = false; await loadCurrentRound(); return; }
    var rows = CATEGORIES.map(function (c) { return { round_id: o.round.id, player_id: o.me.id, category: c.key, value: inputValue("of_" + c.key), submitted_at: new Date().toISOString() }; });
    var r = await client.from("answers").insert(rows);
    if (r.error) { o.submitting = false; if (finishButton) finishButton.disabled = false; return fail(r.error.message); }
    o.submitted[o.me.id] = true; lockOnlineForm(); updatePlayersStrip();
    var ch = o.channels[0]; if (ch) ch.track({ player_id: o.me.id, typing: false, submitted: true });
    clearTimeout(o.submitDebounce);
    o.submitDebounce = setTimeout(function () { if (allSubmitted()) closeRound(); }, 300);
  }
  function trackTyping() {
    if (o.typingThrottle) return;
    var ch = o.channels[0]; if (ch) ch.track({ player_id: o.me.id, typing: true, submitted: false });
    o.typingThrottle = setTimeout(function () { o.typingThrottle = null; }, 1500);
  }

  function updatePlayersStrip() {
    var strip = document.getElementById("oStrip"); if (!strip) return;
    strip.innerHTML = '<strong>اللاعبون</strong>' + o.players.map(function (p) {
      var status = o.submitted[p.id] || (o.presence[p.id] && o.presence[p.id].submitted) ? "تم الإرسال ✓" : (o.presence[p.id] && o.presence[p.id].typing ? "يكتب الآن…" : "يستعد");
      return '<div class="leaderboard-row"><span class="lb-name">' + esc(p.name) + (p.id === o.me.id ? ' <span class="muted">(أنت)</span>' : '') + '<br><span class="muted" style="font-size:12px;">' + status + '</span></span><span class="lb-score">' + (p.total_score || 0) + '</span></div>';
    }).join("");
  }

  function renderMenu() {
    var saved = readOnlineSession();
    var resumeButton = saved && saved.roomCode && saved.name ? '<button class="btn btn-secondary" id="oResume">استئناف الغرفة السابقة (' + esc(saved.roomCode) + ')</button>' : '';
    screenEl.innerHTML = '<div class="card stack center-text"><h2 style="font-family:Cairo,sans-serif;font-weight:800;">اللعب أونلاين</h2><p class="muted">العبوا معًا من أجهزة مختلفة في نفس الغرفة.</p>' + resumeButton + '<button class="btn btn-primary" id="oCreate">إنشاء غرفة</button><button class="btn btn-secondary" id="oJoin">انضمام</button><button class="btn btn-ghost" id="oBack">رجوع</button></div>';
    if (resumeButton) document.getElementById("oResume").onclick = resumeRoom;
    document.getElementById("oCreate").onclick = function () { route("onlineCreate"); };
    document.getElementById("oJoin").onclick = function () { route("onlineJoin"); };
    document.getElementById("oBack").onclick = function () { cleanup(); state.mode = "local"; window.goTo("home"); };
  }
  function renderCreate() {
    screenEl.innerHTML = '<div class="card stack"><h2 style="font-family:Cairo,sans-serif;font-weight:800;">إنشاء غرفة</h2><label class="field-label" for="ocName">اسمك</label><input type="text" id="ocName" maxlength="20" placeholder="اكتب الاسم"><span class="field-label">مدة الجولة</span><div class="choice-row" id="ocDuration"><div class="choice" data-v="30">30</div><div class="choice active" data-v="60">60</div><div class="choice" data-v="90">90</div></div><span class="field-label">عدد الجولات</span><div class="choice-row" id="ocRounds"><div class="choice active" data-v="3">3</div><div class="choice" data-v="5">5</div><div class="choice" data-v="10">10</div></div><button class="btn btn-primary" id="ocGo">إنشاء الغرفة</button><button class="btn btn-ghost" id="ocBack">رجوع</button></div>';
    document.getElementById("ocDuration").onclick = function (e) { var n = e.target.closest(".choice"); if (!n) return; o.settings.roundDuration = Number(n.dataset.v); Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("active", x === n); }); };
    document.getElementById("ocRounds").onclick = function (e) { var n = e.target.closest(".choice"); if (!n) return; o.settings.totalRounds = Number(n.dataset.v); Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("active", x === n); }); };
    document.getElementById("ocGo").onclick = createRoom; document.getElementById("ocBack").onclick = function () { route("onlineMenu"); };
  }
  async function createRoom() {
    if (o.creating) return;
    var name = inputValue("ocName").trim(); if (name.length < 2) return alert("اكتب اسمًا من حرفين على الأقل");
    cleanup();
    o.creating = true;
    var goButton = document.getElementById("ocGo"); if (goButton) goButton.disabled = true;
    var meId = uuid(), roomId = uuid(), roomCode = code();
    var r = await client.from("rooms").insert({ id: roomId, code: roomCode, host_id: meId, status: "waiting", total_rounds: o.settings.totalRounds, round_duration: o.settings.roundDuration, current_round: 0 }).select().single();
    if (r.error) { o.creating = false; if (goButton) goButton.disabled = false; return fail(r.error.message); }
    var p = await client.from("players").insert({ id: meId, room_id: roomId, name: name, total_score: 0, connected: true }).select().single();
    if (p.error) { o.creating = false; if (goButton) goButton.disabled = false; return fail(p.error.message); }
    o.room = r.data; o.me = p.data; saveOnlineSession(); setupRealtime(); route("onlineWaiting");
  }
  function renderJoin() {
    screenEl.innerHTML = '<div class="card stack"><h2 style="font-family:Cairo,sans-serif;font-weight:800;">الانضمام إلى غرفة</h2><label class="field-label" for="ojName">اسمك</label><input type="text" id="ojName" maxlength="20" placeholder="اكتب الاسم"><label class="field-label" for="ojCode">رمز الغرفة</label><input type="text" id="ojCode" maxlength="5" placeholder="مثال: A7K2P" style="text-transform:uppercase"><button class="btn btn-primary" id="ojGo">انضمام</button><button class="btn btn-ghost" id="ojBack">رجوع</button></div>';
    document.getElementById("ojGo").onclick = joinRoom; document.getElementById("ojBack").onclick = function () { route("onlineMenu"); };
  }
  async function joinRoom() {
    if (o.joining) return;
    var name = inputValue("ojName").trim(), roomCode = inputValue("ojCode").trim().toUpperCase();
    if (name.length < 2 || roomCode.length !== 5) return alert("تحقق من الاسم ورمز الغرفة");
    o.joining = true;
    var goButton = document.getElementById("ojGo"); if (goButton) goButton.disabled = true;
    var r = await client.from("rooms").select("*").eq("code", roomCode).eq("status", "waiting").maybeSingle();
    if (r.error || !r.data) { o.joining = false; if (goButton) goButton.disabled = false; return fail("الغرفة غير موجودة أو بدأت بالفعل"); }
    var count = await client.from("players").select("id", { count: "exact", head: true }).eq("room_id", r.data.id);
    if (count.error) { o.joining = false; if (goButton) goButton.disabled = false; return fail(count.error.message); }
    if ((count.count || 0) >= MAX_ONLINE_PLAYERS) { o.joining = false; if (goButton) goButton.disabled = false; return fail("الغرفة ممتلئة (20 لاعبًا كحد أقصى)"); }
    var meId = uuid();
    var p = await client.from("players").insert({ id: meId, room_id: r.data.id, name: name, total_score: 0, connected: true }).select().single();
    if (p.error) { o.joining = false; if (goButton) goButton.disabled = false; return fail(p.error.message); }
    o.room = r.data; o.me = p.data; saveOnlineSession(); setupRealtime(); route("onlineWaiting");
  }
  function renderWaiting() {
    if (!o.room) return renderMenu();
    screenEl.innerHTML = '<div class="card stack center-text"><h2 style="font-family:Cairo,sans-serif;font-weight:800;">غرفة الانتظار</h2><p class="muted">رمز الغرفة</p><div class="letter-hero" style="font-size:48px;letter-spacing:5px;">' + esc(o.room.code) + '</div><p class="muted">أرسل الرمز إلى أصدقائك</p><div id="oWaitPlayers"></div>' + (isHost() ? '<button class="btn btn-primary" id="owStart">ابدأ</button>' : '<p class="muted">بانتظار المضيف لبدء اللعبة…</p>') + '<button class="btn btn-ghost" id="owLeave">مغادرة</button></div>';
    document.getElementById("owLeave").onclick = function () { clearOnlineSession(); cleanup(); route("onlineMenu"); };
    if (isHost()) document.getElementById("owStart").onclick = startRoom;
    var list = document.getElementById("oWaitPlayers"); list.innerHTML = o.players.map(function (p) { return '<div class="leaderboard-row"><span class="lb-name">' + esc(p.name) + (p.id === o.room.host_id ? ' <span class="muted">(المضيف)</span>' : '') + '</span></div>'; }).join("");
  }
  async function startRoom() {
    if (!isHost() || o.players.length < 1 || o.starting) return;
    o.starting = true;
    var existing = await client.from("rounds").select("id").eq("room_id", o.room.id).eq("number", 1).maybeSingle();
    if (existing.error) { o.starting = false; return fail(existing.error.message); }
    if (existing.data) { o.starting = false; await loadCurrentRound(); return; }
    if (!AVAILABLE_LETTERS.length && typeof loadAvailableLetters === "function") {
      try { await loadAvailableLetters(); } catch (e) {}
    }
    var letter = getRandomLetter(null), ends = new Date(serverNow() + Number(o.room.round_duration) * 1000).toISOString();
    if (!letter) { o.starting = false; return fail("لا توجد حروف متاحة — تعذر تحميل قائمة الحروف"); }
    var r = await client.from("rounds").insert({ room_id: o.room.id, number: 1, letter: letter, status: "active", started_at: new Date().toISOString(), ends_at: ends }).select().single();
    if (r.error) {
      o.starting = false;
      if (r.error.code === "23505" || /duplicate key/i.test(r.error.message || "")) { await loadCurrentRound(); return; }
      return fail(r.error.message);
    }
    var u = await client.from("rooms").update({ status: "playing", current_round: 1 }).eq("id", o.room.id).eq("status", "waiting").select("id").maybeSingle();
    if (u.error) { o.starting = false; return fail(u.error.message); }
    o.starting = false;
    o.room = Object.assign({}, o.room, { status: "playing", current_round: 1 });
    if (!u.data) { loadCurrentRound(); return; }
  }

  function renderPlaying() {
    var rem = nowRemaining();
    screenEl.innerHTML = '<div class="card" id="onlineForm"><div class="play-top"><span class="letter-chip">' + esc(o.round.letter) + '</span><span class="timer' + (rem <= 10 ? ' urgent' : '') + '" id="oTimer">' + fmt(rem) + '</span></div><p class="center-text muted" style="margin:2px 0 14px;">الجولة ' + o.round.number + ' — اكتب إجاباتك ثم اضغط انتهيت</p>' + CATEGORIES.map(function (c) { return '<div class="answer-block"><label for="of_' + c.key + '">' + c.label + '</label><input type="text" id="of_' + c.key + '" placeholder="' + esc(o.round.letter) + '..."></div>'; }).join("") + '<button class="btn btn-primary" id="ofFinish">انتهيت ✓</button></div><div class="card" id="oStrip"></div>';
    CATEGORIES.forEach(function (c) { var el = document.getElementById("of_" + c.key); el.oninput = trackTyping; });
    document.getElementById("ofFinish").onclick = submitOnline; updatePlayersStrip(); startOnlineTimer();
  }
  function categoryLabel(key) {
    var c = CATEGORIES.filter(function (x) { return x.key === key; })[0];
    return c ? c.label : key;
  }
  function findObjection(word, category, ownerId) {
    var found = null;
    Object.keys(o.objections).some(function (key) {
      var item = o.objections[key];
      if (item && item.word === word && item.category === category && item.owner_id === ownerId) { found = item; return true; }
      return false;
    });
    return found;
  }
  function objectionButton(cell, ownerPlayer) {
    var buttons = screenEl.querySelectorAll("[data-object-category]");
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      if (button.dataset.objectCategory === cell.category && button.dataset.objectOwner === String(ownerPlayer.id) && button.dataset.objectWord === cell.value) return button;
    }
    return null;
  }
  function restoreObjectionButton(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = "اعتراض";
  }
  async function raiseObjection(cell, ownerPlayer) {
    if (!o.round || !ownerPlayer || ownerPlayer.id !== o.me.id || findObjection(cell.value, cell.category, ownerPlayer.id)) return;
    var button = objectionButton(cell, ownerPlayer);
    if (button) { button.disabled = true; button.textContent = "جار الإرسال…"; }
    var localKey = "local:" + cell.category + ":" + ownerPlayer.id + ":" + cell.value;
    o.objections[localKey] = { word: cell.value, category: cell.category, owner_id: ownerPlayer.id, raised_by: o.me.id, busy: true };
    var r = await client.from("pending_words").insert({ room_id: o.room.id, round_id: o.round.id, letter: o.round.letter, word: cell.value, category: cell.category, owner_id: ownerPlayer.id, raised_by: o.me.id }).select().single();
    delete o.objections[localKey];
    if (r.error) {
      restoreObjectionButton(button);
      if (r.error.code === "23505" || /duplicate key/i.test(r.error.message || "")) { renderReview(); return; }
      renderReview(); alert(r.error.message || "تعذر تسجيل الاعتراض"); return;
    }
    o.objections[r.data.id] = r.data;
    o.seenObjectionIds[r.data.id] = true;
    if (button) { button.disabled = true; button.textContent = "أُرسل ✓"; }
    if (isHost()) { o.objectionQueue.push(r.data); showNextObjection(); }
  }
  function showNextObjection() {
    if (!isHost() || document.getElementById("objectionPopup")) return;
    var pending = o.objectionQueue.filter(function (item) { return item && !item.host_decision; })[0];
    if (!pending) return;
    o.accepting[pending.id] = true;
    var popup = document.createElement("div");
    popup.id = "objectionPopup";
    popup.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:100;background:var(--card,#fff);border:2px solid var(--accent-deep,#a66b2c);border-radius:14px;padding:16px;box-shadow:0 12px 36px rgba(0,0,0,.24);";
    popup.innerHTML = '<strong>اعتراض من ' + esc(playerName(pending.raised_by)) + ': ' + esc(pending.word) + ' في ' + esc(categoryLabel(pending.category)) + '</strong><div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary" id="objectionAccept">قبول (+10)</button><button class="btn btn-secondary" id="objectionReject">رفض</button></div>';
    document.body.appendChild(popup);
    document.getElementById("objectionAccept").onclick = function () { decideObjection(pending, "accepted"); };
    document.getElementById("objectionReject").onclick = function () { decideObjection(pending, "rejected"); };
  }
  async function decideObjection(pending, decision) {
    if (!isHost() || !pending || !o.accepting[pending.id]) return;
    var result = await client.from("pending_words").update({ host_decision: decision, decided_at: new Date().toISOString() }).eq("id", pending.id).is("host_decision", null).select().maybeSingle();
    if (result.error) { delete o.accepting[pending.id]; alert(result.error.message); return; }
    if (!result.data) { delete o.accepting[pending.id]; closeObjectionPopup(pending.id); return; }
    pending.host_decision = decision;
    if (decision === "accepted") {
      var owner = o.players.filter(function (p) { return p.id === pending.owner_id; })[0];
      if (owner) {
        var pu = await bumpPlayerScore(owner.id, 10);
        if (pu.error) { delete o.accepting[pending.id]; alert(pu.error.message); return; }
        owner.total_score = pu.total_score;
        if (o.scores[owner.id] && o.scores[owner.id][pending.category]) {
          o.scores[owner.id][pending.category].points = 10;
          o.scores[owner.id][pending.category].status = "unique";
        }
      }
    }
    delete o.accepting[pending.id];
    closeObjectionPopup(pending.id);
    o.objectionQueue = o.objectionQueue.filter(function (item) { return item.id !== pending.id; });
    renderReview();
    showNextObjection();
  }
  function closeObjectionPopup(id) {
    var popup = document.getElementById("objectionPopup");
    if (popup) popup.remove();
    if (o.objections[id]) o.objections[id].host_decision = o.objections[id].host_decision || null;
  }
  function renderReview() {
    if (!o.round) return;
    var rows = o.players.map(function (p) { var sc = o.scores[p.id] || {}; return '<div class="review-player"><div class="review-player-name"><span>' + esc(p.name) + '</span><span>' + roundTotalForPlayer(sc) + '</span></div>' + CATEGORIES.map(function (c) { var cell = sc[c.key] || { value: "", points: 0, status: "empty" }; var obj = findObjection(cell.value, c.key, p.id); var flag = cell.status === "not_in_dict" && p.id === o.me.id && !obj ? '<button class="btn btn-secondary" style="padding:4px 12px;font-size:13px;margin-inline-start:8px;border-radius:8px;width:auto;display:inline-flex;" data-object-category="' + esc(c.key) + '" data-object-owner="' + esc(p.id) + '" data-object-word="' + esc(cell.value) + '">اعتراض</button>' : ''; var cls = cell.points === 10 ? "unique" : cell.points === 5 ? "dup" : "zero"; return '<div class="review-row"><span class="cat">' + c.label + '</span><span class="ans">' + esc(cell.value || "—") + flag + '</span><span class="pts ' + cls + '">+' + cell.points + '</span></div>'; }).join("") + '</div>'; }).join("");
    var nextAction = o.round.number < o.room.total_rounds ? (isHost() ? '<button class="btn btn-primary" id="oNextRound" style="margin-top:16px;">الجولة التالية</button>' : '<p class="center-text muted" style="margin-top:16px;">بانتظار المضيف لبدء الجولة التالية…</p>') : '<p class="center-text muted" style="margin-top:16px;">انتهت الجولات…</p>';
    screenEl.innerHTML = '<div class="card"><p class="center-text muted">نتائج الجولة — الحرف <strong style="color:var(--accent-deep);font-size:20px;">' + esc(o.round.letter) + '</strong></p>' + rows + nextAction + '</div>';
    Array.prototype.forEach.call(screenEl.querySelectorAll("[data-object-category]"), function (button) {
      button.onclick = function () { raiseObjection({ value: button.dataset.objectWord, category: button.dataset.objectCategory }, { id: button.dataset.objectOwner }); };
    });
    var nextBtn = document.getElementById("oNextRound");
    if (nextBtn) nextBtn.onclick = function () {
      nextBtn.disabled = true;
      clearTimeout(o.nextRoundTimer);
      o.nextRoundTimer = null;
      startNextRound();
    };
  }
  function renderResults() {
    var ranked = o.players.slice().sort(function (a, b) { return (b.total_score || 0) - (a.total_score || 0); });
    screenEl.innerHTML = '<div class="card"><div class="final-title"><span class="trophy">🏆</span><h2 style="font-family:Cairo,sans-serif;font-weight:800;">النتائج النهائية</h2></div>' + ranked.map(function (p, i) { return '<div class="leaderboard-row"><span class="rank-medal">' + (["🥇", "🥈", "🥉"][i] || (i + 1)) + '</span><span class="lb-name">' + esc(p.name) + '</span><span class="lb-score">' + (p.total_score || 0) + '</span></div>'; }).join("") + '<button class="btn btn-primary" id="orHome" style="margin-top:18px;">الرئيسية</button></div>';
    document.getElementById("orHome").onclick = function () { clearOnlineSession(); cleanup(); state.mode = "local"; window.goTo("home"); };
  }

  window.Online = { render: function (screen) { if (screen === "onlineMenu") renderMenu(); else if (screen === "onlineCreate") renderCreate(); else if (screen === "onlineJoin") renderJoin(); else if (screen === "onlineWaiting") renderWaiting(); else if (screen === "onlinePlaying") renderPlaying(); else if (screen === "onlineReview") renderReview(); else if (screen === "onlineResults") { loadPlayers().then(renderResults); } } };
})();
