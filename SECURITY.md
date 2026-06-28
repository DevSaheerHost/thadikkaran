# Security Guide — Thadikkaran

This app runs on Firebase (Auth + Realtime Database) and Vercel. The most
important "firewall" for this kind of app is **Firebase Realtime Database
Security Rules** — they decide who can read/write your data. Without them, a
database in test mode is open to the entire internet.

---

## 1. Database Security Rules (the firewall) — **deploy these**

The rules live in **`database.rules.json`** (wired into `firebase.json`).

### What they enforce
- **Default deny.** Nothing is readable or writable unless a rule allows it.
- **Auth required everywhere.** Anonymous/unauthenticated access is blocked.
- **Admin-only branches** (write protected, only UIDs in `admin/allowedUids`):
  `services`, `settings`, `blocked`, `noshows`, `deleted` (trash).
- **Per-user branches** (`users/{uid}`, `reminders/{uid}`): a user can only
  read/write their own; admins can read/write all.
- **`bookings`**: any signed-in user can read (needed to show slot availability)
  and create bookings (client uses a transaction on the date node); admins
  manage everything.
- **`admin/allowedUids/{uid}`**: a user may read only their own flag; no one can
  write it from the app (you set admins manually — see below).

### How to deploy

**Option A — Firebase Console (easiest):**
1. Open [Firebase Console](https://console.firebase.google.com) → your project
   (`todolistformarcket`) → **Realtime Database** → **Rules** tab.
2. Copy the contents of `database.rules.json` and paste them in.
3. Click **Publish**.

**Option B — Firebase CLI:**
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database
```

### Make yourself an admin
The admin panel only loads for UIDs flagged in `admin/allowedUids`. To add one:
1. Sign in once at `/admin` (you'll see "Access Denied" — that's expected).
2. In Firebase Console → Realtime Database → Data, find your UID under
   `users/` (or copy it from Authentication → Users).
3. Manually add: `admin / allowedUids / <your-uid> : true`

### Test before relying on it
In the Console **Rules Playground**, simulate:
- Unauthenticated read of `/bookings` → should **deny**.
- Authenticated read of `/bookings` → should **allow**.
- Non-admin write to `/services` → should **deny**.
- Admin write to `/services` → should **allow**.

### Known limitation (future hardening)
Because the client books via a transaction on the whole `bookings/{date}` node,
any signed-in user technically has write access to that date node. This is fine
for a single-shop booking app, but if you ever need stricter guarantees, move
booking writes into a **Cloud Function** and make `bookings` client-read-only.

---

## 2. App Check — block bots & API abuse (recommended)

App Check is Firebase's anti-abuse "firewall": it ensures requests come from
*your* real app, not scripts hitting your database/endpoints.

1. Firebase Console → **App Check** → register the Web app with
   **reCAPTCHA v3** (free).
2. Add the App Check SDK init to `client.js` and `admin.js` (a few lines).
3. Turn on **Enforcement** for Realtime Database once verified.

> Tell me when you're ready and I'll wire the App Check SDK into the app.

---

## 3. HTTP security headers (already added in `vercel.json`)

Applied to every response:
- `Strict-Transport-Security` — force HTTPS for 2 years (HSTS).
- `X-Content-Type-Options: nosniff` — block MIME sniffing.
- `X-Frame-Options: DENY` — prevent clickjacking via iframes.
- `Referrer-Policy: strict-origin-when-cross-origin` — don't leak full URLs.
- `Permissions-Policy` — disable camera/mic/geolocation/payment (unused).

### Optional: Content-Security-Policy (test before enabling)
A CSP further limits what the page can load. It's powerful but easy to break
auth/Firebase if mis-set, so **enable it on a Vercel preview deploy and test
Google sign-in + booking first**. A known-good starting policy for this app:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com;
  frame-src https://*.firebaseapp.com https://accounts.google.com https://*.google.com;
  worker-src 'self';
  manifest-src 'self';
  base-uri 'self';
  object-src 'none'
```

---

## Quick checklist
- [ ] Published `database.rules.json` (Console or CLI)
- [ ] Confirmed your UID is in `admin/allowedUids`
- [ ] Tested allow/deny in Rules Playground
- [ ] (Recommended) Enabled App Check with reCAPTCHA v3
- [ ] (Optional) Tested + enabled CSP on a preview deploy
