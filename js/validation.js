function isValidAnswer(answer, letter) {
  const trimmed = (answer || "").trim();
  if (!trimmed) return false;
  return firstChar(trimmed) === normalizeArabic(letter);
}
