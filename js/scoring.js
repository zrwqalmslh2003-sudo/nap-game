const CATEGORIES = [
  { key: "nameMale",   label: "اسم ولد", dictCat: "name_male" },
  { key: "nameFemale", label: "اسم بنت", dictCat: "name_female" },
  { key: "animal",  label: "حيوان" },
  { key: "plant",   label: "نبات" },
  { key: "object",  label: "جماد" },
  { key: "country", label: "بلاد" }
];

// answersByPlayer: { playerId: { name, animal, plant, object, country } }
// returns { playerId: { name: {value, points, status}, ... } }
function calculateRoundScores(letter, players, answersByPlayer) {
  const perCategoryNorm = {};
  CATEGORIES.forEach(function (cat) { perCategoryNorm[cat.key] = []; });

  players.forEach(function (p) {
    const ans = answersByPlayer[p.id] || {};
    CATEGORIES.forEach(function (cat) {
      const raw = ans[cat.key] || "";
      const valid = isValidAnswer(raw, letter);
      let candidate = false;
      let status = "empty";
      if (!raw || !raw.trim()) { status = "empty"; }
      else if (!valid) { status = "invalid"; }
      else {
        const inDict = isWordInDictionary(letter, raw, cat.dictCat || cat.key);
        if (inDict === false) { status = "not_in_dict"; }
        else { candidate = true; }
      }
      perCategoryNorm[cat.key].push({
        playerId: p.id,
        raw: raw,
        norm: candidate ? normalizeAnswer(raw) : null,
        valid: valid,
        candidate: candidate,
        status: status
      });
    });
  });

  const result = {};
  players.forEach(function (p) { result[p.id] = {}; });

  CATEGORIES.forEach(function (cat) {
    const entries = perCategoryNorm[cat.key];
    const counts = {};
    entries.forEach(function (e) {
      if (e.candidate) counts[e.norm] = (counts[e.norm] || 0) + 1;
    });
    entries.forEach(function (e) {
      let points = 0;
      let status = e.status;
      if (e.candidate) {
        if (counts[e.norm] > 1) { points = 5; status = "dup"; }
        else { points = 10; status = "unique"; }
      }
      result[e.playerId][cat.key] = { value: e.raw, points: points, status: status };
    });
  });

  return result;
}

function calculateTotalScores(players) {
  const totals = {};
  players.forEach(function (p) { totals[p.id] = p.totalScore; });
  return totals;
}

function roundTotalForPlayer(scoreRow) {
  let total = 0;
  CATEGORIES.forEach(function (c) { total += (scoreRow[c.key] ? scoreRow[c.key].points : 0); });
  return total;
}
