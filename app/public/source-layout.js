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
// Source ownership and stable deployment names. Used by hosts, builders and compatibility tests.
export const PUBLIC_SOURCES = {
  "agent-panel.js": "shared/agent/agent-panel.js",
  "cities.js": "operations-console/cities.js",
  "console-banner.js": "operations-console/console-banner.js",
  "console-charts.js": "operations-console/console-charts.js",
  "console-csv.js": "operations-console/console-csv.js",
  "console-dash-view.js": "operations-console/console-dash-view.js",
  "console-demo.js": "operations-console/console-demo.js",
  "console-drawers.js": "operations-console/console-drawers.js",
  "console-geo.js": "operations-console/console-geo.js",
  "console-jcache.js": "operations-console/console-jcache.js",
  "console-kit.js": "operations-console/console-kit.js",
  "console-labels.js": "operations-console/console-labels.js",
  "console-limits-ref.js": "operations-console/console-limits-ref.js",
  "console-limits-view.js": "operations-console/console-limits-view.js",
  "console-limits.js": "operations-console/console-limits.js",
  "console-map-view.js": "operations-console/console-map-view.js",
  "console-panels.js": "operations-console/console-panels.js",
  "console-service-view.js": "operations-console/console-service-view.js",
  "console-state.js": "operations-console/console-state.js",
  "design/index.html": "shared/design/index.html",
  "geo.js": "operations-console/geo.js",
  "index.html": "operations-console/index.html",
  "om-agent.js": "shared/agent/om-agent.js",
  "om-browser-runtime.js": "shared/transport/browser-runtime.js",
  "om-bundles.js": "shared/data/om-bundles.js",
  "om-command-browser.js": "operations-console/transport/browser.js",
  "om-command-core.js": "operations-console/data/core.js",
  "om-command-platform.js": "operations-console/transport/platform.js",
  "om-command-reads.js": "operations-console/data/console-reads.js",
  "om-config.js": "shared/transport/om-config.js",
  "om-core-dashboard.js": "operations-console/data/om-core-dashboard.js",
  "om-core-org.js": "shared/data/om-core-org.js",
  "om-core-util.js": "shared/data/om-core-util.js",
  "om-customer-reads.js": "shared/data/customer-reads.js",
  "om-display-facts.js": "shared/data/display-facts.js",
  "om-graphql.js": "shared/transport/om-graphql.js",
  "om-http.js": "shared/transport/om-http.js",
  "om-meter.js": "shared/transport/om-meter.js",
  "om-mode.js": "shared/transport/om-mode.js",
  "om-order-reads.js": "shared/data/order-reads.js",
  "om-platform-runtime.js": "shared/transport/platform-runtime.js",
  "om-queue-reads.js": "operations-console/data/queue-reads.js",
  "om-read-runtime.js": "shared/data/read-runtime.js",
  "om-reads.js": "shared/data/om-reads.js",
  "om-rules.js": "shared/data/om-rules.js",
  "tokens.css": "shared/ui/tokens.css"
};

export const TOOL_SOURCES = {
  "license-headers.mjs": "shared/license-headers.mjs",
  "pixel-diff.mjs": "shared/pixel-diff.mjs",
  "static-site.mjs": "shared/static-site.mjs",
  "build-artifact.mjs": "operations-console/build-artifact.mjs",
  "build-live-artifact.mjs": "operations-console/build-live-artifact.mjs",
  "build-geo.mjs": "operations-console/build-geo.mjs",
  "serve-live.mjs": "operations-console/serve-live.mjs",
  "artifact-call-local.js": "operations-console/artifact-call-local.js",
  "artifact-call.js": "operations-console/artifact-call.js",
  "artifact-connector.js": "operations-console/artifact-connector.js",
  "artifact-live.html": "operations-console/artifact-live.html",
  "artifact-live.js": "operations-console/artifact-live.js",
  "artifact-picker.js": "operations-console/artifact-picker.js",
  "graphql-batch.js": "operations-console/graphql-batch.js",
  "om-cowork.js": "operations-console/om-cowork.js",
  "a11y-audit.js": "a11y-audit.js",
  "browser-kit.mjs": "shared/browser-kit.mjs",
  "browser-coverage.mjs": "shared/browser-coverage.mjs",
  "golden.mjs": "shared/golden.mjs",
  "agent-check.mjs": "shared/agent-check.mjs",
  "build-ui-bundle.mjs": "shared/build-ui-bundle.mjs",
  "check-syntax.mjs": "shared/check-syntax.mjs",
  "ci-test-files.mjs": "shared/ci-test-files.mjs",
  "ci-fetch-playwright.mjs": "internal/ci-fetch-playwright.mjs",
  "ci-summary.mjs": "internal/ci-summary.mjs",
  "cowork-skill/SKILL.md": "operations-console/cowork-skill/SKILL.md",
  "cowork-skill/configure.py": "operations-console/cowork-skill/configure.py"
};
export const NODE_SOURCES = { "server.mjs": "node/shared/host.mjs", "sf-conn.mjs": "node/shared/sf-conn.mjs", "share.mjs": "node/shared/share.mjs" };
export const APP_SOURCES = { ...NODE_SOURCES, ...Object.fromEntries(Object.entries(PUBLIC_SOURCES).map(([a,b]) => ['public/'+a,'public/'+b])), ...Object.fromEntries(Object.entries(TOOL_SOURCES).map(([a,b]) => ['tools/'+a,'tools/'+b])) };

export const APP_URL = new URL('../', import.meta.url);
export const CLASSIC_ASSETS = new Set(['geo.js', 'cities.js']);
// Browser redirects can retain distinct module-map keys. A facade explicitly imports the canonical live bindings.
export function legacyModule(legacy, sources = PUBLIC_SOURCES) {
  const source = Object.hasOwn(sources, legacy) ? sources[legacy] : null;
  if (!source || CLASSIC_ASSETS.has(legacy)) return null;
  const spec = JSON.stringify(relativePath(legacy, source));
  return `export * from ${spec};\n` + (/^service\/i18n-(?:en|es|fr)\.js$/.test(legacy) ? `export { default } from ${spec};\n` : '');
}
export function sourcePath(legacy, sources = PUBLIC_SOURCES) {
  if (Object.hasOwn(sources, legacy)) return sources[legacy];
  if (legacy) {
    const directories = Object.entries(sources).filter(([name]) => name.startsWith(legacy + '/'))
      .map(([name, target]) => target.slice(0, -(name.length - legacy.length)));
    if (directories.length && directories.every((directory) => directory === directories[0])) return directories[0];
  }
  return legacy;
}
export const deploymentName = (source, sources = PUBLIC_SOURCES) => Object.entries(sources).find(([, target]) => target === source)?.[0] || source;
export function relativePath(from, to) {
  const base = from.split('/').slice(0, -1), target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift(); }
  const result = '../'.repeat(base.length) + target.join('/');
  return result.startsWith('.') ? result : './' + result;
}
export function resolvePath(from, spec) {
  return decodeURIComponent(new URL(spec, 'https://layout.invalid/' + from).pathname.slice(1));
}
// The served/deployed legacy layout has stable URLs. Actual modules import canonical sources on disk.
export function deploymentText(text, source, destination = deploymentName(source), sources = PUBLIC_SOURCES) {
  return text.replace(/((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"])(\.{1,2}\/[^'"]+\.(?:m?js))(['"])/g,
    (_, before, spec, after) => before + relativePath(destination, deploymentName(resolvePath(source, spec), sources)) + after);
}
export function canonicalText(text, legacy, destination = sourcePath(legacy), sources = PUBLIC_SOURCES) {
  return text.replace(/((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"])(\.{1,2}\/[^'"]+\.(?:m?js))(['"])/g,
    (_, before, spec, after) => before + relativePath(destination, sourcePath(resolvePath(legacy, spec), sources)) + after);
}
export function canonicalDocument(text, legacy, destination = legacy, sources = PUBLIC_SOURCES) {
  return canonicalText(text, legacy, destination, sources).replace(/((?:src|href)=")([\w./-]+\.js)(")/g,
    (_, before, spec, after) => before + relativePath(destination, sourcePath(resolvePath(legacy, './' + spec), sources)) + after);
}

// A virtual view of the stable public layout, for packaging and source-text contract tests.
// IO is supplied by the caller; this description imports no Node code and never runs in an application page.
export function createSourceView(fs, path, toPath = (p) => p) {
  const roots = new Map();
  const materializedFile = (root, source, relative, legacy) => {
    const tool = source.startsWith('tools/') && path.join(root, 'test/support/legacy-tools', source.slice(6));
    const context = path.join(root, 'test/support/legacy-context', relative);
    if (tool && fs.existsSync(tool)) return tool;
    if (fs.existsSync(context)) return context;
    return path.join(root, legacy);
  };
  const resolver = (root, sources, compatibility) => (file) => {
    let relative = path.relative(root, file).split(path.sep).join('/');
    if (compatibility && relative.startsWith('app/')) relative = relative.slice(4);
    const legacy = deploymentName(relative, sources), source = sourcePath(legacy, sources);
    if (compatibility && !fs.existsSync(path.join(root, source))) {
      const fallback = materializedFile(root, source, relative, legacy);
      if (fs.existsSync(fallback)) return { file: fallback, root, relative, legacy, source, sources, materialized: true };
    }
    return { file: path.join(root, source), root, relative, legacy, source, sources };
  };
  const locate = (input) => {
    const file = toPath(input);
    if (typeof file !== 'string') return { file: input };
    let dir = path.dirname(file);
    if (roots.has(dir)) return roots.get(dir)(file);
    const initial = dir;
    while (true) {
      const isPublic = fs.existsSync(path.join(dir, 'source-layout.js')) && fs.existsSync(path.join(dir, 'shared', 'transport', 'om-http.js'));
      const isApp = fs.existsSync(path.join(dir, 'public', 'source-layout.js')) && fs.existsSync(path.join(dir, 'public', 'shared', 'transport', 'om-http.js'));
      if (isPublic || isApp) {
        const sources = isPublic ? PUBLIC_SOURCES : APP_SOURCES;
        const compatibility = isApp && fs.existsSync(path.join(dir, 'public', 'legacy-source-view.json'));
        const resolve = resolver(dir, sources, compatibility);
        roots.set(initial, resolve); return resolve(file);
      }
      const parent = path.dirname(dir);
      if (parent === dir) return { file: input };
      dir = parent;
    }
  };
  const readFileSync = (file, options) => {
    const at = locate(file), data = fs.readFileSync(at.file, options);
    // Browser tool templates resolve against the generated artifact's flat namespace.
    if (!at.root || at.materialized || !/\.m?js$/.test(at.source) || (at.source.startsWith('tools/') && at.source.endsWith('.js'))) return data;
    const text = deploymentText(String(data), at.source, at.legacy, at.sources);
    return typeof data === 'string' ? text : data.constructor.from(text);
  };
  const writeFileSync = (file, data, options) => {
    const at = locate(file);
    const rewrite = at.root && !at.materialized && /\.m?js$/.test(at.source) && !(at.source.startsWith('tools/') && at.source.endsWith('.js'));
    return fs.writeFileSync(at.file, rewrite ? canonicalText(String(data), at.legacy, at.source, at.sources) : data, options);
  };
  const readdirSync = (dir, options) => {
    const at = locate(path.join(toPath(dir), '__layout_directory__'));
    if (!at.root) return fs.readdirSync(dir, options);
    const relative = path.relative(at.root, toPath(dir)).split(path.sep).join('/');
    const prefix = relative ? relative + '/' : '';
    const virtual = Object.keys(at.sources).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length).split('/')[0]);
    const physical = sourcePath(relative, at.sources) === relative && fs.existsSync(path.join(at.root, relative)) ? fs.readdirSync(path.join(at.root, relative)) : [];
    const names = [...new Set([...physical, ...virtual])].sort();
    if (!options?.withFileTypes) return names;
    return names.map((name) => {
      const entry = locate(path.join(toPath(dir), name)), stats = fs.statSync(entry.file);
      return { name, isFile: () => stats.isFile(), isDirectory: () => stats.isDirectory(), isSymbolicLink: () => false };
    });
  };
  return { ...fs, readFileSync, writeFileSync, readdirSync,
    existsSync: (file) => fs.existsSync(locate(file).file), statSync: (file, ...args) => fs.statSync(locate(file).file, ...args),
    rmSync: (file, ...args) => fs.rmSync(locate(file).file, ...args) };
}
