#!/usr/bin/env node
/**
 * postbuild-web.js — runs after `expo export --platform web` to harden
 * the dist/ output for production:
 *
 *   1. Removes every `*.map` source-map file under
 *      dist/_expo/static/js/web/. The web build emits them by default so
 *      `expo start --web` and source-map-aware crash reporters work, but
 *      shipping them to prod means anyone with dev tools can read the
 *      entire TypeScript source. Native (ios / android) maps are kept —
 *      they're not served over the web.
 *
 *   2. Strips the `//# sourceMappingURL=` and `//# debugId=` trailers
 *      from each prod JS chunk. Without this dev tools logs noisy 404s
 *      trying to fetch the now-missing .map files, and someone could
 *      still scrape the URL pattern.
 *
 *   3. Copies the Apple App Site Association file into
 *      dist/.well-known/ (preserves the original build:web behavior).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_JS_DIR = path.join(ROOT, 'dist', '_expo', 'static', 'js', 'web');

function removeSourceMaps() {
  if (!fs.existsSync(WEB_JS_DIR)) {
    console.warn(`[postbuild-web] ${WEB_JS_DIR} missing — skipping source-map cleanup.`);
    return;
  }
  const files = fs.readdirSync(WEB_JS_DIR);
  let removed = 0;
  let stripped = 0;
  for (const name of files) {
    const full = path.join(WEB_JS_DIR, name);
    if (name.endsWith('.map')) {
      fs.unlinkSync(full);
      removed += 1;
      continue;
    }
    if (name.endsWith('.js')) {
      const src = fs.readFileSync(full, 'utf8');
      // Strip both the trailing comment lines AND any inline data-URL
      // source map (rare in expo's output but defensive against future
      // bundler changes that might inline maps).
      const next = src
        .replace(/^\s*\/\/[#@]\s+sourceMappingURL=.*$/gm, '')
        .replace(/^\s*\/\/[#@]\s+debugId=.*$/gm, '')
        .replace(/\/\*[#@]\s+sourceMappingURL=[^*]*\*\//g, '');
      if (next !== src) {
        fs.writeFileSync(full, next);
        stripped += 1;
      }
    }
  }
  console.log(`[postbuild-web] removed ${removed} .map file(s), stripped sourceMappingURL from ${stripped} JS file(s).`);
}

function copyAppleAppSiteAssociation() {
  const src = path.join(ROOT, 'public', '.well-known', 'apple-app-site-association');
  if (!fs.existsSync(src)) {
    console.warn('[postbuild-web] public/.well-known/apple-app-site-association missing — skipping copy.');
    return;
  }
  const destDir = path.join(ROOT, 'dist', '.well-known');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'apple-app-site-association'));
  console.log('[postbuild-web] copied apple-app-site-association into dist/.well-known/.');
}

removeSourceMaps();
copyAppleAppSiteAssociation();
