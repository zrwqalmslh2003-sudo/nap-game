const AVAILABLE_LETTERS = ["ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","ه","و","ي"];

const EASY_LETTERS = ["ا","ب","ت","ج","ح","خ","د","ر","ز","س","ش","ص","ض","ط","ع","ف","ق","ك","ل","م","ن","ه","و","ي"];

const HARD_LETTERS = EASY_LETTERS.concat(["ث","ذ","ظ"]);

function getLetterPool(difficulty) {
  return difficulty === "hard" ? HARD_LETTERS : EASY_LETTERS;
}

function getRandomLetter(exclude, difficulty) {
  const base = getLetterPool(difficulty);
  const pool = base.filter(function (l) { return l !== exclude; });
  const source = pool.length ? pool : base;
  return source[Math.floor(Math.random() * source.length)];
}