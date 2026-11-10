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
// An accessibility check for whatever is on screen, run in the page (no dependencies): paste it into the browser's console,
// or into the Browser pane's eval, then call a11yAudit(). It returns { count, issues } with one entry per rule, each with up
// to 12 examples. It covers what a page can tell about itself: names (WCAG 4.1.2, 1.1.1), roles and their parents, ARIA
// references, focusable things hidden from screen readers, nested controls, positive tabindex, things that look clickable
// but take no focus (2.1.1), text contrast (1.4.3, from computed colours; SVG text is left to themes.test.mjs), placeholder
// contrast, headings and landmarks (1.3.1), target size (2.5.8), the page's language and title.
// It can't see focus order, what a screen reader says, or forced colours: Tab through the page for those (CLAUDE.md).
window.a11yAudit = function a11yAudit(root = document.body) {
  const ROLES = new Set('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' '));
  const CONTEXT = { option: ['listbox', 'group'], tab: ['tablist'], menuitem: ['menu', 'menubar', 'group'], menuitemradio: ['menu', 'menubar', 'group'], menuitemcheckbox: ['menu', 'menubar', 'group'], listitem: ['list', 'directory'], row: ['table', 'grid', 'treegrid', 'rowgroup'], gridcell: ['row'], treeitem: ['tree', 'group'] };
  const NEEDS_NAME = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'img', 'dialog', 'alertdialog', 'textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'progressbar', 'meter', 'treeitem', 'radiogroup', 'tablist', 'menu']);
  const TOKENS = { 'aria-pressed': ['true', 'false', 'mixed'], 'aria-expanded': ['true', 'false'], 'aria-selected': ['true', 'false'], 'aria-checked': ['true', 'false', 'mixed'], 'aria-hidden': ['true', 'false'], 'aria-current': ['true', 'false', 'page', 'step', 'location', 'date', 'time'], 'aria-live': ['off', 'polite', 'assertive'], 'aria-haspopup': ['true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog'], 'aria-disabled': ['true', 'false'], 'aria-modal': ['true', 'false'], 'aria-busy': ['true', 'false'], 'aria-invalid': ['true', 'false', 'grammar', 'spelling'], 'aria-required': ['true', 'false'] };
  const NATIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,iframe';
  const issues = {}, add = (rule, el, extra = '') => { (issues[rule] ||= []).push(desc(el) + (extra ? ` · ${extra}` : '')); };
  const all = [...root.querySelectorAll('*')];
  const style = new Map(), cs = (el) => { let s = style.get(el); if (!s) style.set(el, s = getComputedStyle(el)); return s; };
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = cs(e); if (s.display === 'none' || s.visibility === 'hidden' || s.contentVisibility === 'hidden') return false; }
    return cs(el).display === 'contents' ? [...el.children].some(shown) : el.getClientRects().length > 0; // display:contents has no box of its own
  };
  const atHidden = (el) => !!el.closest('[aria-hidden="true"],[inert]');
  const implicit = (el) => {
    const t = el.localName;
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'a' || t === 'area') return el.hasAttribute('href') ? 'link' : null;
    if (t === 'input') return ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', number: 'spinbutton', hidden: null })[el.type] ?? 'textbox';
    if (t === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'img') return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    if (/^h[1-6]$/.test(t)) return 'heading';
    return ({ dialog: 'dialog', main: 'main', nav: 'navigation', aside: 'complementary', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', progress: 'progressbar', meter: 'meter', fieldset: 'group', details: 'group', output: 'status' })[t] ?? null;
  };
  const role = (el) => el.getAttribute('role')?.trim().split(/\s+/)[0] || implicit(el);
  const text = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true') continue;
        const c = cs(n); if (c.display === 'none' || c.visibility === 'hidden') continue;
        s += ' ' + (n.localName === 'img' ? n.getAttribute('alt') || '' : n.getAttribute('aria-label') || (/^(input|select|textarea)$/.test(n.localName) ? n.value || '' : text(n))) + ' ';
      }
    }
    return s.replace(/\s+/g, ' ').trim();
  };
  const byIds = (ids) => ids.trim().split(/\s+/).map((i) => document.getElementById(i));
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = byIds(lb).map((x) => x ? x.getAttribute('aria-label') || text(x) : '').join(' ').trim(); if (t) return t; }
    const al = el.getAttribute('aria-label'); if (al?.trim()) return al.trim();
    if (el.labels?.length) { const t = [...el.labels].map(text).join(' ').trim(); if (t) return t; }
    if (el.localName === 'img') return el.getAttribute('alt') || '';
    if (el.localName === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
    const r = role(el);
    if (el.localName === 'svg') { const t = el.querySelector(':scope > title'); if (t) return t.textContent.trim(); }
    else if (!/^(input|select|textarea)$/.test(el.localName) && !['img', 'dialog', 'alertdialog', 'listbox', 'group', 'radiogroup', 'tablist', 'menu', 'region', 'list', 'table', 'textbox', 'searchbox', 'combobox'].includes(r)) { const t = text(el); if (t) return t; }
    if (el.localName === 'fieldset') { const lg = el.querySelector(':scope > legend'); if (lg) return text(lg); }
    return (el.getAttribute('title') || '').trim();
  };
  const desc = (el) => {
    let s = el.localName; if (el.id) s += '#' + el.id;
    const c = typeof el.className === 'string' ? el.className : el.className?.baseVal; if (c?.trim()) s += '.' + c.trim().split(/\s+/).slice(0, 2).join('.');
    const t = (el.getAttribute('aria-label') || text(el)).slice(0, 40); return t ? `${s} "${t}"` : s;
  };
  const focusable = (el) => (el.matches(NATIVE) && !el.disabled) || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') || el.isContentEditable;

  // Colours: computed values come as rgb()/rgba() or, from color-mix(), as color(srgb …).
  const parse = (c) => {
    let m = c.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null;
  };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a ? [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
  // A gradient behind the text counts as each of its colour stops (the contrast is the worst of them); a url() image can't
  // be read, so text over one is reported for a look by eye.
  const stops = (img) => (img.match(/rgba?\([^)]*\)|color\(srgb [^)]*\)/g) || []).map(parse).filter(Boolean);
  const background = (el) => {
    const layers = []; let bases = null, image = false;
    for (let e = el; e; e = e.parentElement) {
      const s = cs(e), c = parse(s.backgroundColor);
      if (c && c[3] >= 1) { bases = [c]; break; }
      if (/^url/.test(s.backgroundImage)) image = true;
      else if (s.backgroundImage !== 'none') { const g = stops(s.backgroundImage).filter((x) => x[3] > 0); if (g.length && g.some((x) => x[3] >= 1)) { if (c && c[3] > 0) layers.push(c); bases = g.map((x) => over(x, [255, 255, 255, 1])); break; } }
      if (c && c[3] > 0) layers.push(c);
    }
    return { bgs: (bases || [[255, 255, 255, 1]]).map((b) => { let bg = [...b]; for (const l of [...layers].reverse()) bg = over(l, bg); return bg; }), image };
  };
  const lum = (c) => [0, 1, 2].map((i) => c[i] / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const opacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(cs(e).opacity); return o; };
  const contrastOf = (el, colour) => {
    const { bgs, image } = background(el), c = parse(colour); if (!c) return null;
    const r = Math.min(...bgs.map((bg) => ratio(over([c[0], c[1], c[2], c[3] * opacity(el)], bg), bg)));
    const s = cs(el), px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
    return { r, need: px >= 24 || (bold && px >= 18.66) ? 3 : 4.5, image };
  };

  const ids = new Map();
  for (const el of all) if (el.id) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) (issues['duplicate-id'] ||= []).push(`#${id} ×${n}`);

  const targets = [];
  for (const el of all) {
    if (el.closest('svg') && el.localName !== 'svg' && !el.hasAttribute('tabindex') && !el.hasAttribute('role')) continue;
    const vis = shown(el), r = role(el), explicit = el.getAttribute('role');
    // ARIA: known roles, allowed values, references that resolve.
    if (explicit && !explicit.trim().split(/\s+/).some((x) => ROLES.has(x))) add('aria-role-unknown', el, explicit);
    for (const a of el.getAttributeNames()) {
      if (TOKENS[a] && !TOKENS[a].includes(el.getAttribute(a))) add('aria-value-invalid', el, `${a}="${el.getAttribute(a)}"`);
      if (['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-details'].includes(a) && el.getAttribute(a).trim()) {
        const miss = el.getAttribute(a).trim().split(/\s+/).filter((i) => !document.getElementById(i)); if (miss.length) add('aria-reference-missing', el, `${a}=${miss.join(' ')}`);
      }
    }
    if (el.localName === 'label' && el.htmlFor && !document.getElementById(el.htmlFor)) add('label-for-missing', el, el.htmlFor);
    if (!vis || atHidden(el)) {
      if (vis && focusable(el) && atHidden(el)) add('focusable-in-aria-hidden', el);
      continue;
    }
    // Names.
    const isRoleImgSvg = el.localName === 'svg' && !explicit;
    if (isRoleImgSvg && !el.closest('a,button,[role="button"]') && el.getBoundingClientRect().width > 0) add('svg-unnamed-not-hidden', el);
    if (el.localName === 'img' && !el.hasAttribute('alt') && !explicit) add('img-alt-missing', el);
    if (r && NEEDS_NAME.has(r) && !name(el) && !(el.localName === 'img' && el.getAttribute('alt') === '')) add(`name-missing:${r}`, el);
    if (/^(input|textarea)$/.test(el.localName) && el.type !== 'hidden' && !['button', 'submit', 'reset', 'image'].includes(el.type)) {
      const real = el.getAttribute('aria-labelledby') || el.getAttribute('aria-label') || el.labels?.length || el.title;
      if (!real && el.placeholder) add('label-is-placeholder-only', el);
      if (el.placeholder) { const c = contrastOf(el, getComputedStyle(el, '::placeholder').color); if (c && c.r < 4.5 && !c.image) add('contrast-placeholder', el, `${c.r.toFixed(2)} < 4.5`); }
    }
    // Parents a role needs, controls inside controls, tab order.
    if (explicit && CONTEXT[r]) { let p = el.parentElement, ok = false; while (p && p !== document.body) { const pr = role(p); if (CONTEXT[r].includes(pr)) { ok = true; break; } if (pr && !['generic', 'none', 'presentation', null].includes(pr) && pr !== 'group') break; p = p.parentElement; } if (!ok && !(r === 'option' && el.closest('[role="listbox"],[role="combobox"]'))) add('aria-required-parent', el, `${r} outside ${CONTEXT[r].join('/')}`); }
    if (el.getAttribute('tabindex') && parseInt(el.getAttribute('tabindex'), 10) > 0) add('tabindex-positive', el);
    // Takes focus but has no role, so a screen reader can't say what it is (4.1.2). A table row is a row.
    if (el.getAttribute('tabindex') === '0' && !el.matches(NATIVE) && (!r || r === 'generic')) add('focusable-without-role', el);
    const ctl = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'textbox', 'combobox', 'searchbox'];
    if (ctl.includes(r) && focusable(el)) { const inner = [...el.querySelectorAll(`${NATIVE},[tabindex]:not([tabindex="-1"])`)].find((x) => shown(x)); if (inner) add('nested-interactive', el, desc(inner)); }
    // Looks clickable, takes no focus: a pointer cursor that starts here (not inherited from a control around it).
    if (cs(el).cursor === 'pointer' && !focusable(el) && !el.closest(`${NATIVE},label,[tabindex]:not([tabindex="-1"]),[role="button"],[role="option"][aria-selected]`) && cs(el.parentElement || el).cursor !== 'pointer') add('clickable-not-focusable', el);
    // Text contrast: each element with its own text.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !el.closest('svg') && !el.closest(':disabled,[aria-disabled="true"]')) {
      const c = contrastOf(el, cs(el).color);
      if (c && c.r < c.need) add(c.image ? 'contrast-check-by-eye (gradient or image behind)' : 'contrast-text', el, `${c.r.toFixed(2)} < ${c.need}`);
    }
    if (focusable(el) || ctl.includes(r)) targets.push(el);
  }
  // Target size (2.5.8): under 24×24 px only if a 24 px circle around it stays clear of other targets. Inline links in a
  // sentence are exempt.
  // A target under a drawer or dialog can't be hit, so it neither fails nor crowds another (checked where it's on screen).
  const covered = (el, b) => { const x = b.left + b.width / 2, y = b.top + b.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; const at = document.elementFromPoint(x, y); return !!at && !el.contains(at) && !at.contains(el); };
  const rects = targets.map((el) => ({ el, b: el.getBoundingClientRect() })).filter((t) => t.b.width && t.b.height && !covered(t.el, t.b));
  for (const t of rects) {
    if (t.b.width >= 24 && t.b.height >= 24) continue;
    if (t.el.localName === 'a' && cs(t.el).display === 'inline') continue;
    const cx = t.b.left + t.b.width / 2, cy = t.b.top + t.b.height / 2;
    const near = rects.find((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && Math.hypot(Math.max(o.b.left - cx, 0, cx - o.b.right), Math.max(o.b.top - cy, 0, cy - o.b.bottom)) < 12);
    if (near) add('target-size', t.el, `${Math.round(t.b.width)}×${Math.round(t.b.height)} next to ${desc(near.el)}`);
  }
  // Headings: one h1 per screen, no skipped levels.
  const hs = all.filter((el) => /^h[1-6]$/.test(el.localName) && shown(el) && !atHidden(el)).map((el) => [Number(el.localName[1]), el]);
  if (!hs.some(([l]) => l === 1)) (issues['heading-h1-missing'] ||= []).push(hs.map(([l, el]) => `h${l} ${text(el).slice(0, 25)}`).slice(0, 4).join(' · ') || 'no headings');
  hs.forEach(([l, el], i) => { if (i && l > hs[i - 1][0] + 1) add('heading-level-skipped', el, `h${hs[i - 1][0]} → h${l}`); });
  // Landmarks: visible text outside main, header, nav, aside, footer, a named region or a dialog.
  const LM = 'main,[role="main"],header,[role="banner"],nav,[role="navigation"],aside,[role="complementary"],footer,[role="contentinfo"],[role="region"][aria-label],section[aria-label],section[aria-labelledby],[role="dialog"],[role="alertdialog"],dialog,[role="search"],form[aria-label]';
  if (!document.querySelector('main,[role="main"]') || ![...document.querySelectorAll('main,[role="main"]')].some(shown)) (issues['landmark-main-missing'] ||= []).push('no visible main');
  const orphans = new Set();
  for (const el of all) if (shown(el) && !atHidden(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !el.closest(LM) && !el.closest('.skip,[role="status"],[role="alert"],[aria-live]')) { let top = el; while (top.parentElement && top.parentElement !== document.body && !top.parentElement.matches(LM)) top = top.parentElement; orphans.add(top); }
  for (const el of orphans) add('content-outside-landmarks', el);
  if (!document.documentElement.lang) (issues['html-lang-missing'] ||= []).push('html');
  if (!document.title.trim()) (issues['document-title-missing'] ||= []).push('title');
  const out = {}; for (const [k, v] of Object.entries(issues)) out[k] = { n: v.length, examples: v.slice(0, 12) };
  return { count: Object.values(issues).reduce((s, v) => s + v.length, 0), issues: out };
};
