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
// The address the Salesforce Order Management Operations Console component frames: the console's Multi-Framework app, with ?order=<Id>
// (and ?view=) so the page opens that order once it has loaded (openFromUrl() in index.html).
// Only an app-domain address is framed; anything else is null, and the component says so.
const ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const VIEWS = ['details', 'activity', 'timeline'];

export function frameUrl(consoleUrl, recordId, view) {
  let u;
  try { u = new URL(consoleUrl); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.my.salesforce.app') || !u.pathname.startsWith('/app/')) return null;
  u.search = ''; u.hash = '';
  if (ID.test(recordId || '')) {
    u.searchParams.set('order', recordId);
    if (VIEWS.includes(view)) u.searchParams.set('view', view);
  }
  return u.toString();
}
