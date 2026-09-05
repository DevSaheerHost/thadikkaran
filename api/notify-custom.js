const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { initFirebase, requireAdmin } = require("./_adminAuth");

const SITE = "https://thadikkaran.vercel.app/";
const DAY  = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 60;

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Free-text push from the admin panel.
 *
 * Audience is deliberately explicit rather than always-everyone: a note meant
 * for lapsed customers shouldn't buzz the people who came in yesterday.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!(await requireAdmin(req, res))) return;

  const { title, body, audience } = req.body || {};
  const text = String(body || "").trim();
  if (!text) return res.status(400).json({ error: "body is required" });
  if (text.length > 300) return res.status(400).json({ error: "body is too long" });

  const who = ["all", "inactive", "upcoming"].includes(audience) ? audience : "all";

  try {
    initFirebase();
    const db  = getDatabase();
    const fcm = getMessaging();

    const usersSnap = await db.ref("users").get();
    if (!usersSnap.exists()) return res.status(200).json({ sent: 0, total: 0 });

    // "Upcoming" needs to know who actually has a booking ahead of them
    let upcomingUids = null;
    if (who === "upcoming") {
      upcomingUids = new Set();
      const today = new Date();
      const days = [];
      for (let i = 0; i <= 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        days.push(dateKey(d));
      }
      await Promise.all(days.map(async (k) => {
        const snap = await db.ref(`bookings/${k}`).get().catch(() => null);
        if (!snap || !snap.exists()) return;
        snap.forEach((child) => {
          const b = child.val() || {};
          if (b.uid && b.status === "confirmed") upcomingUids.add(b.uid);
        });
      }));
    }

    const now = Date.now();
    const targets = [];
    const seen = new Set();
    usersSnap.forEach((child) => {
      const u = child.val() || {};
      const token = u.fcmToken;
      if (!token || seen.has(token)) return;
      if (u.blocked === true) return;              // never message a blocked account

      const uid = child.key;
      if (who === "inactive") {
        // No recorded visit at all doesn't mean lapsed — it means unknown
        if (!u.lastVisitAt) return;
        if (now - u.lastVisitAt < INACTIVE_DAYS * DAY) return;
      } else if (who === "upcoming") {
        if (!upcomingUids.has(uid)) return;
      }

      seen.add(token);
      targets.push({ uid, token });
    });

    if (!targets.length) return res.status(200).json({ sent: 0, total: 0 });

    const messages = targets.map((t) => ({
      token: t.token,
      data: {
        type:  "announcement",
        title: String(title || "").trim() || "✂ Thadikkaran",
        body:  text,
        url:   SITE,
      },
    }));

    let sent = 0;
    for (let i = 0; i < messages.length; i += 500) {
      const batch = messages.slice(i, i + 500);
      const resp  = await fcm.sendEach(batch);
      sent += resp.successCount;
      resp.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error && r.error.code;
        const target = targets[i + idx];
        if (target &&
            (code === "messaging/invalid-registration-token" ||
             code === "messaging/registration-token-not-registered")) {
          db.ref(`users/${target.uid}/fcmToken`).remove().catch(() => {});
        }
      });
    }

    res.status(200).json({ sent, total: targets.length, audience: who });
  } catch (err) {
    console.error("notify-custom error:", err);
    res.status(500).json({ error: err.message });
  }
};
