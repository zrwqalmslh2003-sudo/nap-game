"use strict";

const DICT_BASE = "https://raw.githubusercontent.com/zrwqalmslh2003-sudo/nap-dictionary/main/data";

const LETTER_FILES = {
  "ا":"01-alef.csv","ب":"02-beh.csv","ت":"03-teh.csv","ث":"04-theh.csv",
  "ج":"05-jeem.csv","ح":"06-hah.csv","خ":"07-khah.csv","د":"08-dal.csv",
  "ذ":"09-dhal.csv","ر":"10-reh.csv","ز":"11-zain.csv","س":"12-seen.csv",
  "ش":"13-sheen.csv","ص":"14-sad.csv","ض":"15-dad.csv","ط":"16-tah.csv",
  "ظ":"17-zah.csv","ع":"18-ain.csv","غ":"19-ghain.csv","ف":"20-feh.csv",
  "ق":"21-qaf.csv","ك":"22-kaf.csv","ل":"23-lam.csv","م":"24-meem.csv",
  "ن":"25-noon.csv","ه":"26-heh.csv","و":"27-waw.csv","ي":"28-yeh.csv"
};

const dictionaryCache = {};   // letter → { normalizedWord: Set(categories) } | null

function parseCsv(text) {
  const out = {};
  text.split(/\r?\n/).forEach(function(line){
    line = line.trim();
    if (!line) return;
    const i = line.indexOf(",");
    if (i < 1) return;
    const w = normalizeAnswer(line.slice(0, i));
    const c = line.slice(i + 1).trim();
    if (!w || !c) return;
    if (!out[w]) out[w] = new Set();
    out[w].add(c);
  });
  return out;
}

async function loadDictionary(letter) {
  if (letter in dictionaryCache) return dictionaryCache[letter];
  const file = LETTER_FILES[letter];
  if (!file) return null;
  try {
    const res = await fetch(DICT_BASE + "/" + file);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const dict = parseCsv(await res.text());
    if (Object.keys(dict).length === 0) return null;
    dictionaryCache[letter] = dict;
    return dict;
  } catch (e) {
    console.warn("Dictionary load failed:", letter, e);
    return null;
  }
}

function isWordInDictionary(letter, word, category) {
  const dict = dictionaryCache[letter];
  if (dict === null || dict === undefined) return null;  // unknown
  const cats = dict[normalizeAnswer(word)];
  if (!cats) return false;
  return cats.has(category);
}
