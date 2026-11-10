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
// Salesforce Order Management Operations Console in Cowork. tools/build-live-artifact.mjs --console builds index.html with its "inside Salesforce" mode on (no
// sign-in of its own) and this module in om-platform.js's place, with the same interface: createPlatform({ onRequest }) and
// platform(), giving route(), status(), instanceUrl().
// Every GET om-core.js asks for goes through graphql-batch.js (aggregates and describes batched into GraphQL GETs) and then
// artifact-connector.js (one dispatch_readonly call each, through the viewer's own Salesforce connector). Nothing here
// writes: any other method is refused, and Agentforce, whose chat needs the Agent API's POSTs, is off.
import { createCore } from './om-command-core.js';
import { CONFIG } from './om-config.js';
import { translate } from './om-graphql.js';
import { kindOf } from './om-meter.js';
import { CONNECTOR, connectorRequest, probe, readAnswer } from './artifact-connector.js';
import { callConnector } from './artifact-call.js';
import { createBatcher } from './graphql-batch.js';

const notHere = () => Object.assign(new Error('Not available in Cowork: this page only reads'), { code: 404, httpStatus: 404 });

// call(tool, args) is the connector call (injectable for tests); onBatch sees each GraphQL batch. onRequest (optional) hears
// about every connector call once it ends, for the Limits view's live meter, as om-platform.js reports its own:
// { t, kind, path, method, ms, status, rows }. It can never break a request.
export function createPlatform({ call = callConnector, onRequest, onBatch } = {}) {
  const metered = async (tool, args) => {
    const started = Date.now();
    let r;
    try { return (r = await call(tool, args)); } finally {
      if (onRequest) {
        try {
          let a = null;
          try { a = r && readAnswer(r); } catch { /* the call itself failed: no HTTP status */ }
          onRequest({ t: Date.now(), kind: kindOf(args?.url), path: args?.url, method: args?.method, ms: Date.now() - started,
            status: a?.status ?? 0, rows: Array.isArray(a?.body?.records) ? a.body.records.length : null });
        } catch { /* a listener's mistake is not the request's */ }
      }
    }
  };
  const get = connectorRequest(metered, { blocked: CONFIG.blocked });
  const core = createCore({ request: createBatcher({ get, translate, onBatch }), instanceUrl: get.instanceUrl, apiVersion: () => null });

  let checked = null;
  async function status() {
    const p = await (checked ||= probe(get));
    if (!p.ok) { checked = null; return { connected: false, error: p.error?.message || `The ${CONNECTOR} connector didn't answer` }; }
    const org = get.instanceUrl();
    return { connected: true, username: org ? new URL(org).hostname : `Your ${CONNECTOR} org`, instanceUrl: org, platform: true };
  }

  async function route(url, opts = {}) {
    if (String(opts.method || 'GET').toUpperCase() !== 'GET') throw notHere();
    if (url === '/api/agent/info') return { agent: null };
    return core.route(url);
  }

  return { request: get, route, status, instanceUrl: get.instanceUrl, enableActions() { throw notHere(); } };
}

// The page's single instance, for callers that don't meter.
let page = null;
export const platform = () => (page ||= createPlatform());
