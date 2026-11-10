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
// Dependency inspection for this repo's browser ES modules. Unsupported/computed forms fail closed.
// Strings, comments and regular expressions are skipped; no application code is evaluated.
const REGEX_START = /^(?:[=(:,[!&|?;{}>]|return|throw|=>)$/;
function regexEnd(source, at) {
  at++; let bracket = false;
  while (at < source.length) {
    if (source[at] === '\\') { at += 2; continue; }
    if (source[at] === '[') bracket = true;
    if (source[at] === ']') bracket = false;
    if (source[at++] === '/' && !bracket) break;
  }
  while (at < source.length && /[a-z]/i.test(source[at])) at++;
  return at;
}
function quotedEnd(source, at) {
  const quote = source[at++];
  while (at < source.length) {
    if (source[at] === '\\') { at += 2; continue; }
    if (source[at] === quote) return at + 1;
    if (quote === '`' && source.startsWith('${', at)) {
      at += 2; let depth = 1, previous = '';
      while (at < source.length && depth) {
        const c = source[at];
        if (/\s/.test(c)) { at++; continue; }
        if (['"', "'", '`'].includes(c)) { at = quotedEnd(source, at); previous = 'value'; continue; }
        if (source.startsWith('//', at)) { const end = source.indexOf('\n', at); at = end < 0 ? source.length : end; continue; }
        if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); if (end < 0) throw new Error('Unclosed comment'); at = end + 2; continue; }
        if (c === '/' && (!previous || REGEX_START.test(previous))) { at = regexEnd(source, at); previous = 'value'; continue; }
        if (c === '{') depth++;
        if (c === '}') depth--;
        const word = source.slice(at).match(/^[A-Za-z_$][\w$]*/)?.[0];
        previous = word || c; at += word?.length || 1;
      }
      continue;
    }
    at++;
  }
  throw new Error('Unclosed string');
}
export function moduleDependencies(source) {
  const tokens = [];
  let at = 0, previous = '';
  while (at < source.length) {
    const c = source[at];
    if (/\s/.test(c)) { at++; continue; }
    if (source.startsWith('//', at)) { at = source.indexOf('\n', at); if (at < 0) break; continue; }
    if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); if (end < 0) throw new Error('Unclosed comment'); at = end + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c, start = at;
      at = quotedEnd(source, at);
      const value = source.slice(start + 1, at - 1), escaped = value.includes('\\');
      // A dependency hidden in interpolation is refused until represented as a literal module import.
      if (quote === '`' && value.includes('${') && /\bimport\s*\(/.test(value)) throw new Error('Import inside a template interpolation must be explicit');
      tokens.push({ type: quote === '`' ? 'template' : 'string', value, escaped, start }); previous = 'value'; continue;
    }
    if (c === '/' && (!previous || REGEX_START.test(previous))) {
      at = regexEnd(source, at);
      previous = 'value'; continue;
    }
    const word = source.slice(at).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (word) { tokens.push({ type: 'word', value: word }); at += word.length; previous = word; }
    else { tokens.push({ type: 'punct', value: c }); at++; previous = c; }
  }
  const dependencies = [];
  const take = (token) => {
    if (!token || !['string', 'template'].includes(token.type) || token.value.includes('${') || token.escaped) throw new Error('Module dependencies must use unescaped literal paths');
    dependencies.push(token.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'word') continue;
    if (token.value === 'require' && tokens[i + 1]?.value === '(') throw new Error('CommonJS require is not a browser dependency');
    if (token.value === 'import') {
      if (tokens[i - 1]?.value === '.' || tokens[i + 1]?.value === '.') continue;
      if (tokens[i + 1]?.value === '(') { take(tokens[i + 2]); continue; }
      if (tokens[i + 1]?.type === 'string') { take(tokens[i + 1]); continue; }
      let j = i + 1;
      while (j < tokens.length && !['from', ';'].includes(tokens[j].value)) j++;
      if (tokens[j]?.value !== 'from') throw new Error('Unsupported import declaration');
      take(tokens[j + 1]);
    }
    if (token.value === 'export' && ['{', '*'].includes(tokens[i + 1]?.value)) {
      let j = i + 1;
      while (j < tokens.length && !['from', ';'].includes(tokens[j].value)) j++;
      if (tokens[j]?.value === 'from') take(tokens[j + 1]);
    }
  }
  return [...new Set(dependencies)];
}
