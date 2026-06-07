// ═══════════════════════════════════════════════
//  Firebase Cloud Functions – Thadikkaran Salon
//  File: functions/index.js
//
//  SETUP STEPS:
//  1. npm install -g firebase-tools
//  2. firebase login
//  3. firebase init functions   (choose JavaScript, your project)
//  4. Copy this file into functions/index.js
//  5. cd functions && npm install
//  6. firebase deploy --only functions
// ═══════════════════════════════════════════════

const { onValueCreated } = require("firebase-functions/v2/database");
const { initializeApp }  = require("firebase-admin/app");
const { getDatabase }    = require("firebase-admin/database");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();

// ─────────────────────────────────────────────
//  TRIGGER: New booking created by client
//  Path: /bookings/{dateKey}/{bookingId}
// ─────────────────────────────────────────────
exports.notifyAdminOnNewBooking = onValueCreated(
  {
    ref:    "/bookings/{dateKey}/{bookingId}",
    region: "us-central1",   // Change if your DB is in a different region
  },
  async (event) => {
    const booking   = event.data.val();
    const dateKey   = event.params.dateKey;
    const bookingId = event.params.bookingId;

    // Skip notifications for walk-in / admin-created bookings
    // (admin already knows — no need to notify themselves)
    if (booking.source === "admin") return null;

    console.log(`New client booking: ${bookingId} on ${dateKey}`, booking);

    // ── Fetch all admin FCM tokens from DB ──
    const db         = getDatabase();
    const tokensSnap = await db.ref("admin/fcmTokens").get();

    if (!tokensSnap.exists()) {
      console.log("No admin FCM tokens found. Skipping notification.");
      return null;
    }

    const tokens = [];
    tokensSnap.forEach((child) => {
      const data = child.val();
      if (data?.token) tokens.push(data.token);
    });

    if (tokens.length === 0) {
      console.log("Token list empty.");
      return null;
    }

    // ── Build the notification payload ──
    const clientName  = booking.name        || "A client";
    const serviceName = booking.serviceName || "a service";
    const startTime   = booking.startTime   || "—";
    const price       = booking.price ? `₹${booking.price}` : "At Store";

    const message = {
      // Notification shown in system tray (works when app is closed)
      notification: {
        title: `📅 New Booking – Thadikkaran`,
        body:  `${clientName} booked ${serviceName} at ${formatTime(startTime)} · ${price}`,
      },

      // Extra data for the service worker / foreground handler
      data: {
        bookingId,
        dateKey,
        clientName,
        serviceName,
        startTime,
        price,
        url:  "/admin.html",
        click_action: "FLUTTER_NOTIFICATION_CLICK"  // Helps some browsers
      },

      // Web-specific config (Android Chrome, desktop Chrome)
      webpush: {
        notification: {
          title: `📅 New Booking – Thadikkaran`,
          body:  `${clientName} → ${serviceName} at ${formatTime(startTime)}`,
          icon:  "/icon-192.png",
          badge: "/badge-72.png",
          tag:   "thadikkaran-new-booking",
          requireInteraction: true,
          actions: [
            { action: "view",    title: "Open Admin" },
            { action: "dismiss", title: "Dismiss"    }
          ]
        },
        fcmOptions: {
          link: "/admin.html"
        }
      },

      // Send to all registered admin tokens
      tokens,
    };

    try {
      const response = await getMessaging().sendEachForMulticast(message);
      console.log(`Sent ${response.successCount} / ${tokens.length} notifications.`);

      // Remove any invalid / expired tokens automatically
      const invalidTokenUids = [];
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          const errCode = res.error?.code;
          console.error(`Token[${idx}] failed:`, errCode);
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            invalidTokenUids.push(tokens[idx]);
          }
        }
      });

      // Clean up stale tokens
      if (invalidTokenUids.length > 0) {
        tokensSnap.forEach((child) => {
          if (invalidTokenUids.includes(child.val()?.token)) {
            db.ref(`admin/fcmTokens/${child.key}`).remove();
          }
        });
      }

    } catch (err) {
      console.error("FCM send error:", err);
    }

    return null;
  }
);

// ─────────────────────────────────────────────
//  HELPER: "09:30" → "9:30 AM"
// ─────────────────────────────────────────────
function formatTime(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return timeStr;
  const [h, m] = timeStr.split(":").map(Number);
  const ampm   = h >= 12 ? "PM" : "AM";
  const hh     = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
