"use strict";

// Bot players for single-player mode. Pure functions: no network, no DOM.
(function () {
  var EMPTY_RATIO = 0.25; // PR1: fixed share of categories a bot leaves empty

  var NAMES = [
    "خالد", "سارة", "نور", "فيصل", "ليلى", "عمر", "مريم", "يوسف", "هند", "أحمد",
    "ريم", "سلمان", "دانة", "طارق", "لينا", "ماجد", "جود", "بدر", "رهف", "زياد",
    "أمل", "ناصر", "غادة", "سعد", "منى", "هاشم", "شهد", "وليد", "سلمى", "إبراهيم",
    "لمى", "حسن", "ديما", "عبدالله", "رنا", "مازن", "هدى", "كريم", "أسيل", "رائد",
    "جنى", "بسام", "ياسمين", "علي"
  ];

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Returns `count` distinct names, none of them in `exclude`.
  function names(count, exclude) {
    var banned = {};
    (exclude || []).forEach(function (n) { banned[String(n || "").trim()] = true; });
    var out = shuffle(NAMES).filter(function (n) { return !banned[n]; }).slice(0, count);
    var n = 1;
    while (out.length < count) {
      var fallback = "لاعب " + n++;
      if (!banned[fallback] && out.indexOf(fallback) === -1) out.push(fallback);
    }
    return out;
  }

  // dict: { normalizedWord: Set(tags) } for this letter (or null/undefined if unavailable).
  // categories: [{ key, dictCat?, skipDict? }]. Returns { categoryKey: word | "" }.
  function answers(letter, dict, categories) {
    var result = {};
    var used = {};
    var letterNorm = normalizeArabic(letter);
    categories.forEach(function (cat) {
      result[cat.key] = "";
      if (cat.skipDict || !dict) return;
      if (Math.random() < EMPTY_RATIO) return;
      var tag = cat.dictCat || cat.key;
      var candidates = [];
      Object.keys(dict).forEach(function (word) {
        if (dict[word] && dict[word].has(tag) && !used[word] && firstChar(word) === letterNorm) candidates.push(word);
      });
      if (!candidates.length) return;
      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      used[pick] = true;
      result[cat.key] = pick;
    });
    return result;
  }

  window.ai = { names: names, answers: answers };
})();
