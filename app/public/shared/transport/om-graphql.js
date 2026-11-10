/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// SOQL aggregate -> UI API GraphQL translator (pure functions, no I/O). Inside Salesforce the Apex read path counts every scanned row
// against the 50,000-row governor limit, so big aggregates die there. UI API GraphQL aggregates don't, so om-platform.js asks
// translate(soql) first: null means "not an aggregate or not understood", and the query goes to Apex as before. Anything
// this module does not recognise MUST return null rather than guess; a wrong number is worse than a slow one.
// Read-only by construction: it only ever emits a `query` document.
// HAVING (one predicate on one COUNT/SUM/MIN/MAX/COUNT_DISTINCT, with GROUP BY, no ORDER BY): GraphQL aggregates have no
// HAVING, so the query groups, orders by that aggregate (DESC for > >= = !=, ASC for < <=), takes `first` (LIMIT, max 2000) and
// map() applies the predicate client-side. Rows are sorted by the aggregate, so the result is complete unless the page came
// back full and its last row could still be followed by qualifying groups; then `capped` is set, as for a 2000-row REST result.
// Time series (CALENDAR_YEAR/CALENDAR_MONTH, DAY_ONLY, HOUR_IN_DAY over convertTimezone(field)): GraphQL groupBy has one function per
// field and no time zone option (it buckets in UTC; probed), so these cannot be a groupBy. Instead the translator walks the
// buckets in the user's time zone itself and asks for one COUNT per bucket (field >= start AND field < end) as aliased aggregates
// in one document. That is exactly what convertTimezone means, DST included. It needs the user's zone and a bounded WHERE range
// (translate(soql, { timeZone, now })); without them the query stays on Apex.

const CAP = 1999; // GraphQL `first:2000` with a lookup groupBy fails on a large org once 2000+ groups exist (SObjectException); 1999 works
const AGG = { COUNT: 'count', COUNT_DISTINCT: 'countDistinct', SUM: 'sum', AVG: 'avg', MIN: 'min', MAX: 'max' };
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Valid `literal:` enum values in UI API (LAST_N_DAYS and friends are not; they go through `range`).
const LITERALS = new Set(('YESTERDAY TODAY TOMORROW LAST_WEEK THIS_WEEK NEXT_WEEK LAST_MONTH THIS_MONTH NEXT_MONTH LAST_90_DAYS ' +
  'NEXT_90_DAYS LAST_QUARTER THIS_QUARTER NEXT_QUARTER LAST_YEAR THIS_YEAR NEXT_YEAR LAST_FISCAL_QUARTER THIS_FISCAL_QUARTER ' +
  'NEXT_FISCAL_QUARTER LAST_FISCAL_YEAR THIS_FISCAL_YEAR NEXT_FISCAL_YEAR').split(' '));
const RANGE = /^(LAST|NEXT)_N_(DAYS|WEEKS|MONTHS|QUARTERS|YEARS):(\d{1,6})$/;
const ISO_Z = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/;
const OPS = { '=': 'eq', '!=': 'ne', '<>': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };
const CLAUSE = new Set(['GROUP', 'ORDER', 'LIMIT', 'HAVING', 'OFFSET', 'FROM', 'WHERE']);

const no = (why) => { throw Object.assign(new Error(why), { unsupported: true }); };
const up = (t) => t?.t === 'id' ? t.v.toUpperCase() : null;

// ---------- tokens ----------
const TOKENS = [
  ['dt', /\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\dZ|(?![\dT]))/y], // 2026-01-01 or 2026-01-01T00:00:00Z (no ms, no offset)
  ['num', /[+-]?\d+(?:\.\d+)?(?![\w.])/y],
  ['id', /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?::\d+)?/y], // Account.Name, LAST_N_DAYS:90
  ['op', /!=|<>|<=|>=|=|<|>/y],
  ['p', /[(),]/y],
];

function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === "'") { // SOQL string: backslash escapes; unknown ones (\_ \%) are kept for LIKE
      let v = ''; i++;
      for (;;) {
        if (i >= s.length) no('unterminated string');
        const c = s[i++];
        if (c === "'") break;
        if (c !== '\\') { v += c; continue; }
        const e = s[i++];
        v += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', "'": "'", '\\': '\\' }[e] ?? `\\${e ?? ''}`;
      }
      // Control characters have no business in a filter value, and they are the first thing an injection tries.
      if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v)) no('control character');
      out.push({ t: 'str', v }); continue;
    }
    let hit = null;
    for (const [t, re] of TOKENS) { re.lastIndex = i; const m = re.exec(s); if (m) { hit = { t, v: m[0] }; break; } }
    if (!hit) no(`unexpected ${s[i]}`); // includes ; " { } [ ] : $ and friends
    out.push(hit); i += hit.v.length;
  }
  return out;
}

// ---------- parser ----------
function parse(soql) {
  if (typeof soql !== 'string' || soql.length > 20000) no('input');
  const tk = tokenize(soql); let i = 0;
  const peek = () => tk[i], next = () => tk[i++] ?? no('end of input');
  const isKw = (k) => up(peek()) === k;
  const eatKw = (k) => isKw(k) ? (i++, true) : false;
  const needKw = (k) => eatKw(k) || no(`expected ${k}`);
  const isP = (c) => peek()?.t === 'p' && peek().v === c;
  const needP = (c) => isP(c) ? i++ : no(`expected ${c}`);
  const path = () => { const t = next(); if (t.t !== 'id' || t.v.includes(':') || t.v.split('.').length > 4) no('field'); return t.v; };
  const alias = () => { const t = peek(); if (t?.t === 'id' && !t.v.includes('.') && !t.v.includes(':') && !CLAUSE.has(up(t))) { i++; return t.v; } return null; };

  // FUNC(arg) or a plain path. An unknown function (CALENDAR_MONTH, convertTimezone, ...) is unsupported.
  const expr = (bucketOk) => {
    const t = next();
    if (t.t !== 'id' || t.v.includes(':')) no('select item');
    if (!isP('(')) return { path: path2(t.v) };
    if (BUCKET_FN.has(t.v.toUpperCase())) { // FN(convertTimezone(Field)); anywhere else it is unsupported
      if (!bucketOk) no(`function ${t.v}`);
      i++;
      if (up(next()) !== 'CONVERTTIMEZONE') no('bucket without convertTimezone');
      needP('('); const f = path(); needP(')'); needP(')');
      if (f.includes('.')) no('bucket on parent field');
      return { bucket: t.v.toUpperCase(), field: f };
    }
    const fn = AGG[t.v.toUpperCase()] ? t.v.toUpperCase() : no(`function ${t.v}`);
    i++;
    let arg = null;
    if (!isP(')')) arg = path();
    else if (fn !== 'COUNT') no('empty args');
    needP(')');
    if (arg?.includes('.')) no('aggregate on parent field'); // not probed; Apex handles it
    return { fn, arg: arg ?? 'Id' };
  };
  const path2 = (v) => v.split('.').length > 4 ? no('depth') : v;

  needKw('SELECT');
  const select = [];
  do { const e = expr(true); e.alias = alias(); select.push(e); } while (isP(',') && i++);
  needKw('FROM');
  const from = next(); if (from.t !== 'id' || !NAME.test(from.v)) no('object');
  const where = eatKw('WHERE') ? cond() : null;
  const group = [];
  const groupB = []; // bucket expressions, kept apart so the plain path below never sees one
  if (eatKw('GROUP')) {
    needKw('BY');
    do {
      const j = i, e = tk[i]?.t === 'id' && tk[i + 1]?.v === '(' ? expr(true) : null;
      if (e?.bucket) groupB.push(e); else { i = j; group.push(path()); }
    } while (isP(',') && i++);
  }
  let having = null;
  if (eatKw('HAVING')) {
    const e = expr(), o = next(), v = next();
    if (!e.fn || o.t !== 'op' || (v.t !== 'num' && v.t !== 'dt')) no('having');
    having = { fn: e.fn, arg: e.arg, op: OPS[o.v], val: v }; // AND / OR / a second predicate stop at the trailing check
  }
  const order = [];
  if (eatKw('ORDER')) {
    needKw('BY');
    do {
      const e = expr(); e.dir = eatKw('DESC') ? 'DESC' : (eatKw('ASC'), 'ASC');
      if (eatKw('NULLS')) e.nulls = eatKw('FIRST') ? 'FIRST' : (needKw('LAST'), 'LAST');
      order.push(e);
    } while (isP(',') && i++);
  }
  let limit = null;
  if (eatKw('LIMIT')) { const n = next(); if (n.t !== 'num' || !/^\d+$/.test(n.v) || +n.v < 1) no('limit'); limit = +n.v; }
  if (i < tk.length) no(`trailing ${tk[i].v}`); // a second HAVING predicate, OFFSET, FOR, WITH, a second statement ...

  // ---- WHERE: or > and > not > comparison ----
  function cond() {
    const parts = [and()];
    while (eatKw('OR')) parts.push(and());
    return parts.length > 1 ? { or: parts } : parts[0];
  }
  function and() {
    const parts = [not()];
    while (eatKw('AND')) parts.push(not());
    return parts.length > 1 ? { and: parts } : parts[0];
  }
  function not() {
    if (eatKw('NOT')) return { not: not() };
    if (isP('(')) { i++; const c = cond(); needP(')'); return c; }
    return cmp();
  }
  function value() {
    const t = next();
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'dt') return { k: 'dt', v: t.v };
    if (t.t !== 'id') no('value');
    const u = t.v.toUpperCase();
    if (u === 'NULL') return { k: 'null' };
    if (u === 'TRUE' || u === 'FALSE') return { k: 'bool', v: u.toLowerCase() };
    const m = RANGE.exec(u);
    if (m) return { k: 'range', v: `${m[1].toLowerCase()}_n_${m[2].toLowerCase()}`, n: +m[3] };
    if (LITERALS.has(u)) return { k: 'lit', v: u };
    return no(`identifier ${t.v}`); // field-to-field comparison, bind variable, unknown literal
  }
  function cmp() {
    const f = path();
    if (isKw('NOT')) { i++; needKw('IN'); return inList(f, true); }
    if (eatKw('IN')) return inList(f, false);
    if (eatKw('LIKE')) { const v = value(); if (v.k !== 'str') no('like'); return { f, op: 'like', val: v }; }
    const o = next();
    if (o.t !== 'op') no('operator');
    return { f, op: OPS[o.v], val: value() };
  }
  function inList(f, neg) {
    needP('(');
    if (isKw('SELECT')) { // semi/anti-join: Field IN (SELECT fk FROM Child [WHERE ...]) and nothing else
      i++;
      const t = next(); if (t.t !== 'id' || t.v.includes('.') || t.v.includes(':') || !NAME.test(t.v)) no('subquery select');
      needKw('FROM');
      const c = next(); if (c.t !== 'id' || !NAME.test(c.v)) no('subquery object');
      const w = eatKw('WHERE') ? cond() : null;
      needP(')');
      return { f, op: neg ? 'ninq' : 'inq', child: c.v, fk: t.v, where: w };
    }
    const vals = [];
    do { const v = value(); if (v.k === 'null' || v.k === 'range' || v.k === 'lit' || v.k === 'dt') no('list item'); vals.push(v); } while (isP(',') && i++);
    needP(')');
    return { f, op: neg ? 'nin' : 'in', vals };
  }

  return { select, from: from.v, where, group, groupB, having, order, limit };
}

// ---------- GraphQL emit ----------
const str = (s) => JSON.stringify(s); // controls were rejected in the tokenizer, so this is a valid GraphQL string
const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) no('number'); return String(n); };
const scalar = (v) => v.k === 'str' ? str(v.v) : v.k === 'num' ? num(v.v) : v.k === 'bool' ? v.v : v.k === 'null' ? 'null' : no('scalar');

// nest('Account.Name', X) -> Account:{Name:X}
const nest = (p, inner) => p.split('.').reduceRight((acc, k) => `${k}:{${acc}}`, inner);

function operand(v) {
  if (v.k === 'dt') return `{value:${str(v.v)}}`;
  if (v.k === 'lit') return `{literal:${v.v}}`;
  return scalar(v);
}

function leaf(c) {
  if (c.op === 'inq' || c.op === 'ninq') {
    const w = c.where ? filter(c.where) : '';
    return nest(c.f, `${c.op}:{${c.child}:{${w}},ApiName:${str(c.fk)}}`);
  }
  if (c.op === 'in' || c.op === 'nin') return nest(c.f, `${c.op}:[${c.vals.map(scalar).join(',')}]`);
  const v = c.val;
  if (v.k === 'null' && c.op !== 'eq' && c.op !== 'ne') no('null compare');
  if (v.k === 'range') { // SOQL `Field = LAST_N_DAYS:90` is a range match; the other operators read oddly server-side
    if (c.op !== 'eq') no('range operator');
    return nest(c.f, `eq:{range:{${v.v}:${v.n}}}`);
  }
  if (c.op === 'like' && v.k !== 'str') no('like');
  return nest(c.f, `${c.op}:${operand(v)}`);
}

function filter(c) {
  if (c.and) return `and:[${c.and.map((x) => `{${filter(x)}}`).join(',')}]`;
  if (c.or) return `or:[${c.or.map((x) => `{${filter(x)}}`).join(',')}]`;
  if (c.not) return `not:{${filter(c.not)}}`;
  return leaf(c);
}

// Merge `path` + leaf selection into a nested tree, then print it. Group fields and aggregates on the same
// field share one node: AccountId{ value countDistinct{ value } }.
function addSel(tree, p, leafKey) {
  const parts = p.split('.'); let n = tree;
  for (const k of parts) n = (n[k] ||= {});
  if (leafKey === null) n.value = true; else (n[leafKey] ||= {}).value = true;
}
// groupBy keys that share a relationship prefix must be ONE nested object (OrderSummary:{OrderNumber:{..},Account:{..}});
// repeating the key makes GraphQL reject the document (UniqueObjectFieldName).
function groupArg(paths) {
  const tree = {};
  for (const p of paths) { let n = tree; for (const k of p.split('.')) n = (n[k] ||= {}); n.group = true; }
  const print = (n) => Object.entries(n).map(([k, v]) => k === 'group' ? 'group:true' : `${k}:{${print(v)}}`).join(',');
  return print(tree);
}
const printSel = (n) => Object.entries(n).map(([k, v]) => v === true ? k : `${k}{${printSel(v)}}`).join(' ');

// ---------- time series per bucket ----------
const BUCKET_FN = new Set(['CALENDAR_YEAR', 'CALENDAR_MONTH', 'DAY_ONLY', 'HOUR_IN_DAY']);
const MAX_SLOTS = 100; // a quarter of days; more buckets than this stays on Apex (each 5 buckets is one more request)
const PER_DOC = 5; // UI API allows 10 data fetchers per document and each aliased aggregate costs 2 (probed: 154 for 77 buckets)
const fmts = new Map();
function zoneParts(ms, tz) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  return Object.fromEntries(f.formatToParts(ms).map((p) => [p.type, +p.value]));
}
const offsetAt = (ms, tz) => { const p = zoneParts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
// The instant at which the wall clock in `tz` reads y-mo-d h:00. A wall time that does not exist (DST gap) is refused.
function wallToUtc(y, mo, d, h, tz) {
  const g = Date.UTC(y, mo - 1, d, h);
  let t = g - offsetAt(g, tz); t = g - offsetAt(t, tz);
  const p = zoneParts(t, tz), e = new Date(g);
  if (p.year !== e.getUTCFullYear() || p.month !== e.getUTCMonth() + 1 || p.day !== e.getUTCDate() || p.hour !== e.getUTCHours()) no('wall time in a DST gap');
  return t;
}
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const pad = (n) => String(n).padStart(2, '0');

// Top-level AND-ed bounds on `field` (ISO datetimes only); anything under OR/NOT is not a bound.
function bounds(w, field) {
  const leaves = [];
  (function walk(c) { if (c?.and) c.and.forEach(walk); else if (c && !c.or && !c.not) leaves.push(c); })(w);
  let lo = null, hi = null;
  for (const c of leaves) {
    if (c.f?.toLowerCase() !== field.toLowerCase() || c.val?.k !== 'dt' || !/^\d{4}-\d\d-\d\dT/.test(c.val.v)) continue;
    const ms = Date.parse(c.val.v);
    if (c.op === 'gte' || c.op === 'gt') lo = lo === null ? ms : Math.max(lo, ms);
    if (c.op === 'lte' || c.op === 'lt') hi = hi === null ? ms : Math.min(hi, ms);
  }
  return { lo, hi };
}

// Buckets in the user's zone covering [lo, hi]: { start, end (UTC ms), key } with key = what the SOQL row's expr values hold.
function slotsFor(grain, lo, hi, tz) {
  const out = [], push = (s) => { if (out.length >= MAX_SLOTS) no('too many buckets'); out.push(s); };
  const p0 = zoneParts(lo, tz);
  if (grain === 'month') {
    for (let y = p0.year, m = p0.month; ; m++) {
      if (m > 12) { y++; m = 1; }
      const start = wallToUtc(y, m, 1, 0, tz); if (start > hi) break;
      push({ start, end: wallToUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, tz), key: [y, m] });
    }
  } else if (grain === 'day') {
    for (let d = Date.UTC(p0.year, p0.month - 1, p0.day); ; d += 86400000) {
      const a = new Date(d), b = new Date(d + 86400000);
      const start = wallToUtc(a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate(), 0, tz); if (start > hi) break;
      push({ start, end: wallToUtc(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), 0, tz), key: [`${a.getUTCFullYear()}-${pad(a.getUTCMonth() + 1)}-${pad(a.getUTCDate())}`] });
    }
  } else {
    const trunc = (ms) => { const p = zoneParts(ms, tz); return ms - (p.minute * 60 + p.second) * 1000 - (ms % 1000); };
    for (let s = trunc(lo); s <= hi;) {
      const e = trunc(s + 3600000);
      if (e <= s) no('hour stepping');
      // An offset change inside the bucket (a 30-minute DST shift, e.g. Australia/Lord_Howe) leaves it spanning two local hours,
      // so one label would be wrong for part of it. Whole-hour shifts land exactly on a boundary and never trip this: Apex answers.
      if (offsetAt(s, tz) !== offsetAt(e - 1000, tz) || zoneParts(s, tz).hour !== zoneParts(e - 1000, tz).hour) no('offset change inside an hour');
      push({ start: s, end: e, key: [zoneParts(s, tz).hour] });
      s = e;
    }
  }
  return out;
}

function buildSeries(q, ctx) {
  const { select, groupB, group, order, having } = q;
  if (group.length || order.length || having || q.limit !== null) no('series shape');
  const sel = select.filter((s) => s.bucket), aggs = select.filter((s) => s.fn);
  if (sel.length + aggs.length !== select.length || aggs.length !== 1 || aggs[0].fn !== 'COUNT' || aggs[0].arg !== 'Id') no('series select');
  const names = (l) => l.map((b) => b.bucket).sort().join();
  const field = sel[0].field;
  if (names(sel) !== names(groupB) || new Set(sel.map((b) => b.bucket)).size !== sel.length || [...sel, ...groupB].some((b) => b.field.toLowerCase() !== field.toLowerCase())) no('series group');
  const grain = { 'CALENDAR_MONTH,CALENDAR_YEAR': 'month', DAY_ONLY: 'day', HOUR_IN_DAY: 'hour' }[names(sel)] ?? no('series grain');
  if (typeof ctx.timeZone !== 'string' || !q.where) no('series needs a zone and a range');
  const { lo, hi: hi0 } = bounds(q.where, field);
  if (lo === null) no('open-ended range'); // "all time": no first bucket to start from
  const hi = hi0 ?? (ctx.now === undefined ? Date.now() : +ctx.now);
  if (!(lo <= hi)) no('empty range');
  const slots = slotsFor(grain, lo, hi, ctx.timeZone);
  const base = `{${filter(q.where)}}`;
  const bound = (op, ms) => `{${field}:{${op}:{value:${str(iso(ms))}}}}`;
  const docs = slots.map((s, n) => `b${n}:${q.from}(where:{and:[${base},${bound('gte', s.start)},${bound('lt', s.end)}]}){edges{node{aggregate{Id{count{value}}}}}}`);
  // Output columns in SELECT order; unaliased ones are expr0, expr1, ... like the REST API names them.
  let ex = 0;
  const cols = select.map((s) => ({ key: s.alias ?? `expr${ex++}`, part: s.bucket ? (grain === 'month' ? (s.bucket === 'CALENDAR_YEAR' ? 0 : 1) : 0) : null }));
  const queries = [];
  for (let i = 0; i < docs.length; i += PER_DOC) queries.push(`query{uiapi{aggregate{${docs.slice(i, i + PER_DOC).join(' ')}}}}`);
  return {
    queries,
    map: (bodies) => {
      const agg = {};
      for (const body of bodies) {
        if (body?.errors?.length) throw new Error(body.errors.map((e) => e?.message ?? String(e)).join('; '));
        Object.assign(agg, body?.data?.uiapi?.aggregate);
      }
      const sums = new Map(); // SOQL groups equal keys (the same hour on several days; a repeated DST hour)
      slots.forEach((s, n) => {
        const node = agg[`b${n}`]?.edges;
        if (!Array.isArray(node)) throw new Error(`GraphQL returned no aggregate for ${q.from}`);
        const c = Number(node[0]?.node?.aggregate?.Id?.count?.value ?? 0);
        if (!c) return; // SOQL returns no row for an empty group
        const k = s.key.join('|');
        sums.set(k, { key: s.key, c: (sums.get(k)?.c ?? 0) + c });
      });
      const records = [...sums.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map(({ key, c }) => {
        const row = {};
        for (const col of cols) row[col.key] = col.part === null ? c : key[col.part];
        return row;
      });
      return { records, totalSize: records.length, done: true };
    },
  };
}

// ---------- public ----------
export function translate(soql, ctx = {}) {
  try { return build(parse(soql), ctx); } catch { return null; } // unsupported() or a bug: either way Apex is the safe answer
}

function build(q, ctx) {
  if (q.groupB.length || q.select.some((s) => s.bucket)) return buildSeries(q, ctx);
  const { select, group, order, having } = q;
  const aggs = select.filter((s) => s.fn), plain = select.filter((s) => !s.fn);
  if (!aggs.length && !group.length) no('not an aggregate');
  if (q.limit !== null && !group.length) no('limit without group');

  // Plain selected fields must be group keys, and use the GROUP BY spelling (GraphQL names are case-sensitive).
  const gk = new Map(group.map((g) => [g.toLowerCase(), g]));
  if (gk.size !== group.length) no('duplicate group key');
  if (plain.some((s) => !gk.has(s.path.toLowerCase()))) no('field not in GROUP BY');
  if (plain.length && !group.length) no('field without GROUP BY');
  plain.forEach((s) => { s.path = gk.get(s.path.toLowerCase()); });
  const aliases = select.map((s) => s.alias?.toLowerCase()).filter(Boolean);
  if (new Set(aliases).size !== aliases.length) no('duplicate alias');

  // selection tree + where each row value lives, plus its output key
  const tree = {}; let ex = 0;
  const cols = select.map((s) => {
    if (s.fn) {
      const fn = AGG[s.fn]; addSel(tree, s.arg, fn);
      return { key: s.alias ?? `expr${ex++}`, flat: true, at: [s.arg, fn, 'value'], num: true };
    }
    addSel(tree, s.path, null);
    return { key: s.alias ?? s.path, flat: !!s.alias, at: [...s.path.split('.'), 'value'] };
  });

  // HAVING: the predicate's aggregate is read from the same place as a selected one, or added to the selection as a helper
  // that never reaches the output rows (rows are built from `cols` only).
  let hv = null;
  if (having) {
    if (!group.length) no('HAVING without GROUP BY');
    if (order.length) no('HAVING with ORDER BY');
    if (having.fn === 'AVG') no('HAVING AVG');
    if (/.Id$/.test(having.arg)) no('aggregate order on a lookup'); // we must orderBy it, and GraphQL rejects that on references
    const fn = AGG[having.fn];
    addSel(tree, having.arg, fn);
    hv = { at: [having.arg, fn, 'value'], op: having.op, val: having.val };
  }

  const args = [];
  if (q.where) args.push(`where:{${filter(q.where)}}`);
  if (group.length) args.push(`groupBy:{${groupArg(group)}}`);
  // Null aggregates never pass HAVING, but GraphQL sorts them FIRST by default (probed, both directions), so they would fill the
  // page and hide every qualifying group. nulls:LAST puts the groups that can qualify at the front (probed: accepted for MIN/MAX/SUM/COUNT).
  if (having) args.push(`orderBy:{${having.arg}:{function:${having.fn},order:${hv.op === 'lt' || hv.op === 'lte' ? 'ASC' : 'DESC'},nulls:LAST}}`);
  if (order.length > 1) no('multi-key ORDER BY'); // key order inside an input object is not a documented tiebreak
  let sort = null;
  if (order.length) {
    const o = order[0];
    const nulls = o.nulls ?? 'FIRST'; // probed: SOQL puts nulls first for DESC too; GraphQL's default differs
    if (o.fn) {
      if (!group.length) no('order without group');
      if (/.Id$/.test(o.arg)) { // GraphQL rejects `function` on reference fields (probed): fetch every group and sort here
        if (o.fn !== 'COUNT_DISTINCT' && o.fn !== 'COUNT') no('aggregate order on a lookup');
        addSel(tree, o.arg, AGG[o.fn]);
        sort = { at: [o.arg, AGG[o.fn], 'value'], desc: o.dir === 'DESC', limit: q.limit };
      } else args.push(`orderBy:{${o.arg}:{function:${o.fn},order:${o.dir}}}`); // null placement matches SOQL's by default (probed)
    } else {
      if (!gk.has(o.path.toLowerCase())) no('ORDER BY non-group field');
      args.push(`orderBy:{${nest(gk.get(o.path.toLowerCase()), `order:${o.dir},nulls:${nulls}`)}}`);
    }
  }
  const first = group.length ? (sort ? CAP : Math.min(q.limit ?? CAP, CAP)) : null;
  if (first) args.push(`first:${first}`);

  const query = `query{uiapi{aggregate{${q.from}${args.length ? `(${args.join(',')})` : ''}` +
    `{edges{node{aggregate{${printSel(tree)}}}}}}}}`;
  return { query, map: (body) => mapResult(body, q.from, cols, first, hv, sort) };
}

// SOQL HAVING compare. Numbers compare as numbers, ISO dates as instants; a null or unparseable aggregate never passes.
function holds(hv, v) {
  if (v === null || v === undefined) return false;
  const [a, b] = hv.val.t === 'dt' ? [Date.parse(v), Date.parse(hv.val.v)] : [typeof v === 'string' && v.trim() === '' ? NaN : Number(v), Number(hv.val.v)];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return { eq: a === b, ne: a !== b, gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[hv.op];
}

function mapResult(body, object, cols, first, hv, sort) {
  if (body?.errors?.length) throw new Error(body.errors.map((e) => e?.message ?? String(e)).join('; '));
  const conn = body?.data?.uiapi?.aggregate?.[object];
  if (!conn || !Array.isArray(conn.edges)) throw new Error(`GraphQL returned no aggregate for ${object}`);
  let aggs = conn.edges.map((e) => e?.node?.aggregate ?? {});
  if (sort) { // client-side ORDER BY on a lookup aggregate: only right when every group came back
    if (aggs.length >= first) throw Object.assign(new Error('too many groups to order here'), { incomplete: true });
    const val = (a) => Number(sort.at.reduce((x, k) => x?.[k], a)) || 0;
    aggs = aggs.map((a, i) => [a, i]).sort(([a, i], [b, j]) => (sort.desc ? val(b) - val(a) : val(a) - val(b)) || i - j).map(([a]) => a);
    if (sort.limit !== null) aggs = aggs.slice(0, sort.limit);
  }
  const hvOf = (agg) => hv.at.reduce((a, k) => a?.[k], agg);
  if (hv) { // nulls were asked for last; if they came first (or end a full page) the page cannot be trusted to hold every qualifying group
    const isNull = (agg) => hvOf(agg) === null || hvOf(agg) === undefined;
    const firstNull = aggs.findIndex(isNull);
    if (firstNull >= 0 && (aggs.slice(firstNull).some((a) => !isNull(a)) || (first >= CAP && aggs.length >= first))) {
      throw Object.assign(new Error('null aggregates fill the page'), { incomplete: true });
    }
  }
  const kept = hv ? aggs.filter((agg) => holds(hv, hvOf(agg))) : aggs;
  const records = kept.map((agg) => {
    const row = {};
    for (const c of cols) {
      let v = c.at.reduce((a, k) => a?.[k], agg);
      if (v === undefined) v = null;
      if (typeof v === 'string') v = v.replace(ISO_Z, (_, a, ms = '000') => `${a}.${ms.slice(0, 3).padEnd(3, '0')}+0000`); // REST spelling
      if (c.num && typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) v = +v;
      if (c.flat) { row[c.key] = v; continue; }
      const parts = c.key.split('.'); let o = row; // Account.Name -> { Account: { Name } }
      parts.slice(0, -1).forEach((k) => { o = (o[k] ||= {}); });
      o[parts.at(-1)] = v;
    }
    return row;
  });
  // REST marks a result at 2,000 rows as capped; do the same so the page says "top 2,000" in both modes.
  // With HAVING the page is sorted by the aggregate, so more qualifying groups can only follow a full page whose last row
  // has not yet passed the literal (for != anything can follow; for = the rows after a last value >= literal can still match).
  let capped = first >= CAP && aggs.length >= first;
  if (hv && capped) {
    const last = aggs.at(-1);
    capped = hv.op === 'ne' || (hv.op === 'eq' ? holds({ ...hv, op: 'gte' }, hvOf(last)) : holds(hv, hvOf(last)));
  }
  if (capped) Object.defineProperty(records, 'capped', { value: true });
  return { records, totalSize: records.length, done: true };
}

// ---------- plain row queries ----------
// translateRows(soql): SELECT fields FROM Object [WHERE] [ORDER BY one key] [LIMIT] as one UI API query document.
// Same rule as translate(): null for anything not fully understood (aggregates, subqueries, functions, aliases, OFFSET, two sort keys),
// and Apex answers. `field` is the selection without the query{uiapi{query{ wrapper}}} so a caller can alias and batch it.
const ROW_MAX = 2000; // UI API's page size for `first`

export function translateRows(soql) {
  try { return buildRows(parse(soql)); } catch { return null; }
}

function buildRows(q) {
  const { select, order } = q;
  if (q.group.length || q.groupB.length || q.having) no('not a row query');
  if (select.some((s) => !s.path || s.alias)) no('function or alias');
  if (order.length > 1) no('multi-key ORDER BY'); // key order inside an input object is not a documented tiebreak
  if (order[0] && !order[0].path) no('ORDER BY function');

  // Selected paths merge into one tree (a shared relationship prefix prints once; repeating the key is a GraphQL error).
  // Keys match case-insensitively but print as spelled; a path that is both a leaf and a prefix is refused.
  const tree = new Map();
  for (const { path } of select) {
    let level = tree;
    const parts = path.split('.');
    parts.forEach((name, i) => {
      const key = name.toLowerCase(), last = i === parts.length - 1;
      let n = level.get(key);
      if (!n) level.set(key, n = { name, kids: last ? null : new Map() });
      else if (last || !n.kids) no('duplicate path');
      level = n.kids;
    });
  }
  const print = (level) => [...level.values()].map((n) => n.kids ? `${n.name}{${print(n.kids)}}` : n.name === 'Id' ? 'Id' : `${n.name}{value}`).join(' ');

  const args = [];
  if (q.where) args.push(`where:{${filter(q.where)}}`);
  if (order.length) args.push(`orderBy:{${nest(order[0].path, `order:${order[0].dir},nulls:${order[0].nulls ?? 'FIRST'}`)}}`); // nulls first, as SOQL has it
  const first = Math.min(q.limit ?? ROW_MAX, ROW_MAX);
  args.push(`first:${first}`);
  const field = `${q.from}(${args.join(',')}){edges{node{${print(tree)}}} pageInfo{hasNextPage}}`;

  const unwrap = (v) => {
    if (v && typeof v === 'object' && 'value' in v) v = v.value;
    if (v === undefined) return null;
    return typeof v === 'string' ? v.replace(ISO_Z, (_, a, ms = '000') => `${a}.${ms.slice(0, 3).padEnd(3, '0')}+0000`) : v; // REST spelling
  };
  const read = (node, level) => {
    const out = {};
    for (const n of level.values()) {
      const v = node?.[n.name];
      out[n.name] = n.kids ? (v == null ? null : read(v, n.kids)) : unwrap(v);
    }
    return out;
  };
  // Every field path the query selects, filters or sorts on (a semi-join's own fields excluded), as written.
  const paths = new Set(select.map((s) => s.path));
  (function walk(c) { if (!c) return; if (c.and || c.or) (c.and || c.or).forEach(walk); else if (c.not) walk(c.not); else paths.add(c.f); })(q.where);
  if (order[0]) paths.add(order[0].path);
  return {
    query: `query{uiapi{query{${field}}}}`, object: q.from, field, paths: [...paths],
    map: (body) => {
      if (body?.errors?.length) throw new Error(body.errors.map((e) => e?.message ?? String(e)).join('; '));
      const conn = body?.data?.uiapi?.query?.[q.from];
      if (!conn || !Array.isArray(conn.edges)) throw new Error(`GraphQL returned no rows for ${q.from}`);
      const records = conn.edges.map((e) => ({ attributes: { type: q.from }, ...read(e?.node, tree) }));
      return { records, totalSize: records.length, done: q.limit !== null && q.limit <= ROW_MAX ? true : !conn.pageInfo?.hasNextPage };
    },
  };
}

// Describes as one objectInfos (at most 20 names). → { query, split(body) → per name: { name, createable, fields: [{ name,
// relationshipName, referenceTo }] } (the REST describe's shape), or null when objectInfos has no info for it }. The same
// rules as objectInfos() in tools/graphql-batch.js, which the live-artifact bundler can't import from here.
export function describeDoc(names) {
  const query = `query{uiapi{objectInfos(apiNames:${JSON.stringify(names)}){ApiName createable fields{ApiName relationshipName referenceToInfos{ApiName}}}}}`;
  const split = (body) => {
    const infos = body?.data?.uiapi?.objectInfos, errors = Array.isArray(body?.errors) ? body.errors : [];
    if (!Array.isArray(infos) || infos.length !== names.length) throw new Error('objectInfos came back without an answer per object');
    return names.map((name, i) => {
      const o = infos[i];
      if (o && o.ApiName === name && Array.isArray(o.fields)) {
        return { name, createable: !!o.createable, fields: o.fields.map((f) => ({ name: f.ApiName, relationshipName: f.relationshipName ?? null, referenceTo: (f.referenceToInfos || []).map((r) => r.ApiName) })) };
      }
      const e = errors.find((x) => Array.isArray(x?.path ?? x?.paths) && (x.path ?? x.paths).at(-1) === i);
      if (o === null && e && /No ObjectInfo/i.test(e.message || '')) return null;
      throw new Error(`objectInfos gave no answer for ${name}`);
    });
  };
  return { query, split };
}
