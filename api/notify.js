const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

function initFirebase() {
  if (getApps().length > 0) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  initializeApp({
    credential: cert(sa),
    databaseURL: "https://todolistformarcket-default-rtdb.firebaseio.com",
  });
}

function formatTime(t) {
  if (!t || !t.includes(":")) return t || "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { bookingId, dateKey, booking } = req.body || {};
  if (!bookingId || !dateKey || !booking) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (booking.source === "admin") {
    return res.status(200).json({ skipped: true });
  }

  try {
    initFirebase();
    const db = getDatabase();

    const tokensSnap = await db.ref("admin/fcmTokens").get();
    if (!tokensSnap.exists()) return res.status(200).json({ sent: 0 });

    const entries = [];
    tokensSnap.forEach((child) => {
      const d = child.val();
      if (d && d.token) entries.push({ uid: child.key, token: d.token });
    });

    if (!entries.length) return res.status(200).json({ sent: 0 });

    const name = booking.name || "A client";
    const svc  = booking.serviceName || "a service";
    const time = formatTime(booking.startTime);

    const message = {
      data: {
        type: "booking",
        title: "📅 New Booking – Thadikkaran",
        body: `${name} → ${svc} at ${time}`,
        bookingId,
        dateKey,
        clientName: name,
        serviceName: svc,
        startTime: booking.startTime || "",
        url: "https://thadikkaran.vercel.app/admin",
      },
      tokens: entries.map((e) => e.token),
    };

    const resp = await getMessaging().sendEachForMulticast(message);

    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          db.ref(`admin/fcmTokens/${entries[i].uid}`).remove();
        }
      }
    });

    res.status(200).json({ sent: resp.successCount, total: entries.length });
  } catch (err) {
    console.error("notify error:", err);
    res.status(500).json({ error: err.message });
  }
};
