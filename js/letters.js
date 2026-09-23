"use strict";

var AVAILABLE_LETTERS = [];
var EASY_LETTERS = [];
var HARD_LETTERS = [];

var _MANIFEST_URL = "https://raw.githubusercontent.com/zrwqalmslh2003-sudo/nap-dictionary/main/data/manifest.json";
var _DIFFICULTY_HARD = ["ث", "ذ", "ظ"];

async function loadAvailableLetters() {
  var r = await fetch(_MANIFEST_URL, { cache: "no-cache" });
  if (!r.ok) throw new Error("manifest " + r.status);
  var data = await r.json();
  var present = {};
  (data.files || []).forEach(function (f) { present[f] = true; });
  var easy = ["ا", "ب", "ت", "ج", "ح", "خ", "د", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ع", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي"];
  var hard = _DIFFICULTY_HARD;
  var newEasy = [], newHard = [];
  easy.forEach(function (l) {
    var file = (typeof LETTER_FILES !== "undefined" && LETTER_FILES[l]) ? LETTER_FILES[l] : null;
    if (file && present[file]) newEasy.push(l);
  });
  hard.forEach(function (l) {
    var file = (typeof LETTER_FILES !== "undefined" && LETTER_FILES[l]) ? LETTER_FILES[l] : null;
    if (file && present[file]) newHard.push(l);
  });
  AVAILABLE_LETTERS = newEasy.concat(newHard);
  EASY_LETTERS = newEasy;
  HARD_LETTERS = newHard;
}

function getLetterPool(difficulty) {
  return difficulty === "hard" ? HARD_LETTERS : EASY_LETTERS;
}

function getRandomLetter(exclude, difficulty) {
  var base = getLetterPool(difficulty);
  if (!base.length) return null;
  var pool = base.filter(function (l) { return l !== exclude; });
  var source = pool.length ? pool : base;
  return source[Math.floor(Math.random() * source.length)];
}
