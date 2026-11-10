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
// File-level migration guard. Behavior/case parity remains covered by the existing suites and later contract work.
const OWNERS = new Set(['operations-console', 'service-center', 'shared', 'architecture', 'integration']);
const scopedOwner = (file) => file.match(/^app\/test\/([^/]+)\/.+\.test\.mjs$/)?.[1];

export function inventoryProblems(baseline, current, { publicExport = false } = {}) {
  const problems = [];
  const present = new Set(current), accounted = new Set();
  if (present.size !== current.length) problems.push('A test is listed more than once');
  const moves = baseline.moves || {};
  for (const original of Object.keys(moves)) {
    if (!(original in baseline.testOwners)) problems.push(`Move names an unknown baseline test: ${original}`);
  }
  for (const [original, owner] of Object.entries(baseline.testOwners)) {
    if (!OWNERS.has(owner)) problems.push(`Unknown owner for ${original}: ${owner}`);
    const target = moves[original] || original;
    if (accounted.has(target)) problems.push(`Multiple baseline tests map to ${target}`);
    accounted.add(target);
    if (moves[original]) {
      if (present.has(original)) problems.push(`Moved test still exists at its old path: ${original}`);
      if (scopedOwner(target) !== owner) problems.push(`Moved test must stay with ${owner}: ${target}`);
    }
    const internal = (baseline.sourceOnlyTests || []).includes(original);
    if (publicExport && internal) {
      if (present.has(target)) problems.push(`Source-only test leaked into public export: ${target}`);
    } else if (!present.has(target)) problems.push(`Baseline test missing: ${original} (expected ${target})`);
  }
  for (const file of current) {
    if (!accounted.has(file) && !OWNERS.has(scopedOwner(file))) problems.push(`New tests need an owner folder: ${file}`);
  }
  return problems;
}
