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
// What the console's range and period buttons are called, and how a panel labels what it shows: from the payload on screen,
// never from the pick (the pick moves at the click, the data only when it arrives).

export const RANGE_LABEL = { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days', '6m': 'last 6 months', '1y': 'last 12 months', all: 'all open' };
export const PERIOD_LABEL = { today: 'Today', mtd: 'Month to date', qtd: 'Quarter to date', ytd: 'Year to date', '6m': 'Last 6 months', '1y': 'Last 12 months', all: 'All time' };
export const WIDER = { today: 'mtd', mtd: 'qtd', qtd: '6m', ytd: '1y', '6m': '1y', '1y': 'all' }; // empty-period notice steps out to the next wider window
export const PRIOR_LABEL = { today: 'vs yesterday to this hour', mtd: 'vs last month, same point', qtd: 'vs last quarter, same point', ytd: 'vs last year to date', '6m': 'vs the prior 6 months', '1y': 'vs the prior 12 months' };
// A panel's label comes from the payload on screen, never from the pick: the pick moves at the click, the data only when it arrives (or never, if the load fails).
export const shownKey = (payload, field, pick, labels) => (payload && Object.hasOwn(labels, payload[field]) ? payload[field] : pick);
// The one-line answer to a failed load: what was asked, and what is still on screen. Lower-cased, as PERIOD_LABEL is capitalised.
export const failNote = (labels, want, shown, loaded) => {
  const name = (k) => (Object.hasOwn(labels, k) ? labels[k].toLowerCase() : null), w = name(want), s = name(shown);
  if (!loaded) return w ? `Couldn't load ${w}.` : "Couldn't load.";
  if (w && s && want !== shown) return `Couldn't load ${w}. Showing ${s}.`;
  return `${w ? `Couldn't refresh ${w}` : "Couldn't refresh"}. Showing the last good load.`;
};
// The Store and Sales channel filters: the query string a load adds for the pick, and the words for the filters a payload was
// loaded with (its own `scope`, so the words follow the data). Names come from /api/filters; an Id it doesn't list shows as is.
export const scopeQuery = (s) => [['store', s?.store], ['channel', s?.channel]].filter(([, v]) => v).map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join('');
export const scopeText = (scope, options) => {
  const name = (list, id) => list?.find((x) => x.id === id)?.name || id;
  return [scope?.store && `store ${name(options?.stores, scope.store)}`, scope?.channel && `sales channel ${name(options?.channels, scope.channel)}`].filter(Boolean).join(', ');
};
// The pickers' options: a name the org uses for two stores (or channels) gets the end of each one's Id, so they can be told apart.
export const scopeNames = (list) => {
  const seen = {}; for (const x of list || []) seen[x.name] = (seen[x.name] || 0) + 1;
  return (list || []).map((x) => ({ id: x.id, name: seen[x.name] > 1 ? `${x.name} · ${String(x.id).slice(0, 15).slice(-4)}` : x.name }));
};
