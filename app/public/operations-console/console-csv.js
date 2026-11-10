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
// CSV export for the dashboard's panels: a cell that starts with = + - @ (or a tab or CR) would run as a formula in a
// spreadsheet, so it gets a leading ' first. A real number, or a string that is only a number ('-5', '-1.50'), can't run and
// stays as it is. Rows in csvStore stay raw; only the file is escaped.

export const CSV_FORMULA = /^[\t\r]|^\s*[=+\-@]/;
export const CSV_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v !== 'number' && CSV_FORMULA.test(s) && !CSV_NUMBER.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvText = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
