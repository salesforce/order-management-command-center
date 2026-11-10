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
// The console's load banner and tab title: what a failed load says, and when it's a sign-in problem instead.

export const BASE_TITLE = 'Salesforce Order Management Operations Console';
// The sign-in screen answers an expired sign-in and a blocked org's refusal (blockedRefusal() in om-http.js); a banner would
// double it.
export const isAuthFailure = (e) => e?.status === 401 || e?.orgBlocked === true;
export const tabTitle = (live, mode, n) => (live && mode === 'console' && Number.isFinite(n) && n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE);
// Amber while a payload is still on screen (`note` is failNote()'s sentence, `at` that payload's time), red when the view has nothing yet.
export const loadProblem = (view, note, message, loaded, at) => (loaded
  ? { kind: 'stale', head: note, text: `${at ? `Data from ${at}. ` : ''}${message}` }
  : { kind: 'err', head: `Couldn't load ${view}.`, text: message });
