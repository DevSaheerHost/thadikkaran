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

function prettyDate(dateKey) {
  if (!dateKey) return "";
  try {
    return new Date(dateKey + "T00:00:00")
      .toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return dateKey;
  }
}

// Event-driven: called once when the admin closes or reopens the shop. Not a cron.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { type, startDate, endDate, reason } = req.body || {};
  if (type !== "closed" && type !== "reopened") {
    return res.status(400).json({ error: "type must be 'closed' or 'reopened'" });
  }

  try {
    initFirebase();
    const db  = getDatabase();
    const fcm = getMessaging();

    // Collect every customer push token
    const usersSnap = await db.ref("users").get();
    if (!usersSnap.exists()) return res.status(200).json({ sent: 0, total: 0 });

    const targets = [];               // { uid, token }
    const seen = new Set();
    usersSnap.forEach((child) => {
      const token = child.child("fcmToken").val();
      if (token && !seen.has(token)) {
        seen.add(token);
        targets.push({ uid: child.key, token });
      }
    });
    if (!targets.length) return res.status(200).json({ sent: 0, total: 0 });

    let title, body;
    if (type === "closed") {
      const range = endDate
        ? `${prettyDate(startDate)} – ${prettyDate(endDate)}`
        : `from ${prettyDate(startDate)}`;
      title = "🚫 Thadikkaran is temporarily closed";
      body  = reason
        ? `${reason} (${range})`
        : `We're closed ${range}. Bookings are paused — sorry for the trouble!`;
    } else {
      title = "✅ We're open again!";
      body  = "Thadikkaran is back. Book your next appointment now.";
    }

    const messages = targets.map((t) => ({
      token: t.token,
      data: {
        type:  type === "closed" ? "shop-closed" : "shop-reopened",
        title,
        body,
        url: "https://thadikkaran.vercel.app/",
      },
    }));

    // FCM caps a batch at 500 messages
    let sent = 0;
    for (let i = 0; i < messages.length; i += 500) {
      const batch = messages.slice(i, i + 500);
      const resp  = await fcm.sendEach(batch);
      sent += resp.successCount;

      // Clean up tokens that are no longer valid
      resp.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error && r.error.code;
        const target = targets[i + idx];
        if (
          target &&
          (code === "messaging/invalid-registration-token" ||
           code === "messaging/registration-token-not-registered")
        ) {
          db.ref(`users/${target.uid}/fcmToken`).remove().catch(() => {});
        }
      });
    }

    res.status(200).json({ sent, total: targets.length });
  } catch (err) {
    console.error("notify-closure error:", err);
    res.status(500).json({ error: err.message });
  }
};
