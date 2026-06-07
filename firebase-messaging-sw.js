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

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "New Booking – Thadikkaran";
  const body  = payload.notification?.body  || "A new appointment has been made.";

  self.registration.showNotification(title, {
    body,
    icon:             "/icon-192.png",
    badge:            "/badge-72.png",
    tag:              "thadikkaran-booking",
    renotify:         true,
    requireInteraction: true,
    vibrate:          [200, 100, 200],
    data: {
      url:        payload.data?.url        || "https://thadikkaran.vercel.app/admin.html",
      bookingId:  payload.data?.bookingId  || null,
      dateKey:    payload.data?.dateKey    || null,
      clientName: payload.data?.clientName || null,
    },
    actions: [
      { action: "view",    title: "View Booking" },
      { action: "dismiss", title: "Dismiss" }
    ]
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/admin.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("admin") && "focus" in client) {
          client.postMessage({ type: "BOOKING_NOTIFICATION_CLICK", data: event.notification.data });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
