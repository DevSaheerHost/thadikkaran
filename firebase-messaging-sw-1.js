// ═══════════════════════════════════════════════
//  firebase-messaging-sw.js
//  THADIKKARAN – Background Push Notification Handler
//
//  DEPLOYMENT:
//  ► Place this file in the ROOT of your web server
//    (same level as index.html / admin.html)
//  ► This file MUST be served from the root path "/"
//    so the service worker scope covers the whole app.
//
//  IMPORTANT: Update the firebaseConfig below to
//  match your project's exact credentials.
// ═══════════════════════════════════════════════

// Import Firebase scripts for the service worker environment
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// ── Firebase Config (must match the main app) ──
firebase.initializeApp({
  apiKey:            "AIzaSyBZPfyCZ36MgCNcjnFrsgQ6mAigylEOHww",
  authDomain:        "todolistformarcket.firebaseapp.com",
  databaseURL:       "https://todolistformarcket-default-rtdb.firebaseio.com",
  projectId:         "todolistformarcket",
  storageBucket:     "todolistformarcket.firebasestorage.app",
  messagingSenderId: "377052629282",
  appId:             "1:377052629282:web:f981c4ec54aee921b0fd7b"
});

// ── Get messaging instance ──
const messaging = firebase.messaging();

// ═══════════════════════════════════════════════
//  BACKGROUND MESSAGE HANDLER
//  Fires when the app is in the background or closed.
//  FCM calls this with the payload from your server/Firebase function.
// ═══════════════════════════════════════════════

messaging.onBackgroundMessage((payload) => {
  console.log("[Service Worker] Background message received:", payload);

  // Extract notification details from payload
  const title = payload.notification?.title || "New Booking – Thadikkaran";
  const body  = payload.notification?.body  || "A new appointment has been made.";

  // Notification options
  const options = {
    body,
    icon:  "/icon-192.png",   // Replace with your actual icon path
    badge: "/badge-72.png",   // Replace with your actual badge path
    tag:   "thadikkaran-booking",  // Replaces previous notification with same tag
    renotify: true,           // Vibrate/sound even if same tag exists
    requireInteraction: true, // Keep notification visible until dismissed

    // Vibration pattern: vibrate, pause, vibrate
    vibrate: [200, 100, 200],

    // Data passed to the notification click handler
    data: {
      url:        payload.data?.url || "/admin.html",
      bookingId:  payload.data?.bookingId || null,
      dateKey:    payload.data?.dateKey   || null,
      clientName: payload.data?.clientName || "Client",
      service:    payload.data?.service    || "Service"
    },

    // Action buttons on the notification
    actions: [
      { action: "view",    title: "View Booking" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  // Show the notification
  self.registration.showNotification(title, options);
});

// ═══════════════════════════════════════════════
//  NOTIFICATION CLICK HANDLER
//  Opens / focuses the admin app when the admin
//  taps the notification.
// ═══════════════════════════════════════════════

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Handle dismiss action — do nothing
  if (event.action === "dismiss") return;

  // Determine target URL: from data, or default to admin
  const targetUrl = event.notification.data?.url || "/admin.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If an admin tab is already open anywhere, focus it
      for (const client of clientList) {
        if (client.url.includes("admin") && "focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICK", data: event.notification.data });
          return client.focus();
        }
      }
      // No admin tab open — open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ═══════════════════════════════════════════════
//  SERVICE WORKER LIFECYCLE
// ═══════════════════════════════════════════════

// Activate immediately (skip waiting for old SW to die)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
