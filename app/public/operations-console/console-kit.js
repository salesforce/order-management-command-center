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
// The Salesforce Order Management Operations Console page's small helpers (index.html): escaping for the page's HTML strings, number and date formats,
// pressed buttons, tooltips at an element, and keeping focus where it was across a redraw. No state of the page's own.

export const $ = (s) => document.querySelector(s);
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export const money = (v) => v == null ? '—' : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const num = (v) => v == null ? '—' : Number(v).toLocaleString();
// The order drawer's line items: a bundle's parts (each part's MainOrderItemSummaryId) indented under it, a Bundle tag on it;
// every other item as it comes.
export function drawerItems(items) {
  const ids = new Set(items.map((i) => i.Id)), partsOf = new Map(), isPart = (i) => !!i.MainOrderItemSummaryId && ids.has(i.MainOrderItemSummaryId);
  for (const i of items) if (isPart(i)) partsOf.set(i.MainOrderItemSummaryId, [...(partsOf.get(i.MainOrderItemSummaryId) || []), i]);
  const row = (i, part) => `<tr${part ? ' class="bpart"' : ''}><td>${esc(i.Name || i.ProductCode)}${partsOf.has(i.Id) ? ' <span class="pill">Bundle</span>' : ''}<div class="muted">${esc(i.TypeCode || '')} ${esc(i.Status || '')}</div></td><td class="num">${num(i.Quantity)}</td><td class="num">${num(i.QuantityCanceled)}</td><td class="num">${money(i.TotalPrice)}</td></tr>`;
  const walk = (i, part) => [row(i, part), ...(partsOf.get(i.Id) || []).flatMap((x) => walk(x, true))];
  return items.filter((i) => !isPart(i)).flatMap((i) => walk(i, false)).join('');
}
export const pct = (v) => `${Math.round(v * 100)}%`;
export const ago = (d) => { if (!d) return ''; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m/60)}h ago` : `${Math.round(m/1440)}d ago`; };
// Keyboard and screen readers. A row or map mark that opens something on click takes focus (tabindex="0"), and Enter or
// Space on it clicks it (the keydown by the shortcuts). A tooltip shown on hover is shown on focus too, at the element.
export const NATIVE = 'a[href],button,input,select,textarea,summary';
export const tipAt = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
export const pressed = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
// A re-render replaces the element that has focus. keepFocus() puts focus back on its counterpart (the same id, or the same
// data-* key under the same parent id), so a keyboard user keeps their place when a panel refreshes or a click redraws it.
export function focusSel(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const k = Object.keys(el.dataset).find((x) => !['x', 'y', 'tip', 'say'].includes(x)), home = el.parentElement?.closest('[id]');
  return k && home ? `#${CSS.escape(home.id)} [data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(el.dataset[k])}"]` : null;
}
export function keepFocus(paint) {
  const a = document.activeElement, sel = a && a !== document.body ? focusSel(a) : null;
  paint();
  if (sel && (!document.activeElement || document.activeElement === document.body)) document.querySelector(sel)?.focus({ preventScroll: true });
}
