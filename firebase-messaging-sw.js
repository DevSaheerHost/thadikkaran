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
  const isClient = ["reminder", "ontime", "thankyou"].includes(type);

  const title = payload.data?.title || (isClient ? "✂ Thadikkaran" : "New Booking – Thadikkaran");
  const body  = payload.data?.body  || (isClient ? "Appointment reminder" : "A new appointment has been made.");
  const url   = payload.data?.url || (isClient ? "https://thadikkaran.vercel.app/" : "https://thadikkaran.vercel.app/admin");

  self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/badge-72.png",
    tag:   isClient ? "thadikkaran-reminder" : "thadikkaran-booking",
    renotify: true,
    requireInteraction: !isClient,
    vibrate: [200, 100, 200],
    data: { url, ...payload.data },
    actions: isClient
      ? [{ action: "view", title: "View Booking" }]
      : [{ action: "view", title: "View Booking" }, { action: "dismiss", title: "Dismiss" }]
  });
});

// ── Notification click ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("admin") && "focus" in client) {
          client.postMessage({ type: "BOOKING_NOTIFICATION_CLICK", data: event.notification.data });
          return client.focus();
        }
        if (!client.url.includes("admin") && "focus" in client) {
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
const CACHE = "thadikkaran-sw-v3";
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
