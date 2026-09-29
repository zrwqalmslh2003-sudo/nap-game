#!/usr/bin/env node
// Cross-file symbol check.
//
// `node --check` validates syntax per file, so every file can be valid while the
// game is broken. That is how 489f894 reached main: js/online.js referenced
// EASY_LETTERS / HARD_LETTERS while js/letters.js no longer defined them, so
// creating or joining a room threw ReferenceError at runtime.
//
// This check resolves every global each file uses against the globals the other
// files declare. It is a heuristic, not a parser: it strips comments, strings,
// regex literals, member accesses, object keys, and function parameters, then
// reports identifiers left in value position that no file declares.
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");

var FILES = [
  "js/normalization.js",
  "js/letters.js",
  "js/dictionary.js",
  "js/validation.js",
  "js/scoring.js",
  "js/ai.js",
  "js/game.js",
  "js/online.js",
  "js/app.js"
];

// JavaScript keywords and reserved words. These are not identifiers and must
// never be reported as unresolved.
var KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "throw", "try", "catch", "finally", "var", "let",
  "const", "function", "class", "extends", "super", "new", "delete",
  "typeof", "void", "in", "of", "instanceof", "this", "async", "await",
  "yield", "static", "get", "set", "export", "import", "from", "as", "null",
  "true", "false"
]);

// Ambient names: provided by the browser or the runtime, and declared by none of
// the eight scanned files. Only these may be skipped without verification.
//
// The first version of this list also held the project's own cross-file globals
// (state, CATEGORIES, normalizeAnswer, roundTotalForPlayer, …). That silently
// defeated the check: renaming roundTotalForPlayer in js/scoring.js still passed
// because the name was skipped, even though js/online.js would then throw
// ReferenceError. A name declared in a scanned file is now left for the
// cross-file resolver to prove, so this list must stay restricted to names that
// no file in FILES declares — run with a name added here and the preflight will
// tell you if the name actually is ambient.
var SKIP = new Set([
  "window", "document", "console", "alert", "confirm", "prompt", "fetch",
  "crypto", "navigator", "localStorage", "sessionStorage",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "Promise", "JSON", "Math", "Date", "Object", "Array", "String", "Number",
  "Boolean", "RegExp", "Error", "URL", "Response", "Set", "Map", "WeakMap",
  "WeakSet", "Symbol", "Reflect", "Proxy", "Intl", "encodeURIComponent",
  "decodeURIComponent", "parseFloat", "parseInt", "isNaN", "isFinite",
  "undefined", "NaN", "Infinity", "self", "caches", "clients", "importScripts"
]);

var IDENT_SRC = "([A-Za-z_$][\\w$]*)";

// Strip comments, strings, template literals, and regex literals in a single
// pass. A pass-per-construct approach is wrong: a regex literal may contain
// quotes ("/[&<>"']/g) and a line comment may live inside a string
// ("https://...").
function stripNoise(src) {
  var VALUE_BEFORE = "(,=:[!&|?{};+-*%<>~^";
  var out = "";
  var i = 0;
  var n = src.length;
  var prev = "";
  while (i < n) {
    var c = src[i];
    var two = src.substr(i, 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (two === "/*") {
      while (i < n && src.substr(i, 2) !== "*/") { out += src[i] === "\n" ? "\n" : " "; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      var quote = c;
      out += " ";
      i++;
      while (i < n) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        if (src[i] === quote) { out += " "; i++; break; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (c === "/" && (prev === "" || VALUE_BEFORE.indexOf(prev) >= 0)) {
      var j = i + 1;
      var closed = false;
      var inClass = false;
      while (j < n) {
        var d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        out += " ";
        i = j + 1;
        while (i < n && /[a-z]/.test(src[i])) { out += " "; i++; }
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// Binding sites are read with a scanner, not a regex. The first version of
// this file harvested "declarations" with /var|let|const\s+([^;]*)/ which stops
// at the first ";", so `var a = f(function () { var b = 1; ...` lost `b` and
// `var a = 1, c = 2` lost `c`. Both shapes exist in js/online.js.

var OPENERS = { "(": ")", "[": "]", "{": "}" };
var CLOSERS = ")]}";

function isIdentStart(code) {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 36;
}

function readIdent(s, i) {
  if (i >= s.length || !isIdentStart(s.charCodeAt(i))) return null;
  var j = i + 1;
  while (j < s.length && isIdentPart(s.charCodeAt(j))) j++;
  return { name: s.slice(i, j), end: j };
}

function isIdentPart(code) {
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

function skipSpace(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

// Index just past the bracket group opening at s[i]. Tracks mixed nesting via a
// stack; returns end-of-input if the input is not balanced.
function skipGroup(s, i) {
  var stack = [OPENERS[s[i]]];
  for (i++; i < s.length; i++) {
    var ch = s[i];
    if (OPENERS[ch]) {
      stack.push(OPENERS[ch]);
      continue;
    }
    if (CLOSERS.indexOf(ch) >= 0) {
      if (ch !== stack[stack.length - 1]) return s.length;
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  return s.length;
}

// Skips an initializer or default value, stopping where the enclosing list
// resumes: a top-level "," or any closing bracket.
function skipExpr(s, i) {
  while (i < s.length) {
    var ch = s[i];
    if (OPENERS[ch]) { i = skipGroup(s, i); continue; }
    if (ch === "," || CLOSERS.indexOf(ch) >= 0) return i;
    i++;
  }
  return i;
}

// Reads one binding pattern and adds every name it binds. Renames, defaults,
// computed keys and rest markers are stepped over rather than harvested, so an
// identifier in value position is never mistaken for a declaration.
function readPattern(s, i, out) {
  i = skipSpace(s, i);
  if (s[i] === "{" || s[i] === "[") {
    var close = s[i] === "{" ? "}" : "]";
    for (i++; i < s.length;) {
      i = skipSpace(s, i);
      if (i >= s.length) break;
      if (s[i] === close) { i++; break; }
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ".") { i += 3; continue; }                       // ...rest
      var key = readIdent(s, i);
      if (key && s[key.end] === ":") { i = readPattern(s, key.end + 1, out); continue; }
      if (key && s[key.end] === "=") { i = skipExpr(s, key.end + 1); continue; }
      if (key) { out.add(key.name); i = key.end; continue; }
      i = skipGroup(s, i);                                          // computed key
      if (i >= s.length) break;
    }
    return i;
  }
  var id = readIdent(s, i);
  if (id) { out.add(id.name); return id.end; }
  return i;
}

// Reads the parameter list whose "(" is at `open`.
function readParams(s, open, out) {
  var i = open + 1;
  while (i < s.length) {
    i = skipSpace(s, i);
    if (i >= s.length) break;
    if (s[i] === ")") return i + 1;
    if (s[i] === ",") { i++; continue; }
    if (s[i] === ".") { i += 3; continue; }                         // ...rest
    var before = i;
    i = readPattern(s, i, out);
    if (i === before) { i++; continue; }                            // malformed
    i = skipSpace(s, i);
    if (s[i] === "=") i = skipExpr(s, i + 1);                       // default value
  }
  return i;
}

// var / let / const binding sites, including multi-declarator lists.
function collectDeclarations(s, out) {
  var kw = /(^|[^\w$.])(var|let|const)\s/g, m;
  while ((m = kw.exec(s))) {
    var i = kw.lastIndex;
    while (i < s.length) {
      var before = i;
      i = readPattern(s, i, out);
      if (i === before) break;
      i = skipSpace(s, i);
      if (s[i] === "=") i = skipExpr(s, i + 1);
      i = skipSpace(s, i);
      if (s[i] !== ",") break;
      i++;
    }
  }
}

// Function names and parameter lists: `function f(a, b)`, `function (a)`,
// `(a, b) =>`, `a =>`, and `catch (e)`.
function collectFunctions(s, out) {
  var i = 0;
  while (i < s.length) {
    if (s[i] === "(") {
      var after = skipGroup(s, i);
      if (s.substr(skipSpace(s, after), 2) === "=>") readParams(s, i, out);
      i++;
      continue;
    }
    if (isIdentStart(s.charCodeAt(i))) {
      var id = readIdent(s, i);
      if (id.name === "function") {
        var j = skipSpace(s, id.end);
        if (s[j] === "*") j = skipSpace(s, j + 1);
        var name = readIdent(s, j);
        if (name) { out.add(name.name); j = skipSpace(s, name.end); }
        if (s[j] === "(") readParams(s, j, out);
      } else if (id.name === "catch") {
        var k = skipSpace(s, id.end);
        if (s[k] === "(") readParams(s, k, out);
      }
      i = id.end;
      continue;
    }
    i++;
  }
  // Bare single-parameter arrow: a => …
  var bare = /(^|[=({[,;:?&|!+\-*/%<>~^]|\s)([A-Za-z_$][\w$]*)\s*=>/g, bm;
  while ((bm = bare.exec(s))) out.add(bm[2]);
}

function collect(source) {
  var clean = stripNoise(source);
  var locals = new Set();
  var uses = new Set();
  var m;

  // window.X = ... publishes X as a global.
  var winRe = new RegExp("\\b(?:window|globalThis)\\s*\\.\\s*" + IDENT_SRC, "g");
  while ((m = winRe.exec(clean))) locals.add(m[1]);

  // Member accesses and object keys are not free variables.
  var noMembers = clean
    .replace(/(\.)(\s*)([A-Za-z_$][\w$]*)/g, "$1$2#")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, "$1#:");

  collectDeclarations(noMembers, locals);
  collectFunctions(noMembers, locals);

  // Every identifier is also a use. Names bound in one function and read in
  // another stay uses on purpose: the per-file locals set is what resolves
  // them, so a genuinely free global still has nowhere to hide.
  var useRe = new RegExp(IDENT_SRC, "g");
  while ((m = useRe.exec(noMembers))) uses.add(m[1]);

  return { locals: locals, uses: uses };
}

// Read and collect all files.
var units = [];
var readErrors = [];
for (var f = 0; f < FILES.length; f++) {
  var rel = FILES[f];
  var abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    readErrors.push(rel);
    continue;
  }
  var src = fs.readFileSync(abs, "utf8");
  var c = collect(src);
  units.push({ label: rel, locals: c.locals, uses: c.uses });
}

if (readErrors.length) {
  console.log("cross-file symbols: FAIL");
  for (var e = 0; e < readErrors.length; e++) {
    console.log("  MISSING FILE: " + readErrors[e]);
  }
  process.exit(1);
}

// Map each identifier to the files that declare it.
var declared = {};
for (var u = 0; u < units.length; u++) {
  var unit = units[u];
  unit.locals.forEach(function (name) {
    if (!declared[name]) declared[name] = [];
    declared[name].push(unit.label);
  });
}

// Check each file's uses against the skip list and declared identifiers.
var failures = [];
var resolved = 0;
for (var u2 = 0; u2 < units.length; u2++) {
  var unit2 = units[u2];
  unit2.uses.forEach(function (name) {
    if (KEYWORDS.has(name)) return;
    if (SKIP.has(name)) return;
    if (declared[name]) {
      for (var d = 0; d < declared[name].length; d++) {
        if (declared[name][d] !== unit2.label) { resolved++; return; }
      }
      return;
    }
    failures.push({ name: name, usedIn: unit2.label });
  });
}

// Deduplicate failures.
var seen = {};
var unique = [];
for (var fi = 0; fi < failures.length; fi++) {
  var key = failures[fi].name + "|" + failures[fi].usedIn;
  if (!seen[key]) {
    seen[key] = true;
    unique.push(failures[fi]);
  }
}
failures = unique;

if (failures.length) {
  console.log("cross-file symbols: FAIL (" + failures.length + " unresolved)");
  for (var o = 0; o < failures.length; o++) {
    console.log("  UNRESOLVED: " + failures[o].name + " used in " + failures[o].usedIn + " but declared in no scanned file");
  }
  process.exit(1);
}

console.log("cross-file symbols: PASS");
console.log("- files scanned: " + units.length);
console.log("- cross-file references resolved: " + resolved);
