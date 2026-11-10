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
import { APP_URL } from "../../public/source-layout.js";
// A regression check for restructuring the Salesforce Order Management Operations Console's page: the same scenarios (?demo=1, so no org) run against a base commit
// and against this working tree, in the same Chrome, and what each leaves on screen is compared. For every element that is its
// tag, attributes and text, whether it has focus, and a hash of its computed style and box (so a CSS rule that moved, lost its
// order or its cascade shows up as a changed hash even when the markup is the same). A scenario passes when the two are equal.
//
// Nothing is recorded in the repo: layout depends on the machine's fonts, so the base is exported from git and run alongside.
// Usage (from the repo root; it starts its own servers on free ports):
//   node app/tools/golden.mjs [--base-ref <rev>] [--only <text>] [--out <dir>] [--list]     compare this tree with the base
//   node app/tools/golden.mjs --self                                                       the tree against itself: the check is stable
//   node app/tools/golden.mjs --perf [--runs 5]                                            boot cost of the base and this tree
// --base-ref defaults to the merge base of HEAD and origin/main. Needs Playwright (PLAYWRIGHT=<path to playwright-core's
// index.mjs> if Node doesn't find it) and Chrome; nothing is added to the repo's dependencies. Dev-only: CI doesn't run it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NARROW, WIDE, launchChrome, loadPlaywright, newContext, openOn, serve, settle, until } from "./browser-kit.mjs";
import { pixelDifference } from './pixel-diff.mjs';
const ROOT = path.dirname(fileURLToPath(APP_URL));
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });

// ---------- scenarios ----------
// Each is a fresh page load of one address, then steps that use the page the way a person does. A step that can't find its
// control is recorded in the snapshot (the same on both sides if the controls are the same), and listed at the end.
const click = async (p, sel, i = 0) => { await p.locator(sel).nth(i).click({ force: true, timeout: 2500 }); await settle(p); };
const press = async (p, key) => { await p.keyboard.press(key); await settle(p); };
const type = async (p, sel, text) => { await p.locator(sel).fill(text, { force: true, timeout: 2500 }); await settle(p, 3); };
const DOMAINS = ['orders', 'customers', 'fulfillment', 'payments', 'service', 'returns', 'products', 'policies'];
const demo = (hash = '') => `/?demo=1${hash}`;
const SCENARIOS = [];
const add = (name, url, steps = async () => {}, o = {}) => SCENARIOS.push({ name, url, steps, viewport: WIDE, ready: '#app:not(.hide)', ...o });

add('console.initial', demo());
for (const r of ['today', '7d', '30d', '90d', '6m']) add(`console.range.${r}`, demo(), (p) => click(p, `#range button[data-v="${r}"]`));
for (let i = 0; i < 6; i++) add(`console.layer.${i}`, demo(), (p) => click(p, '#layers button', i));
add('console.flows-off', demo(), (p) => click(p, '#flowsOn'));
add('console.state', demo(), (p) => click(p, '#map [data-state]'));
add('console.node', demo(), (p) => click(p, '#map [data-node]'));
add('console.zoom', demo(), async (p) => { await click(p, '#zoom [data-z="in"]'); await click(p, '#zoom [data-z="in"]'); });
for (let i = 0; i < 5; i++) add(`console.exceptions.tab${i}`, demo(), (p) => click(p, '#exTabs button', i));
for (let i = 0; i < 5; i++) add(`console.stream.tab${i}`, demo(), (p) => click(p, '#stTabs button', i));
add('console.exception-drawer', demo(), (p) => click(p, '#exList .item[data-id]'));
add('console.stream-drawer', demo(), (p) => click(p, '#stream [data-id]'));
add('console.narrow', demo(), async () => {}, { viewport: NARROW });
add('console.agent', demo(), (p) => click(p, '#agentBtn'));
add('console.keys', demo(), async (p) => { await press(p, 'ArrowDown'); await press(p, 'Space'); await press(p, 'Space'); });
for (const d of DOMAINS) {
  for (const per of ['mtd', 'ytd']) add(`dash.${d}.${per}`, demo(`#dashboard/${d}`), (p) => click(p, `#period button[data-v="${per}"]`));
  add(`dash.${d}.narrow`, demo(`#dashboard/${d}`), async () => {}, { viewport: NARROW });
}
add('dash.data-map', demo('#dashboard/orders'), (p) => click(p, '#dataMapBtn'));
add('dash.tab-click', demo('#dashboard/orders'), (p) => click(p, '#dTabs button', 3));
add('service.initial', demo('#service'));
for (let i = 0; i < 3; i++) add(`service.queue.tab${i}`, demo('#service'), (p) => click(p, '#qTabs button', i));
add('service.row', demo('#service'), (p) => click(p, '#queue [data-q]'));
add('service.search', demo('#service'), (p) => type(p, '#svcSearch', 'avery'));
add('service.customer', demo('#service'), async (p) => { await type(p, '#svcSearch', 'avery'); await click(p, '#svcResults [data-hit]'); });
add('limits.initial', demo('#limits'));
add('limits.window', demo('#limits'), async (p) => { await p.locator('#lWin').selectOption({ index: 0 }, { force: true }); await settle(p); });
add('limits.reference', demo('#limits'), (p) => click(p, '#lRef summary'));
add('limits.run', demo('#limits'), (p) => settle(p, 6));
for (const t of ['slds-light', 'slds-dark']) {
  add(`theme.${t}.console`, demo(), async () => {}, { theme: t });
  add(`theme.${t}.dash`, demo('#dashboard/orders'), async () => {}, { theme: t });
  add(`theme.${t}.drawer`, demo(), (p) => click(p, '#exList .item[data-id]'), { theme: t });
}
add('gate.browser', '/?auth=browser', async () => {}, { ready: '#gate:not(.hide)' });
add('gate.theme-menu', '/?auth=browser', (p) => click(p, '#gateTheme .theme-btn'), { ready: '#gate:not(.hide)' });
add('topbar.theme-menu', demo(), (p) => click(p, '#theme .theme-btn'));
add('route.service-hash', demo('#service'), (p) => click(p, '#mode button[data-m="dashboard"]'));
add('route.mode-cycle', demo(), async (p) => { for (const m of ['dashboard', 'service', 'limits', 'console']) await click(p, `#mode button[data-m="${m}"]`); });

// ---------- what a page looks like to the check ----------
// Runs in the page. One line per element and per text run: the element's tag and attributes (sorted; long values hashed), a mark
// where focus is, and `#s=` a hash of its computed style and box. `keys` are a few readable properties for explaining a diff.
const snapshot = (full) => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);
  const KEYS = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'margin', 'padding', 'border', 'width', 'height', 'opacity', 'visibility', 'grid-template-columns'];
  const h = (s) => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); } a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36); };
  const lines = [], keys = [], styles = [];
  const walk = (node, depth) => {
    const pad = '  '.repeat(depth);
    if (node.nodeType === 3) { const t = node.textContent.replace(/\s+/g, ' ').trim(); if (t) lines.push(`${pad}"${t}"`); return; }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
    const cs = getComputedStyle(node), r = node.getBoundingClientRect();
    // Chrome lists custom properties in an order that changes between loads, so the names are sorted.
    let sty = '';
    for (const n of [...cs].sort()) sty += `${n}:${cs.getPropertyValue(n)};`;
    sty += `|${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}|${node.scrollTop},${node.scrollLeft}`;
    if (full) styles.push(sty);
    const attrs = [...node.attributes].sort((x, y) => (x.name < y.name ? -1 : 1)).map((a) => ` ${a.name}="${a.value.length > 100 ? `#${h(a.value)}` : a.value}"`).join('');
    const val = node.matches('input,select,textarea') ? ` value=${JSON.stringify(node.value)}${node.checked ? ' checked' : ''}` : '';
    lines.push(`${pad}<${node.tagName.toLowerCase()}${attrs}${val}>${node === document.activeElement ? ' @focus' : ''} #s=${h(sty)}`);
    keys.push(KEYS.map((k) => `${k}:${cs.getPropertyValue(k)}`).join('; ') + ` | box ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
    for (const c of node.childNodes) walk(c, depth + 1);
  };
  const head = `# ${document.title} | ${location.pathname}${location.search}${location.hash} | ${document.documentElement.className} data-theme=${document.documentElement.dataset.theme || ''} | ${innerWidth}×${innerHeight}`;
  walk(document.body, 0);
  return { head, lines, keys, styles };
};

// ---------- running ----------
function exportBase(ref, into) {
  const arc = spawnSync('git', ['archive', ref, 'app'], { cwd: ROOT, maxBuffer: 1 << 30 });
  if (arc.status) throw new Error(`golden: git archive ${ref}: ${arc.stderr}`);
  const tar = spawnSync('tar', ['-x', '-C', into], { input: arc.stdout });
  if (tar.status) throw new Error('golden: tar failed');
}
async function runScenario(browser, base, sc, opt) {
  const ctx = await newContext(browser, { viewport: sc.viewport, theme: sc.theme });
  const events = [];
  try {
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') events.push(`console.error: ${m.text()}`); });
    p.on('pageerror', (e) => events.push(`pageerror: ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) events.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await openOn(p, base + sc.url);
    // Let asynchronous panels and their timers finish on the controlled clock before checking readiness.
    await settle(p, 4);
    const ready = await until(p, sc.ready);
    if (!ready) throw new Error(`golden: ${sc.name} never became ready (${sc.ready})`);
    let failed = null;
    try { await sc.steps(p); } catch (e) { failed = String(e.message).split('\n')[0]; }
    // SMIL motion uses the SVG document clock, which Playwright's JS clock and CSS animation control do not pause.
    // Compare the same animation phase on both revisions; keep the animated elements, paths and styles in the snapshot.
    await p.evaluate(() => { for (const svg of document.querySelectorAll('svg')) { svg.pauseAnimations(); svg.setCurrentTime(0); } });
    // Keyboard scrolling can leave a native compositor animation running after the JS clock is paused.
    // Finish the same scroll on both revisions before comparing rasterized SVG edges.
    await p.evaluate(() => { window.scrollTo({ left: Math.round(window.scrollX), top: Math.round(window.scrollY), behavior: 'instant' }); });
    await p.clock.runFor(32); // flush pending animation-frame paints after pausing the SVG document clock
    await p.waitForTimeout(120);
    const snap = await p.evaluate(snapshot, !!opt.props);
    const image = opt.pixels ? await p.screenshot({ animations: 'disabled', caret: 'hide' }) : null;
    return { ...snap, events: events.sort(), failed, image };
  } finally { await ctx.close(); }
}
// Up to two 8-bit channel steps at anti-aliased edges are browser raster rounding. No pixel may differ beyond that.
// DOM/box/computed-style equality and the immutable source hashes independently catch layout and token edits.
const samePixels = (a, b) => !a.image || !b.image || pixelDifference(a.image, b.image).equal;
const same = (a, b) => a.head === b.head && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]) && a.events.join() === b.events.join() && samePixels(a, b);

function explain(name, a, b, out, opt) {
  if (!samePixels(a, b)) {
    writeFileSync(path.join(out, `${name}.base.png`), a.image);
    writeFileSync(path.join(out, `${name}.new.png`), b.image);
    console.log('  screenshot differs; both images saved for review');
  }
  const fa = path.join(out, `${name}.base.txt`), fb = path.join(out, `${name}.new.txt`);
  const dump = (s) => [s.head, ...s.events.map((e) => `! ${e}`), ...s.lines].join('\n') + '\n';
  writeFileSync(fa, dump(a)); writeFileSync(fb, dump(b));
  const d = spawnSync('diff', ['-u', '--label', 'base', '--label', 'new', fa, fb], { encoding: 'utf8' }).stdout.split('\n');
  console.log(d.slice(0, 40).join('\n') + (d.length > 40 ? `\n… ${d.length - 40} more diff lines in ${fb}` : ''));
  if (opt.props && a.styles.length === b.styles.length) {
    let shown = 0;
    a.styles.forEach((x, i) => {
      if (x === b.styles[i] || shown >= 4) return; shown++;
      const pa = Object.fromEntries(x.split(';').map((t) => t.split(/:(.*)/s).slice(0, 2))), pb = Object.fromEntries(b.styles[i].split(';').map((t) => t.split(/:(.*)/s).slice(0, 2)));
      let k = 0; while (x[k] === b.styles[i][k]) k++;
      console.log(`  first difference in element #${i} at ${k}: ${x.slice(Math.max(0, k - 60), k + 80)}  →  ${b.styles[i].slice(Math.max(0, k - 60), k + 80)}`);
      console.log(`  props of element #${i}: ` + Object.keys({ ...pa, ...pb }).filter((k) => pa[k] !== pb[k]).map((k) => `${k}: ${pa[k]} → ${pb[k]}`).join(' | ').slice(0, 400));
    });
  }
  // A line that differs only in #s= is a style or layout change: show the readable properties of both.
  if (a.lines.length === b.lines.length) {
    let k = 0, shown = 0;
    a.lines.forEach((l, i) => {
      const isEl = l.includes(' #s='); if (!isEl) return;
      const ki = k++;
      if (shown < 6 && l !== b.lines[i] && l.replace(/ #s=\S+$/, '') === b.lines[i].replace(/ #s=\S+$/, '')) { shown++; console.log(`  style/box of ${l.trim().slice(0, 90)}\n    base: ${a.keys[ki]}\n    new:  ${b.keys[ki]}`); }
    });
  }
}

async function compare(pw, opt) {
  const ref = opt['base-ref'] || (opt.self ? 'HEAD' : git('merge-base', 'HEAD', 'origin/main').stdout.trim());
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'golden-')), out = opt.out || path.join(tmp, 'diffs');
  mkdirSync(out, { recursive: true });
  const servers = [], todo = SCENARIOS.filter((s) => !opt.only || s.name.includes(opt.only));
  try {
    let baseUrl;
    if (opt.self) { const s = await serve(ROOT); servers.push(s); baseUrl = s.url; } else { exportBase(ref, tmp); const s = await serve(tmp); servers.push(s); baseUrl = s.url; }
    const cur = await serve(ROOT); servers.push(cur);
    // Headless Chrome on macOS dies now and then (a display-link error), so each scenario retries once on a fresh browser.
    let browser = null, n = 0;
    const launch = async () => { await browser?.close().catch(() => {}); browser = await launchChrome(pw, { args: ['--disable-smooth-scrolling', '--deterministic-mode', '--disable-partial-raster'] }); n = 0; };
    const run = async (url, sc) => {
      for (let attempt = 0; ; attempt++) {
        try { if (!browser || n++ >= 20) await launch(); return await runScenario(browser, url, sc, opt); } catch (e) { if (attempt) throw e; await browser?.close().catch(() => {}); browser = null; }
      }
    };
    console.log(`golden: ${todo.length} scenarios, ${opt.self ? 'this tree twice' : `${ref.slice(0, 9)} (base) against this tree`}`);
    let bad = 0; const brokenSteps = [];
    for (const sc of todo) {
      const a = await run(baseUrl, sc), b = await run(cur.url, sc);
      if (b.failed || a.failed) brokenSteps.push(`${sc.name}: ${a.failed ? `base: ${a.failed}` : ''}${b.failed ? ` new: ${b.failed}` : ''}`.trim());
      if (same(a, b) && !a.failed === !b.failed) { console.log(`  ok    ${sc.name}  (${a.keys.length} elements)`); continue; }
      bad++; console.log(`  DIFF  ${sc.name}`); explain(sc.name, a, b, out, opt);
    }
    await browser?.close().catch(() => {});
    if (brokenSteps.length) console.log(`\ngolden: ${brokenSteps.length} scenario step(s) found no control (equal on both sides is fine, but check they should):\n  ${brokenSteps.join('\n  ')}`);
    console.log(bad ? `\ngolden: ${bad} of ${todo.length} scenarios differ (diffs in ${out})` : `\ngolden: all ${todo.length} scenarios identical`);
    return bad ? 1 : 0;
  } finally { servers.forEach((s) => s.stop()); if (!opt.keep) rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- boot cost ----------
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function perf(pw, opt) {
  const ref = opt['base-ref'] || git('merge-base', 'HEAD', 'origin/main').stdout.trim(), runs = Number(opt.runs) || 5;
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'golden-')), servers = [];
  try {
    exportBase(ref, tmp); const b = await serve(tmp), c = await serve(ROOT); servers.push(b, c);
    let browser = await launchChrome(pw);
    const pages = [['console', demo()], ['dashboard', demo('#dashboard/orders')], ['limits', demo('#limits')]].filter(([n]) => !opt.only || n.includes(opt.only));
    const measure = async (base, url) => {
      for (let attempt = 0; ; attempt++) {
        try { return await measureOnce(base, url); } catch (e) {
          if (attempt >= 2) throw e; if (process.env.GOLDEN_DEBUG) console.error('perf retry:', e.message.split('\n')[0]);
          await browser.close().catch(() => {}); browser = await launchChrome(pw);
        }
      }
    };
    const measureOnce = async (base, url) => {
      const ctx = await browser.newContext({ viewport: WIDE, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
      try {
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        await ctx.addInitScript(`window.__lt = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: 'longtask', buffered: true });`);
        const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
        await cdp.send('Performance.enable');
        if (process.env.GOLDEN_DEBUG) { p.on('crash', () => console.error('page crash')); p.on('close', () => console.error('page close', base, url)); }
        const t0 = Date.now(); await p.goto(base + url, { waitUntil: 'load' });
        if (!await until(p, '#app:not(.hide):not(.loading) #kpis > *, #app:not(.hide):not(.loading) #dTiles > *, #app:not(.hide):not(.loading) .lim:not(.hide) .lhead', 15000)) throw new Error('golden --perf: page never became ready');
        const ready = Date.now() - t0; await p.waitForTimeout(800);
        const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
        const res = await p.evaluate(() => { const r = performance.getEntriesByType('resource'); return { n: r.length + 1, kb: r.reduce((s, x) => s + (x.encodedBodySize || 0), 0) / 1024, js: r.filter((x) => /\.js(\?|$)/.test(x.name)).length, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0, lt: window.__lt }; });
        return { ready, script: m.ScriptDuration * 1000, style: m.RecalcStyleDuration * 1000, layout: m.LayoutDuration * 1000, heap: m.JSHeapUsedSize / 1048576, ...res };
      } finally { await ctx.close(); }
    };
    const rows = [];
    for (const [name, url] of pages) {
      const samples = { base: [], new: [] }, builds = [['base', b.url], ['new', c.url]];
      // Alternate the order of each cold-load pair so warmup and machine load do not favor one revision.
      for (let i = 0; i < runs; i++) for (const [label, base] of i % 2 ? [...builds].reverse() : builds) samples[label].push(await measure(base, url));
      for (const [label] of builds) {
        const col = (k) => median(samples[label].map((x) => x[k]));
        rows.push([name, label, ...['n', 'js', 'kb', 'fcp', 'ready', 'script', 'style', 'layout', 'lt', 'heap'].map((k) => col(k).toFixed(k === 'n' || k === 'js' ? 0 : 1))]);
      }
    }
    await browser.close();
    const head = ['page', 'build', 'requests', 'js files', 'KB', 'FCP ms', 'ready ms', 'script ms', 'style ms', 'layout ms', 'long task ms', 'heap MB'];
    console.log(`golden --perf: median of ${runs} cold loads of ${ref.slice(0, 9)} (base) and this tree, demo data, no web fonts\n`);
    console.log([head, ...rows].map((r) => r.map((x, i) => String(x).padEnd(i < 2 ? 10 : 13)).join('')).join('\n'));
  } finally { servers.forEach((s) => s.stop()); rmSync(tmp, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  const { values: opt } = parseArgs({ args, options: {
    'base-ref': { type: 'string' }, only: { type: 'string' }, out: { type: 'string' }, list: { type: 'boolean' }, self: { type: 'boolean' },
    perf: { type: 'boolean' }, props: { type: 'boolean' }, pixels: { type: 'boolean' }, runs: { type: 'string', default: '5' }, keep: { type: 'boolean' },
  } });
  if (opt.list) { SCENARIOS.forEach((s) => console.log(s.name)); process.exit(0); }
  const pw = await loadPlaywright();
  if (!pw) { console.error('golden: Playwright is needed (PLAYWRIGHT=<path to playwright-core/index.mjs>)'); process.exit(2); }
  if (opt.perf) await perf(pw, opt); else process.exitCode = await compare(pw, opt);
  process.exit(process.exitCode || 0); // Chrome's pipes can keep the process alive after everything is closed
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
