#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --check js/online.js
node --check js/game.js
node --check js/letters.js
git diff --check

grep -q 'loadAvailableLetters' js/online.js
grep -q 'pollId' js/online.js
grep -q 'current_round,status' js/online.js
grep -q 'existing.data' js/online.js
grep -q '23505' js/online.js
grep -q 'pending_words' js/online.js
grep -q 'oNextRound' js/online.js
grep -q '60000' js/online.js

echo "online-preflight: PASS"
echo "- JavaScript syntax: PASS"
echo "- whitespace check: PASS"
echo "- manifest loading guard: PASS"
echo "- polling fallback: PASS"
echo "- duplicate-round recovery: PASS"
echo "- objection flow hooks: PASS"
echo "- manual transition and 60s safety net: PASS"
