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
// Assemble existing hosted URLs from an immutable public-source snapshot. No application compiler or runtime dependency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_URL, canonicalDocument, legacyModule } from '../../public/source-layout.js';

function checkAssetPath(name) {
  if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error('static-site: unsafe asset path');
}

export function staticSite(publicDir, destination, { configuration } = {}) {
  fs.cpSync(publicDir, destination, { recursive: true });
  const manifest = path.join(publicDir, 'source-layout.js');
  if (!fs.existsSync(manifest)) {
    // Publishing an older flat revision keeps its original file/URL contract.
    if (configuration) fs.writeFileSync(path.join(destination, 'om-config.js'), configuration);
    return;
  }
  const literal = fs.readFileSync(manifest, 'utf8').match(/export const PUBLIC_SOURCES = (\{[\s\S]*?\});/);
  if (!literal) throw new Error('static-site: source snapshot has no literal public asset map');
  const sources = JSON.parse(literal[1]);
  for (const [legacy, canonical] of Object.entries(sources)) {
    checkAssetPath(legacy);
    checkAssetPath(canonical);
    const data = fs.readFileSync(path.join(publicDir, canonical));
    const target = path.join(destination, legacy);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const facade = legacy.endsWith('.js') && legacyModule(legacy, sources);
    fs.writeFileSync(target, facade || (legacy.endsWith('.html') ? canonicalDocument(data.toString(), legacy, legacy, sources) : data));
  }
  if (configuration) fs.writeFileSync(path.join(destination, sources['om-config.js']), configuration);
  // Only stable HTML entry URLs are published; source-only HTML paths must not become new OAuth callback locations.
  for (const canonical of Object.values(sources).filter((name) => name.endsWith('.html'))) fs.rmSync(path.join(destination, canonical));
  fs.rmSync(path.join(destination, 'source-layout.js'));
}

// Public hosting command: keep the deployment's own configuration and write only to an empty output directory.
export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error('Usage: node app/tools/shared/static-site.mjs <empty output directory>');
  const destination = path.resolve(args[0]);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Static site output directory must be empty');
  staticSite(fileURLToPath(new URL('public/', APP_URL)), destination);
  console.log(`Built static site at ${destination}; deploy this directory to your static host.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
