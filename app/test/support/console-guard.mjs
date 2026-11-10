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
// Detectors for the careless changes a console edit can make that the other tests don't see. Each takes text and returns what's
// wrong, so console-guard.test.mjs can run them on made-up files (proving they fire) and on the real console (proving it's clean).
import { readFileSync, readdirSync } from "./source-view.mjs";

// Every CSS colour keyword. `transparent`, `currentcolor` and `inherit` are not colours of their own, so they pass.
const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse '
  + 'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta '
  + 'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet '
  + 'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green '
  + 'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey '
  + 'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen '
  + 'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple '
  + 'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey '
  + 'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ').join('|');
// A hex colour (not an `url(#id)` or `&#38;`), a colour function (rgb, hsl and the modern spaces) or a colour keyword on its own (not
// inside a path or a name such as `red.png`, `--red` or `redraw`).
const LITERAL = `(?:(?<![(\\w&])#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(|(?<![-\\w/.#])(?:${NAMED})(?![-\\w./(]))`;
const PROPS = '(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|box-shadow|text-shadow|--[\\w-]+)';
const QUOTE = `["'\`]`;
// A colour written out in a CSS declaration, a style string, an SVG attribute (`color:#f0a`, `fill="red"`) or a custom property
// (`--x:#fff`); or set from script: `el.style.color = 'rgb(…)'`, `style.setProperty('color', …)`, a canvas's `fillStyle = …`,
// `strokeStyle`, `shadowColor` and `addColorStop(0, …)`. `var(--x)` and color-mix() of tokens have no literal in them, so they pass.
const COLOUR = new RegExp([
  `(?<![-\\w])${PROPS}\\s*[:=]\\s*${QUOTE}?[^;"'\`}<>]*?${LITERAL}`,
  `\\.style\\.\\w*(?:olor|ackground|ill|troke)\\w*\\s*=\\s*${QUOTE}${LITERAL}`,
  `\\bsetProperty\\(\\s*${QUOTE}[\\w-]+${QUOTE}\\s*,\\s*${QUOTE}${LITERAL}`,
  `\\b(?:fillStyle|strokeStyle|shadowColor)\\s*=\\s*${QUOTE}${LITERAL}`,
  `\\baddColorStop\\([^,)]+,\\s*${QUOTE}${LITERAL}`,
].join('|'), 'gi');
// Comments say what a colour was; only code and markup count. (`//` after `:` is a URL, not a comment.)
const withoutComments = (t) => t.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '').replace(/(^|[^:\w"'`])\/\/.*$/gm, '$1');
// The brand mark is a white glyph on its tile; that one attribute is the exception.
export const colourLiterals = (text) => (withoutComments(text).replace(/fill="#fff"/g, '').match(COLOUR) || []).map((s) => s.trim());

// Data is read in om-core*.js and om-reads.js (the read model). A query written anywhere else is a second copy that the guards
// (read-only, batching, schema tolerance) never see. SELECT … FROM in capitals, or a raw /query?q= call.
// Also across lines, with `${…}` in the field list or the object, and the other query routes (queryAll, tooling, and a SOSL FIND). Lower-case
// `select … from` is prose too often to tell apart, so a query must be in capitals, as every one in this repo is.
const SOQL = /\bSELECT\s+[\w.,()$*{}\s]+?\s+FROM\s+(?:[A-Z]\w+|\$\{)|\/(?:tooling\/)?query(?:All)?\/?\?q=|\bFIND\s*\{[^}]*\}\s+IN\s/g;
export const queriesIn = (text) => text.match(SOQL) || [];

// Console files that no test imports (a mention in a comment, or reading the file as text, isn't a test of it). `tests` is the text
// of every test file. An import counts in any quote or a template literal (`import(\`../public/x.js?copy=${n}\`)`); a commented-out
// one doesn't.
const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const imports = (t, f) => new RegExp(`(?:\\bfrom|\\bimport\\s*\\(?)\\s*["'\`][^"'\`]*/${esc(f)}(?:\\?[^"'\`]*)?["'\`]`).test(withoutComments(t));
export const untested = (files, tests) => files.filter((f) => !tests.some((t) => imports(t, f)));

// Every relative `.js` a piece of code names in a string (`'./x.js'`, `"x.js?v=2"`, `./sub/x.js`): the test that the console's own
// reach (console-source.mjs) saw them all compares this wider net with what it scanned.
export const jsRefs = (text) => [...withoutComments(text).matchAll(/["'`]((?:\.{0,2}\/)?[\w./-]*\.js)(?:\?[^"'`]*)?["'`]/g)].map((m) => m[1]);

export function testTexts(dir = new URL("..", import.meta.url)) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mjs') && e.name !== 'console-guard.test.mjs') out.push(readFileSync(p, 'utf8'));
  } };
  walk(dir);
  return out;
}

// Raw values for the properties tokens.css has a scale or a named token for, as `prop:value` strings. A value written as var(--…),
// 0 or 1 (opacity), `normal`, `auto` or inside calc() is fine; anything else is a number typed by hand.
const declarations = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/[{;"'`]\s*([a-z-]+)\s*:\s*([^;{}"'`]+)/g)].map((m) => [m[1], m[2].trim().replace(/\s*!important$/, '')]);
const RAW = {
  'letter-spacing': (v) => /\d(em|px|rem)\b/.test(v) && !/^-?0(em|px|rem)?$/.test(v),
  'line-height': (v) => /^[\d.]+(px|em|rem)?$/.test(v) && v !== '0',
  'font-stretch': (v) => /\d%/.test(v),
  'z-index': (v) => /^-?\d+$/.test(v) && v !== '0',
  opacity: (v) => /^[\d.]+$/.test(v) && v !== '0' && v !== '1',
};
export const rawScale = (css) => declarations(css).filter(([p, v]) => RAW[p]?.(v) && !/calc\(|var\(/.test(v)).map(([p, v]) => `${p}:${v}`);
