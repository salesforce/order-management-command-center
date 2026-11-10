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
// Small pure helpers the read model's areas (om-core*.js) share: text out of HTML, escaping for SOQL, Id lists, and the
// errors a route answers with. Imports only om-reads.js.
import { ID_RE } from './om-reads.js';

// Replace ASCII controls with spaces; record notes may retain normalized line breaks.
export function controlSpaces(value, keepNewlines = false) {
  let out = '';
  for (const char of String(value ?? '')) {
    const code = char.charCodeAt(0), control = code < 32 || code === 127;
    out += control && (!keepNewlines || char !== '\n') ? ' ' : char;
  }
  return out;
}

// LiveChatTranscript.Body is HTML: centred <p> lines are system events, and "( 4s ) Name: text<br>" lines are messages
// (a line without that prefix continues the previous message). Returned as plain text only; the page never injects it.
function stripTags(text) {
  let out = '', start = 0;
  while (start < text.length) {
    const open = text.indexOf('<', start);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    if (close < 0) break;
    out += text.slice(start, open);
    start = close + 1;
  }
  return out + text.slice(start);
}
function contentStart(text, start, end) {
  while (start < end - 1 && text[start].trim() === '') start++;
  return start;
}
function transcriptLine(text) {
  if (text[0] !== '(') return null;
  const close = text.indexOf(')'), colon = text.indexOf(':', close + 1);
  if (close < 2 || colon <= close + 1) return null;
  const at = contentStart(text, 1, close), who = contentStart(text, close + 1, colon);
  let end = close, message = colon + 1;
  while (end > at + 1 && text[end - 1].trim() === '') end--;
  if (message < text.length && text[message].trim() === '') message++;
  return [text, text.slice(at, end), text.slice(who, colon), text.slice(message)];
}
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const plainText = (s) => stripTags(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITY[e.toLowerCase()] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
}).trim();
export function parseTranscript(body) {
  const out = [];
  for (const part of String(body ?? '').split(/(<p\b[^>]*>[\s\S]*?<\/p>)/i)) {
    if (/^<p\b/i.test(part)) { const text = plainText(part); if (text) out.push({ kind: 'system', text }); continue; }
    for (const line of part.split(/<br\s*\/?>/i)) {
      const text = plainText(line); if (!text) continue;
      const m = transcriptLine(text), last = out[out.length - 1];
      if (m) {
        const btn = m[3].match(/^\{ChatWindow\w+:([\s\S]*)\}$/);
        out.push(btn ? { kind: 'message', at: m[1], who: m[2], text: '', buttons: btn[1].split(/,(?!\s)/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean) } : { kind: 'message', at: m[1], who: m[2], text: m[3] });
      } else if (last?.kind === 'message') last.text += (last.text ? '\n' : '') + text;
      else out.push({ kind: 'system', text });
    }
  }
  return out;
}

// User text goes into a LIKE literal: drop control characters, cap the length, and backslash-escape quote, backslash and the % _ wildcards.
export const likeEsc = (s) => controlSpaces(s).trim().slice(0, 80).replace(/[\\'%_]/g, '\\$&');
// A list of record Ids for an IN (…): only real Ids, once each.
export const idList = (xs) => [...new Set(xs.filter((x) => x && ID_RE.test(x)))].map((x) => `'${x}'`).join(', ');
export const notFound = (m) => Object.assign(new Error(m), { code: 404 });
// A route refuses input it can't use with a 400; an optional Id is either absent or a real one.
export const bad = (m) => { throw Object.assign(new Error(m), { code: 400 }); };
export const okId = (v) => !v || ID_RE.test(v);
// Omnichannel Inventory's availability lookup, a read the REST API makes as a POST (READ_ONLY_POSTS in om-http.js).
export const OCI_AVAIL = '/commerce/oci/availability/availability-records/actions/get-availability';
// An account as the customer drawer (console) and the Service tab's 360 read it.
export const ACCOUNT_F = ['Id', 'Name', 'Type', 'Rating', 'Industry', 'AnnualRevenue', 'IsPersonAccount', 'PersonContactId', 'PersonEmail', 'Phone', 'PersonMobilePhone', 'BillingCity', 'BillingState', 'Owner.Name', 'CreatedDate'];

// ---------- the Operations Console's and Dashboard's Store and Sales channel filters ----------
// `?store=<WebStore Id>&channel=<SalesChannel Id>`, each optional. Anything else is a 400, so only an Id reaches a query.
export function scopeOf(q) {
  const store = q('store') || null, channel = q('channel') || null;
  if (!okId(store) || !okId(channel)) bad('Bad store or channel');
  return { store, channel };
}
// How each object reaches its order summary: a relationship path, or `semi` for a polymorphic lookup (Invoice and CreditMemo
// point at their order through ReferenceEntityId). Case's lookup is the org's own (caseOrderRel). An object that isn't here,
// or whose path the org lacks (Location, Agent_Proposal__c), can't be filtered: its panel says so instead of showing every store.
export const SCOPE_PATH = {
  OrderSummary: '', FulfillmentOrder: 'OrderSummary.', ProcessException: 'OrderSummary.', ReturnOrder: 'OrderSummary.',
  OrderItemSummary: 'OrderSummary.', OrderItemSummaryChange: 'OrderSummary.', OrderDeliveryGroupSummary: 'OrderSummary.', Shipment: 'OrderSummary.',
  ReturnOrderLineItem: 'ReturnOrder.OrderSummary.', FulfillmentOrderLineItem: 'FulfillmentOrder.OrderSummary.',
  PaymentAuthorization: 'OrderPaymentSummary.OrderSummary.', Payment: 'OrderPaymentSummary.OrderSummary.', Refund: 'OrderPaymentSummary.OrderSummary.',
  Invoice: { semi: 'ReferenceEntityId' }, CreditMemo: { semi: 'ReferenceEntityId' },
};
// The condition on the order summary `path` leads to ('' on OrderSummary itself); '' when nothing is filtered.
export const scopeCond = (scope, path = '') => [scope?.store && `${path}SalesStoreId = '${scope.store}'`, scope?.channel && `${path}SalesChannelId = '${scope.channel}'`].filter(Boolean).join(' AND ');
export const UNSCOPED = 'This panel can’t be filtered by store or sales channel in this org';
// `text` after `prefix` (' AND ', ' WHERE ', ' GROUP BY '), or '' when there's no text: an optional clause without a template
// inside a template.
export const pre = (prefix, text) => (text ? prefix + text : '');
