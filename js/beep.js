// ---------- countdown beep (Web Audio, no files) ----------
(function () {
  var beepCtx = null;
  var beepLastSecond = null;

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

  // Call with the integer seconds remaining on the current turn.
  function beepTick(secondsLeft) {
    if (secondsLeft < 0 || secondsLeft > 10) { beepLastSecond = null; return; }
    if (secondsLeft === beepLastSecond) return;
    beepLastSecond = secondsLeft;
    if (secondsLeft === 0) beepPlay(440, 400, 0.12);
    else if (secondsLeft <= 3) beepPlay(880, 100, 0.10);
    else beepPlay(660, 80, 0.08);
  }

  function beepReset() { beepLastSecond = null; }

  window.beep = { tick: beepTick, reset: beepReset };
})();
