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
// Operations Console read profile; no Service actions or Service-only read providers.
import { createReader } from '../../shared/data/om-reads.js';
import { createReadRuntime } from '../../shared/data/read-runtime.js';
import { orderReads } from '../../shared/data/order-reads.js';
import { customerReads } from '../../shared/data/customer-reads.js';
import { displayFacts } from '../../shared/data/display-facts.js';
import { orgReads } from '../../shared/data/om-core-org.js';
import { commandReads } from './console-reads.js';
import { queueReads } from './queue-reads.js';
import { dashboardReads } from './om-core-dashboard.js';

export const PROVIDERS = [{ name: 'console', make: commandReads, needs: ['scoper'] }, { name: 'dashboard', make: dashboardReads, needs: ['scoper'] }, queueReads,
  { name: 'orders', make: orderReads, needs: ['featureOff', 'scoper'] },
  { name: 'customers', make: customerReads, needs: ['moneyFacts'] }, displayFacts, orgReads];
export const createCore = (options) => createReadRuntime({ ...options, createReader }, PROVIDERS);
