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
// This deployment's settings: the one file to change when you host the console and OM Service Console for your own org. Every
// sign-in path reads it when it signs in (sf-conn.mjs, om-browser.js, om-platform.js and the Cowork artifact), so a test may
// change CONFIG and see the change. Imports nothing.
/**
 * This deployment's settings.
 * @type {{clientId: string, domain: string, blocked: RegExp[]}}
 */
export const CONFIG = {
  // The hosted (PKCE) sign-in: the External Client App's consumer key, a public client id (PKCE, no secret), not a credential,
  // and the org it signs in to when the sign-in screen's My Domain field is left empty. An empty clientId makes the screen
  // ask for the consumer key; an empty domain makes it ask for the My Domain URL.
  clientId: '',
  domain: 'https://login.salesforce.com',
  // Orgs this deployment refuses, matched against the username and the org's address on every sign-in path. An empty list
  // refuses nothing; OM_BLOCKED adds more for a local run (sf-conn.mjs).
  blocked: [],
};
