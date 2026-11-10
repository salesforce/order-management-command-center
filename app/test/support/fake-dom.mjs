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
// Just enough of a DOM for OM Service Console's h() (service/ui.js) to build a page in Node: elements with classes, data, styles,
// attributes, listeners and children, and their text. Nothing is laid out or painted; a test reads what was built.
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = [new Text(v)]; }
}
class Text extends Node { constructor(t) { super(); this.text = String(t); } get textContent() { return this.text; } }
class Element extends Node {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.className = ''; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
  }
  get classList() { const names = () => this.className.split(/\s+/).filter(Boolean); return { contains: (c) => names().includes(c), add: (c) => { if (!names().includes(c)) this.className = [...names(), c].join(' '); }, remove: (c) => { this.className = names().filter((x) => x !== c).join(' '); }, toggle: (c, on) => { const has = names().includes(c); if (on ?? !has) { if (!has) this.className = [...names(), c].join(' '); } else this.className = names().filter((x) => x !== c).join(' '); } }; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  append(...kids) { for (const k of kids) { k.parentNode = this; this.childNodes.push(k); } }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  // Every element under this one, depth first.
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  closest() { return null; }
}
// Focus as a browser keeps it, for a test of where it goes, with the page drawn into `root` (hooks.render): focus() on an
// enabled element drawn there makes it document.activeElement, which is the body again once it isn't drawn there any more,
// and document.querySelector finds what's drawn by its data-key, as keepFocus() and focusKey() ask for it.
export function focusIn(root) {
  let at = null;
  const drawn = (el) => root.all().includes(el);
  Element.prototype.focus = function () { if (drawn(this) && !this.disabled) at = this; };
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => (at && drawn(at) ? at : document.body), set: (v) => { at = v; } });
  document.querySelector = (sel) => { const m = /^\[data-key="(.+)"\]$/.exec(sel); return m ? root.all().find((e) => e.dataset.key === m[1]) || null : null; };
  globalThis.CSS ??= { escape: (s) => s };
}
export function installDom() {
  globalThis.Node = Node; globalThis.Element = Element; globalThis.HTMLElement = Element;
  globalThis.document = { createElement: (t) => new Element(t), createTextNode: (t) => new Text(t), activeElement: null, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: new Element('body') };
  return { root: () => new Element('div') };
}
