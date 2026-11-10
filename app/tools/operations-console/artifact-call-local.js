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
// The local stand-in for the claude.ai connector, built in by `build-live-artifact.mjs --local` in place of artifact-call.js.
// tools/serve-live.mjs answers each call as Headless 360's dispatch_readonly would, with the sf CLI's sign-in.
export const connectHelp = 'This local copy reads Order Management with your sf CLI sign-in. Sign in with "sf org login web --alias om-console", then reload this page.';

export async function callConnector(tool, args) {
  const r = await fetch(`connector?${new URLSearchParams({ tool, args: JSON.stringify(args) })}`);
  if (!r.ok) throw new Error((await r.text()) || `The local connector answered ${r.status}`);
  return r.json();
}
