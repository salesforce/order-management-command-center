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
// The transport rules every sign-in path shares (sf-conn.mjs for the local server, om-browser.js, om-platform.js and the
// Cowork artifact): the blocked-org guard, timeouts and how a slow or failed answer reads, the read-only POST check createCore()
// (om-core.js) applies to every request, and the parts of one REST call that don't depend on how the path signs in. Imports
// nothing.
//
// What each path gives the rest of the app:
//   request(path, post?) → the parsed body of GET (or a read-only POST to) /services/data/vXX.X{path}. A failure throws an
//     Error with .httpStatus (readBody below); a timeout throws tooSlow(). createCore() takes it.
//   send(method, path, body?) → { status, body } for one of OM Service Console's writes, sent once (writeAnswer below), even when
//     Order Management answers with an error. createActions() (om-actions.js) takes it.
// Each path still decides its own retries and what a 401 means: sf-conn.mjs asks the sf CLI again, om-browser.js refreshes
// the OAuth token, and om-platform.js fetches a new CSRF token.
// Whether any of the values (a username, an org's address) matches one of the deployment's blocked patterns (CONFIG.blocked
// in om-config.js).
/**
 * Whether a deployment refuses an org.
 * @param {RegExp[]} patterns The blocked patterns (`CONFIG.blocked` and `OM_BLOCKED`).
 * @param {...string} values A username or an org address to test.
 * @returns {boolean} True when any value matches any pattern.
 */
export const isBlocked = (patterns, ...values) => values.some((v) => patterns.some((re) => re.test(v || '')));
// What refusing a blocked org throws, on every sign-in path: 409, marked `orgBlocked`. The pages show the sign-in screen for
// the mark (and a 401), never for the status alone: a write the gate refuses as a conflict, or Salesforce's own 409, answers
// 409 too.
/**
 * The error thrown to refuse a blocked org.
 * @param {string} message What to tell the person.
 * @returns {Error} Code 409 with `orgBlocked: true`.
 */
export const blockedRefusal = (message) => Object.assign(new Error(message), { code: 409, orgBlocked: true });
export const BLOCKED_MESSAGE = 'This deployment refuses to run against this org.';

// A query Salesforce gave up on, or one we stopped waiting for, reads the same on every panel. Callers cut a request off
// after REQUEST_MS (a /composite batch after COMPOSITE_MS), so a slow query in a large org can't hang the page.
export const REQUEST_MS = 30000;
// What an error says besides its message, carried from the local server (server.mjs) to the page (service/app.js), so a
// declined card, a released hold, an outcome that couldn't be told, a duplicate match and a blocked org's refusal read the same in every mode.
export const ERROR_FIELDS = ['kind', 'duplicates', 'allowSave', 'declined', 'released', 'unsure', 'authorize', 'orgBlocked'];
/**
 * An error as the local server sends it to the page.
 * @param {Error} e
 * @returns {object} `{ error, ...ERROR_FIELDS present on e }`.
 */
export const errorBody = (e) => ({ error: e?.message, ...Object.fromEntries(ERROR_FIELDS.filter((k) => e?.[k] != null).map((k) => [k, e[k]])) });
/**
 * An error rebuilt from the server's answer: the inverse of `errorBody`.
 * @param {object} b The answer's JSON body.
 * @param {number} status The HTTP status.
 * @returns {Error} With `status` and the `ERROR_FIELDS` the body carried.
 */
export const errorFrom = (b, status) => Object.assign(new Error(b?.error || `HTTP ${status}`), { status, ...Object.fromEntries(ERROR_FIELDS.filter((k) => b?.[k] != null).map((k) => [k, b[k]])) });
export const COMPOSITE_MS = 60000;
/**
 * The error for a read Salesforce gave up on.
 * @returns {Error} Code 504.
 */
export const tooSlow = () => Object.assign(new Error('Salesforce took too long to answer; try a shorter range'), { code: 504 });
// A failed request's explanation: REST answers [{ message }]; Connect APIs answer { message } or { output: { errors } }.
/**
 * A failed request's explanation.
 * @param {*} b A REST error array, or a Connect error object.
 * @returns {string} The messages joined with '; '; '' when there is none.
 */
export const errorText = (b) => (Array.isArray(b) ? b : [...(b?.output?.errors || []), ...(Array.isArray(b?.errors) ? b.errors : [])]).map((e) => (typeof e === 'string' ? e : e?.message)).filter(Boolean).join('; ') || (typeof b?.message === 'string' ? b.message : '');
/**
 * Whether a failure is a timeout.
 * @param {Error|null} e A thrown error.
 * @param {*} [body] A REST error body.
 * @returns {boolean} True for a timeout or abort, or a body with `QUERY_TIMEOUT`.
 */
export const isTooSlow = (e, body) => e?.name === 'TimeoutError' || e?.name === 'AbortError' || (Array.isArray(body) && body.some((x) => x.errorCode === 'QUERY_TIMEOUT'));
// The only POSTs this app sends change nothing: OCI's availability lookup, UI API's duplicate check of unsaved values (it runs
// the org's duplicate rules and saves nothing), and /composite wrapping nothing but GET queries and describes.
export const READ_ONLY_POSTS = new Set(['/commerce/oci/availability/availability-records/actions/get-availability', '/ui-api/predupe']);
// Two more POSTs only read: Order Management's delivery estimate (dates from the setup, carrier methods and stock), and its
// pickup estimate (stores near a postal code with pickup times and stock). Neither saves anything.
const READ_ONLY_POST_RE = [/^\/commerce\/delivery\/estimation-setup\/[\w.-]{1,80}\/estimate\/estimate-date$/, /^\/commerce\/delivery\/estimation-setup\/[\w.-]{1,80}\/estimate\/bopis$/];
const READ_URL = /^\/services\/data\/v\d+\.\d\/(query\?q=[^\s]+|sobjects\/\w+\/describe)$/;
/**
 * Whether a POST only reads.
 * @param {string} p The request path.
 * @param {*} body The request body.
 * @returns {boolean} True for the allowlisted posts and for a `/composite` of GET queries and describes only.
 */
export const readOnlyPost = (p, body) => READ_ONLY_POSTS.has(p) || READ_ONLY_POST_RE.some((re) => re.test(p)) || (p === '/composite' && Array.isArray(body?.compositeRequest) && body.compositeRequest.length <= 25
  && body.compositeRequest.every((r) => r.method === 'GET' && READ_URL.test(r.url) && r.body === undefined));

// ---------- one REST call ----------
// A read's fetch options: the path's own headers (a bearer token, or the CSRF token inside Salesforce), a read-only POST's
// JSON body, and a timeout, REQUEST_MS unless `ms` says otherwise (a /composite batch gets COMPOSITE_MS).
/**
 * Fetch options for a read.
 * @param {string} p The request path.
 * @param {*} post The JSON body of a read-only POST; pass `undefined` for a GET (the slot stays, `headers` follows it).
 * @param {Object<string, string>} headers Auth headers.
 * @param {number} [ms] Timeout in ms.
 * @returns {RequestInit}
 */
export function readInit(p, post, headers, ms = p === '/composite' ? COMPOSITE_MS : REQUEST_MS) {
  const init = { headers: { ...headers } };
  if (post !== undefined) Object.assign(init, { method: 'POST', body: JSON.stringify(post), headers: { ...init.headers, 'Content-Type': 'application/json' } });
  init.signal = AbortSignal.timeout(ms);
  return init;
}
// A read's answer, once the path has dealt with a 401: its body, or the error every panel shows. A query Salesforce gave up on
// reads as tooSlow(); anything else carries its own text and the HTTP status. `error(message, status)` makes the Error.
/**
 * A read's answer, or the error every panel shows.
 * @param {Response} res
 * @param {*} body The parsed body.
 * @param {(message: string, status: number) => Error} [error] Makes the Error to throw.
 * @returns {*} `body` when the response is ok; throws `tooSlow()` or `error(...)` otherwise.
 */
export function readBody(res, body, error = (m, status) => Object.assign(new Error(m), { httpStatus: status })) {
  if (!res.ok && isTooSlow(null, body)) throw tooSlow();
  if (!res.ok) throw error(errorText(body) || `HTTP ${res.status}`, res.status);
  return body;
}
// A write's fetch options: JSON both ways, cut off after COMPOSITE_MS. A write is not retried after a network error: the
// first attempt may have gone through.
/**
 * Fetch options for a write.
 * @param {string} method
 * @param {*} body JSON body; pass `undefined` for none (the slot stays, `headers` follows it).
 * @param {Object<string, string>} headers Auth headers.
 * @param {number} [ms] Timeout in ms.
 * @returns {RequestInit}
 */
export function writeInit(method, body, headers, ms = COMPOSITE_MS) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(ms) };
  if (body !== undefined) Object.assign(init, { body: JSON.stringify(body), headers: { ...init.headers, 'Content-Type': 'application/json' } });
  return init;
}
// A write that timed out may still have happened, so the agent checks before trying again.
/**
 * The error for a write that timed out.
 * @returns {Error} Code 504; the write may still have happened.
 */
export const slowWrite = () => Object.assign(new Error('Salesforce took too long to answer. Check the order before trying again.'), { code: 504 });
// A write's answer is { status, body } whatever the status, because Order Management says what went wrong in the body.
/**
 * A write's answer, whatever its status.
 * @param {Response} res
 * @returns {Promise<{status: number, body: object}>} `{}` for a 204 or an unreadable body.
 */
export const writeAnswer = async (res) => ({ status: res.status, body: res.status === 204 ? {} : await res.json().catch(() => ({})) });
