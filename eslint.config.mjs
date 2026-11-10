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
// ESLint for app/: npx eslint@10 . (CONTRIBUTING, Testing). Needs no plugins or installed packages, so the repo keeps no
// npm dependencies: the rules are ESLint's recommended set, listed here, and the globals are Node's (read from this Node)
// plus the browser names the pages use. Every .js is an ES module, as in the syntax check.
const RECOMMENDED = ['constructor-super', 'for-direction', 'getter-return', 'no-async-promise-executor', 'no-case-declarations',
  'no-class-assign', 'no-compare-neg-zero', 'no-cond-assign', 'no-const-assign', 'no-constant-binary-expression',
  'no-constant-condition', 'no-control-regex', 'no-debugger', 'no-delete-var', 'no-dupe-args', 'no-dupe-class-members',
  'no-dupe-else-if', 'no-dupe-keys', 'no-duplicate-case', 'no-empty-character-class', 'no-empty-pattern', 'no-empty-static-block',
  'no-empty', 'no-ex-assign', 'no-extra-boolean-cast', 'no-fallthrough', 'no-func-assign', 'no-global-assign', 'no-import-assign',
  'no-invalid-regexp', 'no-irregular-whitespace', 'no-loss-of-precision', 'no-misleading-character-class',
  'no-new-native-nonconstructor', 'no-nonoctal-decimal-escape', 'no-obj-calls', 'no-octal', 'no-prototype-builtins',
  'no-redeclare', 'no-regex-spaces', 'no-self-assign', 'no-setter-return', 'no-shadow-restricted-names', 'no-sparse-arrays',
  'no-this-before-super', 'no-unassigned-vars', 'no-undef', 'no-unexpected-multiline', 'no-unreachable', 'no-unsafe-finally',
  'no-unsafe-negation', 'no-unsafe-optional-chaining', 'no-unused-labels', 'no-unused-private-class-members', 'no-unused-vars',
  'no-useless-assignment', 'no-useless-backreference', 'no-useless-catch', 'no-useless-escape', 'no-with', 'preserve-caught-error',
  'require-yield', 'use-isnan', 'valid-typeof'];

const BROWSER = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'addEventListener', 'getComputedStyle',
  'matchMedia', 'requestAnimationFrame', 'innerWidth', 'innerHeight', 'CSS', 'Element', 'Node', 'SVGElement', 'MouseEvent',
  'MutationObserver', 'ResizeObserver', 'Path2D', 'US_GEO'];

const globals = Object.fromEntries([...Object.getOwnPropertyNames(globalThis), ...BROWSER].map((g) => [g, 'readonly']));

export default [
  { ignores: ['org/**', 'app/public/geo.js', 'app/public/operations-console/geo.js'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals },
    rules: {
      ...Object.fromEntries(RECOMMENDED.map((r) => [r, 'error'])),
      // On purpose here: input is cleaned of control characters, a failed optional step is caught and ignored, and
      // { attributes, ...rest } drops a field.
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { ignoreRestSiblings: true, caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
];
