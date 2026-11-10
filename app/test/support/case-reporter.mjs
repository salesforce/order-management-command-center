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
// Node test reporter used alongside TAP/spec/LCOV. Records executed cases, not a source-derived test count.
import path from 'node:path';
export default async function* cases(events) {
  const records = [];
  for await (const { type, data } of events) {
    if ((type !== 'test:pass' && type !== 'test:fail') || data.type === 'suite') continue;
    records.push({ file: path.relative(process.cwd(), data.file).split(path.sep).join('/'), name: data.name,
      nesting: data.nesting, passed: type === 'test:pass', skipped: !!data.skip });
  }
  yield JSON.stringify(records, null, 2) + '\n';
}
