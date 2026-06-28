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
  try {
    const d = new Date(dateKey + "T00:00:00");
    return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  } catch {
    return dateKey;
  }
}

// Event-driven (called once when a booking is cancelled) — NOT a cron.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { dateKey } = req.body || {};
  if (!dateKey) return res.status(400).json({ error: "Missing dateKey" });

  try {
    initFirebase();
    const db  = getDatabase();
    const fcm = getMessaging();

    const wlSnap = await db.ref(`waitlist/${dateKey}`).get();
    if (!wlSnap.exists()) return res.status(200).json({ sent: 0 });

    // Collect waitlisted users + their push tokens
    const entries = [];
    wlSnap.forEach((child) => {
      const w = child.val();
      if (w && w.uid) entries.push({ uid: w.uid, key: child.key });
    });
    if (!entries.length) return res.status(200).json({ sent: 0 });

    const tokenSnaps = await Promise.all(
      entries.map((e) => db.ref(`users/${e.uid}/fcmToken`).get())
    );

    const messages = [];
    entries.forEach((e, i) => {
      const token = tokenSnaps[i].exists() ? tokenSnaps[i].val() : null;
      if (token) {
        messages.push({
          token,
          data: {
            type: "waitlist",
            title: "🔔 A slot just opened!",
            body: `Someone cancelled on ${prettyDate(dateKey)}. Book now before it's gone!`,
            url: `https://thadikkaran.vercel.app/`,
          },
        });
      }
    });

    let sent = 0;
    if (messages.length) {
      const resp = await fcm.sendEach(messages);
      sent = resp.successCount;
    }

    // One-shot waitlist: clear entries so they aren't re-notified on the next cancel
    await db.ref(`waitlist/${dateKey}`).remove();

    res.status(200).json({ sent, waiting: entries.length });
  } catch (err) {
    console.error("notify-waitlist error:", err);
    res.status(500).json({ error: err.message });
  }
};
