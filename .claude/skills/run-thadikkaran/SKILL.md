---
name: run-thadikkaran
description: Run, screenshot, and visually verify the Thadikkaran salon booking web app. Use when asked to run the app, take screenshots, verify CSS/layout changes, or preview the client booking flow or admin panel.
---

# Run Thadikkaran

Thadikkaran is a static web app (HTML + JS + CSS) with two pages:
- `index.html` — client booking flow (4-step wizard: Date → Time → Service → Confirm)
- `admin.html` — admin panel (bookings, blocks, no-shows, settings)

The driver at `.claude/skills/run-thadikkaran/driver.mjs` starts a local HTTP server, intercepts Firebase CDN imports (blocked in this container), serves stub modules, and takes a screenshot using Playwright + Chromium.

## Prerequisites

Already available in this container — no installation needed:
- Node 22 at `/opt/node22/bin/node`
- Playwright at `/opt/node22/lib/node_modules/playwright`
- Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`

## Run (agent path)

All commands run from the project root (`/home/user/thadikkaran/`).

**Screenshot the auth screens (no login required):**
```bash
node .claude/skills/run-thadikkaran/driver.mjs --page client --ss client-auth.png
node .claude/skills/run-thadikkaran/driver.mjs --page admin  --ss admin-auth.png
```

**Screenshot a specific booking step (1–4):**
```bash
# Step 1 = Date picker (calendar grid)
node .claude/skills/run-thadikkaran/driver.mjs --page client --show-step 1 --ss step-date.png

# Step 2 = Time slot picker
node .claude/skills/run-thadikkaran/driver.mjs --page client --show-step 2 --ss step-time.png

# Step 3 = Service selection (shows prices)
node .claude/skills/run-thadikkaran/driver.mjs --page client --show-step 3 --ss step-service.png

# Step 4 = Confirm screen
node .claude/skills/run-thadikkaran/driver.mjs --page client --show-step 4 --ss step-confirm.png
```

Screenshots land in `/tmp/thadikkaran-screenshots/` by default. Override with `SS_DIR=/your/path`.

**Read back a screenshot:**
```
Read /tmp/thadikkaran-screenshots/step-date.png
```

## Run (human path)

```bash
python3 -m http.server 4502
# then open http://localhost:4502 in a browser
```

Note: Firebase CDN is blocked in this container so the app stays on the splash screen in a normal browser unless using the driver (which injects stub modules).

## How it works

The driver:
1. Starts `python3 -m http.server` on port 4503 serving the project root
2. Intercepts `*.html` requests and injects an ES module import-map that rewrites all `https://www.gstatic.com/firebasejs/10.12.0/*` URLs to local stub modules in `.claude/skills/run-thadikkaran/firebase-stubs/`
3. Stubs simulate unauthenticated state by default; `--show-step` injects a mock user (with `phoneNumber`) so `showApp()` runs and populates the calendar + services
4. For `--show-step`, DOM is manipulated directly to show the correct step content

## Gotchas

- **Firebase CDN is host-blocked in this container.** `gstatic.com` returns `403 host_not_allowed` at the network level — it's not a TLS error. `--ignore-certificate-errors` and `ignoreHTTPSErrors` don't help. The import-map stub approach is the only way to load the app.
- **`npx serve` redirects `admin.html` to `/admin`** (clean-URL behaviour), and then SPA mode serves `index.html` for `/admin`. Use `python3 -m http.server` instead — it serves files exactly as named.
- **`--show-step` without `--page client`** is a no-op; the flag only applies to `index.html`.
- **The phone modal blocks the app** if the mock user has no `phoneNumber`. The driver injects `phoneNumber: '+911234567890'` on the stub user, which bypasses the prompt.
- **Step 2 shows a loading spinner** when force-shown without a selected date — `loadSlots()` fires but has no date to query. The layout is still fully visible; the slot buttons just don't appear.
- **`ctx.addInitScript` must be called before `page.goto`** (it only affects subsequent navigations). The driver re-navigates when `--show-step` is set.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Error: Cannot find module '/opt/node22/lib/node_modules/playwright/index.mjs'` | Run from project root as the working directory |
| `EADDRINUSE: address already in use 4503` | `kill $(lsof -ti:4503)` |
| Screenshot is blank / "Not found" text | Path resolution error — always `cd /home/user/thadikkaran` first |
| Splash screen never disappears | Firebase stub module not loaded — check that the import-map injection is working (`page.route('**/*.html', ...)` must fire before any scripts run) |
