const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { initFirebase, requireAdmin } = require("./_adminAuth");

const SITE = "https://thadikkaran.vercel.app/";
const DAY  = 24 * 60 * 60 * 1000;

function prettyDate(dateKey) {
  try {
    const d = new Date(dateKey + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / DAY);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return "on " + d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  } catch { return dateKey; }
}

function prettyTime(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

/**
 * "Fill the gap": a cancellation left an empty slot, so tell the customers
 * most likely to take it. Event-driven — the admin taps a button. No cron.
 *
 * Targets, in order of preference:
 *   1. Anyone on the waitlist for that date (they asked for exactly this).
 *   2. Customers overdue for a visit (past their own average gap), so the
 *      blast stays small and relevant instead of pinging everyone.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!(await requireAdmin(req, res))) return;

  const { dateKey, time, limit } = req.body || {};
  if (!dateKey || !time) {
    return res.status(400).json({ error: "dateKey and time are required" });
  }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);

  try {
    initFirebase();
    const db  = getDatabase();
    const fcm = getMessaging();

    const [usersSnap, waitSnap] = await Promise.all([
      db.ref("users").get(),
      db.ref(`waitlist/${dateKey}`).get(),
    ]);
    if (!usersSnap.exists()) return res.status(200).json({ sent: 0, total: 0 });

    const waiting = new Set();
    waitSnap.forEach((c) => { waiting.add(c.key); });

    const now = Date.now();
    const pool = [];
    usersSnap.forEach((child) => {
      const u = child.val() || {};
      if (!u.fcmToken || u.blocked === true) return;
      const uid = child.key;
      const onWaitlist = waiting.has(uid);
      // Overdue = past their own rhythm; new customers with no history sit out
      // so a routine gap doesn't turn into a blast to the entire list.
      const overdue = u.lastVisitAt && u.avgGapMs &&
                      (now - u.lastVisitAt) >= u.avgGapMs * 0.85;
      if (!onWaitlist && !overdue) return;
      pool.push({
        uid,
        token: u.fcmToken,
        rank: onWaitlist ? 0 : 1,
        // Within a rank, the longest-waiting customer hears first
        since: now - (u.lastVisitAt || 0),
      });
    });

    pool.sort((a, b) => a.rank - b.rank || b.since - a.since);
    const targets = pool.slice(0, cap);
    if (!targets.length) return res.status(200).json({ sent: 0, total: 0 });

    const title = `💈 ${prettyTime(time)} just opened up`;
    const body  = `A slot freed up ${prettyDate(dateKey)}. Grab it before someone else does.`;

    const messages = targets.map((t) => ({
      token: t.token,
      data: { type: "slot-open", title, body, url: SITE, dateKey, time },
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

    res.status(200).json({
      sent,
      total: targets.length,
      waitlisted: targets.filter((t) => t.rank === 0).length,
    });
  } catch (err) {
    console.error("notify-gap error:", err);
    res.status(500).json({ error: err.message });
  }
};
