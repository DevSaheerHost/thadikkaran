#!/usr/bin/env node
/**
 * Thadikkaran local driver — serves the static web app and drives it
 * with Playwright + Chromium, using Firebase stub modules so the app
 * renders without network access.
 *
 * Usage:
 *   node .claude/skills/run-thadikkaran/driver.mjs [--page client|admin] [--ss name.png] [--show-step N]
 *
 * Examples:
 *   node .claude/skills/run-thadikkaran/driver.mjs
 *   node .claude/skills/run-thadikkaran/driver.mjs --page admin --ss admin-settings.png
 *   node .claude/skills/run-thadikkaran/driver.mjs --show-step 3
 */

import { chromium }              from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer }          from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join, resolve } from 'path';
import { fileURLToPath }         from 'url';

// ── Config ───────────────────────────────────────────────────────────────────
const EXEC        = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const __file      = fileURLToPath(import.meta.url);
const SKILL_DIR   = resolve(__file, '..');                 // .claude/skills/run-thadikkaran/
const ROOT        = resolve(SKILL_DIR, '../../..');        // project root (3 dirs up from skill dir)
const STUBS_DIR   = join(SKILL_DIR, 'firebase-stubs');
const SS_DIR      = process.env.SS_DIR || '/tmp/thadikkaran-screenshots';
const PORT        = 4503;
const BASE        = `http://localhost:${PORT}`;

// ── CLI args ──────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const getArg   = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};
const PAGE      = getArg('--page', 'client');           // 'client' | 'admin'
const SS_NAME   = getArg('--ss', `${PAGE}-${Date.now()}.png`);
const SHOW_STEP = getArg('--show-step', null);          // 1-4 for client booking steps

if (!existsSync(SS_DIR)) mkdirSync(SS_DIR, { recursive: true });

// ── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

// ── Local HTTP server (serves project files + Firebase stubs) ────────────────
const server = createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  // Serve Firebase stub modules (intercepted CDN URLs proxied via import-map)
  const stubMatch = url.match(/^\/firebase-stub\/(firebase-[^.]+\.js)$/);
  if (stubMatch) {
    const stubPath = join(STUBS_DIR, stubMatch[1]);
    if (existsSync(stubPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' });
      res.end(readFileSync(stubPath, 'utf8'));
      return;
    }
  }

  const filePath = join(ROOT, url);
  if (existsSync(filePath)) {
    const ext  = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found: ' + url);
  }
});

await new Promise(r => server.listen(PORT, r));
console.log(`Server: ${BASE}`);

// ── Import-map script injected into every page ────────────────────────────────
// Rewrites Firebase CDN URLs to our local stubs before the page's own modules load.
const IMPORTMAP_SCRIPT = `
<script type="importmap">
{
  "imports": {
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js":       "${BASE}/firebase-stub/firebase-app.js",
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js":      "${BASE}/firebase-stub/firebase-auth.js",
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js":  "${BASE}/firebase-stub/firebase-database.js",
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js": "${BASE}/firebase-stub/firebase-messaging.js"
  }
}
</script>`;

// ── Launch Playwright ────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

page.on('console', m => {
  if (m.type() === 'error') console.error('[page:err]', m.text().slice(0, 200));
});

// Inject import-map by intercepting the HTML response
await page.route('**/*.html', async route => {
  const resp = await route.fetch();
  let body   = await resp.text();
  // Insert import-map right after <head>
  body = body.replace('<head>', '<head>\n' + IMPORTMAP_SCRIPT);
  await route.fulfill({ response: resp, body });
});

const htmlFile = PAGE === 'admin' ? '/admin.html' : '/index.html';
const url = BASE + htmlFile;
console.log(`Loading: ${url}`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

// When showing a booking step, inject a mock user so showApp() runs and builds the UI
const needsLoggedInUser = SHOW_STEP && PAGE === 'client';
if (needsLoggedInUser) {
  await ctx.addInitScript(() => {
    window.__stubAuthUser = {
      uid: 'dev-preview', displayName: 'Preview User',
      email: 'preview@dev.local', phoneNumber: '+911234567890',
    };
  });
  // Re-navigate so the init script takes effect
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
}

// Wait for splash screen to disappear (Firebase stub calls onAuthStateChanged after 300ms)
try {
  await page.waitForFunction(
    () => window.getComputedStyle(document.getElementById('screen-loading')).display === 'none',
    { timeout: 8000 }
  );
  if (needsLoggedInUser) {
    console.log('Splash gone — app screen loading');
    // Wait for the app to be visible and calendar to render
    await page.waitForFunction(
      () => window.getComputedStyle(document.getElementById('screen-app')).display !== 'none',
      { timeout: 5000 }
    );
    await page.waitForTimeout(400); // let buildCalendarUI / buildServicesUI finish
    console.log('App rendered');
  } else {
    console.log('Splash gone — auth screen showing');
  }
} catch {
  console.log('Warning: splash still visible after timeout');
}

// Optionally jump to a specific booking step (client page only)
if (SHOW_STEP && PAGE === 'client') {
  const step = parseInt(SHOW_STEP, 10);
  console.log(`Showing booking step ${step}...`);
  await page.evaluate(s => {
    // Show step N content, hide others
    document.querySelectorAll('.step-content').forEach((el, i) => {
      const n = i + 1;
      if (n === s) {
        el.classList.add('active'); el.classList.remove('hidden');
      } else {
        el.classList.remove('active'); el.classList.add('hidden');
      }
    });
    // Update step indicator bar
    document.querySelectorAll('.step[data-step]').forEach(el => {
      const n = parseInt(el.dataset.step);
      el.classList.toggle('active', n === s);
      el.classList.toggle('completed', n < s);
    });
  }, step);
  await page.waitForTimeout(300);
}

// Take screenshot
const ssPath = join(SS_DIR, SS_NAME);
await page.screenshot({ path: ssPath, fullPage: true });
console.log(`Screenshot saved: ${ssPath}`);

await browser.close();
server.close();
