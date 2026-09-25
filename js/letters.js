"use strict";

var AVAILABLE_LETTERS = [];

var _MANIFEST_URL = "https://raw.githubusercontent.com/zrwqalmslh2003-sudo/nap-dictionary/main/data/manifest.json";

async function loadAvailableLetters() {
  var r = await fetch(_MANIFEST_URL, { cache: "no-cache" });
  if (!r.ok) throw new Error("manifest " + r.status);
  var data = await r.json();
  var present = {};
  (data.files || []).forEach(function (f) { present[f] = true; });
  var all = ["ا", "ب", "ت", "ج", "ح", "خ", "د", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ع", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي"];
  var result = [];
  all.forEach(function (l) {
    var file = (typeof LETTER_FILES !== "undefined" && LETTER_FILES[l]) ? LETTER_FILES[l] : null;
    if (file && present[file]) result.push(l);
  });
  AVAILABLE_LETTERS = result;
  return result;
}

function getRandomLetter(exclude) {
  var base = AVAILABLE_LETTERS;
  if (!base.length) return null;
  var pool = base.filter(function (l) { return l !== exclude; });
  var source = pool.length ? pool : base;
  return source[Math.floor(Math.random() * source.length)];
}
