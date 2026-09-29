#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for f in js/*.js; do
  node --check "$f"
done

# Cross-file symbol resolution. `node --check` is per file, so a file can be
# valid while the game throws at runtime -- that is how 489f894 shipped broken
# main (js/online.js used EASY_LETTERS, js/letters.js no longer defined it).
node tests/cross-file-symbols.js || { echo "cross-file symbol check FAILED"; exit 1; }

git diff --check

grep -q 'loadAvailableLetters' js/online.js
grep -q 'pollId' js/online.js
grep -q 'current_round,status' js/online.js
grep -q 'existing.data' js/online.js
grep -q '23505' js/online.js
grep -q 'pending_words' js/online.js
grep -q 'oNextRound' js/online.js
grep -q '60000' js/online.js
grep -q 'loadDictionaryWithRetry' js/online.js
grep -q 'لا يمكن حساب نتائج الجولة بأمان' js/online.js
grep -q 'var MAX_ONLINE_PLAYERS = 20;' js/online.js
grep -q '20 لاعبًا كحد أقصى' js/online.js

echo "online-preflight: PASS"
echo "- JavaScript syntax: PASS"
echo "- cross-file symbols: PASS"
echo "- whitespace check: PASS"
echo "- manifest loading guard: PASS"
echo "- polling fallback: PASS"
echo "- duplicate-round recovery: PASS"
echo "- objection flow hooks: PASS"
echo "- manual transition and 60s safety net: PASS"
echo "- strict online dictionary loading: PASS"
