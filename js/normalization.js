function normalizeArabic(str) {
  if (!str) return "";
  let s = str.trim();
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, ""); // diacritics + tatweel
  s = s.replace(/[إأآا]/g, "ا");
  s = s.replace(/ى/g, "ي");
  s = s.replace(/ة/g, "ه");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeAnswer(str) {
  return normalizeArabic(str).toLowerCase();
}

function firstChar(str) {
  const n = normalizeArabic(str);
  return n.length ? n[0] : "";
}
