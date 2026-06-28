importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyBZPfyCZ36MgCNcjnFrsgQ6mAigylEOHww",
  authDomain:        "todolistformarcket.firebaseapp.com",
  databaseURL:       "https://todolistformarcket-default-rtdb.firebaseio.com",
  projectId:         "todolistformarcket",
  storageBucket:     "todolistformarcket.firebasestorage.app",
  messagingSenderId: "377052629282",
  appId:             "1:377052629282:web:f981c4ec54aee921b0fd7b"
});

const messaging = firebase.messaging();

// ── Background FCM (works for both admin new-booking and client reminders) ──
messaging.onBackgroundMessage((payload) => {
  const type  = payload.data?.type || "booking";
  // Everything except the admin "booking" alert is a client-facing notification
  const isClient    = type !== "booking";
  const isReminder  = ["tenMin", "onTime", "thanks", "reminder", "ontime", "thankyou"].includes(type);

  const title = payload.data?.title || (isClient ? "✂ Thadikkaran" : "New Booking – Thadikkaran");
  const body  = payload.data?.body  || (isClient ? "Appointment reminder" : "A new appointment has been made.");
  const url   = payload.data?.url || (isClient ? "https://thadikkaran.vercel.app/" : "https://thadikkaran.vercel.app/admin");

  let actions;
  if (isReminder && payload.data?.bookingId) {
    // Two-way reminder: let the customer confirm or reschedule
    actions = [
      { action: "confirm",    title: "✓ I'll be there" },
      { action: "reschedule", title: "Reschedule" },
    ];
  } else if (isClient) {
    actions = [{ action: "view", title: "Open" }];
  } else {
    actions = [{ action: "view", title: "View Booking" }, { action: "dismiss", title: "Dismiss" }];
  }

  self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/badge-72.png",
    tag:   type === "booking" ? "thadikkaran-booking" : (type === "waitlist" ? "thadikkaran-waitlist" : "thadikkaran-reminder"),
    renotify: true,
    requireInteraction: !isClient,
    vibrate: [200, 100, 200],
    data: { url, ...payload.data },
    actions
  });
});

// ── Notification click ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const d = event.notification.data || {};
  let targetUrl = d.url || "/";

  // For booking notifications, append params so a newly opened page can show the detail
  if (d.bookingId && d.dateKey && targetUrl.includes("admin")) {
    targetUrl += `?bdate=${encodeURIComponent(d.dateKey)}&bid=${encodeURIComponent(d.bookingId)}`;
  }

  // Two-way reminder actions → client app handles confirm / reschedule
  const isReschedule = event.action === "reschedule";
  const isConfirm    = event.action === "confirm";
  if ((isConfirm || isReschedule) && d.bookingId) {
    const base = "https://thadikkaran.vercel.app/";
    targetUrl = isConfirm
      ? `${base}?cbid=${encodeURIComponent(d.bookingId)}&cdate=${encodeURIComponent(d.dateKey || "")}`
      : `${base}?bookings=1`;
  }

  const clientMsg = isConfirm
    ? { type: "REMINDER_CONFIRM", data: d }
    : isReschedule
      ? { type: "REMINDER_RESCHEDULE", data: d }
      : { type: "BOOKING_NOTIFICATION_CLICK", data: d };

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("admin") && "focus" in client) {
          client.postMessage({ type: "BOOKING_NOTIFICATION_CLICK", data: d });
          return client.focus();
        }
        if (!client.url.includes("admin") && "focus" in client) {
          client.postMessage(clientMsg);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ── Local notification trigger (from client.js setTimeout) ──
self.addEventListener("message", (event) => {
  const d = event.data;
  if (d?.type !== "SHOW_REMINDER") return;
  self.registration.showNotification(d.title, {
    body:    d.body,
    icon:    "/icon-192.png",
    badge:   "/badge-72.png",
    tag:     "thadikkaran-reminder",
    renotify: true,
    vibrate: [150, 80, 150],
    data:    { url: "https://thadikkaran.vercel.app/", type: d.reminderType }
  });
});

// ── PWA caching (network-first, cache fallback) ──
const CACHE = "thadikkaran-sw-v4";
const PRECACHE = ["/", "/client.css", "/favicon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Delete ALL old caches (including thadikkaran-v1 from the old client-sw.js)
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Only cache same-origin requests — skip Firebase CDN, Google Fonts, API calls
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
