// ═══════════════════════════════════════════════
//  Thadikkaran – FCM Notifier (Termux / Node.js)
//  Runs on your phone in background via Termux
//
//  SETUP:
//  1. pkg install nodejs
//  2. npm install firebase-admin
//  3. Download your Firebase service account key:
//     Firebase Console → Project Settings → Service Accounts
//     → Generate new private key → save as serviceAccount.json
//     in the same folder as this file
//  4. node notifier.js
//
//  To run in background (keep running after closing Termux):
//  pkg install termux-services
//  Then run: nohup node notifier.js &
// ═══════════════════════════════════════════════

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://todolistformarcket-default-rtdb.firebaseio.com"
});

const db        = admin.database();
const messaging = admin.messaging();

console.log("✅ Thadikkaran notifier started. Watching for new bookings...");

// ── Watch for new bookings in real-time ──
// We listen to the entire bookings node and detect new children
db.ref("bookings").on("child_added", (dateSnap) => {
  const dateKey = dateSnap.key;

  // For each date node, watch for new individual bookings
  dateSnap.ref.on("child_added", async (bookingSnap) => {
    const booking   = bookingSnap.val();
    const bookingId = bookingSnap.key;

    // Skip walk-in / admin bookings
    if (booking.source === "admin") return;

    // Only notify for bookings created in the last 30 seconds
    // (prevents re-notifying old bookings on script restart)
    const ageMs = Date.now() - (booking.createdAt || 0);
    if (ageMs > 30000) return;

    console.log(`🔔 New booking: ${booking.name} – ${booking.serviceName} at ${booking.startTime} on ${dateKey}`);

    // Fetch admin FCM tokens
    const tokensSnap = await db.ref("admin/fcmTokens").get();
    if (!tokensSnap.exists()) {
      console.log("⚠️  No admin FCM tokens registered yet.");
      return;
    }

    const tokens = [];
    tokensSnap.forEach((child) => {
      const data = child.val();
      if (data && data.token) tokens.push(data.token);
    });

    if (tokens.length === 0) return;

    const clientName  = booking.name        || "A client";
    const serviceName = booking.serviceName || "a service";
    const price       = booking.price ? `₹${booking.price}` : "At Store";
    const timeDisplay = formatTime(booking.startTime || "");

    const message = {
      notification: {
        title: "📅 New Booking – Thadikkaran",
        body:  `${clientName} → ${serviceName} at ${timeDisplay} · ${price}`,
      },
      data: {
        bookingId,
        dateKey,
        clientName,
        serviceName,
        url: "/admin.html",
      },
      webpush: {
        notification: {
          title: "📅 New Booking – Thadikkaran",
          body:  `${clientName} → ${serviceName} at ${timeDisplay}`,
          icon:  "/icon-192.png",
          tag:   "thadikkaran-booking",
          requireInteraction: true,
        },
        fcmOptions: {
          link: "/admin.html",
        },
      },
      tokens,
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      console.log(`✅ Notification sent (${response.successCount}/${tokens.length} delivered)`);

      // Clean up expired tokens
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          const code = res.error && res.error.code;
          console.log(`  ⚠️  Token[${idx}] failed: ${code}`);
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            // Remove stale token from DB
            tokensSnap.forEach((child) => {
              if (child.val() && child.val().token === tokens[idx]) {
                db.ref(`admin/fcmTokens/${child.key}`).remove();
                console.log(`  🗑️  Removed stale token.`);
              }
            });
          }
        }
      });
    } catch (err) {
      console.error("❌ FCM error:", err.message);
    }
  });
});

// Keep process alive
process.on("SIGINT", () => {
  console.log("\n👋 Notifier stopped.");
  process.exit(0);
});

function formatTime(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return timeStr;
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
