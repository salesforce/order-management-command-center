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
// How a page reads the org, decided once from its address, the same for both apps (index.html and service/):
//   DEMO: sample data (?demo=1), nothing reaches an org;
//   PLATFORM: inside Salesforce (a Multi-Framework app on *.my.salesforce.app), with the user's own session (om-platform.js);
//   BROWSER: signed in from this tab with OAuth + PKCE (om-browser.js): any host but localhost, or ?auth=browser there. On
//     localhost a sign-in that's under way or done keeps this mode, because Salesforce redirects back to /?code=… without the query;
//   otherwise the local server's sf CLI sign-in (server.mjs). ?auth=server forces that on localhost.
// The builds switch FORCE: the edit view (build-artifact.mjs) to 'demo', the live console (build-live-artifact.mjs) to 'platform'.
const FORCE = null;

export function modeOf({ search = '', hostname = '', signingIn = false } = {}, force = FORCE) {
  const q = new URLSearchParams(search), auth = q.get('auth');
  const demo = force === 'demo' || q.has('demo');
  const platform = !demo && (force === 'platform' || /\.my\.salesforce\.app$/i.test(hostname));
  const browser = !demo && !platform && auth !== 'server' && (auth === 'browser' || !['localhost', '127.0.0.1'].includes(hostname) || signingIn);
  return { demo, auth, platform, browser };
}

const page = typeof location === 'undefined' ? {}
  : { search: location.search, hostname: location.hostname, signingIn: !!(sessionStorage.getItem('omc.pkce') || sessionStorage.getItem('omc.auth')) };
const mode = modeOf(page);
export const DEMO = mode.demo;
export const AUTH = mode.auth;
export const PLATFORM = mode.platform;
export const BROWSER = mode.browser;
