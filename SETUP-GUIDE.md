# Thadikkaran Salon Booking System – Setup Guide

## File Structure

```
/thadikkaran-client/
  ├── index.html          ← Client booking app
  ├── client.css          ← Client styles
  └── client.js           ← Client logic (Firebase Auth + DB)

/thadikkaran-admin/
  ├── admin.html          ← Admin dashboard
  ├── admin.css           ← Admin styles
  └── admin.js            ← Admin logic (bookings, blocks, no-shows, FCM)

/firebase-messaging-sw.js ← MUST be at the ROOT of your server
/firebase-database-structure.json ← DB reference schema
```

---

## Step 1 – Firebase Console Setup

### A. Enable Authentication
1. Firebase Console → Authentication → Sign-in method
2. Enable: **Phone** and **Google**
3. Add your domain to "Authorized domains"

### B. Enable Realtime Database
1. Firebase Console → Realtime Database → Create database
2. Start in **test mode** (tighten rules before production)

### C. Enable Cloud Messaging (FCM)
1. Firebase Console → Project Settings → Cloud Messaging
2. Under "Web Push certificates" click **Generate key pair**
3. Copy the **VAPID key** (starts with `BN...`)
4. In `admin.js`, replace `"YOUR_VAPID_PUBLIC_KEY_HERE"` with your VAPID key

### D. Database Security Rules (Recommended)
```json
{
  "rules": {
    "bookings": {
      "$dateKey": {
        ".read":  "auth != null",
        ".write": "auth != null"
      }
    },
    "blocked": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "users": {
      "$uid": {
        ".read":  "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    },
    "noshows": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "admin": {
      ".read":  "auth != null",
      ".write": "auth != null"
    }
  }
}
```

---

## Step 2 – Deploy the Service Worker

The `firebase-messaging-sw.js` file **must be at the root** of your web server.

For example, if your admin app is at `https://yourdomain.com/admin.html`,
then the service worker must be at `https://yourdomain.com/firebase-messaging-sw.js`.

---

## Step 3 – Phone Auth (OTP) Setup

1. Firebase Console → Authentication → Sign-in method → Phone
2. For testing without a real OTP, add test phone numbers:
   - Phone: `+91 9999999999`, OTP: `123456`
3. In production, reCAPTCHA is handled automatically (invisible reCAPTCHA)

---

## Step 4 – FCM Push Notifications Flow

```
Client books appointment
      ↓
Booking written to Firebase Realtime Database
      ↓
Firebase Cloud Function (you write this) detects new booking
      ↓
Cloud Function sends FCM message to admin's token
      ↓
Admin receives push notification even if browser is closed
      ↓
firebase-messaging-sw.js handles the background notification
```

### Sample Cloud Function (functions/index.js)
```javascript
const functions = require("firebase-functions");
const admin     = require("firebase-admin");
admin.initializeApp();

exports.notifyAdminOnNewBooking = functions.database
  .ref("/bookings/{dateKey}/{bookingId}")
  .onCreate(async (snap, context) => {
    const booking = snap.val();

    // Fetch all admin FCM tokens
    const tokensSnap = await admin.database().ref("admin/fcmTokens").get();
    const tokens = [];
    tokensSnap.forEach(child => tokens.push(child.val().token));

    if (tokens.length === 0) return;

    const message = {
      notification: {
        title: "New Booking – Thadikkaran",
        body:  `${booking.name} booked ${booking.serviceName} at ${booking.startTime}`
      },
      data: {
        bookingId:  snap.key,
        dateKey:    context.params.dateKey,
        clientName: booking.name,
        service:    booking.serviceName,
        url:        "/admin.html"
      },
      tokens
    };

    await admin.messaging().sendEachForMulticast(message);
  });
```

---

## Step 5 – Icons for PWA/Notifications

Create two icons and place them at the root of your server:
- `/icon-192.png` – 192×192 px app icon (black T on white, or logo)
- `/badge-72.png`  – 72×72 px monochrome badge icon

---

## Business Logic Summary

| Feature | Implementation |
|---|---|
| Working hours | 9:00 AM – 8:30 PM |
| Closed days | Tuesday (hardcoded, configurable in `SHOP.holidayDays`) |
| Max advance booking | 6 days |
| Slot overlap detection | Duration-aware; slots hidden if they'd overlap any booked slot |
| No-show auto-block | User blocked in DB after 3 recorded no-shows |
| Edit time + overlap alert | Checks all same-day bookings; shows ⚠️ confirm dialog |
| Quick block presets | Lunch (60 min), Short break (30 min), Full day |
| Payment | "Pay at store" only – no gateway |
| Notifications | FCM background push via service worker |
