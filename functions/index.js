"use strict";

const {onValueCreated} = require("firebase-functions/v2/database");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();

exports.notifyAdminOnNewBooking = onValueCreated(
  {
    ref: "/bookings/{dateKey}/{bookingId}",
    region: "us-central1",
  },
  async (event) => {
    const booking = event.data.val();
    const dateKey = event.params.dateKey;
    const bookingId = event.params.bookingId;

    if (booking.source === "admin") return null;

    console.log(`New booking: ${bookingId} on ${dateKey}`);

    const db = getDatabase();
    const tokensSnap = await db.ref("admin/fcmTokens").get();

    if (!tokensSnap.exists()) {
      console.log("No admin FCM tokens found.");
      return null;
    }

    const tokens = [];
    tokensSnap.forEach((child) => {
      const data = child.val();
      if (data && data.token) tokens.push(data.token);
    });

    if (tokens.length === 0) return null;

    const clientName = booking.name || "A client";
    const serviceName = booking.serviceName || "a service";
    const startTime = booking.startTime || "";
    const price = booking.price ? `\u20B9${booking.price}` : "At Store";
    const timeDisplay = formatTime(startTime);

    const message = {
      notification: {
        title: "New Booking \u2013 Thadikkaran",
        body: `${clientName} booked ${serviceName} at ${timeDisplay} \u00B7 ${price}`,
      },
      data: {
        bookingId: bookingId,
        dateKey: dateKey,
        clientName: clientName,
        serviceName: serviceName,
        startTime: startTime,
        url: "https://devsaheerhost.github.io/thadikkaran/admin.html",
      },
      webpush: {
        notification: {
          title: "\uD83D\uDCC5 New Booking \u2013 Thadikkaran",
          body: `${clientName} \u2192 ${serviceName} at ${timeDisplay}`,
          icon: "https://devsaheerhost.github.io/thadikkaran/icon-192.png",
          badge: "https://devsaheerhost.github.io/thadikkaran/badge-72.png",
          tag: "thadikkaran-booking",
          requireInteraction: true,
        },
        fcmOptions: {
          link: "https://devsaheerhost.github.io/thadikkaran/admin.html",
        },
      },
      tokens: tokens,
    };

    try {
      const response = await getMessaging().sendEachForMulticast(message);
      console.log(`Sent ${response.successCount}/${tokens.length} notifications.`);

      const staleTokens = [];
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            staleTokens.push(tokens[idx]);
          }
        }
      });

      if (staleTokens.length > 0) {
        tokensSnap.forEach((child) => {
          const d = child.val();
          if (d && staleTokens.includes(d.token)) {
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

function formatTime(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return timeStr;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${hh}:${m} ${ampm}`;
}
