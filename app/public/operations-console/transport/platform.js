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
import { createPlatform as makePlatform, RELAY_READS, LIMIT_MESSAGE, parseLimits, unwrapReply, orgDomainUrl } from '../../shared/transport/platform-runtime.js';
import { createCore } from '../data/core.js';
export { RELAY_READS, LIMIT_MESSAGE, parseLimits, unwrapReply, orgDomainUrl };
export const createPlatform = (options = {}) => makePlatform({ ...options, createCore });
let page;
export const platform = () => (page ||= createPlatform());
