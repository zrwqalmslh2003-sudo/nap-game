# Feature Spec: Player Kick (PR1) + Public Rooms List (PR2)

Target file: `js/online.js` (online multiplayer module for the "اسم حيوان نبات جماد بلاد" game).
You may also need a Supabase SQL migration (new columns/table) and an update to `ONLINE-MULTIPLAYER-TEST.md`.

This is two separate, independently shippable pull requests. **Do not combine them.** Ship and test PR1 completely before starting PR2. Read this entire document before writing any code. Where this document gives a decision, follow it exactly — do not substitute your own UI pattern, table design, or channel choice. Where something is marked "VERIFY FIRST," you must inspect the actual current file/schema before proceeding; do not assume.

## 0. Architecture constraints (non-negotiable, apply to both PRs)

- This is a **static site with no backend**. Supabase is used only as a Postgres database + Realtime (`postgres_changes` and Presence). There is no server-side code and no cron job available unless you explicitly confirm one exists — do not assume.
- All game logic runs client-side, independently in every connected browser. Any new logic must follow this same pattern: mutate DB rows directly from the client, and let `postgres_changes` subscriptions propagate the change to other clients.
- Match existing code style exactly: `var`, `function` keyword (no arrow functions, no `let`/`const`), string concatenation with `+` (no template literals), 2-space indentation, existing error-handling pattern (`if (x.error) return fail(x.error.message);`), existing naming (`o.*` for module state).
- Do not add new npm dependencies or new CDN scripts.
- Reuse existing infrastructure before adding new infrastructure. **Do not** add a Supabase Broadcast channel for anything in this spec. The existing `postgres_changes` subscription on `players` is sufficient for both features — see PR1 section 1.4 for exactly how.
- Reuse `js/normalization.js` (`normalizeArabic`) for any text filtering. Do not write a second normalization routine.
- Every new async action must follow the existing re-entrancy pattern already used in this file: a boolean flag on `o`, checked at the top of the function and reset on every exit path, with the triggering control disabled while in flight. Grep `o.joining`, `o.creating`, `o.submitting`, `o.closing` for the exact pattern before writing new code.
- VERIFY FIRST: `players.connected` is currently written on insert (`connected: true`) but not read anywhere else in the file. Confirm this yourself with a grep before deciding whether to repurpose this column.
- New shared helper, required by both PRs: add `function activePlayers() { return o.players.filter(function (p) { return !p.kicked_at; }); }`. Every render function that lists players (`renderWaiting`, `updatePlayersStrip`, `renderReview`, `renderResults`) must be changed to iterate `activePlayers()` instead of `o.players` directly, so a kicked player disappears from every view without needing per-function special-casing. `o.players` itself stays the full, unfiltered list — do not remove kicked rows from it, and do not filter it at fetch time. This is the one and only place kicked-player filtering happens for display purposes.

---

## PR 1: Player Kick

### 1.1 Goal
Let the host remove a disruptive player from their own room, at any point before the room's final results (waiting room, or mid-round).

### 1.2 Data model changes
Do not add a new table. Preferred approach, in order:
1. If VERIFY FIRST (section 0) confirms `players.connected` is genuinely unused elsewhere, you may still prefer a dedicated column for clarity — see option 2. Only reuse `connected` if a timestamp is not needed anywhere.
2. Add `players.kicked_at timestamptz` (nullable; null = not kicked). Use a timestamp, not a boolean.

Do not physically `DELETE` the player row. Deleting it breaks any existing `answers` rows referencing `player_id` as a foreign key and corrupts round scoring for rounds already played this game. This is a hard requirement.

### 1.3 UI changes
- In the waiting-room player list (`renderWaiting`) and in the live players strip during a round (`updatePlayersStrip`), if `isHost()` and the row is not the host's own row, add a small "✕" kick control next to that player's name.
- On click, use `confirm()` (consistent with this codebase's existing use of plain `alert()` — do not build a custom modal for this).
- On confirm, `update players set kicked_at = now() where id = ...`. Guard with a per-row in-flight flag; do not block the whole screen while one kick request is in flight.
- Both of these render functions must now source their player rows from `activePlayers()` (section 0), so a kicked player vanishes from both screens for every other player automatically, with no separate "remove from view" code needed.

### 1.4 Effect on the kicked player's own client — exact detection logic
The kicked player's own browser is still subscribed to `postgres_changes` on `players` for this room. `loadPlayers()` already re-fetches and re-assigns `o.players` on every such event. Add this check **immediately after** `o.players` is reassigned inside `loadPlayers()`, before any render call:

```js
if (o.me && !o.selfKicked) {
  var mine = o.players.filter(function (p) { return p.id === o.me.id; })[0];
  if (mine && mine.kicked_at) {
    o.selfKicked = true;
    clearInterval(o.timerId);
    clearOnlineSession();
    cleanup();
    route("onlineMenu");
    alert("تم إخراجك من الغرفة من قبل المضيف");
    return;
  }
}
```

- `o.selfKicked` must be added to the `o` state object initializer and reset to `false` in `cleanup()`, same as every other flag in this file.
- The early `return` here must skip whatever `loadPlayers()` normally does next (e.g. calling a render function) — read the current end of `loadPlayers()` before inserting this, so you place it correctly relative to existing logic rather than guessing.
- This is the only place self-kick detection lives. Do not duplicate this check elsewhere.

### 1.5 Effect on scoring — exact rule (do not improvise here)
No changes to `calculateRoundScores()` or the scoring loop in `closeRound()` are needed or permitted. A kicked player is handled entirely by these two existing mechanisms once section 1.4 is in place:
- If they had already submitted an answer for the current round before being kicked, that answer is real data and must still be scored normally when the round closes — do not strip it out.
- If they had not submitted yet, they are treated exactly like any other non-submitting player already is today (scored as empty for that round) — this requires no new code, since the existing scoring logic already handles a player who never submits.
- The only place kicked-awareness is needed for round-flow purposes is `allSubmitted()`: it must not wait on a kicked player. Change its check to iterate `activePlayers()` instead of `o.players`, so the round can close without them.

### 1.6 Rejoin prevention (best-effort — state the limitation in a code comment)
Players are anonymous with no persistent account, so a kicked person can always reload and get a new identity. Implement only this much:
- In `resumeRoom()`, if the fetched player row for the saved session has `kicked_at` set, clear the session (`clearOnlineSession()`) and show the same "تم إخراجك من الغرفة من قبل المضيف" message instead of silently resuming them.
- Do not attempt IP-based or device-fingerprint blocking. Out of scope.

### 1.7 Explicitly out of scope for PR1
Temporary bans/timeouts, a moderation log/history screen, kicking from the final results screen (the game is already over there — no new code needed).

### 1.8 Required testing before PR1 ships
Two real, separate devices, not two tabs of one browser:
1. Kicking a player during the waiting room immediately removes them from every other player's view.
2. The kicked player's own screen shows the correct message and returns to the menu, without needing to refresh.
3. Kicking mid-round, before that player submits: the round still closes normally once everyone else submits or time runs out.
4. Kicking mid-round, after that player already submitted: their submitted answer still scores normally for that round.
5. The kicked player refreshes and taps "استئناف الغرفة السابقة": they are not let back in, and see the kicked message instead.
Update `ONLINE-MULTIPLAYER-TEST.md` with these five as new M-numbered cases.

---

## PR 2: Public Rooms List (start only after PR1 is shipped and tested)

### 2.1 Goal
Let a player without a room code see a list of open public rooms and join one directly, instead of only supporting join-by-code.

### 2.2 Data model changes
Add to `rooms`:
- `is_public boolean not null default false`
- `room_name text` (nullable; required only when `is_public = true`; 2–40 chars)

Add one new table for reporting (section 2.5):
- `room_reports (id uuid primary key, room_id uuid references rooms(id), reported_by uuid, created_at timestamptz default now())`

No auto-delist, no report threshold, no moderation action of any kind is triggered automatically by this table in this PR — see section 2.5. Do not add columns or logic beyond what this section lists.

### 2.3 Room creation flow changes
Add a toggle: "غرفة عامة" / "غرفة خاصة", **default private** (opt-in, not opt-out — this must not change the current default behavior for anyone who doesn't touch the toggle).
- If "public" is selected, require a room name (2–40 chars), validated client-side the same way existing name-length checks work in this file.
- Run the room name through the profanity filter (section 2.6) before allowing submission. On rejection, show an inline message that reads as a soft nudge, not a final verdict — e.g. "الاسم يحتاج تعديل بسيط، جربي صياغة ثانية." Do not word it as an absolute judgment ("هذا الاسم غير مسموح" or similar) — the filter can be beaten with a single substituted character, and the copy must not imply a guarantee it cannot back up.

### 2.4 Public rooms list screen
New screen, e.g. `onlinePublicRooms`, reachable from the online menu via a new "غرف عامة" button next to the existing create/join options.
- Query `rooms` where `is_public = true and status = 'waiting'`, ordered by `created_at desc`, limit ~30.
- For each room show `room_name`, live player count, and a state badge (open if `count < 6`, "ممتلئة" with join disabled if `count >= 6`). Batch the player counts in one query — do not issue 30 separate count queries.
- Tapping an open room joins it using the existing `joinRoom()` logic. Refactor `joinRoom()` so it accepts either a typed code (existing flow) or a known room id (from this list) without duplicating the insert/guard logic. The `o.joining` guard must cover both entry points.
- Refresh this screen's list periodically (reuse the existing poll pattern, or subscribe to `postgres_changes` on `rooms` filtered to `is_public = true`).
- Include a link back to the normal join-by-code screen — public rooms must never be the only way in.

### 2.5 Reporting — minimal, non-automated (do not add automation)
- Add a "إبلاغ عن الغرفة" action on each row in the public list.
- On tap, insert one row into `room_reports` (`room_id`, `reported_by` = `o.me.id` if available, else null). That is the entire behavior.
- **Do not** implement any automatic consequence of a report — no auto-delist, no threshold, no counting logic anywhere in the client. A small number of colluding reporters must not be able to remove a room from the list themselves; the only way this table is acted on is a human looking at it later. If you find yourself writing a `count(*) from room_reports` check anywhere in the client, stop — that is explicitly excluded from this PR.
- One report per `(room_id, reported_by)` pair is enough to record — a unique constraint on those two columns is acceptable to prevent someone spamming duplicate rows, but this is a data-hygiene detail, not a moderation mechanism.

### 2.6 Content filtering — set expectations correctly
- Maintain a small Arabic + English blocklist (a plain array in the JS file — no new table, no external service).
- Run `room_name` through `normalizeArabic()` before matching against it.
- This will not catch spaced-out letters, zero-width characters, or digit substitutions. Do not describe this filter to the user, in code comments, or in the test doc as comprehensive — it is a basic first pass, backed by the human-reviewed reports in section 2.5, not a guarantee.

### 2.7 Cleanup of stale rooms
- If a scheduled job (`pg_cron` or scheduled Edge Function) is confirmed available in this Supabase project, use it to delist (`is_public = false`) `waiting` rooms older than ~2 hours.
- If none is available, fall back to: when the public list loads, opportunistically delist any fetched room older than the threshold before rendering it. Note in a code comment that this is a client-side workaround standing in for a proper scheduled job.

### 2.8 Explicitly out of scope for PR2
Room name search/filter beyond default ordering, pagination beyond a simple limit, spectator mode, monetization, popularity sorting, any automated moderation action (see 2.5).

### 2.9 Required testing before PR2 ships
Two real, separate devices:
1. A public room appears in the list within a few seconds, with an accurate, live player count.
2. A blocklisted room name is rejected at creation with the soft-worded message from 2.3, not silently altered or auto-corrected.
3. Reporting a room inserts exactly one row into `room_reports` and has no visible effect on the room's listing.
4. A full room (6/6) shows as full with its join control disabled.
5. Joining from the public list and joining by code both land the player in the same working room state.
Update `ONLINE-MULTIPLAYER-TEST.md` with these five as new M-numbered cases.
