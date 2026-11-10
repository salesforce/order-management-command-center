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
// The console map's geography: the US states and the AlbersUSA projection at 975×610 (the same constants as geo.js, which
// build-geo.mjs makes), the map's layers and the product overlay's ramp.

// ---------- geography: AlbersUSA at 975×610, same constants as public/geo.js ----------
export function conic(p0, p1, rot, center, k, tx, ty) {
  const rad = Math.PI / 180, s0 = Math.sin(p0 * rad), n = (s0 + Math.sin(p1 * rad)) / 2, c = 1 + s0 * (2 * n - s0), r0 = Math.sqrt(c) / n;
  const raw = (l, p) => { const r = Math.sqrt(c - 2 * n * Math.sin(p)) / n; return [r * Math.sin(l * n), r0 - r * Math.cos(l * n)]; };
  const cc = raw(center[0] * rad, center[1] * rad);
  return (lon, lat) => { let l = lon + rot; if (l > 180) l -= 360; const q = raw(l * rad, lat * rad); return [tx + k * (q[0] - cc[0]), ty - k * (q[1] - cc[1])]; };
}
export const P48 = conic(29.5, 45.5, 96, [-0.6, 38.7], 1300, 487.5, 305);
export const PAK = conic(55, 65, 154, [-2, 58.5], 455, 88.4, 566.3);
export const PHI = conic(8, 18, 157, [-3, 19.9], 1300, 221, 580.6);
export const proj = (lon, lat) => (lat > 51 && lon < -129 ? PAK : lat < 23 && lon < -150 ? PHI : P48)(lon, lat);
export const STATES = { AL:['Alabama',32.8,-86.8],AK:['Alaska',64.2,-150.5],AZ:['Arizona',34.3,-111.7],AR:['Arkansas',34.9,-92.4],CA:['California',37.2,-119.5],CO:['Colorado',39,-105.5],CT:['Connecticut',41.6,-72.7],DE:['Delaware',39,-75.5],DC:['District of Columbia',38.9,-77],FL:['Florida',28.2,-81.6],GA:['Georgia',32.7,-83.4],HI:['Hawaii',20.6,-156.9],ID:['Idaho',44.4,-114.6],IL:['Illinois',40,-89.2],IN:['Indiana',39.9,-86.3],IA:['Iowa',42.1,-93.5],KS:['Kansas',38.5,-98.4],KY:['Kentucky',37.5,-85.3],LA:['Louisiana',31.1,-92],ME:['Maine',45.4,-69.2],MD:['Maryland',39,-76.8],MA:['Massachusetts',42.3,-71.8],MI:['Michigan',43.6,-84.7],MN:['Minnesota',46.3,-94.3],MS:['Mississippi',32.7,-89.7],MO:['Missouri',38.4,-92.5],MT:['Montana',47,-109.6],NE:['Nebraska',41.5,-99.8],NV:['Nevada',39.3,-116.6],NH:['New Hampshire',43.7,-71.6],NJ:['New Jersey',40.2,-74.7],NM:['New Mexico',34.4,-106.1],NY:['New York',42.9,-75.5],NC:['North Carolina',35.6,-79.4],ND:['North Dakota',47.5,-100.5],OH:['Ohio',40.3,-82.8],OK:['Oklahoma',35.6,-97.5],OR:['Oregon',43.9,-120.6],PA:['Pennsylvania',40.9,-77.8],RI:['Rhode Island',41.7,-71.5],SC:['South Carolina',33.9,-80.9],SD:['South Dakota',44.4,-100.2],TN:['Tennessee',35.9,-86.4],TX:['Texas',31.5,-99.3],UT:['Utah',39.3,-111.7],VT:['Vermont',44.1,-72.7],VA:['Virginia',37.5,-78.8],WA:['Washington',47.4,-120.5],WV:['West Virginia',38.6,-80.6],WI:['Wisconsin',44.6,-89.9],WY:['Wyoming',43,-107.5] };
export const BY_NAME = Object.fromEntries(Object.entries(STATES).map(([a, [n]]) => [n.toLowerCase(), a]));
export const toAbbr = (s) => { const t = String(s || '').trim(); return STATES[t.toUpperCase()] ? t.toUpperCase() : BY_NAME[t.toLowerCase()]; };
export const ringArc = (cx,cy,r,f) => { const a=-Math.PI/2, b=a+Math.PI*2*Math.min(.999,Math.max(.001,f)); return `M${cx+r*Math.cos(a)},${cy+r*Math.sin(a)}A${r},${r} 0 ${f>.5?1:0} 1 ${cx+r*Math.cos(b)},${cy+r*Math.sin(b)}`; };
// Layers: one sequential hue each (magnitude); exceptions use the reserved warning hue because they are a warning state.
export const LAYERS = { demand: { label: 'Demand', color: 'var(--d1)', what: 'Delivery groups by ship-to state' }, customers: { label: 'Customers', color: 'var(--d2)', what: 'Customers by bill-to city' }, fulfill: { label: 'Fulfillment', color: 'var(--d3)', what: 'Fulfillment orders by ship-to state' }, risk: { label: 'Exceptions', color: 'var(--d4)', what: 'Open process exceptions by bill-to state' }, cases: { label: 'Cases', color: 'var(--d5)', what: 'Cases by order ship-to / bill-to or account state' }, inventory: { label: 'Inventory', color: 'var(--d6)', what: 'Stock by location and state for one product' } };
// Product overlay: magnitude steps on the blue ramp; the two dark steps take ink labels, the light ones dark labels.
export const RAMP = ['var(--ramp1)', 'var(--ramp2)', 'var(--ramp3)', 'var(--ramp4)'];
export const rampAt = (t) => RAMP[Math.min(3, Math.floor(t * 4))];
