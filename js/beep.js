// ---------- countdown sound ----------
// Primary: the custom 10-second clip (audio/tick_tick_10s.mp3), started once when the last
// 10 seconds begin (or seeked to the right offset after a refresh).
// Fallback: synthesized Web Audio beeps, used only if the clip cannot load or play.
(function () {
  var CLIP_URL = "audio/tick_tick_10s.mp3";
  var CLIP_SECONDS = 10;

  var clip = null;
  var clipFailed = false;
  var clipStarted = false;
  var beepCtx = null;
  var beepLastSecond = null;

  /* ---------- custom clip ---------- */
  function clipFail() {
    clipFailed = true;
    clipStarted = false;
    beepLastSecond = null; // let the synthesized beep take over on the very next tick
  }

  function clipInit() {
    if (clip || clipFailed) return clip;
    try {
      if (typeof Audio === "undefined") { clipFail(); return null; }
      clip = new Audio(CLIP_URL);
      clip.preload = "auto";
      clip.addEventListener("error", clipFail);
    } catch (e) { clip = null; clipFail(); }
    return clip;
  }

  function clipStop() {
    clipStarted = false;
    if (!clip) return;
    try { clip.pause(); clip.currentTime = 0; } catch (e) { /* ignore */ }
  }

  function clipStart(secondsLeft) {
    var a = clipInit();
    if (!a || clipFailed) return false;
    try {
      // secondsLeft = 10 -> start of the clip; secondsLeft = 3 (e.g. after a refresh) -> 7 s in.
      a.currentTime = Math.min(Math.max(CLIP_SECONDS - secondsLeft, 0), CLIP_SECONDS - 0.1);
      var p = a.play();
      if (p && p.catch) {
        p.catch(function (err) {
          if (err && err.name === "AbortError") return; // we paused it ourselves
          clipFail();
        });
      }
      clipStarted = true;
      return true;
    } catch (e) { clipFail(); return false; }
  }

  // iOS/Safari only allow the first play() inside a user gesture: on the first tap,
  // start the clip muted and stop it again, so later timer-driven play() calls are allowed
  // and the file is already loaded.
  function unlock() {
    ["pointerdown", "touchend", "click"].forEach(function (evt) {
      document.removeEventListener(evt, unlock, true);
    });
    var a = clipInit();
    if (!a || clipFailed) return;
    try {
      a.muted = true;
      var p = a.play();
      var done = function () {
        if (!clipStarted) { try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ } }
        a.muted = false;
      };
      if (p && p.then) p.then(done, function () { a.muted = false; });
      else done();
    } catch (e) { /* ignore */ }
  }
  try {
    ["pointerdown", "touchend", "click"].forEach(function (evt) {
      document.addEventListener(evt, unlock, true);
    });
  } catch (e) { /* ignore */ }

  /* ---------- synthesized fallback ---------- */
  function beepInit() {
    if (beepCtx) return beepCtx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      beepCtx = new Ctx();
    } catch (e) { beepCtx = null; }
    return beepCtx;
  }

  function beepPlay(freq, ms, gain) {
    var ctx = beepInit();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      var now = ctx.currentTime;
      osc.start(now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
      osc.stop(now + ms / 1000 + 0.02);
    } catch (e) { /* audio failure must never break the game */ }
  }

  /* ---------- public API ---------- */
  // Call with the integer seconds remaining on the current turn.
  function beepTick(secondsLeft) {
    if (secondsLeft < 0 || secondsLeft > 10) {
      beepLastSecond = null;
      if (clipStarted) clipStop();
      return;
    }
    if (!clipFailed) {
      if (!clipStarted) clipStart(secondsLeft);
      if (clipStarted) { beepLastSecond = secondsLeft; return; }
    }
    if (secondsLeft === beepLastSecond) return;
    beepLastSecond = secondsLeft;
    if (secondsLeft === 0) beepPlay(440, 400, 0.12);
    else if (secondsLeft <= 3) beepPlay(880, 100, 0.10);
    else beepPlay(660, 80, 0.08);
  }

  // New turn / leaving the playing screen: silence the clip and clear the per-second state.
  function beepReset() {
    beepLastSecond = null;
    clipStop();
  }

  window.beep = { tick: beepTick, reset: beepReset };
})();
