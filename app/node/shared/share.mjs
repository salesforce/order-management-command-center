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
// Demo-only share server: serves public/ on the network with sample data. No sf CLI, no token, no org access.
// Usage: node app/share.mjs   → http://<your-host>:5179   (env: SHARE_PORT, SHARE_HOST)
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PUBLIC_SOURCES, sourcePath, deploymentName, canonicalDocument, APP_URL, legacyModule } from '../../public/source-layout.js';

const ROOT = path.resolve(fileURLToPath(new URL('public/', APP_URL)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function startShare({ port = +process.env.SHARE_PORT || 5179, host = process.env.SHARE_HOST || '0.0.0.0' } = {}) {
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Every page load is forced into sample-data mode; there is no API behind this server.
  if (url.pathname === '/' && !url.searchParams.has('demo')) { res.writeHead(302, { location: '/?demo=1' + (url.hash || '') }); return res.end(); }
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Demo share — not connected to an org"}'); }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!Object.hasOwn(PUBLIC_SOURCES, name) && !Object.values(PUBLIC_SOURCES).includes(name)) { res.writeHead(404); return res.end('Not found'); }
  if (PUBLIC_SOURCES[name] && name.endsWith('.js') && legacyModule(name)) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return res.end(legacyModule(name)); }
  if (Object.values(PUBLIC_SOURCES).includes(name) && name.endsWith('.html')) { res.writeHead(307, { location: '/' + deploymentName(name) + url.search }); return res.end(); }
  const file = path.join(ROOT, sourcePath(name));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    let body = await readFile(file);
    if (file.endsWith('.html')) body = canonicalDocument(String(body), deploymentName(sourcePath(name)), name);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, host, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Salesforce Order Management Operations Console — demo share (sample data only, no org access)`);
  for (const h of [`${os.hostname().split('.')[0]}.local`, ...ips]) console.log(`  http://${h}:${server.address().port}`);
});
return server;
}
