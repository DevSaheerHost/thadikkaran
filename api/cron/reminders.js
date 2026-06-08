const admin = require("firebase-admin");

function initFirebase() {
  if (admin.apps.length) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    databaseURL: "https://todolistformarcket-default-rtdb.firebaseio.com",
  });
}

// Vercel cron — runs every minute (requires Vercel Pro).
// On Hobby plan: add CRON_SECRET env var and call manually, or
// upgrade to Pro and set schedule "* * * * *" in vercel.json.
module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  initFirebase();
  const db        = admin.database();
  const fcm       = admin.messaging();
  const now       = Date.now();
  const WINDOW_MS = 90 * 1000; // ±90 seconds tolerance

  const snap = await db.ref("reminders").once("value");
  if (!snap.exists()) return res.status(200).json({ sent: 0 });

  let sent = 0;
  const tasks = [];

  snap.forEach((userSnap) => {
    const uid = userSnap.key;
    userSnap.forEach((bookingSnap) => {
      const r = bookingSnap.val();
      const bookingId = bookingSnap.key;

      const REMINDER_DEFS = [
        {
          key:   "tenMin",
          title: "✂ Appointment in 10 Minutes",
          body:  `Your ${r.serviceName} starts at ${r.startTime}. Head over now!`,
        },
        {
          key:   "onTime",
          title: "✂ Your Appointment Starts Now",
          body:  `Time for your ${r.serviceName} at Thadikkaran!`,
        },
        {
          key:   "thanks",
          title: "✂ Thank You!",
          body:  `Hope you loved your ${r.serviceName}. See you again at Thadikkaran!`,
        },
      ];

      REMINDER_DEFS.forEach((def) => {
        const item = r[def.key];
        if (!item || item.sent) return;
        const due = item.time - now;
        if (due > WINDOW_MS || due < -WINDOW_MS) return; // not yet / already passed

        tasks.push(async () => {
          const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
          if (!tokenSnap.exists()) return;
          try {
            await fcm.send({
              token: tokenSnap.val(),
              notification: { title: def.title, body: def.body },
              data: { type: def.key, bookingId, url: "https://thadikkaran.vercel.app/" },
              webpush: {
                notification: {
                  icon: "/icon-192.png",
                  badge: "/badge-72.png",
                  vibrate: [150, 80, 150],
                },
              },
            });
            await db.ref(`reminders/${uid}/${bookingId}/${def.key}/sent`).set(true);
            sent++;
          } catch (err) {
            // Stale token — clean up
            if (err.code === "messaging/registration-token-not-registered") {
              await db.ref(`users/${uid}/fcmToken`).remove();
            }
          }
        });
      });
    });
  });

  await Promise.all(tasks.map((t) => t()));
  return res.status(200).json({ sent });
};
