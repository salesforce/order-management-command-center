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
// What the dev-only browser scripts and the UI tests share: Playwright found at run time (it isn't a dependency), a local
// server on a free port, the page-side set-up that makes a ?demo=1 page repeatable, and a paused clock to step through.
// Playwright is PLAYWRIGHT=<path to playwright-core's index.mjs> or whatever `playwright-core` resolves to; Chrome is the
// installed one (channel 'chrome'). Nothing here is imported by app/public.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveBrowserCoverage } from "./browser-coverage.mjs";

// The page's "now": fixed, and paused until a step runs the clock.
export const T0 = Date.parse('2026-10-27T12:00:00Z');
export const WIDE = { width: 1440, height: 900 };
export const NARROW = { width: 1024, height: 768 };

// Playwright's module, or null when it isn't there. Any other failure (a broken install) is thrown, not hidden as "absent".
// REQUIRE_UI=1 (a CI build) makes "absent" an error too, so a build with no browser fails instead of skipping the UI tests green.
export const loadPlaywright = async () => {
  try { return await import(process.env.PLAYWRIGHT || 'playwright-core'); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') {
      if (process.env.REQUIRE_UI) throw new Error('browser-kit: REQUIRE_UI is set but Playwright is missing (PLAYWRIGHT=<path to playwright-core/index.mjs>)', { cause: e });
      return null;
    }
    throw e;
  }
};
// Headless by default. `headed: true` (or HEADED=1) opens a visible window to watch; SLOWMO=<ms> pauses between its actions
// (150 when headed). Headless runs without the GPU, which keeps headless Chrome on macOS from dying; a window uses it.
// Playwright's own Chromium is used when it is installed (node <playwright-core>/cli.js install chromium), else the installed
// Chrome. A Chrome that a company manages can disable DevTools by policy and then drops every automated page after about
// five seconds, so BROWSER=chrome picks Chrome only when you know yours isn't one.
export async function launchChrome(pw, { headed = !!process.env.HEADED, args = [] } = {}) {
  const o = { headless: !headed, slowMo: headed ? Number(process.env.SLOWMO ?? 150) : 0, args: [...(headed ? [] : ['--disable-gpu']), ...args] };
  // CHROME_PATH=<browser binary> for a machine that has one installed but not where Playwright looks (a CI image); CHROME_NO_SANDBOX=1
  // for a container that runs as root, where Chrome refuses to start with its sandbox.
  if (process.env.CHROME_NO_SANDBOX) o.args.push('--no-sandbox');
  if (process.env.CHROME_PATH) return pw.chromium.launch({ ...o, executablePath: process.env.CHROME_PATH });
  if (process.env.BROWSER !== 'chrome') { try { return await pw.chromium.launch(o); } catch { /* not installed: use Chrome */ } }
  return pw.chromium.launch({ ...o, channel: 'chrome' });
}

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
// Starts <dir>/app/server.mjs on a free port and resolves when it answers.
export async function serve(dir) {
  const port = await freePort(), child = spawn(process.execPath, [path.join(dir, 'app', 'server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/?demo=1`)).ok) return { url: `http://localhost:${port}`, stop: () => child.kill() }; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  child.kill(); throw new Error(`browser-kit: the server in ${dir} didn't start`);
}

// Runs in every page before its own scripts: a seeded Math.random (the sample data draws from it), an optional saved theme,
// and no animations or transitions.
export const INIT = (theme) => `(() => {
  let s = 0x2f6e2b1; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  ${theme ? `try { localStorage.setItem('omc.theme', ${JSON.stringify(theme)}); } catch {}` : ''}
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(st); });
})();`;

// A fresh context set up the same way every time: fixed locale, zone and size, fonts blocked, INIT first.
// A recording has no pointer, so `record` (and HEADED) adds a dot that follows the mouse.
const POINTER = `document.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:2147483647;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:rgba(220,40,40,.65);border:2px solid #fff;pointer-events:none;left:-20px;top:-20px'; document.documentElement.appendChild(d); document.addEventListener('mousemove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true); });`;
export async function newContext(browser, { viewport = WIDE, theme, reducedMotion = 'reduce', record } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC', reducedMotion, colorScheme: 'light', deviceScaleFactor: 1, ...(record ? { recordVideo: { dir: record, size: viewport } } : {}) });
  if (record || process.env.HEADED) { await ctx.addInitScript(POINTER); }
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(INIT(theme));
  return ctx;
}

// Lets the page run for a while on its paused clock, and the browser paint.
export const settle = async (p, n = 2) => { for (let i = 0; i < n; i++) { await p.clock.runFor(600); await p.waitForTimeout(80); } };
// Waits (in real time) until a selector matches.
export async function until(p, sel, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await p.evaluate((q) => !!document.querySelector(q), sel)) { return true; } await new Promise((r) => setTimeout(r, 60)); } return false; }
// Installs the paused clock and opens an address on it.
export async function openOn(p, url) { await p.clock.install({ time: T0 }); await p.clock.pauseAt(T0 + 1000); await p.goto(url, { waitUntil: 'load' }); }

// ---------- UI tests ----------
// What every UI test under app/test shares, at any folder depth, so a setting changed here changes it for all of them. A test opens a session, drives
// `page`, and closes it in a `finally`; it never launches a browser, starts a server or records a video itself.
//   HEADLESS=1      no visible window (the default is a window you can watch)
//   SLOWMO=<ms>     pause between actions when there is a window (150)
//   RECORD=<dir>    where videos go (app/artifact/ui-test-videos); RECORD=0 records nothing
//   BASE_URL=<url>  test the app already running there instead of starting one
//   BROWSER=chrome  the installed Chrome instead of Playwright's Chromium
//   PLAYWRIGHT=<path to playwright-core/index.mjs>
//   REQUIRE_UI=1    a missing Playwright is an error, not a skip (for CI); CHROME_PATH / CHROME_NO_SANDBOX: see launchChrome
//   UI_COVERAGE_DIR=<dir>    collect Chromium execution data for app/tools/browser-coverage.mjs (CI only)
const REPO = path.dirname(fileURLToPath(APP_URL));
export const UI = {
  headed: !process.env.HEADLESS,
  baseUrl: process.env.BASE_URL?.replace(/\/$/, '') || null,
  videos: process.env.RECORD === '0' ? null : path.resolve(process.env.RECORD || path.join(REPO, 'app', 'artifact', 'ui-test-videos')),
  pause: 600, // ms between steps, so a video can be followed
  skip: (pw) => (pw ? false : 'Playwright is needed (PLAYWRIGHT=<path to playwright-core/index.mjs>)'),
};

async function closeSession({ browser, ctx, page, server, name, covering, coverageDir }) {
  let coverageError;
  if (covering) {
    try { saveBrowserCoverage(coverageDir, server.url, await page.coverage.stopJSCoverage()); }
    catch (e) { coverageError = e; }
  }
  const video = page?.video();
  await ctx?.close().catch(() => {});
  if (UI.videos && video) await video.saveAs(path.join(UI.videos, `${name}.webm`)).then(() => video.delete()).catch((e) => console.error('no video:', e.message));
  await browser?.close().catch(() => {});
  server.stop();
  if (coverageError) throw coverageError;
}

// A page open on the app, ready for a test. `name` names the video (<name>.webm). `problems` collects what a demo page must never
// do: throw, call /api/, or send anything but a GET. `step(fn)` runs an action and pauses; `close()` stops everything, and each
// part on its own, so a browser that failed to start or has gone doesn't leave the server running.
export async function openSession(pw, name, { path: start = '/?demo=1', viewport, theme, time, setup } = {}) {
  const server = UI.baseUrl ? { url: UI.baseUrl, stop() {} } : await serve(REPO);
  let browser, ctx, page, covering = false;
  const problems = [];
  const coverageDir = process.env.UI_COVERAGE_DIR;
  const close = async () => {
    const stoppedCoverage = covering; covering = false;
    await closeSession({ browser, ctx, page, server, name, covering: stoppedCoverage, coverageDir });
  };
  try {
    if (UI.videos) mkdirSync(UI.videos, { recursive: true });
    browser = await launchChrome(pw, { headed: UI.headed });
    ctx = await newContext(browser, { viewport, theme, record: UI.videos || undefined });
    page = await ctx.newPage();
    if (coverageDir) { await page.coverage.startJSCoverage({ resetOnNavigation: false }); covering = true; }
    // Date stays fixed while timers run normally (Dashboard calendar periods and recorded actions).
    if (time != null) await page.clock.setFixedTime(time);
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') || r.method() !== 'GET') problems.push(`${r.method()} ${u.pathname}`); });
    // Optional test fixtures and a controlled clock are installed before any application script runs.
    if (setup) await setup(page);
    await page.goto(server.url + start);
  } catch (e) {
    try { await close(); }
    catch (cleanupError) { console.error('browser-kit: cleanup after setup failure:', cleanupError); }
    throw e;
  }
  const step = async (fn) => { await fn(); await page.waitForTimeout(UI.pause); };
  return { page, url: server.url, problems, step, close };
}
