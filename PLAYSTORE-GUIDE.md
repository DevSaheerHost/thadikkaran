# Publishing Thadikkaran to the Google Play Store

Your app is a website (PWA). The easiest way to put it on Play is a **TWA**
(Trusted Web Activity) — a thin Android wrapper that loads your live site.
You change nothing in your code; site updates = app updates automatically.

## Total cost

| Item | Cost |
|---|---|
| Google Play Console account (one-time, lifetime) | **$25 USD (~₹2,100)** |
| Building the app (PWABuilder) | Free |
| Hosting (Vercel, already yours) | Free |
| **Total** | **~₹2,100, paid once** |

---

## What's already done (in this repo)

- ✅ **Privacy policy** live at `https://thadikkaran.vercel.app/privacy`
  (Play requires this because the app collects name, email, phone.)
- ✅ **Web app manifest** (`client-manifest.json`) upgraded with the fields
  PWABuilder/Play need (id, scope, categories, maskable icons).
- ✅ **Digital Asset Links** file scaffolded at
  `/.well-known/assetlinks.json` (needs 2 values filled in — see Step 3).
- ✅ Privacy link shown on the sign-in screen.

---

## Step-by-step

### Step 1 — Create a Google Play Console account
1. Go to https://play.google.com/console
2. Sign in, choose account type (**Personal** is fine for a single shop).
3. Pay the **one-time $25** fee with a card.
4. Complete identity verification (Google may ask for an ID; takes 1–2 days).

### Step 2 — Build the Android app with PWABuilder
1. Go to https://www.pwabuilder.com
2. Enter: `https://thadikkaran.vercel.app`
3. Click **Start** → it scores your PWA → click **Package for stores**.
4. Choose **Android** → **Generate**.
5. On the Android options screen, note these values (you'll need them in Step 3):
   - **Package ID** (e.g. `app.vercel.thadikkaran.twa`)
   - It will also create a **signing key** (`.keystore`) — **download and keep
     it safe**. If you lose it you can't update the app later.
   - PWABuilder shows the key's **SHA-256 fingerprint**.
     (Or let Google manage signing — see Step 3 note.)
6. Download the ZIP. It contains the `.aab` file you upload to Play.

### Step 3 — Fill in `assetlinks.json` (so the app opens fullscreen)
Open `.well-known/assetlinks.json` in this repo and replace the two
placeholders with the values from PWABuilder / Play Console:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.vercel.thadikkaran.twa",        // your Package ID
      "sha256_cert_fingerprints": [
        "AB:CD:EF:...:99"                                   // your SHA-256
      ]
    }
  }
]
```

> **Important:** If you let **Google Play sign your app** (recommended — Play
> Console → Setup → App signing), use the **"App signing key" SHA-256** shown
> there, NOT the upload key. You can add BOTH fingerprints to the array to be
> safe. After editing, commit and push so Vercel serves the updated file.

Verify it's live: open
`https://thadikkaran.vercel.app/.well-known/assetlinks.json` in a browser —
it should show your JSON.

### Step 4 — Create the app in Play Console & upload
1. Play Console → **Create app** → name "Thadikkaran", type **App**, **Free**.
2. Upload the `.aab` from Step 2 under **Production** (or **Internal testing**
   first — recommended to test before going public).
3. Fill the **store listing**:
   - Short & full description
   - **App icon** 512×512 (you already have `icon-512.png`)
   - **Feature graphic** 1024×500 (make one — canva.com has free templates)
   - **Screenshots** (at least 2 phone screenshots of the app)
4. **Privacy policy URL**: `https://thadikkaran.vercel.app/privacy`
5. Fill the **Data safety** form — declare you collect:
   name, email, phone, and that data is encrypted in transit and not sold.
6. Complete the content rating questionnaire (it's free).

### Step 5 — Submit for review
- Submit. Google review usually takes **a few hours to a few days**.
- First-time personal accounts created after Nov 2023 may need **12 testers for
  14 days** on closed testing before production — Play will tell you if so.

---

## Quick checklist

- [ ] Paid $25, account verified
- [ ] Built `.aab` with PWABuilder, **saved the signing key**
- [ ] Filled `assetlinks.json` with real package name + SHA-256, pushed
- [ ] Confirmed `/​.well-known/assetlinks.json` loads in a browser
- [ ] Store listing: icon, feature graphic, screenshots, descriptions
- [ ] Privacy policy URL added
- [ ] Data safety form completed
- [ ] Uploaded `.aab` and submitted

---

## Notes
- **Updating the app later:** just update the website — the TWA loads the live
  site, so most changes need no new upload. You only re-upload an `.aab` if you
  change the app name, icon, or package config.
- **Keep your signing key forever.** Back it up somewhere safe (not just your
  laptop). Losing it means you can never update this app listing again.
