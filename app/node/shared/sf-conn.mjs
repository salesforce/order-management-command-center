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
// sf CLI connection shared by server.mjs and the plugin's command-line tool. Auth comes from `sf` for one alias;
// the global default org is never read or set. The token comes from `org auth show-access-token` (`org display` redacts it).
import { execFile } from 'node:child_process';
import { isBlocked, blockedRefusal, tooSlow, isTooSlow, readInit, readBody, writeInit, slowWrite, writeAnswer } from '../../public/shared/transport/om-http.js';
import { CONFIG } from '../../public/shared/transport/om-config.js';

function stripAnsiColors(output) {
  const escape = String.fromCharCode(27);
  return output.split(escape).map((part, index) => {
    if (!index) return part;
    const color = part.match(/^\[[0-9;]*m/);
    return color ? part.slice(color[0].length) : escape + part;
  }).join('');
}

/**
 * Run an `sf` command and parse its JSON.
 * @param {string[]} args Arguments; `--json` is added.
 * @returns {Promise<object>} The parsed output, or `{ status: 1, message }` when sf is missing or printed no JSON. Never rejects.
 */
export function sfCli(args) {
  return new Promise((resolve) => {
    // FORCE_COLOR in the parent env makes sf colorize its --json output; turn color off and strip any ANSI that slips through.
    const env = { ...process.env, SF_AUTOUPDATE_DISABLE: 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    execFile('sf', [...args, '--json'], { maxBuffer: 10 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return resolve({ status: 1, name: 'SfNotFound', message: 'The sf CLI is not installed or not on PATH. Install it from https://developer.salesforce.com/tools/salesforcecli' });
      try { resolve(JSON.parse(stripAnsiColors(stdout))); } catch { resolve({ status: 1, message: err?.message || (stderr || stdout || 'no output').trim().slice(0, 500) }); }
    });
  });
}

// OM_BLOCKED: more orgs to refuse, on top of CONFIG.blocked. Comma-separated regular expressions (no commas inside one),
// matched case-insensitively like CONFIG.blocked. A pattern that isn't a valid regular expression throws, so a typo can't
// quietly refuse nothing.
/**
 * The blocked-org patterns from the environment.
 * @param {string} [value] Comma-separated regular expressions (default `OM_BLOCKED`).
 * @returns {RegExp[]} Case-insensitive patterns; throws on an invalid one.
 */
export function envBlocked(value = process.env.OM_BLOCKED) {
  return (value || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    try { return new RegExp(p, 'i'); }
    catch (e) { throw new Error(`OM_BLOCKED: "${p}" is not a valid regular expression (${e.message})`, { cause: e }); }
  });
}

// run(args) → parsed `sf … --json` output; fetchImpl is fetch; onConnect(conn) runs after each fresh sign-in; blocked adds
// to CONFIG.blocked (OM_BLOCKED by default).
/**
 * Make the sf CLI connection shared by the server and the plugin's tool.
 * @param {object} opts
 * @param {string} opts.alias The sf org alias.
 * @param {(args: string[]) => Promise<object>} [opts.run] Runs sf (default `sfCli`).
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(conn: object) => void} [opts.onConnect] Called after each fresh sign-in.
 * @param {number} [opts.timeoutMs] Per-request timeout.
 * @param {RegExp[]} [opts.blocked] Orgs to refuse besides `CONFIG.blocked`.
 * @returns {{sf: Function, getConn: (force?: boolean) => Promise<object|null>, requireConn: () => Promise<object>, api: (path: string, post?: *) => Promise<*>, send: (method: string, path: string, body?: *) => Promise<{status: number, body: object}>, fetchRetry: Function, current: () => object|null, clear: () => void}} `getConn` is null when not logged in; `requireConn` throws a 401 then; `api` is a read; `send` is a write that answers `{ status, body }`; a non-GET is not retried after a network failure (its outcome may be unknown), but any call is retried once after a 401 and a token refresh.
 */
export function createConn({ alias, run = sfCli, fetchImpl = fetch, onConnect = () => {}, timeoutMs, blocked = envBlocked() }) {
  let conn = null; // { accessToken, instanceUrl, username, apiVersion, at }

  async function getConn(force = false) {
    if (!force && conn && Date.now() - conn.at < 10 * 60 * 1000) return conn;
    const r = await run(['org', 'display', '--target-org', alias]);
    if (r.status !== 0 || !r.result?.instanceUrl) {
      conn = null;
      if (r.name === 'NamedOrgNotFoundError') return null; // not logged in yet
      if (r.name === 'SfNotFound') throw Object.assign(new Error(r.message), { code: 503 });
      throw Object.assign(new Error(`sf org display failed: ${r.message || r.name || 'unknown error'}`), { code: 401 });
    }
    const { instanceUrl, username, apiVersion } = r.result;
    if (isBlocked([...CONFIG.blocked, ...blocked], username, instanceUrl)) {
      conn = null;
      throw blockedRefusal(`Alias "${alias}" points at ${username}, an org this deployment refuses to run against. Log in to your OM org instead.`);
    }
    // Recent sf versions redact accessToken in `org display`; fetch it explicitly (this also refreshes an expired token).
    const t = await run(['org', 'auth', 'show-access-token', '--target-org', alias, '--no-prompt']);
    const accessToken = t.result?.accessToken;
    if (t.status !== 0 || !accessToken || accessToken.startsWith('[REDACTED')) {
      conn = null;
      throw Object.assign(new Error(`Could not get an access token for "${alias}": ${t.message || 'sf returned no token'}`), { code: 401 });
    }
    conn = { accessToken, instanceUrl, username, apiVersion: apiVersion || '62.0', at: Date.now() };
    onConnect(conn);
    return conn;
  }

  async function requireConn() {
    const c = await getConn();
    if (!c) throw Object.assign(new Error('Not connected'), { code: 401 });
    return c;
  }

  // Socket-level failures ("fetch failed") happen intermittently when many panels query at once; retry those only.
  async function fetchRetry(url, opts, tries = 3) {
    for (let i = 1; ; i++) {
      try { return await fetchImpl(url, opts); }
      catch (e) {
        if (opts?.signal?.aborted) throw e; // timed out: retrying would only wait longer
        const why = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
        if (i >= tries) throw new Error(e.message + why, { cause: e });
        await new Promise((r) => setTimeout(r, 250 * i));
      }
    }
  }

  // The read-only POST allowlist is enforced in om-core.js before a request reaches here. A 401 asks the sf CLI for a fresh token once.
  async function api(p, post, retry = true) {
    const c = await requireConn();
    const opts = readInit(p, post, { Authorization: `Bearer ${c.accessToken}` }, timeoutMs);
    let res;
    try { res = await fetchRetry(`${c.instanceUrl}/services/data/v${c.apiVersion}${p}`, opts); }
    catch (e) { throw isTooSlow(e) || opts.signal.aborted ? tooSlow() : e; }
    if (res.status === 401 && retry) { await getConn(true); return api(p, post, false); }
    return readBody(res, await res.json().catch(() => ({})));
  }

  // The customer service app's writes (om-actions.js checks every call against its allowlist before it gets here). Answers
  // { status, body } instead of throwing on an HTTP error, because Order Management reports what went wrong in the body.
  // A non-GET write is not retried after a socket error (the first attempt may have gone through); a 401 asks for a fresh token and sends once more.
  async function send(method, p, body, retry = true) {
    const c = await requireConn();
    const opts = writeInit(method, body, { Authorization: `Bearer ${c.accessToken}`, Accept: 'application/json' }, timeoutMs);
    let res;
    try { res = await fetchRetry(`${c.instanceUrl}/services/data/v${c.apiVersion}${p}`, opts, method === 'GET' ? 3 : 1); }
    catch (e) { throw isTooSlow(e) || opts.signal.aborted ? slowWrite() : e; }
    if (res.status === 401 && retry) { await getConn(true); return send(method, p, body, false); }
    return writeAnswer(res);
  }

  return { sf: run, getConn, requireConn, api, send, fetchRetry, current: () => conn, clear: () => { conn = null; } };
}
