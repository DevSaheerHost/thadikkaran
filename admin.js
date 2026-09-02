// ═══════════════════════════════════════════════
//  THADIKKARAN – ADMIN PANEL
//  Bookings, Blocks, No-Shows, Edit + FCM
// ═══════════════════════════════════════════════

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  initializeAuth,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

// ── Firebase Config ──
const firebaseConfig = {
  apiKey: "AIzaSyBZPfyCZ36MgCNcjnFrsgQ6mAigylEOHww",
  authDomain: "todolistformarcket.firebaseapp.com",
  databaseURL: "https://todolistformarcket-default-rtdb.firebaseio.com",
  projectId: "todolistformarcket",
  storageBucket: "todolistformarcket.firebasestorage.app",
  messagingSenderId: "377052629282",
  appId: "1:377052629282:web:f981c4ec54aee921b0fd7b"
};

// IMPORTANT: Replace with your actual VAPID key from Firebase Console > Project Settings > Cloud Messaging
const VAPID_KEY = "BJljfSryCZol-Pg9YfT2x9OKMP4kom5Q6OBeuzgN4773-PLqhvhTPFOVA2PRvwTKDCc3ZeN1h1Uc0ilieNj6NQQ";

const app       = initializeApp(firebaseConfig);
const auth      = initializeAuth(app, {
  persistence: [browserLocalPersistence, inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
const db        = getDatabase(app);
const messaging = getMessaging(app);

// ── Service catalogue (mirrors client SERVICES array) ──
const DEFAULT_SERVICES = [
  { id: "haircut",       name: "Hair Cut (Mens)",  defaultDuration: 40, defaultPrice: 150 },
  { id: "beard",         name: "Beard Setting",    defaultDuration: 40, defaultPrice: 100 },
  { id: "haircut_beard", name: "Hair Cut & Beard", defaultDuration: 40, defaultPrice: 250 },
  { id: "facial",        name: "Facial",           defaultDuration: 40, defaultPrice: 0   },
  { id: "hair_spa",      name: "Hair Spa",         defaultDuration: 40, defaultPrice: 0   },
];
let serviceDurations  = {}; // { svcId: minutes }
let servicePrices     = {}; // { svcId: number | null }  null = "At Store"
let lunchBreakConfig  = { enabled: true, startTime: "13:00", endTime: "14:30" };
let closedDates       = {}; // { dateKey: { reason, closedAt } }

// ── Service icons (SVG, stroke-style, 16×16) ─────────────────────────────────
const SVC_ICONS = {
  haircut: `<svg class="svc-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/>
  </svg>`,
  beard: `<svg class="svc-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <rect x="2" y="9" width="20" height="6" rx="2"/>
    <line x1="7" y1="9" x2="7" y2="15"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="17" y1="9" x2="17" y2="15"/>
  </svg>`,
  haircut_beard: `<svg class="svc-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/>
  </svg>`,
  facial: `<svg class="svc-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="7"/>
    <path d="M9 15s1.5 1.5 3 1.5 3-1.5 3-1.5"/>
    <circle cx="9.5" cy="10.5" r="1" fill="currentColor" stroke="none"/>
    <circle cx="14.5" cy="10.5" r="1" fill="currentColor" stroke="none"/>
  </svg>`,
  hair_spa: `<svg class="svc-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"/>
  </svg>`,
};

// ── State ──
let currentUser     = null;
let currentDateKey  = formatDateKey(new Date());
let editingBooking  = null;   // { key, dateKey, booking }
let noshowBooking   = null;   // { key, dateKey, booking }
let pendingEditTime = null;   // new start time string "HH:MM"
let unsubBookings          = null;  // real-time listener unsubscribe
let unsubNewBookingWatcher = null;  // always-on watcher for new bookings today

// ═══════════════════════════════════
//  AUTH
// ═══════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    showAuthScreen();
    return;
  }

  // Guard: only explicitly allowed UIDs can access the admin panel
  try {
    const snap = await get(ref(db, `admin/allowedUids/${user.uid}`));
    if (!snap.exists()) {
      showAccessDenied("Your UID is not listed under admin/allowedUids.", user.uid, user.email || "");
      return;
    }
    if (snap.val() !== true) {
      showAccessDenied(
        `Your entry exists but is ${JSON.stringify(snap.val())} — it must be boolean true (not a string).`,
        user.uid, user.email || "");
      return;
    }
  } catch (e) {
    // Almost always a database-rules problem (PERMISSION_DENIED)
    showAccessDenied(
      `Couldn't read admin/allowedUids — ${e && e.message ? e.message : e}`,
      user.uid, user.email || "");
    return;
  }

  currentUser = user;
  showApp();
  initFCM();
});

function showAccessDenied(reason = "", uid = "", email = "") {
  hideSplash();
  // Surface the real cause — a generic message makes this impossible to debug.
  const diag = reason
    ? `<div style="background:#151515;border:1px solid #2a2a2a;border-radius:10px;
                   padding:0.9rem 1rem;margin-bottom:1.5rem;text-align:left">
         <div style="color:#d4a34e;font-size:.7rem;letter-spacing:.08em;
                     text-transform:uppercase;margin-bottom:.5rem">Diagnostics</div>
         <div style="color:#bbb;font-size:.78rem;line-height:1.8;word-break:break-all">
           <div><span style="color:#666">Reason:</span> ${reason}</div>
           ${email ? `<div><span style="color:#666">Signed in as:</span> ${email}</div>` : ""}
           ${uid ? `<div><span style="color:#666">Your UID:</span> <code style="color:#8fd18f">${uid}</code></div>` : ""}
         </div>
         <div style="color:#666;font-size:.72rem;margin-top:.7rem;line-height:1.6">
           Check Firebase Console → Realtime Database → Data →
           <code style="color:#999">admin/allowedUids/${uid || "&lt;uid&gt;"}</code>
           is set to boolean <code style="color:#999">true</code>.
         </div>
       </div>`
    : "";

  document.body.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;
                background:#0a0a0a;font-family:sans-serif;padding:2rem;text-align:center">
      <div style="max-width:420px">
        <div style="color:#d4a34e;font-size:2rem;line-height:1;margin-bottom:1rem"><svg class="ico-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.6l2.2 6.3 6.3 2.1-6.3 2.1L12 18.4l-2.2-6.3L3.5 10l6.3-2.1z"/></svg></div>
        <h2 style="color:#fff;font-size:1.3rem;font-weight:600;margin-bottom:.5rem">Access Denied</h2>
        <p style="color:#666;font-size:.9rem;margin-bottom:1.5rem;line-height:1.6">
          This page is for shop staff only.<br>Your account doesn't have admin access.
        </p>
        ${diag}
        <a href="/" style="color:#d4a34e;font-size:.9rem;text-decoration:none">← Back to Booking Page</a>
      </div>
    </div>`;
}

function hideSplash() {
  const el = document.getElementById("screen-loading");
  if (!el || el.classList.contains("hidden")) return;
  el.classList.add("fade-out");
  setTimeout(() => el.classList.add("hidden"), 360);
}

function showAuthScreen() {
  hideSplash();
  document.getElementById("screen-auth").classList.remove("hidden");
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("active");
}

function showApp() {
  hideSplash();
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-auth").classList.remove("active");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("screen-app").classList.add("active");

  // Init date picker to today
  const picker = document.getElementById("bookings-date-picker");
  picker.value = currentDateKey;

  // Set default date for forms to today
  const today = formatDateKey(new Date());
  const mDate = document.getElementById("m-date");
  const bDate = document.getElementById("b-date");
  if (mDate) mDate.value = today;
  if (bDate) bDate.value = today;

  initLunchBreak();
  initServiceDurations();
  initClosedDates();
  startNewBookingWatcher();
  switchTab("bookings", document.querySelector('.nav-link[data-tab="bookings"]'));
  loadNoshows();
  updateReviewsBadge();

  // If opened from a notification click, show the booking detail
  const urlParams = new URLSearchParams(window.location.search);
  const bdate = urlParams.get("bdate");
  const bid   = urlParams.get("bid");
  if (bdate && bid) {
    history.replaceState({}, "", window.location.pathname);
    setTimeout(() => showBookingDetailModal(bdate, bid), 400);
  } else if (urlParams.get("tab") === "insights") {
    history.replaceState({}, "", window.location.pathname);
    if (urlParams.get("filter")) pendingInsightsFilter = urlParams.get("filter");
    setTimeout(() => switchTab("insights", document.querySelector('.nav-link[data-tab="insights"]')), 300);
  }
}

function setupRecaptcha() {
  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
      size: "invisible",
      callback: () => {}
    });
  }
}

window.sendOTP = async function () {
  const phone = document.getElementById("phone-input").value.trim();
  if (phone.length !== 10) { showAuthError("Enter a valid 10-digit number."); return; }
  setAuthLoading(true);
  try {
    setupRecaptcha();
    window._confirmResult = await signInWithPhoneNumber(auth, "+91" + phone, window.recaptchaVerifier);
    document.getElementById("otp-section").classList.remove("hidden");
    clearAuthError();
  } catch (e) {
    showAuthError("OTP send failed: " + (e.message || "Try again."));
    window.recaptchaVerifier = null;
  } finally { setAuthLoading(false); }
};

window.verifyOTP = async function () {
  const code = document.getElementById("otp-input").value.trim();
  if (!code || !window._confirmResult) { showAuthError("Request OTP first."); return; }
  setAuthLoading(true);
  try {
    await window._confirmResult.confirm(code);
  } catch (e) {
    showAuthError("Invalid OTP.");
  } finally { setAuthLoading(false); }
};

window.signInWithGoogle = async function () {
  setAuthLoading(true);
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    showAuthError("Google sign-in failed.");
  } finally { setAuthLoading(false); }
};

window.signOut = async function () {
  if (unsubBookings)           unsubBookings();
  if (unsubNewBookingWatcher)  unsubNewBookingWatcher();
  await fbSignOut(auth);
};

function setAuthLoading(on) { document.getElementById("auth-loading").classList.toggle("hidden", !on); }
function showAuthError(msg) { const el=document.getElementById("auth-error"); el.textContent=msg; el.classList.remove("hidden"); }
function clearAuthError() { document.getElementById("auth-error").classList.add("hidden"); }

// ═══════════════════════════════════
//  FCM – PUSH NOTIFICATIONS
// ═══════════════════════════════════

let _swReg = null;

async function initFCM() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      showNotifBanner("unsupported");
      return;
    }

    const swUrl = new URL("./firebase-messaging-sw.js", import.meta.url).href;
    _swReg = await navigator.serviceWorker.register(swUrl, { scope: "./" });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "BOOKING_NOTIFICATION_CLICK") {
        const d = event.data.data || {};
        if (d.type === "inactive") {
          pendingInsightsFilter = "inactive";
          switchTab("insights", document.querySelector('.nav-link[data-tab="insights"]'));
          return;
        }
        if (d.dateKey && d.bookingId) showBookingDetailModal(d.dateKey, d.bookingId);
      }
    });

    if (Notification.permission === "granted") {
      await registerFCMToken();
    } else if (Notification.permission === "denied") {
      showNotifBanner("denied");
    } else {
      // "default" — must wait for a user click to call requestPermission()
      showNotifBanner("prompt");
    }

  } catch (err) {
    console.error("FCM init error:", err);
  }
}

async function registerFCMToken() {
  try {
    // Wait for an active service worker — more reliable than storing _swReg
    const swReg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) {
      await set(ref(db, `admin/fcmTokens/${currentUser.uid}`), { token, updatedAt: Date.now() });
      onMessage(messaging, (payload) => {
        const title = payload.notification?.title || "New Booking";
        const body  = payload.notification?.body  || "A new appointment was made.";
        showToast(`🔔 ${title}: ${body}`, 6000);
        loadBookings();
      });
      hideNotifBanner();
      return true;
    } else {
      console.warn("FCM: getToken returned empty — check VAPID key in Firebase Console → Project Settings → Cloud Messaging → Web Push certificates");
      return false;
    }
  } catch (err) {
    console.error("FCM token error:", err.message);
    return false;
  }
}

// Called when the admin clicks the "Enable Notifications" button
window.enableNotifications = async function () {
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await registerFCMToken();
    showToast("✓ Notifications enabled! You'll be alerted for every new booking.", 4000);
  } else {
    showNotifBanner("denied");
  }
};

function showNotifBanner(state) {
  const banner = document.getElementById("notif-banner");
  if (!banner) return;
  banner.classList.remove("hidden");
  const msg  = banner.querySelector(".notif-banner-msg");
  const btn  = banner.querySelector(".notif-banner-btn");
  if (state === "prompt") {
    banner.className = "notif-banner notif-banner-warn";
    msg.textContent = "Enable notifications to get alerted for every new booking.";
    btn.textContent = "Enable Notifications";
    btn.onclick = enableNotifications;
    btn.classList.remove("hidden");
  } else if (state === "denied") {
    banner.className = "notif-banner notif-banner-error";
    msg.textContent = "Notifications blocked. Go to browser Settings → Site Settings → Notifications → Allow for this site.";
    btn.classList.add("hidden");
  } else if (state === "unsupported") {
    banner.className = "notif-banner notif-banner-error";
    msg.textContent = "This browser doesn't support push notifications. Use Chrome on Android or desktop.";
    btn.classList.add("hidden");
  }
}

function hideNotifBanner() {
  const banner = document.getElementById("notif-banner");
  if (banner) banner.classList.add("hidden");
}

async function loadNotifStatus() {
  const perm  = document.getElementById("ns-permission");
  const token = document.getElementById("ns-token");
  if (!perm || !token) return;

  // Permission
  const p = Notification.permission;
  perm.textContent  = p === "granted" ? "✓ Granted" : p === "denied" ? "✗ Blocked" : "⚠ Not set";
  perm.className    = "notif-status-val " + (p === "granted" ? "notif-ok" : p === "denied" ? "notif-err" : "notif-warn");

  // Token
  if (!currentUser) { token.textContent = "—"; return; }
  const snap = await get(ref(db, `admin/fcmTokens/${currentUser.uid}`));
  token.textContent = snap.exists() && snap.val().token ? "✓ Saved" : "✗ Not saved";
  token.className   = "notif-status-val " + (snap.exists() && snap.val().token ? "notif-ok" : "notif-warn");
}

window.retryNotifSetup = async function () {
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    const ok = await registerFCMToken();
    showToast(ok ? "✓ Notifications enabled!" : "⚠ Permission granted but token failed — check browser console for details.", ok ? 3000 : 6000);
  } else {
    showToast("Notifications blocked — allow them in browser Settings → Site Settings.", 5000);
  }
  loadNotifStatus();
};

// ═══════════════════════════════════
//  REAL-TIME NEW BOOKING WATCHER
//  Works via Firebase onValue — no FCM or server needed.
//  Fires toast + chime the instant a client submits a booking.
// ═══════════════════════════════════

function startNewBookingWatcher() {
  if (unsubNewBookingWatcher) { unsubNewBookingWatcher(); unsubNewBookingWatcher = null; }

  const todayKey    = formatDateKey(new Date());
  const watchedAt   = Date.now(); // only alert for bookings created AFTER this moment

  unsubNewBookingWatcher = onValue(ref(db, `bookings/${todayKey}`), (snap) => {
    if (!snap.exists()) return;
    snap.forEach(child => {
      const b = child.val();
      if (b && b.source !== "admin"
          && b.status !== "cancelled" && b.status !== "noshow"
          && b.createdAt && b.createdAt > watchedAt) {
        onNewBookingAlert(b);
      }
    });
  });
}

function onNewBookingAlert(booking) {
  const name = booking.name || "A client";
  const svc  = booking.serviceName || "service";
  const time = formatDisplayTime(booking.startTime);
  showToast(`🔔 New booking! ${name} – ${svc} at ${time}`, 7000);
  playBookingChime();
  // Refresh list if admin is on today's bookings tab
  if (currentDateKey === formatDateKey(new Date())) loadBookings();
}

function playBookingChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1108, 0.13], [1320, 0.26]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.45);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.45);
    });
  } catch (e) { /* audio not supported on this browser */ }
}

// ═══════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════

window.switchTab = function (tabId, btn) {
  document.querySelectorAll(".tab-content").forEach(el => {
    el.classList.remove("active");
    el.classList.add("hidden");
  });
  document.querySelectorAll(".nav-link").forEach(el => el.classList.remove("active"));

  const target = document.getElementById(`tab-${tabId}`);
  target.classList.remove("hidden");
  target.classList.add("active");
  if (btn) btn.classList.add("active");

  if (tabId === "bookings") loadBookings();
  if (tabId === "block")    loadActiveBlocks();
  if (tabId === "noshows")  loadNoshows();
  if (tabId === "settings") { loadLunchSettings(); loadServiceSettings(); loadClosedDates(); loadNotifStatus(); loadClosureSettings(); loadSlotPresets(); }
  if (tabId === 'reviews') {
    localStorage.setItem('reviewsSeenAt', Date.now());
    updateReviewsBadge();
    loadReviews();
  }
  if (tabId === 'trash') loadTrash();
  if (tabId === 'insights') loadInsights();
};

// ═══════════════════════════════════
//  BOOKINGS DASHBOARD
// ═══════════════════════════════════

window.changeBookingsDate = function (delta) {
  const d = new Date(currentDateKey);
  d.setDate(d.getDate() + delta);
  currentDateKey = formatDateKey(d);
  document.getElementById("bookings-date-picker").value = currentDateKey;
  loadBookings();
};

window.onDatePickerChange = function () {
  currentDateKey = document.getElementById("bookings-date-picker").value;
  loadBookings();
};

function loadBookings() {
  const list    = document.getElementById("bookings-list");
  const loading = document.getElementById("bookings-loading");
  const noMsg   = document.getElementById("no-bookings-msg");

  list.innerHTML = "";
  loading.classList.remove("hidden");
  noMsg.classList.add("hidden");

  // Update label
  const d = new Date(currentDateKey + "T00:00:00");
  const dd  = String(d.getDate()).padStart(2, "0");
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const yy  = String(d.getFullYear()).slice(-2);
  const day = d.toLocaleDateString("en-IN", { weekday: "long" });
  document.getElementById("bookings-date-label").textContent = `${dd}/${mm}/${yy} · ${day}`;

  // Detach old listener
  if (unsubBookings) unsubBookings();

  const bookingsRef = ref(db, `bookings/${currentDateKey}`);
  unsubBookings = onValue(bookingsRef, (snap) => {
    loading.classList.add("hidden");
    list.innerHTML = "";

    if (!snap.exists()) { noMsg.classList.remove("hidden"); updateStats([]); return; }

    let bookingItems = [];
    snap.forEach(child => {
      bookingItems.push({ key: child.key, ...child.val() });
    });

    // Update stats immediately from bookings snapshot — don't wait for blocks
    updateStats(bookingItems);

    // Also load blocks + contacts (admin-only phone branch) for full card rendering
    Promise.all([
      get(ref(db, `blocked/${currentDateKey}`)),
      get(ref(db, `contacts/${currentDateKey}`)).catch(() => null),
    ]).then(([blockSnap, contactSnap]) => {
      const items = [...bookingItems];

      // Join phones from contacts (new bookings) — legacy bookings still carry item.phone
      if (contactSnap && contactSnap.exists()) {
        const contacts = contactSnap.val() || {};
        items.forEach(it => {
          if (!it.phone && contacts[it.key]?.phone) it.phone = contacts[it.key].phone;
        });
      }

      if (blockSnap.exists()) {
        blockSnap.forEach(c => {
          items.push({ key: c.key, ...c.val(), source: "block", status: "blocked" });
        });
      }

      // Inject lunch break as a virtual block (display only, not stored)
      if (lunchBreakConfig.enabled && lunchBreakConfig.startTime) {
        const [lh, lm] = lunchBreakConfig.startTime.split(":").map(Number);
        const [eh, em] = lunchBreakConfig.endTime.split(":").map(Number);
        items.push({
          key: "__lunch__",
          source: "block",
          status: "blocked",
          startTime: lunchBreakConfig.startTime,
          duration: (eh * 60 + em) - (lh * 60 + lm),
          reason: "Lunch Break",
          _isLunch: true
        });
      }

      // Sort by startTime
      items.sort((a, b) => a.startTime.localeCompare(b.startTime));

      list.innerHTML = "";
      items.forEach(item => list.appendChild(buildBookingCard(item)));
      startTimelineInterval();
      updateFutureBadge();
      attachReviewStars(list);

      if (items.length === 0) noMsg.classList.remove("hidden");
    });
  });
}

function buildBookingCard(item) {
  const isBlock = item.source === "block";
  const card = document.createElement("div");
  card.className = `booking-card status-${item.status || "confirmed"}`;
  card.dataset.bookingKey = item.key || "";
  card.onclick=(e)=>{
    if (e.target.closest('button, a,.booking-tl-line, .booking-actions')) return;
    if (!isBlock && item.phone) openClientHistory(item.phone, item.name);
  }

  const endMin = timeToMinutes(item.startTime) + (item.duration || 30);
  const endStr = minutesToTime(endMin);

  const statusMap = {
    confirmed: "badge-confirmed",
    noshow:    "badge-noshow",
    cancelled: "badge-cancelled",
    blocked:   "badge-blocked",
    finished:  "badge-finished"
  };
  const badgeClass = statusMap[item.status] || "badge-confirmed";
  const statusLabel = item.status === "blocked" ? "Blocked" : (item.status || "confirmed");
  // Manual / walk-in bookings (added from the admin panel) get a corner sticker
  const sourceSticker = item.source === "admin" ? `<div class="booking-manual-sticker">✋ Walk-in</div>` : "";

  const actionsHtml = isBlock
    ? (item._isLunch
        ? `<button class="btn btn-sm btn-outline" onclick="switchTab('settings', document.querySelector('.nav-link[data-tab=\\'settings\\']'))">Edit in Settings</button>`
        : `<button class="btn btn-sm btn-danger" onclick="removeBlock('${item.key}')">Remove</button>`)

    : item.status !== "noshow" && item.status !== "cancelled" && item.status !== "finished"
      ? `
        <button class="btn btn-sm btn-success" onclick="finishBooking('${item.key}', '${currentDateKey}')">Finish</button>
        <button class="btn btn-sm btn-outline" onclick="openEditModal('${item.key}', '${currentDateKey}')">Edit Time</button>
        <button class="btn btn-sm btn-warning" onclick="openCancelModal('${item.key}', '${currentDateKey}')">Cancel</button>
        <button class="btn btn-sm btn-danger"  onclick="openNoshowModal('${item.key}', '${currentDateKey}')">No-Show</button>
      `
      : item.status === "finished"
        ? `<button class="btn btn-sm btn-danger" onclick="deleteBooking('${item.key}','${currentDateKey}')">🗑 Delete</button>`
        : `<span class="source-tag">${statusLabel}</span>`;

  const svcIcon = !isBlock ? (SVC_ICONS[item.serviceId] || "") : "";

  card.innerHTML = `
    ${sourceSticker}
    <div class="booking-time">
      <div class="booking-time-start">${formatDisplayTime(item.startTime)}</div>
      <div class="booking-tl">
        <div class="booking-tl-dot booking-tl-dot--top"></div>
        <div class="booking-tl-line"
             data-start="${timeToMinutes(item.startTime)}"
             data-end="${endMin}"
             data-key="${item.key || ''}"
             data-date="${currentDateKey}">
          <div class="booking-tl-fill"></div>
        </div>
        <div class="booking-tl-dot booking-tl-dot--bottom"></div>
      </div>
      <div class="booking-time-end">${formatDisplayTime(endStr)}</div>
      ${svcIcon}
    </div>
    <div class="booking-separator"></div>
    <div class="booking-info">
      <div class="booking-name">${item.name || "Blocked"}</div>
      <div class="booking-service">${isBlock ? (item.reason || "Break") : item.serviceName}</div>
      ${!isBlock && item.phone ? `<a class="booking-phone" href="tel:${item.phone.startsWith('+') ? item.phone : '+91' + item.phone}">📞 ${item.phone.startsWith('+') ? item.phone.replace('+91', '+91 ') : '+91 ' + item.phone}</a>` : ""}
      <div class="booking-meta">
        <span class="status-badge ${badgeClass}">${statusLabel}</span>
        ${!isBlock && item.clientConfirmed && item.status !== "cancelled" && item.status !== "finished" ? `<span class="status-badge badge-cconfirmed">✓ Confirmed</span>` : ""}
      </div>
      ${!isBlock && item.createdAt ? `<div class="booking-booked-at">Booked ${formatBookedAt(item.createdAt)}</div>` : ""}
      ${!isBlock && item.price ? `<div class="booking-price-tag">₹${item.price}</div>` : ""}
      ${item.status === "finished" && !isBlock ? `<div class="booking-review-stars"></div>` : ""}
      ${item.status === "cancelled" && item.cancelReason ? `<div class="booking-cancel-reason">"${item.cancelReason}"</div>` : ""}
    </div>
    <div class="booking-actions">${actionsHtml}</div>
  `;

  return card;
}





function closeClientHistory() {
  document.querySelector('#clientHistoryModal')?.classList.remove('active');
  document.querySelector('#clientHistoryModal')?.classList.add('hidden');
}

async function openClientHistory(phone, name) {
  let modal = document.getElementById('clientHistoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'clientHistoryModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box client-history-box">
        <div class="modal-header">
          <h3 id="chTitle">Client History</h3>
          <button class="modal-close btn-icon" id="chCloseBtn">✕</button>
        </div>
        <div id="chStats" class="ch-stats"></div>
        <div id="chList" class="ch-list"></div>
      </div>`;
    document.body.appendChild(modal);

    // Attach the close handler ONCE, right when the modal is first built
    document.getElementById('chCloseBtn').addEventListener('click', closeClientHistory);
  }

  document.getElementById('chTitle').textContent = `${name || 'Client'} — ${phone}`;
  document.getElementById('chStats').innerHTML = `
  <div class="skel-ch-stats">
    ${Array(5).fill('<div class="skel skel-ch-stat"></div>').join('')}
  </div>`;
document.getElementById('chList').innerHTML = `
  <div class="skel-list">
    ${Array(4).fill(`
      <div class="skel-ch-row">
        <div class="skel skch-date"></div>
        <div class="skel skch-time"></div>
        <div class="skel skch-svc"></div>
        <div class="skel skch-price"></div>
      </div>
    `).join('')}
  </div>`;
  modal.classList.remove('hidden');
  modal.classList.add('active');

  try {
    const snap = await get(ref(db, 'bookings'));
    const allDates = snap.val() || {};
    const matches = [];

    Object.keys(allDates).forEach(dateKey => {
      const dayBookings = allDates[dateKey] || {};
      Object.keys(dayBookings).forEach(key => {
        const b = dayBookings[key];
        if (b.phone && b.phone === phone) {
          matches.push({ ...b, key, dateKey: b.dateKey || dateKey });
        }
      });
    });

    matches.sort((a, b) => {
      const ak = `${a.dateKey}T${a.startTime}`;
      const bk = `${b.dateKey}T${b.startTime}`;
      return bk.localeCompare(ak);
    });

    renderClientHistory(matches);
  } catch (err) {
    document.getElementById('chStats').innerHTML = `<div class="ch-error">Failed to load: ${err.message}</div>`;
  }
}
function renderClientHistory(bookings) {
  const total = bookings.length;
  const finished = bookings.filter(b => b.status === 'finished');
  const noshows = bookings.filter(b => b.status === 'noshow');
  const cancelled = bookings.filter(b => b.status === 'cancelled');
  const totalSpent = finished.reduce((sum, b) => sum + (Number(b.price) || 0), 0);

  document.getElementById('chStats').innerHTML = `
    <div class="ch-stat"><span>${total}</span>Total Visits</div>
    <div class="ch-stat"><span>${finished.length}</span>Completed</div>
    <div class="ch-stat"><span>${noshows.length}</span>No-Shows</div>
    <div class="ch-stat"><span>${cancelled.length}</span>Cancelled</div>
    <div class="ch-stat"><span>₹${totalSpent}</span>Total Spent</div>
  `;

  const statusMap = {
    confirmed: 'badge-confirmed', noshow: 'badge-noshow',
    cancelled: 'badge-cancelled', finished: 'badge-finished'
  };

  document.getElementById('chList').innerHTML = bookings.map(b => `
    <div class="ch-row">
      <div class="ch-row-date">${b.dateKey}</div>
      <div class="ch-row-time">${formatDisplayTime(b.startTime)}</div>
      <div class="ch-row-service">${b.serviceName || '-'}</div>
      <div class="ch-row-price">${b.price ? '₹' + b.price : '-'}</div>
      <span class="status-badge ${statusMap[b.status] || 'badge-confirmed'}">${b.status || 'confirmed'}</span>
    </div>
  `).join('') || `<div class="ch-empty">No history found.</div>`;
}



async function attachReviewStars(listEl) {
  try {
    const snap = await get(ref(db, "reviews"));
    if (!snap.exists()) return;
    snap.forEach(c => {
      const r = c.val();
      if (!r.rating) return;
      const cardEl = listEl.querySelector(`[data-booking-key="${c.key}"]`);
      if (!cardEl) return;
      const starsEl = cardEl.querySelector(".booking-review-stars");
      if (!starsEl) return;
      const filled = Math.round(r.rating);
      starsEl.innerHTML = [1,2,3,4,5]
        .map(i => `<span class="bk-rv-star${i <= filled ? " filled" : ""}">${i <= filled ? "★" : "☆"}</span>`)
        .join("") + `<span class="bk-rv-label">${filled}/5</span>`;
    });
  } catch (e) {}
}

async function updateFutureBadge() {
  const btn = document.getElementById("btn-date-next");
  if (!btn) return;

  // Count from the day after the currently viewed date, not always from today
  const base = new Date(currentDateKey + "T00:00:00");
  let confirmed = 0, cancelled = 0;

  for (let i = 1; i <= 6; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const snap = await get(ref(db, `bookings/${formatDateKey(d)}`));
    if (!snap.exists()) continue;
    snap.forEach(child => {
      const b = child.val();
      if (b.source === "block") return;
      if (b.status === "cancelled") cancelled++;
      else confirmed++;
    });
  }

  let badge = btn.querySelector(".future-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "future-badge";
    btn.appendChild(badge);
  }

  if (confirmed > 0 || cancelled > 0) {
    badge.textContent = confirmed > 0 ? confirmed : cancelled;
    badge.className   = `future-badge${confirmed === 0 ? " future-badge--cancelled" : ""}`;
  } else {
    badge.remove();
  }
}

function updateStats(items) {
  const bookings  = items.filter(b => b.source !== "block");
  const confirmed = bookings.filter(b => b.status === "confirmed" || b.status === "walk-in");
  const finished  = bookings.filter(b => b.status === "finished");
  const noshows   = bookings.filter(b => b.status === "noshow");
  const revenue   = [...confirmed, ...finished].reduce((sum, b) => sum + (b.price || 0), 0);

  document.getElementById("stat-total").textContent     = bookings.length;
  document.getElementById("stat-confirmed").textContent = confirmed.length;
  document.getElementById("stat-noshow").textContent    = noshows.length;
  document.getElementById("stat-revenue").textContent   = `₹${revenue}`;
}

// ═══════════════════════════════════
//  INSIGHTS — customers, jobs & charts
// ═══════════════════════════════════

let insightsCustomers = [];          // aggregated customer list
let insightsDaily     = {};          // dateKey  → { revenue, bookings }
let insightsMonthly   = {};          // "YYYY-MM" → { revenue, bookings }
let chartRange        = "daily";     // "daily" | "monthly"
let chartMetric       = "revenue";   // "revenue" | "bookings"
let pendingInsightsFilter = null;    // filter to apply after next loadInsights

const REVENUE_STATUSES = new Set(["confirmed", "finished"]);

async function loadInsights() {
  const loading = document.getElementById("insights-loading");
  const body    = document.getElementById("insights-body");
  loading.classList.remove("hidden");
  body.classList.add("hidden");

  let snap, contactsAll = {};
  try {
    snap = await get(ref(db, "bookings"));
    const cSnap = await get(ref(db, "contacts")).catch(() => null);
    if (cSnap && cSnap.exists()) contactsAll = cSnap.val() || {};
  } catch (e) {
    loading.innerHTML = `<p class="no-data-msg">Couldn't load insights. Please try again.</p>`;
    return;
  }

  const custMap = {};                // key → customer object
  const serviceSet = new Set();      // distinct service names (for the service filter)
  const serviceStats = {};           // serviceName → { count, revenue }
  insightsDaily   = {};
  insightsMonthly = {};
  let totalJobs = 0, totalRevenue = 0, monthRevenue = 0;
  const nowMonthKey = formatDateKey(new Date()).slice(0, 7);

  if (snap.exists()) {
    snap.forEach(dateNode => {
      const dateKey = dateNode.key;
      dateNode.forEach(child => {
        const b = child.val();
        if (!b || !b.serviceName) return;
        // Newer bookings keep the phone in the admin-only contacts branch
        if (!b.phone && contactsAll[dateKey]?.[child.key]?.phone) {
          b.phone = contactsAll[dateKey][child.key].phone;
        }
        if (b.status !== "blocked") serviceSet.add(b.serviceName);
        const status = b.status || "confirmed";
        if (status === "blocked") return;

        const isRevenue = REVENUE_STATUSES.has(status);
        const price = isRevenue ? (b.price || 0) : 0;
        const monthKey = (b.dateKey || dateKey).slice(0, 7);

        // Charts: count confirmed+finished only
        if (isRevenue) {
          (insightsDaily[dateKey]   ||= { revenue: 0, bookings: 0 });
          (insightsMonthly[monthKey] ||= { revenue: 0, bookings: 0 });
          insightsDaily[dateKey].revenue    += price;
          insightsDaily[dateKey].bookings   += 1;
          insightsMonthly[monthKey].revenue += price;
          insightsMonthly[monthKey].bookings += 1;
          totalJobs    += 1;
          totalRevenue += price;
          if (monthKey === nowMonthKey) monthRevenue += price;

          const ss = (serviceStats[b.serviceName] ||= { count: 0, revenue: 0 });
          ss.count   += 1;
          ss.revenue += price;
        }

        // Customer aggregation — key by uid, then phone, then name
        const key = b.uid ? `u:${b.uid}`
                  : b.phone ? `p:${b.phone}`
                  : `n:${(b.name || "Walk-in").toLowerCase()}`;
        const c = (custMap[key] ||= {
          key, uid: b.uid || "", name: b.name || "Walk-in", phone: b.phone || "",
          jobs: [], totalJobs: 0, totalSpend: 0, lastVisit: 0, firstVisit: Infinity,
          noShows: 0, blocked: false,
        });
        if (b.uid && !c.uid) c.uid = b.uid;
        if (b.name && !c.name) c.name = b.name;
        if (b.phone && !c.phone) c.phone = b.phone;
        c.jobs.push({
          serviceName: b.serviceName,
          dateKey: b.dateKey || dateKey,
          startTime: b.startTime || "",
          price: b.price || 0,
          status,
          createdAt: b.createdAt || 0,
        });
        if (isRevenue) { c.totalJobs += 1; c.totalSpend += price; }
        if (status === "noshow") c.noShows += 1;
        const visitTs = b.createdAt || 0;
        if (visitTs > c.lastVisit)  c.lastVisit  = visitTs;
        if (visitTs && visitTs < c.firstVisit) c.firstVisit = visitTs;
      });
    });
  }

  // Merge authoritative no-show / blocked status (keyed by uid)
  try {
    const nsSnap = await get(ref(db, "noshows"));
    if (nsSnap.exists()) {
      const nsMap = {};
      nsSnap.forEach(ch => { nsMap[ch.key] = ch.val() || {}; });
      Object.values(custMap).forEach(c => {
        const entry = c.uid && nsMap[c.uid];
        if (entry) {
          if (entry.blocked) c.blocked = true;
          c.noShows = Math.max(c.noShows, entry.noShowCount || 0);
        }
      });
    }
  } catch (_) { /* admin-only branch; ignore if unreadable */ }

  insightsCustomers = Object.values(custMap)
    .map(c => ({ ...c, firstVisit: c.firstVisit === Infinity ? 0 : c.firstVisit }))
    .sort((a, z) => z.lastVisit - a.lastVisit);

  // Summary cards
  document.getElementById("ins-customers").textContent = insightsCustomers.length;
  document.getElementById("ins-jobs").textContent      = totalJobs;
  document.getElementById("ins-revenue").textContent   = `₹${totalRevenue}`;
  document.getElementById("ins-month-rev").textContent = `₹${monthRevenue}`;

  // Populate the service-type filter (preserve current selection)
  const svcSel = document.getElementById("ins-service");
  const prevSvc = svcSel.value;
  svcSel.innerHTML = `<option value="">All services</option>` +
    [...serviceSet].sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if ([...svcSel.options].some(o => o.value === prevSvc)) svcSel.value = prevSvc;

  // Inactive customers (60+ days since last visit) → banner + once-a-day notification
  const inactive = insightsCustomers.filter(isInactiveCustomer);
  updateInactiveBanner(inactive.length);
  maybeNotifyInactive(inactive.length);

  // Honor a filter requested from a notification click
  if (pendingInsightsFilter) {
    document.getElementById("ins-filter").value = pendingInsightsFilter;
    pendingInsightsFilter = null;
  }

  renderTopServices(serviceStats, totalRevenue);
  renderChart();
  applyCustomerFilters();

  loading.classList.add("hidden");
  body.classList.remove("hidden");
}

window.switchChart = function (range, btn) {
  chartRange = range;
  document.querySelectorAll(".ins-toggle-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderChart();
};

window.switchMetric = function (metric, btn) {
  chartMetric = metric;
  document.querySelectorAll(".ins-metric-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderChart();
};

function renderChart() {
  const el = document.getElementById("ins-chart");
  const today = new Date();
  const buckets = [];

  if (chartRange === "daily") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const k = formatDateKey(d);
      const data = insightsDaily[k] || { revenue: 0, bookings: 0 };
      buckets.push({ label: String(d.getDate()), ...data });
    }
  } else {
    const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const data = insightsMonthly[k] || { revenue: 0, bookings: 0 };
      buckets.push({ label: MON[d.getMonth()], ...data });
    }
  }

  const max = Math.max(1, ...buckets.map(b => b[chartMetric]));
  const total = buckets.reduce((s, b) => s + b[chartMetric], 0);
  if (total === 0) {
    el.innerHTML = `<div class="ins-chart-empty">No data for this period yet.</div>`;
    return;
  }

  const prefix     = chartMetric === "revenue" ? "₹" : "";
  const CHART_H    = 150;                       // px, matches .ins-bar-wrap height
  const many       = buckets.length > 12;       // daily (30) = many
  const showValues = !many;                     // avoid clutter on the 30-day view
  const lastIdx    = buckets.length - 1;
  el.innerHTML = buckets.map((b, i) => {
    const val = b[chartMetric];
    const h   = val > 0 ? Math.max(3, Math.round((val / max) * CHART_H)) : 0;
    const valLabel = (showValues && val > 0) ? `<span class="ins-bar-val">${prefix}${val}</span>` : "";
    // On the dense daily view, show a label every 5th bar (plus the last)
    const showLabel = !many || i % 5 === 0 || i === lastIdx;
    return `
      <div class="ins-bar-col">
        <div class="ins-bar-wrap">
          <div class="ins-bar metric-${chartMetric}" style="height:${h}px">${valLabel}</div>
        </div>
        <span class="ins-bar-label">${showLabel ? b.label : ""}</span>
      </div>`;
  }).join("");
}

// Top services breakdown — share of revenue + job count
function renderTopServices(serviceStats, totalRevenue) {
  const el = document.getElementById("ins-services");
  if (!el) return;
  const rows = Object.entries(serviceStats)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.revenue - a.revenue);

  if (!rows.length) {
    el.innerHTML = `<p class="no-data-msg" style="padding:0.5rem 0">No service data yet.</p>`;
    return;
  }
  const maxRev = Math.max(1, ...rows.map(r => r.revenue));
  el.innerHTML = rows.map(r => {
    const pct   = totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 100) : 0;
    const barPct = Math.max(2, Math.round((r.revenue / maxRev) * 100));
    return `
      <div class="ins-svc-row">
        <div class="ins-svc-top">
          <span class="ins-svc-name">${escapeHtml(r.name)}</span>
          <span class="ins-svc-rev">₹${r.revenue} · ${pct}%</span>
        </div>
        <div class="ins-svc-track"><div class="ins-svc-fill" style="width:${barPct}%"></div></div>
        <div class="ins-svc-count">${r.count} job${r.count === 1 ? "" : "s"}</div>
      </div>`;
  }).join("");
}

// Export the currently-shown customer list to a CSV download
window.exportCustomersCSV = function () {
  const list = renderCustomerList._current || insightsCustomers;
  if (!list.length) { showToast("No customers to export."); return; }

  const fmtDate = ts => ts ? formatDateKey(new Date(ts)) : "";
  const esc = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Name", "Phone", "Completed Jobs", "Total Spent (INR)", "No-shows", "Blocked", "First Visit", "Last Visit"];
  const lines = [header.join(",")];
  list.forEach(c => {
    lines.push([
      esc(c.name), esc(c.phone), c.totalJobs, c.totalSpend, c.noShows,
      c.blocked ? "Yes" : "No", fmtDate(c.firstVisit), fmtDate(c.lastVisit),
    ].join(","));
  });

  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `thadikkaran-customers-${formatDateKey(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`✓ Exported ${list.length} customer${list.length === 1 ? "" : "s"}.`);
};

const NEW_CUSTOMER_MS  = 30 * 24 * 60 * 60 * 1000;   // first visit within 30 days
const INACTIVE_MS      = 60 * 24 * 60 * 60 * 1000;   // 60+ days since last visit
const REGULAR_MIN_JOBS = 3;                          // 3+ completed jobs = regular

function isNewCustomer(c) {
  return c.firstVisit && (Date.now() - c.firstVisit) <= NEW_CUSTOMER_MS;
}
function isInactiveCustomer(c) {
  return c.lastVisit && (Date.now() - c.lastVisit) > INACTIVE_MS;
}
function daysSince(ts) {
  return ts ? Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)) : 0;
}

// In-app banner showing the inactive-customer count
function updateInactiveBanner(count) {
  const banner = document.getElementById("ins-inactive-banner");
  if (!banner) return;
  if (count > 0) {
    banner.innerHTML =
      `<span>📊 <strong>${count}</strong> customer${count === 1 ? "" : "s"} ${count === 1 ? "hasn't" : "haven't"} visited in 60+ days.</span>` +
      `<button class="btn btn-sm btn-primary" onclick="viewInactive()">View</button>`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

window.viewInactive = function () {
  document.getElementById("ins-service").value = "";
  document.getElementById("ins-search").value  = "";
  document.getElementById("ins-filter").value  = "inactive";
  applyCustomerFilters();
  document.getElementById("ins-customer-list").scrollIntoView({ behavior: "smooth", block: "start" });
};

// Local system notification (zero server cost) — fired at most once per day
function maybeNotifyInactive(count) {
  if (!count) return;
  const todayKey = formatDateKey(new Date());
  if (localStorage.getItem("inactiveNotifiedDate") === todayKey) return;   // already notified today
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification("📊 Re-engage customers", {
      body:  `${count} customer${count === 1 ? "" : "s"} haven't visited in 60+ days.`,
      icon:  "/icon-192.png",
      badge: "/badge-72.png",
      tag:   "thadikkaran-inactive",
      data:  { url: "https://thadikkaran.vercel.app/admin?tab=insights&filter=inactive", type: "inactive" },
    });
    localStorage.setItem("inactiveNotifiedDate", todayKey);
  }).catch(() => {});
}

// Combined search + filter/sort for the customer list
window.applyCustomerFilters = function () {
  const q       = (document.getElementById("ins-search").value || "").trim().toLowerCase();
  const mode    = document.getElementById("ins-filter").value;
  const service = document.getElementById("ins-service").value;

  let list = insightsCustomers.slice();

  // Text search (name or phone)
  if (q) list = list.filter(c =>
    (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q));

  // Service-type filter (customer has at least one job of this service)
  if (service) list = list.filter(c => c.jobs.some(j => j.serviceName === service));

  // Filter + sort by selected mode
  switch (mode) {
    case "visits":
      list.sort((a, b) => b.totalJobs - a.totalJobs || b.lastVisit - a.lastVisit);
      break;
    case "regulars":
      list = list.filter(c => c.totalJobs >= REGULAR_MIN_JOBS)
                 .sort((a, b) => b.totalJobs - a.totalJobs);
      break;
    case "new":
      list = list.filter(isNewCustomer)
                 .sort((a, b) => b.firstVisit - a.firstVisit);
      break;
    case "spend-high":
      list.sort((a, b) => b.totalSpend - a.totalSpend);
      break;
    case "spend-low":
      list.sort((a, b) => a.totalSpend - b.totalSpend);
      break;
    case "noshows":
      list = list.filter(c => c.noShows > 0)
                 .sort((a, b) => b.noShows - a.noShows);
      break;
    case "blocked":
      list = list.filter(c => c.blocked)
                 .sort((a, b) => b.noShows - a.noShows);
      break;
    case "inactive":
      list = list.filter(isInactiveCustomer)
                 .sort((a, b) => a.lastVisit - b.lastVisit);   // longest-gone first
      break;
    case "recent":
    default:
      list.sort((a, b) => b.lastVisit - a.lastVisit);
  }

  renderCustomerList(list, mode);
};

function renderCustomerList(list, mode = "recent") {
  const el = document.getElementById("ins-customer-list");
  if (!list.length) {
    el.innerHTML = `<p class="no-data-msg" style="padding:1rem 0">No customers found.</p>`;
    renderCustomerList._current = list;
    return;
  }
  const spendMode = mode === "spend-high" || mode === "spend-low";
  const nsMode    = mode === "noshows" || mode === "blocked";
  el.innerHTML = list.map((c, i) => {
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";
    const sub = `${escapeHtml(c.phone || "No phone")} · ₹${c.totalSpend} spent`;
    const badges =
      (isNewCustomer(c) ? `<span class="ins-new-badge">NEW</span>` : "") +
      (c.blocked        ? `<span class="ins-blocked-badge">BLOCKED</span>` : "");
    let stat;
    if (mode === "inactive") stat = `<div class="ins-cust-jobs">${daysSince(c.lastVisit)}</div><div class="ins-cust-jobs-label">days ago</div>`;
    else if (nsMode)         stat = `<div class="ins-cust-jobs">${c.noShows}</div><div class="ins-cust-jobs-label">no-shows</div>`;
    else if (spendMode)      stat = `<div class="ins-cust-jobs">₹${c.totalSpend}</div><div class="ins-cust-jobs-label">spent</div>`;
    else                     stat = `<div class="ins-cust-jobs">${c.totalJobs}</div><div class="ins-cust-jobs-label">jobs</div>`;
    return `
      <div class="ins-customer-row" onclick="showCustomerDetail(${i})">
        <div class="ins-cust-rank">${i + 1}</div>
        <div class="ins-cust-avatar">${initial}</div>
        <div class="ins-cust-info">
          <div class="ins-cust-name">${escapeHtml(c.name || "Customer")}${badges}</div>
          <div class="ins-cust-sub">${sub}</div>
        </div>
        <div class="ins-cust-stat">${stat}</div>
      </div>`;
  }).join("");
  // store the currently-rendered list for index lookup
  renderCustomerList._current = list;
}

window.showCustomerDetail = function (idx) {
  const c = (renderCustomerList._current || insightsCustomers)[idx];
  if (!c) return;
  document.getElementById("cust-modal-title").textContent = c.name || "Customer";

  const badgeMap = {
    confirmed: "badge-confirmed", finished: "badge-finished",
    noshow: "badge-noshow", cancelled: "badge-cancelled",
  };
  const jobs = [...c.jobs].sort((a, z) =>
    (z.dateKey || "").localeCompare(a.dateKey || "") ||
    (z.startTime || "").localeCompare(a.startTime || ""));

  const jobsHtml = jobs.map(j => {
    const d = new Date((j.dateKey || "") + "T00:00:00");
    const dateStr = isNaN(d) ? j.dateKey : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = j.startTime ? formatDisplayTime(j.startTime) : "";
    const badge = badgeMap[j.status] || "badge-confirmed";
    const priceStr = j.price ? `₹${j.price}` : "—";
    return `
      <div class="cust-job">
        <div class="cust-job-main">
          <div class="cust-job-service">${escapeHtml(j.serviceName)}</div>
          <div class="cust-job-when">${dateStr}${timeStr ? " · " + timeStr : ""}</div>
        </div>
        <div class="cust-job-right">
          <div class="cust-job-price">${priceStr}</div>
          <span class="status-badge cust-job-badge ${badge}">${j.status}</span>
        </div>
      </div>`;
  }).join("");

  const blockedNote = c.blocked
    ? `<div class="cust-blocked-note">⛔ Blocked after repeated no-shows</div>` : "";

  document.getElementById("customer-detail-content").innerHTML = `
    <p class="modal-sub">${escapeHtml(c.phone || "No phone on file")}</p>
    ${blockedNote}
    <div class="cust-spend">
      <div class="cust-spend-item"><span class="cust-spend-num">${c.totalJobs}</span><span class="cust-spend-label">Completed</span></div>
      <div class="cust-spend-item"><span class="cust-spend-num">₹${c.totalSpend}</span><span class="cust-spend-label">Total Spent</span></div>
      <div class="cust-spend-item"><span class="cust-spend-num">${c.noShows}</span><span class="cust-spend-label">No-shows</span></div>
      <div class="cust-spend-item"><span class="cust-spend-num">${c.jobs.length}</span><span class="cust-spend-label">All Bookings</span></div>
    </div>
    <div class="cust-jobs-list">${jobsHtml}</div>`;

  // Wire the WhatsApp button (only when we have a phone number)
  _detailCustomer = c;
  const waBtn = document.getElementById("cust-whatsapp-btn");
  waBtn.classList.toggle("hidden", !c.phone);

  document.getElementById("modal-customer").classList.remove("hidden");
};

let _detailCustomer = null;

// Open WhatsApp with a pre-filled, context-aware message for this customer
window.whatsappCurrentCustomer = function () {
  const c = _detailCustomer;
  if (!c || !c.phone) return;
  const digits = String(c.phone).replace(/\D/g, "");   // e.g. +91 98… → 9198…
  if (!digits) return;
  const first = (c.name || "there").trim().split(" ")[0];
  const site  = "https://thadikkaran.vercel.app/";
  const msg = isInactiveCustomer(c)
    ? `Hi ${first}! 👋 We miss you at Thadikkaran. Come back for a fresh cut 💈 Book here: ${site}`
    : `Hi ${first}! 👋 Thanks for choosing Thadikkaran. Book your next appointment here: ${site}`;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank");
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ═══════════════════════════════════
//  LIVE TIMELINE PROGRESS
// ═══════════════════════════════════

const TERMINAL_STATUSES = new Set(["finished", "noshow", "cancelled", "blocked"]);
let timelineInterval = null;

function updateTimelineProgress() {
  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const todayKey = formatDateKey(now);

  document.querySelectorAll('.booking-tl-line[data-end]').forEach(line => {
    const startMin = parseInt(line.dataset.start, 10);
    const endMin   = parseInt(line.dataset.end,   10);
    const dateKey  = line.dataset.date;
    const fill     = line.querySelector('.booking-tl-fill');
    if (!fill) return;

    // Only animate today's bookings
    if (dateKey !== todayKey) { fill.style.height = '0%'; return; }

    let pct;
    if (nowMin <= startMin) {
      pct = 0;
    } else if (nowMin >= endMin) {
      pct = 100;
    } else {
      pct = (nowMin - startMin) / (endMin - startMin) * 100;
    }
    fill.style.height = pct + '%';

    const tl = line.closest('.booking-card');
    const bookingTl = line.closest('.booking-tl');
    if (bookingTl) bookingTl.classList.toggle('tl-not-started', nowMin < startMin);

    // When time is up: fill the line fully and mark card visually, but don't auto-finish
    if (pct >= 100) {
      if (tl) tl.classList.add('tl-time-up');
    } else {
      if (tl) tl.classList.remove('tl-time-up');
    }
  });
}

function startTimelineInterval() {
  updateTimelineProgress();
  if (timelineInterval) clearInterval(timelineInterval);
  timelineInterval = setInterval(updateTimelineProgress, 30_000);
}

// ═══════════════════════════════════
//  MANUAL BOOKING
// ═══════════════════════════════════

window.submitManualBooking = async function () {
  const name    = document.getElementById("m-name").value.trim();
  const phone   = document.getElementById("m-phone").value.trim();
  const svcRaw  = document.getElementById("m-service").value;
  const dateVal = document.getElementById("m-date").value;
  const timeVal = document.getElementById("m-time").value;
  const errEl   = document.getElementById("manual-error");

  errEl.classList.add("hidden");

  if (!name || !svcRaw || !dateVal || !timeVal) {
    errEl.textContent = "Please fill all required fields.";
    errEl.classList.remove("hidden");
    return;
  }

  const [svcId, svcName, priceStr, durStr] = svcRaw.split("|");
  const price    = parseInt(priceStr) || 0;
  const duration = serviceDurations[svcId] || parseInt(durStr) || 30;

  const startMinutes = timeToMinutes(timeVal);
  const endMinutes   = startMinutes + duration;

  // Admin walk-ins may run past closing — only block starts at/after close.
  if (startMinutes >= 20*60) {
    errEl.textContent = "Start time is at or after closing time (8:00 PM).";
    errEl.classList.remove("hidden");
    return;
  }

  // Phone lives in the admin-only contacts branch, not the client-readable booking
  const booking = {
    name,
    serviceId:   svcId,
    serviceName: svcName,
    price,
    duration,
    dateKey:   dateVal,
    startTime: timeVal,
    endTime:   minutesToTime(endMinutes),
    status:    "confirmed",
    source:    "admin",
    createdAt: Date.now(),
    noShowCount: 0
  };

  try {
    const newRef = await push(ref(db, `bookings/${dateVal}`), booking);
    if (phone) await set(ref(db, `contacts/${dateVal}/${newRef.key}`), { phone, name });
    showToast("✓ Walk-in booking added!");
    // Reset form
    document.getElementById("m-name").value  = "";
    document.getElementById("m-phone").value = "";
    document.getElementById("m-service").value = "";
    document.getElementById("m-time").value  = "";
  } catch (e) {
    errEl.textContent = "Failed to save booking.";
    errEl.classList.remove("hidden");
  }
};

// ═══════════════════════════════════
//  BLOCK SLOTS
// ═══════════════════════════════════

window.applyPreset = function (type, durationMin) {
  const bDuration = document.getElementById("b-duration");
  const bStart    = document.getElementById("b-start");
  const bReason   = document.getElementById("b-reason");
  bDuration.value = durationMin;

  if (type === "lunch") {
    bStart.value  = "13:00";
    bReason.value = "Lunch Break";
  } else if (type === "short") {
    bStart.value  = "11:00";
    bReason.value = "Short Break";
  } else {
    bStart.value  = "09:00";
    bReason.value = "Full Day Leave";
  }
};

window.submitBlock = async function () {
  const date     = document.getElementById("b-date").value;
  const start    = document.getElementById("b-start").value;
  const duration = parseInt(document.getElementById("b-duration").value);
  const reason   = document.getElementById("b-reason").value.trim();
  const errEl    = document.getElementById("block-error");

  errEl.classList.add("hidden");

  if (!date || !start || !duration) {
    errEl.textContent = "Please fill date, start time, and duration.";
    errEl.classList.remove("hidden");
    return;
  }

  const block = {
    startTime: start,
    endTime:   minutesToTime(timeToMinutes(start) + duration),
    duration,
    reason:    reason || "Break",
    source:    "block",
    status:    "blocked",
    createdAt: Date.now()
  };

  try {
    await push(ref(db, `blocked/${date}`), block);
    showToast("✓ Time blocked successfully!");
    loadActiveBlocks();
  } catch (e) {
    errEl.textContent = "Failed to block time.";
    errEl.classList.remove("hidden");
  }
};

function loadActiveBlocks() {
  const today = formatDateKey(new Date());
  const blocksList = document.getElementById("blocks-list");
  blocksList.innerHTML = "";

  get(ref(db, `blocked/${today}`)).then(snap => {
    if (!snap.exists()) { blocksList.innerHTML = `<p class="no-data-msg" style="padding:1rem 0">No active blocks today.</p>`; return; }
    snap.forEach(child => {
      const b = child.val();
      const card = document.createElement("div");
      card.className = "booking-card status-blocked";
      card.innerHTML = `
        <div class="booking-time">
          <div class="booking-time-start">${formatDisplayTime(b.startTime)}</div>
          <div class="booking-time-end">${formatDisplayTime(b.endTime)}</div>
        </div>
        <div class="booking-separator"></div>
        <div class="booking-info">
          <div class="booking-name">${b.reason || "Break"}</div>
          <div class="booking-service">${b.duration} minutes</div>
        </div>
        <div class="booking-actions">
          <button class="btn btn-sm btn-danger" onclick="removeBlock('${child.key}', '${today}')">Remove</button>
        </div>
      `;
      blocksList.appendChild(card);
    });
  });
}

window.removeBlock = async function (key, dateKey) {
  const dk = dateKey || currentDateKey;
  await remove(ref(db, `blocked/${dk}/${key}`));
  showToast("Block removed.");
  loadBookings();
  loadActiveBlocks();
};

// ═══════════════════════════════════
//  EDIT BOOKING TIME + OVERLAP ALERT
// ═══════════════════════════════════

let selectedEditTime = null;

window.openEditModal = async function (bookingKey, dateKey) {
  const snap = await get(ref(db, `bookings/${dateKey}/${bookingKey}`));
  if (!snap.exists()) return;

  editingBooking = { key: bookingKey, dateKey, booking: snap.val() };
  selectedEditTime = editingBooking.booking.startTime;
  pendingEditTime  = null;

  const b = editingBooking.booking;
  document.getElementById("edit-booking-label").textContent =
    `${b.name} – ${b.serviceName} (${b.duration} min)`;
  document.getElementById("overlap-warning").classList.add("hidden");
  document.getElementById("edit-overlap-confirm").classList.add("hidden");
  document.getElementById("btn-save-edit").classList.remove("hidden");

  // Load bookings + blocks to detect conflicts
  const [bookSnap, blkSnap] = await Promise.all([
    get(ref(db, `bookings/${dateKey}`)),
    get(ref(db, `blocked/${dateKey}`))
  ]);

  const occupied = [];
  if (bookSnap.exists()) {
    bookSnap.forEach(child => {
      if (child.key === bookingKey) return;
      const o = child.val();
      if (o.status === "cancelled" || o.status === "noshow" || o.status === "finished") return;
      occupied.push({
        start: timeToMinutes(o.startTime),
        end:   timeToMinutes(o.startTime) + o.duration,
        label: `${o.name} (${formatDisplayTime(o.startTime)})`
      });
    });
  }
  if (blkSnap.exists()) {
    blkSnap.forEach(child => {
      const bl = child.val();
      occupied.push({
        start: timeToMinutes(bl.startTime),
        end:   timeToMinutes(bl.startTime) + (bl.duration || 30),
        label: bl.reason || "Break"
      });
    });
  }

  // Build the slot grid from the active preset
  const grid = document.getElementById("edit-slots-grid");
  grid.innerHTML = "";

  for (const ps of activeSlotTimes(dateKey)) {
    const min      = timeToMinutes(ps.start);
    const timeStr  = ps.start;
    const slotEnd  = min + b.duration;
    const hits     = occupied.filter(o => min < o.end && slotEnd > o.start);
    const isActive = timeStr === b.startTime;

    const btn = document.createElement("button");
    btn.className  = "edit-slot-btn" + (hits.length ? " conflicted" : "") + (isActive ? " selected" : "");
    btn.textContent = formatDisplayTime(timeStr);
    btn.dataset.time = timeStr;
    btn.onclick = () => onEditSlotClick(timeStr, hits);
    grid.appendChild(btn);
  }

  document.getElementById("modal-edit").classList.remove("hidden");
};

function onEditSlotClick(timeStr, hits) {
  selectedEditTime = timeStr;

  document.querySelectorAll(".edit-slot-btn").forEach(btn =>
    btn.classList.toggle("selected", btn.dataset.time === timeStr)
  );

  if (hits.length > 0) {
    document.getElementById("overlap-detail").textContent =
      "Conflicts with: " + hits.map(h => h.label).join(", ");
    document.getElementById("overlap-warning").classList.remove("hidden");
    document.getElementById("edit-overlap-confirm").classList.remove("hidden");
    document.getElementById("btn-save-edit").classList.add("hidden");
    pendingEditTime = timeStr;
  } else {
    document.getElementById("overlap-warning").classList.add("hidden");
    document.getElementById("edit-overlap-confirm").classList.add("hidden");
    document.getElementById("btn-save-edit").classList.remove("hidden");
    pendingEditTime = null;
  }
}

window.closeEditModal = function () {
  document.getElementById("modal-edit").classList.add("hidden");
  editingBooking   = null;
  selectedEditTime = null;
  pendingEditTime  = null;
};

window.saveEditTime = async function () {
  if (!editingBooking || !selectedEditTime) return;
  await applyEditTime(selectedEditTime);
};

window.forceEditTime = async function () {
  if (!pendingEditTime) return;
  await applyEditTime(pendingEditTime);
};

async function applyEditTime(newTime) {
  const b        = editingBooking.booking;
  const duration = b.duration;
  const newEnd   = minutesToTime(timeToMinutes(newTime) + duration);

  const updateData = {
    startTime:    newTime,
    endTime:      newEnd,
    timeModified: Date.now(),
  };
  // Preserve the very first original time so client can detect changes
  if (!b.originalStartTime) updateData.originalStartTime = b.startTime;

  await update(ref(db, `bookings/${editingBooking.dateKey}/${editingBooking.key}`), updateData);

  showToast("✓ Booking time updated.");
  closeEditModal();
  loadBookings();
}

// ═══════════════════════════════════
//  NO-SHOW MANAGEMENT
// ═══════════════════════════════════

window.openNoshowModal = async function (bookingKey, dateKey) {
  const snap = await get(ref(db, `bookings/${dateKey}/${bookingKey}`));
  if (!snap.exists()) return;

  noshowBooking = { key: bookingKey, dateKey, booking: snap.val() };
  const b = noshowBooking.booking;
  if (!b.phone) {
    // Newer bookings keep the phone in the admin-only contacts branch
    const cSnap = await get(ref(db, `contacts/${dateKey}/${bookingKey}`)).catch(() => null);
    if (cSnap?.exists()) b.phone = cSnap.val().phone || "";
  }

  document.getElementById("noshow-label").textContent =
    `${b.name} – ${b.serviceName} at ${formatDisplayTime(b.startTime)}`;
  document.getElementById("modal-noshow").classList.remove("hidden");
};

window.confirmNoShow = async function () {
  if (!noshowBooking) return;
  const { key, dateKey, booking } = noshowBooking;

  // Update booking status
  await update(ref(db, `bookings/${dateKey}/${key}`), { status: "noshow" });

  // Increment user's no-show count
  if (booking.uid) {
    const userRef   = ref(db, `users/${booking.uid}/noShowCount`);
    const userSnap  = await get(userRef);
    const newCount  = (userSnap.val() || 0) + 1;

    await set(userRef, newCount);

    // Auto-block after 3 no-shows
    if (newCount >= 3) {
      await set(ref(db, `users/${booking.uid}/blocked`), true);
      await set(ref(db, `noshows/${booking.uid}`), {
        name:        booking.name,
        phone:       booking.phone || "",
        noShowCount: newCount,
        blocked:     true,
        blockedAt:   Date.now()
      });
      showToast(`⛔ ${booking.name} has been blocked after 3 no-shows.`);
    } else {
      await set(ref(db, `noshows/${booking.uid}`), {
        name:        booking.name,
        phone:       booking.phone || "",
        noShowCount: newCount,
        blocked:     false
      });
    }
  }

  closeModal("modal-noshow");
  showToast("No-show recorded.");
  loadBookings();
  loadNoshows();
  noshowBooking = null;
};

// ═══════════════════════════════════
//  LUNCH BREAK SETTINGS
// ═══════════════════════════════════

async function initLunchBreak() {
  try {
    const snap = await get(ref(db, "settings/lunchBreak"));
    if (snap.exists()) {
      lunchBreakConfig = { ...lunchBreakConfig, ...snap.val() };
    } else {
      // Write defaults on first run
      await set(ref(db, "settings/lunchBreak"), lunchBreakConfig);
    }
  } catch (e) { /* keep defaults */ }
}

function loadLunchSettings() {
  const en    = document.getElementById("lunch-enabled");
  const start = document.getElementById("lunch-start");
  const end   = document.getElementById("lunch-end");
  if (!en) return;
  en.checked  = lunchBreakConfig.enabled;
  start.value = lunchBreakConfig.startTime || "13:00";
  end.value   = lunchBreakConfig.endTime   || "14:30";
  document.getElementById("lunch-times-row").style.opacity = lunchBreakConfig.enabled ? "1" : "0.4";
}

window.saveLunchBreak = async function () {
  const enabled   = document.getElementById("lunch-enabled").checked;
  const startTime = document.getElementById("lunch-start").value;
  const endTime   = document.getElementById("lunch-end").value;
  if (startTime >= endTime) { showToast("End time must be after start time."); return; }
  lunchBreakConfig = { enabled, startTime, endTime };
  document.getElementById("lunch-times-row").style.opacity = enabled ? "1" : "0.4";
  await set(ref(db, "settings/lunchBreak"), lunchBreakConfig);
  // The Default preset's slot count depends on the lunch-end slot
  renderPresetChips();
  if (editingPresetId === DEFAULT_PRESET) openPresetEditor(DEFAULT_PRESET);
  showToast(enabled ? `✓ Lunch break set: ${formatDisplayTime(startTime)} – ${formatDisplayTime(endTime)}` : "Lunch break disabled.");
};

// ═══════════════════════════════════
//  SERVICE DURATION SETTINGS
// ═══════════════════════════════════

async function initServiceDurations() {
  try {
    const snap = await get(ref(db, "settings/services"));
    if (snap.exists()) {
      snap.forEach(child => {
        const v = child.val();
        if (v.duration) serviceDurations[child.key] = v.duration;
        if (v.price !== undefined) servicePrices[child.key] = v.price;
      });
    }
  } catch (e) { /* keep defaults on error */ }
}

function loadServiceSettings() {
  const list = document.getElementById("service-settings-list");
  if (!list) return;
  list.innerHTML = "";

  DEFAULT_SERVICES.forEach(svc => {
    const currentDur   = serviceDurations[svc.id] || svc.defaultDuration;
    const rawPrice     = servicePrices[svc.id] !== undefined ? servicePrices[svc.id] : svc.defaultPrice;
    const currentPrice = rawPrice ?? 0;
    const card = document.createElement("div");
    card.className = "svc-setting-card";
    card.innerHTML = `
      <div class="svc-setting-info">
        <div class="svc-setting-name">${svc.name}</div>
      </div>
      <div class="svc-setting-fields">
        <div class="svc-field-row">
          <span class="svc-field-label">Duration</span>
          <div class="svc-setting-controls">
            <button class="btn-icon svc-dur-adj" onclick="adjustDur('${svc.id}', -5)">−</button>
            <div class="svc-dur-display">
              <input type="number" class="svc-duration-input" id="dur-${svc.id}"
                     value="${currentDur}" min="5" max="120" step="5" />
              <span class="svc-dur-unit">min</span>
            </div>
            <button class="btn-icon svc-dur-adj" onclick="adjustDur('${svc.id}', 5)">+</button>
          </div>
        </div>
        <div class="svc-field-row">
          <span class="svc-field-label">Price</span>
          <div class="svc-setting-controls">
            <span class="svc-price-sym">₹</span>
            <input type="number" class="svc-price-input" id="price-${svc.id}"
                   value="${currentPrice}" min="0" max="9999" step="10" />
            <span class="svc-dur-unit">${currentPrice === 0 ? "At Store" : ""}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-primary svc-save-btn" onclick="saveService('${svc.id}')">Save</button>
      </div>
    `;
    list.appendChild(card);
  });
}

window.adjustDur = function (svcId, delta) {
  const input = document.getElementById(`dur-${svcId}`);
  if (!input) return;
  input.value = Math.max(5, Math.min(120, (parseInt(input.value) || 30) + delta));
};

window.saveService = async function (svcId) {
  const dur   = parseInt(document.getElementById(`dur-${svcId}`)?.value);
  const price = parseInt(document.getElementById(`price-${svcId}`)?.value) || 0;
  if (!dur || dur < 5 || dur > 120) { showToast("Duration must be 5–120 minutes."); return; }
  if (price < 0 || price > 9999)    { showToast("Invalid price."); return; }
  await update(ref(db, `settings/services/${svcId}`), {
    duration: dur,
    price:    price > 0 ? price : 0
  });
  serviceDurations[svcId] = dur;
  servicePrices[svcId]    = price;
  showToast(`✓ Saved.`);
};

// ── Admin Cancellation ──
let cancellingBooking = null;

window.openCancelModal = async function (key, dateKey) {
  const snap = await get(ref(db, `bookings/${dateKey}/${key}`));
  if (!snap.exists()) return;
  const b = snap.val();
  cancellingBooking = { key, dateKey };
  document.getElementById("cancel-label").textContent =
    `${b.name} – ${b.serviceName} at ${formatDisplayTime(b.startTime)}`;
  document.getElementById("cancel-reason").value = "";
  document.getElementById("modal-cancel").classList.remove("hidden");
};

window.confirmCancelBooking = async function () {
  if (!cancellingBooking) return;
  const { key, dateKey } = cancellingBooking;
  const reason = document.getElementById("cancel-reason").value.trim();
  await update(ref(db, `bookings/${dateKey}/${key}`), {
    status:       "cancelled",
    cancelledAt:  Date.now(),
    cancelReason: reason || "Cancelled by shop",
    cancelledBy:  "admin"
  });
  // A slot just opened — notify anyone on the waitlist for this date
  fetch("/api/notify-waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKey }),
  }).catch(() => {});
  closeModal("modal-cancel");
  showToast("Booking cancelled.");
  loadBookings();
  cancellingBooking = null;
};

window.finishBooking = async function (key, dateKey) {
  const snap = await get(ref(db, `bookings/${dateKey}/${key}`));
  if (!snap.exists()) return;

  // Do NOT overwrite duration/endTime with elapsed time — clicking Finish
  // hours later made one booking "occupy" every slot until that moment.
  // The scheduled slot stays intact; finishedAt records the actual finish.
  await update(ref(db, `bookings/${dateKey}/${key}`), {
    status:      "finished",
    finishedAt:  Date.now()
  });
  showToast("✓ Booking marked as finished.");
  loadBookings();
};

function loadNoshows() {
  const list  = document.getElementById("noshows-list");
  const noMsg = document.getElementById("no-noshows-msg");

  list.innerHTML = "";
  noMsg.textContent = "Loading...";

  get(ref(db, "noshows")).then(snap => {
    noMsg.textContent = "No no-show records found.";

    if (!snap.exists()) { noMsg.classList.remove("hidden"); return; }

    let found = false;
    snap.forEach(child => {
      const ns = child.val();
      found = true;
      const uid  = child.key;
      const card = document.createElement("div");
      card.className = `noshow-card ${ns.blocked ? "blocked" : ""}`;
      card.innerHTML = `
        <div class="noshow-info">
          <div class="noshow-name">${ns.name}</div>
          ${ns.phone ? `<a class="noshow-phone" href="tel:${ns.phone}">📞 ${ns.phone}</a>` : `<div class="noshow-phone">No phone</div>`}
          <div class="noshow-count">
            ${ns.noShowCount} no-show${ns.noShowCount !== 1 ? "s" : ""}
            ${ns.blocked ? " · <strong>BLOCKED</strong>" : ""}
          </div>
        </div>
        <div>
          ${ns.blocked
            ? `<button class="btn btn-sm btn-outline" onclick="unblockUser('${uid}')">Unblock</button>`
            : `<button class="btn btn-sm btn-danger"  onclick="blockUser('${uid}', '${ns.name}')">Block</button>`
          }
        </div>
      `;
      list.appendChild(card);
    });

    if (!found) noMsg.classList.remove("hidden");
    else noMsg.classList.add("hidden");
  });
}

window.blockUser = async function (uid, name) {
  await update(ref(db, `users/${uid}`), { blocked: true });
  await update(ref(db, `noshows/${uid}`), { blocked: true, blockedAt: Date.now() });
  showToast(`${name} has been blocked.`);
  loadNoshows();
};

window.unblockUser = async function (uid) {
  await update(ref(db, `users/${uid}`), { blocked: false });
  await update(ref(db, `noshows/${uid}`), { blocked: false });
  showToast("User unblocked.");
  loadNoshows();
};

// ═══════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function formatDisplayTime(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}

function formatBookedAt(ts) {
  if (!ts) return null;
  const d    = new Date(ts);
  const now  = new Date();
  const diff = Math.floor((now - d) / 60000); // minutes ago
  if (diff < 1)  return "just now";
  if (diff < 60) return `${diff}m ago`;
  const hh   = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12  = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  const timeStr = `${h12}:${mm} ${ampm}`;
  // If same day, show time only; otherwise show short date + time
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return timeStr;
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${timeStr}`;
}

function showToast(msg, duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

// ═══════════════════════════════════
//  TEMPORARY SHOP CLOSURE
// ═══════════════════════════════════

let closureConfig = null;   // { active, startDate, endDate, reason, ... }

async function loadClosureSettings() {
  try {
    const snap = await get(ref(db, "settings/closure"));
    closureConfig = snap.exists() ? snap.val() : null;
  } catch (e) { closureConfig = null; }
  renderClosureUI();
}

function renderClosureUI() {
  const activeBox = document.getElementById("closure-active-box");
  const form      = document.getElementById("closure-form");
  if (!activeBox || !form) return;

  if (closureConfig && closureConfig.active) {
    const from = closureConfig.startDate
      ? new Date(closureConfig.startDate + "T00:00:00")
          .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "now";
    const until = closureConfig.endDate
      ? new Date(closureConfig.endDate + "T00:00:00")
          .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "until you reopen";
    document.getElementById("closure-active-detail").innerHTML =
      `<div><strong>${from}</strong> → <strong>${until}</strong></div>` +
      (closureConfig.reason ? `<div class="closure-reason-text">"${escapeHtml(closureConfig.reason)}"</div>` : "");
    activeBox.classList.remove("hidden");
    form.classList.add("hidden");
  } else {
    activeBox.classList.add("hidden");
    form.classList.remove("hidden");
    const start = document.getElementById("closure-start");
    if (start && !start.value) start.value = formatDateKey(new Date());
  }
}

window.toggleClosureIndefinite = function () {
  const on  = document.getElementById("closure-indefinite").checked;
  const end = document.getElementById("closure-end");
  end.disabled = on;
  if (on) end.value = "";
};

// Cancel every active booking inside the closed range; returns affected count
async function cancelBookingsInRange(startDate, endDate) {
  const snap = await get(ref(db, "bookings"));
  if (!snap.exists()) return 0;

  const updates = [];
  snap.forEach(dateNode => {
    const dateKey = dateNode.key;
    if (dateKey < startDate) return;
    if (endDate && dateKey > endDate) return;
    dateNode.forEach(child => {
      const b = child.val();
      if (!b) return;
      const status = b.status || "confirmed";
      if (status === "cancelled" || status === "noshow" || status === "finished") return;
      updates.push(update(ref(db, `bookings/${dateKey}/${child.key}`), {
        status:       "cancelled",
        cancelledAt:  Date.now(),
        cancelReason: "Shop temporarily closed",
        cancelledBy:  "admin-closure",
      }));
    });
  });

  await Promise.all(updates);
  return updates.length;
}

window.closeShopTemporarily = async function () {
  const btn    = document.getElementById("btn-close-shop");
  const errEl  = document.getElementById("closure-error");
  const start  = document.getElementById("closure-start").value;
  const indef  = document.getElementById("closure-indefinite").checked;
  const end    = indef ? "" : document.getElementById("closure-end").value;
  const reason = document.getElementById("closure-reason").value.trim();

  errEl.classList.add("hidden");
  if (!start) {
    errEl.textContent = "Please choose a start date.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!indef && !end) {
    errEl.textContent = "Choose an end date, or tick “Until I reopen it manually”.";
    errEl.classList.remove("hidden");
    return;
  }
  if (end && end < start) {
    errEl.textContent = "End date cannot be before the start date.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!confirm("Close the shop and cancel all bookings in this period?\n\nAll customers will be notified.")) return;

  btn.disabled = true;
  btn.textContent = "Closing…";

  try {
    const entry = {
      active:    true,
      startDate: start,
      endDate:   end || null,
      reason:    reason || "The shop is temporarily closed. We'll be back soon.",
      createdAt: Date.now(),
    };
    await set(ref(db, "settings/closure"), entry);
    closureConfig = entry;

    btn.textContent = "Cancelling bookings…";
    const cancelled = await cancelBookingsInRange(start, end || null);

    btn.textContent = "Notifying customers…";
    let notified = 0;
    try {
      const resp = await fetch("/api/notify-closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "closed", startDate: start, endDate: end || null, reason: entry.reason }),
      });
      const data = await resp.json().catch(() => ({}));
      notified = data.sent || 0;
    } catch (_) { /* closure still applied even if push fails */ }

    renderClosureUI();
    loadBookings();
    showToast(`🚫 Shop closed. ${cancelled} booking${cancelled === 1 ? "" : "s"} cancelled, ${notified} customer${notified === 1 ? "" : "s"} notified.`, 7000);
  } catch (e) {
    errEl.textContent = "Couldn't close the shop. Please try again.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🚫 Close Shop & Notify Customers";
  }
};

window.reopenShop = async function () {
  const btn = document.getElementById("btn-reopen");
  if (!confirm("Reopen the shop?\n\nAll customers will be notified that bookings are open again.")) return;

  btn.disabled = true;
  btn.textContent = "Reopening…";
  try {
    await update(ref(db, "settings/closure"), { active: false, reopenedAt: Date.now() });
    if (closureConfig) closureConfig.active = false;

    btn.textContent = "Notifying customers…";
    let notified = 0;
    try {
      const resp = await fetch("/api/notify-closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reopened" }),
      });
      const data = await resp.json().catch(() => ({}));
      notified = data.sent || 0;
    } catch (_) { /* reopen still applied even if push fails */ }

    renderClosureUI();
    showToast(`✓ Shop reopened. ${notified} customer${notified === 1 ? "" : "s"} notified.`, 6000);
  } catch (e) {
    showToast("Couldn't reopen the shop. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "✓ Reopen Shop & Notify Customers";
  }
};

// ═══════════════════════════════════
//  TIME SLOT PRESETS
// ═══════════════════════════════════

const MAX_SLOTS      = 17;
// Weekly holiday(s) — mirrors SHOP.holidayDays in client.js (2 = Tuesday)
const SHOP_HOLIDAY_DAYS = [2];
const DEFAULT_DUR    = 40;
const DEFAULT_PRESET = "default";

let slotPresets     = {};              // id → { name, slots:[{start,duration}] }
let activePresetId  = DEFAULT_PRESET;  // fallback for days with no assignment
let weekdayPresets  = {};              // "0".."6" (Sun..Sat) → presetId
let editingPresetId = null;            // id being edited (or "__new__")
let editingSlots    = [];              // working copy: [{start,duration}]
let editingSlotIdx  = null;            // index being edited via the modal, null = adding
let slotMode        = "duration";

// The built-in grid — same shape the client falls back to, including the
// lunch-break-end slot the client injects so the counts match everywhere.
function builtinSlots() {
  const OPEN = 9 * 60, CLOSE = 20 * 60, STEP = 40;
  const mins = new Set();
  for (let m = OPEN; m <= CLOSE; m += STEP) {
    if (mins.size >= MAX_SLOTS) break;
    mins.add(m);
  }
  if (lunchBreakConfig.enabled && lunchBreakConfig.endTime) {
    const [eh, em] = lunchBreakConfig.endTime.split(":").map(Number);
    const le = eh * 60 + em;
    if (le > OPEN && le < CLOSE) mins.add(le);
  }
  return [...mins].sort((a, b) => a - b)
    .map(m => ({ start: minutesToTime(m), duration: STEP }));
}

async function loadSlotPresets() {
  try {
    const [pSnap, aSnap, wSnap] = await Promise.all([
      get(ref(db, "settings/slotPresets")),
      get(ref(db, "settings/activeSlotPreset")),
      get(ref(db, "settings/weekdayPresets")),
    ]);
    slotPresets    = pSnap.exists() ? (pSnap.val() || {}) : {};
    activePresetId = aSnap.exists() ? (aSnap.val() || DEFAULT_PRESET) : DEFAULT_PRESET;
    weekdayPresets = wSnap.exists() ? (wSnap.val() || {}) : {};
  } catch (e) {
    slotPresets = {}; activePresetId = DEFAULT_PRESET; weekdayPresets = {};
  }
  renderPresetChips();
  renderWeekdayRows();
}

// Which preset id applies on a given date (weekday assignment → global → default)
function presetIdForDate(dateKey) {
  try {
    const dow = new Date(dateKey + "T00:00:00").getDay();
    const assigned = weekdayPresets[String(dow)];
    if (assigned) return assigned;
  } catch (_) { /* fall through */ }
  return activePresetId || DEFAULT_PRESET;
}

// Slots that apply on a given date (defaults to the day being viewed)
function activeSlotTimes(dateKey = currentDateKey) {
  const id = presetIdForDate(dateKey);
  if (id === DEFAULT_PRESET) return builtinSlots();
  const p = slotPresets[id];
  if (!p || !Array.isArray(p.slots) || !p.slots.length) return builtinSlots();
  return [...p.slots].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

// ── Weekday assignment ──
const WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function renderWeekdayRows() {
  const wrap = document.getElementById("weekday-rows");
  if (!wrap) return;

  const options = [{ id: DEFAULT_PRESET, name: "Default" }]
    .concat(Object.entries(slotPresets).map(([id, p]) => ({ id, name: p.name || "Untitled" })));

  wrap.innerHTML = WEEKDAY_NAMES.map((name, dow) => {
    const sel = weekdayPresets[String(dow)] || DEFAULT_PRESET;
    const isHoliday = Array.isArray(SHOP_HOLIDAY_DAYS) && SHOP_HOLIDAY_DAYS.includes(dow);
    const opts = options.map(o =>
      `<option value="${o.id}"${o.id === sel ? " selected" : ""}>${escapeHtml(o.name)}</option>`
    ).join("");
    return `<div class="weekday-row">
      <span class="wd-name">${name}${isHoliday ? ` <span class="wd-holiday">closed</span>` : ""}</span>
      <select class="ins-filter wd-select" onchange="setWeekdayPreset(${dow}, this.value)">${opts}</select>
    </div>`;
  }).join("");
}

window.setWeekdayPreset = async function (dow, presetId) {
  try {
    if (presetId === DEFAULT_PRESET) {
      await remove(ref(db, `settings/weekdayPresets/${dow}`));
      delete weekdayPresets[String(dow)];
    } else {
      await set(ref(db, `settings/weekdayPresets/${dow}`), presetId);
      weekdayPresets[String(dow)] = presetId;
    }
    const label = presetId === DEFAULT_PRESET
      ? "Default"
      : ((slotPresets[presetId] && slotPresets[presetId].name) || "preset");
    showToast(`✓ ${WEEKDAY_NAMES[dow]} → ${label}`);
    renderPresetChips();
    loadBookings();
  } catch (e) {
    showToast("Couldn't update the weekly schedule.");
    renderWeekdayRows();
  }
};

window.resetWeekdayPresets = async function () {
  if (!confirm("Reset every day back to the Default preset?")) return;
  try {
    await remove(ref(db, "settings/weekdayPresets"));
    weekdayPresets = {};
    renderWeekdayRows();
    renderPresetChips();
    showToast("✓ All days reset to Default.");
    loadBookings();
  } catch (e) {
    showToast("Couldn't reset the schedule.");
  }
};

function renderPresetChips() {
  const wrap = document.getElementById("preset-chips");
  if (!wrap) return;

  const SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  // Which weekdays end up on this preset (explicit assignment, or the
  // global fallback for days with no assignment)
  const daysUsing = (id) => SHORT.filter((_, dow) => {
    const assigned = weekdayPresets[String(dow)];
    return assigned ? assigned === id : (activePresetId || DEFAULT_PRESET) === id;
  });

  const chip = (id, name, count) => {
    const days = daysUsing(id);
    const live = days.length > 0;
    const daysLabel = days.length === 7 ? "Every day" : days.join(" · ");
    return `<button class="preset-chip${live ? " active" : ""}" onclick="openPresetEditor('${id}')">
      <span class="pc-name">${escapeHtml(name)}</span>
      <span class="pc-meta">${count} slot${count === 1 ? "" : "s"}</span>
      ${live ? `<span class="pc-days">${daysLabel}</span>` : `<span class="pc-days pc-days--none">Not scheduled</span>`}
    </button>`;
  };

  let html = chip(DEFAULT_PRESET, "Default", builtinSlots().length);
  Object.entries(slotPresets).forEach(([id, p]) => {
    html += chip(id, p.name || "Untitled", (p.slots || []).length);
  });
  html += `<button class="preset-chip preset-chip--new" onclick="openPresetEditor('__new__')">
    <span class="pc-plus"><svg class="ico-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span><span class="pc-name">Create New Preset</span>
  </button>`;

  wrap.innerHTML = html;
}

window.openPresetEditor = function (id) {
  editingPresetId = id;
  const editor = document.getElementById("preset-editor");
  const nameEl = document.getElementById("preset-name");
  const hint   = document.getElementById("preset-default-hint");

  if (id === "__new__") {
    editingSlots = [];
    nameEl.value = "";
    nameEl.disabled = false;
    hint.textContent = "";
  } else if (id === DEFAULT_PRESET) {
    editingSlots = builtinSlots();
    nameEl.value = "Default";
    nameEl.disabled = true;
    hint.textContent = "The default preset is built in and can't be edited or deleted. Create a new preset to customise times.";
  } else {
    const p = slotPresets[id] || {};
    editingSlots = [...(p.slots || [])];
    nameEl.value = p.name || "";
    nameEl.disabled = false;
    hint.textContent = "";
  }

  const isDefault = id === DEFAULT_PRESET;
  document.getElementById("btn-save-preset").classList.toggle("hidden", isDefault);
  document.getElementById("btn-delete-preset").classList.toggle("hidden", isDefault || id === "__new__");
  document.getElementById("btn-activate-preset").classList.toggle("hidden",
    id === "__new__" || id === activePresetId);

  document.getElementById("preset-error").classList.add("hidden");
  editor.classList.remove("hidden");
  renderPresetGrid();
  editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

window.closePresetEditor = function () {
  editingPresetId = null;
  document.getElementById("preset-editor").classList.add("hidden");
};

function renderPresetGrid() {
  const grid = document.getElementById("preset-grid");
  if (!grid) return;
  const readOnly = editingPresetId === DEFAULT_PRESET;

  const sorted = [...editingSlots].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  editingSlots = sorted;

  document.getElementById("preset-count").textContent = readOnly
    ? `${sorted.length} slot${sorted.length === 1 ? "" : "s"}`
    : `${sorted.length} / ${MAX_SLOTS}`;

  let html = sorted.map((s, i) => {
    const end = minutesToTime(timeToMinutes(s.start) + (s.duration || DEFAULT_DUR));
    return `<div class="slot-cell${readOnly ? " slot-cell--readonly" : ""}"
                 ${readOnly ? "" : `onclick="editSlotAt(${i})"`}>
      <span class="sc-time">${formatDisplayTime(s.start)}</span>
      <span class="sc-range">to ${formatDisplayTime(end)}</span>
      <span class="sc-dur">${s.duration || DEFAULT_DUR}m</span>
      ${readOnly ? "" : `<button class="sc-del" onclick="event.stopPropagation();removeSlotAt(${i})" title="Remove">✕</button>`}
    </div>`;
  }).join("");

  if (!readOnly) {
    const remaining = MAX_SLOTS - sorted.length;
    for (let i = 0; i < remaining; i++) {
      html += `<button class="slot-cell slot-cell--add" onclick="addSlotAt()"><svg class="ico-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
    }
  }

  grid.innerHTML = html || `<p class="no-data-msg" style="grid-column:1/-1">No slots yet.</p>`;
}

// ── Slot time modal ──
window.addSlotAt = function () {
  if (editingSlots.length >= MAX_SLOTS) return;
  editingSlotIdx = null;
  document.getElementById("st-title").textContent = "Add Slot";
  document.getElementById("btn-save-slot").textContent = "Add Slot";

  // Suggest the next time after the last slot
  let suggested = "09:00";
  if (editingSlots.length) {
    const last = editingSlots[editingSlots.length - 1];
    const next = timeToMinutes(last.start) + (last.duration || DEFAULT_DUR);
    if (next < 24 * 60) suggested = minutesToTime(next);
  }
  document.getElementById("st-start").value    = suggested;
  document.getElementById("st-duration").value = DEFAULT_DUR;
  document.getElementById("st-end").value      = minutesToTime(timeToMinutes(suggested) + DEFAULT_DUR);
  setSlotMode("duration", document.querySelector('.st-mode-btn[data-mode="duration"]'));
  document.getElementById("st-error").classList.add("hidden");
  document.getElementById("modal-slot-time").classList.remove("hidden");
  updateSlotPreview();
};

window.editSlotAt = function (idx) {
  const s = editingSlots[idx];
  if (!s) return;
  editingSlotIdx = idx;
  document.getElementById("st-title").textContent = "Edit Slot";
  document.getElementById("btn-save-slot").textContent = "Save Slot";
  document.getElementById("st-start").value    = s.start;
  document.getElementById("st-duration").value = s.duration || DEFAULT_DUR;
  document.getElementById("st-end").value      = minutesToTime(timeToMinutes(s.start) + (s.duration || DEFAULT_DUR));
  setSlotMode("duration", document.querySelector('.st-mode-btn[data-mode="duration"]'));
  document.getElementById("st-error").classList.add("hidden");
  document.getElementById("modal-slot-time").classList.remove("hidden");
  updateSlotPreview();
};

window.removeSlotAt = function (idx) {
  editingSlots.splice(idx, 1);
  renderPresetGrid();
};

window.setSlotMode = function (mode, btn) {
  slotMode = mode;
  document.querySelectorAll(".st-mode-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.getElementById("st-duration-group").classList.toggle("hidden", mode !== "duration");
  document.getElementById("st-end-group").classList.toggle("hidden", mode !== "end");
  updateSlotPreview();
};

window.setSlotDuration = function (min) {
  document.getElementById("st-duration").value = min;
  updateSlotPreview();
};

window.bumpSlotDuration = function (delta) {
  const el = document.getElementById("st-duration");
  const v  = Math.min(480, Math.max(5, (parseInt(el.value, 10) || DEFAULT_DUR) + delta));
  el.value = v;
  updateSlotPreview();
};

// Resolve the modal inputs into { start, duration } or an error string
function resolveSlotInput() {
  const start = document.getElementById("st-start").value;
  if (!start) return { error: "Pick a start time." };
  const sMin = timeToMinutes(start);

  let duration;
  if (slotMode === "duration") {
    duration = parseInt(document.getElementById("st-duration").value, 10);
    if (!duration || duration < 5) return { error: "Duration must be at least 5 minutes." };
  } else {
    const end = document.getElementById("st-end").value;
    if (!end) return { error: "Pick an end time." };
    duration = timeToMinutes(end) - sMin;
    if (duration <= 0) return { error: "End time must be after the start time." };
  }
  if (sMin + duration > 24 * 60) return { error: "Slot would run past midnight." };

  // Overlap check against the other slots in this preset
  const eMin = sMin + duration;
  for (let i = 0; i < editingSlots.length; i++) {
    if (i === editingSlotIdx) continue;
    const o    = editingSlots[i];
    const oS   = timeToMinutes(o.start);
    const oE   = oS + (o.duration || DEFAULT_DUR);
    if (sMin < oE && eMin > oS) {
      return { error: `Overlaps ${formatDisplayTime(o.start)} – ${formatDisplayTime(minutesToTime(oE))}.` };
    }
  }
  return { start, duration };
}

window.updateSlotPreview = function () {
  const prev = document.getElementById("st-preview");
  const err  = document.getElementById("st-error");
  const r    = resolveSlotInput();

  if (r.error) {
    prev.textContent = "—";
    prev.classList.add("st-preview--bad");
    err.textContent = r.error;
    err.classList.remove("hidden");
    return;
  }
  const end = minutesToTime(timeToMinutes(r.start) + r.duration);
  prev.textContent = `${formatDisplayTime(r.start)} → ${formatDisplayTime(end)}  ·  ${r.duration} min`;
  prev.classList.remove("st-preview--bad");
  err.classList.add("hidden");

  // Keep the hidden field in sync so switching modes carries the value over
  if (slotMode === "duration") document.getElementById("st-end").value = end;
  else document.getElementById("st-duration").value = r.duration;
};

window.saveSlotTime = function () {
  const r = resolveSlotInput();
  if (r.error) {
    const err = document.getElementById("st-error");
    err.textContent = r.error;
    err.classList.remove("hidden");
    return;
  }
  if (editingSlotIdx === null) {
    if (editingSlots.length >= MAX_SLOTS) return;
    editingSlots.push({ start: r.start, duration: r.duration });
  } else {
    editingSlots[editingSlotIdx] = { start: r.start, duration: r.duration };
  }
  closeModal("modal-slot-time");
  renderPresetGrid();
};

// ── Preset persistence ──
window.savePreset = async function () {
  const errEl = document.getElementById("preset-error");
  const name  = document.getElementById("preset-name").value.trim();
  errEl.classList.add("hidden");

  if (!name) {
    errEl.textContent = "Give the preset a name.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!editingSlots.length) {
    errEl.textContent = "Add at least one slot.";
    errEl.classList.remove("hidden");
    return;
  }

  const slots = [...editingSlots].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  try {
    let id = editingPresetId;
    if (id === "__new__") {
      const newRef = push(ref(db, "settings/slotPresets"));
      id = newRef.key;
      await set(newRef, { name, slots, createdAt: Date.now() });
    } else {
      await set(ref(db, `settings/slotPresets/${id}`), {
        name, slots,
        createdAt: (slotPresets[id] && slotPresets[id].createdAt) || Date.now(),
        updatedAt: Date.now(),
      });
    }
    slotPresets[id] = { name, slots };
    editingPresetId = id;
    renderPresetChips();
    renderWeekdayRows();
    document.getElementById("btn-delete-preset").classList.remove("hidden");
    document.getElementById("btn-activate-preset").classList.toggle("hidden", id === activePresetId);
    showToast("✓ Preset saved.");
  } catch (e) {
    errEl.textContent = "Couldn't save the preset. Please try again.";
    errEl.classList.remove("hidden");
  }
};

window.activatePreset = async function () {
  if (!editingPresetId || editingPresetId === "__new__") return;
  try {
    await set(ref(db, "settings/activeSlotPreset"), editingPresetId);
    activePresetId = editingPresetId;
    renderPresetChips();
    renderWeekdayRows();
    document.getElementById("btn-activate-preset").classList.add("hidden");
    showToast("✓ This preset is now live for customers.");
    loadBookings();
  } catch (e) {
    showToast("Couldn't activate the preset.");
  }
};

window.deletePreset = async function () {
  if (!editingPresetId || editingPresetId === DEFAULT_PRESET || editingPresetId === "__new__") return;
  if (!confirm("Delete this preset?")) return;
  try {
    await remove(ref(db, `settings/slotPresets/${editingPresetId}`));
    delete slotPresets[editingPresetId];

    // Drop any weekday assignments pointing at the deleted preset
    const orphans = Object.entries(weekdayPresets)
      .filter(([, id]) => id === editingPresetId)
      .map(([dow]) => dow);
    await Promise.all(orphans.map(dow => remove(ref(db, `settings/weekdayPresets/${dow}`))));
    orphans.forEach(dow => { delete weekdayPresets[dow]; });

    if (activePresetId === editingPresetId) {
      await set(ref(db, "settings/activeSlotPreset"), DEFAULT_PRESET);
      activePresetId = DEFAULT_PRESET;
      showToast("Preset deleted. Switched back to Default.");
    } else {
      showToast("Preset deleted.");
    }
    closePresetEditor();
    renderPresetChips();
    renderWeekdayRows();
  } catch (e) {
    showToast("Couldn't delete the preset.");
  }
};

// ── Closed Days ──
async function initClosedDates() {
  try {
    const snap = await get(ref(db, "settings/closedDates"));
    if (snap.exists()) closedDates = snap.val();
  } catch (e) { /* ignore */ }
}

function loadClosedDates() {
  const list = document.getElementById("closed-days-list");
  if (!list) return;
  list.innerHTML = "";

  const entries = Object.entries(closedDates)
    .filter(([k]) => k >= formatDateKey(new Date()))
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    list.innerHTML = `<p class="no-data-msg" style="font-size:0.82rem;padding:0.5rem 0">No upcoming closed days.</p>`;
    return;
  }

  entries.forEach(([dateKey, info]) => {
    const d = new Date(dateKey + "T00:00:00");
    const label = d.toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short", year:"2-digit" });
    const item = document.createElement("div");
    item.className = "closed-day-item";
    item.innerHTML = `
      <div class="closed-day-info">
        <span class="closed-day-date">${label}</span>
        <span class="closed-day-reason">${info.reason || "Closed"}</span>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="removeClosedDate('${dateKey}')">Remove</button>
    `;
    list.appendChild(item);
  });
}

window.addClosedDate = async function () {
  const dateInput   = document.getElementById("closed-date-input");
  const reasonInput = document.getElementById("closed-date-reason");
  const dateKey = dateInput.value;
  if (!dateKey) { showToast("Please select a date."); return; }
  const reason = reasonInput.value.trim() || "Shop closed";
  const entry  = { reason, closedAt: Date.now() };
  await set(ref(db, `settings/closedDates/${dateKey}`), entry);
  closedDates[dateKey] = entry;
  dateInput.value  = "";
  reasonInput.value = "";
  loadClosedDates();
  showToast(`✓ ${dateKey} marked as closed.`);
};

window.removeClosedDate = async function (dateKey) {
  await remove(ref(db, `settings/closedDates/${dateKey}`));
  delete closedDates[dateKey];
  loadClosedDates();
  showToast(`✓ Reopened.`);
};

window.closeModal = function (id) {
  document.getElementById(id).classList.add("hidden");
};

// ── Slot Availability View ──
window.openSlotViewModal = async function () {
  document.getElementById("modal-slot-view").classList.remove("hidden");
  document.getElementById("slot-view-grid").innerHTML = "";
  document.getElementById("slot-view-loading").classList.remove("hidden");

  const d = new Date(currentDateKey + "T00:00:00");
  document.getElementById("slot-view-date-label").textContent =
    d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });

  const [bookSnap, blkSnap] = await Promise.all([
    get(ref(db, `bookings/${currentDateKey}`)),
    get(ref(db, `blocked/${currentDateKey}`))
  ]);

  // Collect all occupied ranges
  const occupied = []; // { start, end, label, type }
  if (bookSnap.exists()) {
    bookSnap.forEach(child => {
      const b = child.val();
      // finished excluded too: the job is done, the chair is free again
      // (and matches client-side availability, which ignores finished)
      if (b.status === "cancelled" || b.status === "noshow" || b.status === "finished") return;
      occupied.push({
        start: timeToMinutes(b.startTime),
        end:   timeToMinutes(b.startTime) + (b.duration || 30),
        label: b.name ? `${b.name} – ${b.serviceName || ""}` : (b.serviceName || "Booking"),
        status: b.status || "confirmed",
        key:   child.key,
        type:  "booked"
      });
    });
  }
  if (blkSnap.exists()) {
    blkSnap.forEach(child => {
      const bl = child.val();
      occupied.push({
        start: timeToMinutes(bl.startTime),
        end:   timeToMinutes(bl.startTime) + (bl.duration || 30),
        label: bl.reason || "Blocked",
        type:  "blocked"
      });
    });
  }
  if (lunchBreakConfig.enabled && lunchBreakConfig.startTime) {
    const ls = timeToMinutes(lunchBreakConfig.startTime);
    const le = timeToMinutes(lunchBreakConfig.endTime);
    occupied.push({ start: ls, end: le, label: "Lunch Break", type: "blocked" });
  }

  // Exactly this day's slots (weekday assignment → global → built-in grid).
  // builtinSlots() already includes the lunch-break-end slot; custom presets
  // define every time explicitly, so nothing extra is injected here.
  const mins = new Set(activeSlotTimes(currentDateKey).map(s => timeToMinutes(s.start)));
  const slots = [...mins].sort((a, b) => a - b);

  const grid = document.getElementById("slot-view-grid");
  grid.innerHTML = "";
  document.getElementById("slot-view-loading").classList.add("hidden");

  const now = new Date();
  const isToday = currentDateKey === formatDateKey(now);

  slots.forEach(min => {
    const timeStr = minutesToTime(min);
    const hit = occupied.find(o => min >= o.start && min < o.end);
    const isPast = isToday && (now.getHours() * 60 + now.getMinutes()) > min;

    const el = document.createElement("div");
    el.className = "sv-slot" +
      (hit ? (hit.type === "blocked" ? " sv-slot--blocked" : " sv-slot--booked") : (isPast ? " sv-slot--past" : " sv-slot--free"));

    const timeEl = document.createElement("span");
    timeEl.className = "sv-slot-time";
    timeEl.textContent = formatDisplayTime(timeStr);

    const labelEl = document.createElement("span");
    labelEl.className = "sv-slot-label";
    labelEl.textContent = hit ? hit.label : (isPast ? "Past" : "Free");

    el.appendChild(timeEl);
    el.appendChild(labelEl);

    // Booked slot → open the booking's detail; free upcoming slot → prefilled walk-in form
    if (hit && hit.type === "booked" && hit.key) {
      el.classList.add("sv-slot--clickable");
      el.addEventListener("click", () => {
        closeModal("modal-slot-view");
        showBookingDetailModal(currentDateKey, hit.key, "Booking Details");
      });
    } else if (!hit && !isPast) {
      el.classList.add("sv-slot--clickable");
      el.addEventListener("click", () => {
        closeModal("modal-slot-view");
        switchTab("manual", document.querySelector('.nav-link[data-tab="manual"]'));
        const mDate = document.getElementById("m-date");
        const mTime = document.getElementById("m-time");
        if (mDate) mDate.value = currentDateKey;
        if (mTime) mTime.value = timeStr;
        document.getElementById("m-name")?.focus();
      });
    }

    grid.appendChild(el);
  });
};

// ═══════════════════════════════════
//  REVIEWS
// ═══════════════════════════════════

function updateReviewsBadge() {
  const seenAt = parseInt(localStorage.getItem('reviewsSeenAt') || '0', 10);
  get(ref(db, "reviews")).then(snap => {
    if (!snap.exists()) return;
    let unseen = 0;
    snap.forEach(c => { if ((c.val().createdAt || 0) > seenAt) unseen++; });
    const btn = document.querySelector('.nav-link[data-tab="reviews"]');
    if (!btn) return;
    let badge = btn.querySelector('.rv-notif-badge');
    if (unseen > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'rv-notif-badge future-badge';
        btn.style.position = 'relative';
        btn.appendChild(badge);
      }
      badge.textContent = unseen;
    } else if (badge) {
      badge.remove();
    }
  }).catch(() => {});
}

// ═══════════════════════════════════
//  BOOKING DETAIL MODAL (notification click)
// ═══════════════════════════════════

async function showBookingDetailModal(dateKey, bookingId, title = "New Booking") {
  const modal   = document.getElementById("modal-booking-detail");
  const content = document.getElementById("booking-detail-content");
  const titleEl = document.getElementById("bd-modal-title");
  if (titleEl) titleEl.textContent = title;
  modal.classList.remove("hidden");
  content.innerHTML = `
    <div class="skel-list" style="margin-top:0.5rem">
      <span class="skel" style="height:16px;width:60%"></span>
      <span class="skel" style="height:13px;width:80%"></span>
      <span class="skel" style="height:13px;width:70%"></span>
      <span class="skel" style="height:13px;width:75%"></span>
      <span class="skel" style="height:13px;width:50%"></span>
    </div>`;

  try {
    const snap = await get(ref(db, `bookings/${dateKey}/${bookingId}`));
    if (!snap.exists()) {
      content.innerHTML = `<p class="no-data-msg">Booking not found.</p>`;
      return;
    }
    const b      = snap.val();
    const name   = b.customerName || b.name || "Customer";
    const svc    = b.serviceName  || b.service || "—";
    let phone    = b.phone || "";
    if (!phone) {
      // Phone lives in the admin-only contacts branch for newer bookings
      const cSnap = await get(ref(db, `contacts/${dateKey}/${bookingId}`)).catch(() => null);
      phone = cSnap?.exists() ? (cSnap.val().phone || "") : "";
    }
    phone = phone || "—";
    const status = b.status || "confirmed";
    const source = b.source === "admin" ? "Walk-in" : "Online";
    const date   = new Date(dateKey + "T00:00:00").toLocaleDateString("en-IN",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const noteHtml = b.note
      ? `<div class="bd-row"><span class="bd-label">Note</span><span class="bd-value">${b.note}</span></div>` : "";

    content.innerHTML = `
      <div class="bd-customer">
        <div class="bd-avatar">${name[0].toUpperCase()}</div>
        <div class="bd-customer-info">
          <div class="bd-name">${name}</div>
          <div class="bd-phone">${phone}</div>
        </div>
      </div>
      <div class="bd-divider"></div>
      <div class="bd-rows">
        <div class="bd-row"><span class="bd-label">Service</span><span class="bd-value">${svc}</span></div>
        <div class="bd-row"><span class="bd-label">Date</span><span class="bd-value">${date}</span></div>
        <div class="bd-row"><span class="bd-label">Time</span><span class="bd-value">${b.startTime ? formatDisplayTime(b.startTime) : "—"}</span></div>
        <div class="bd-row"><span class="bd-label">Duration</span><span class="bd-value">${b.duration ? b.duration + " min" : "—"}</span></div>
        <div class="bd-row"><span class="bd-label">Source</span><span class="bd-value">${source}</span></div>
        <div class="bd-row"><span class="bd-label">Status</span><span class="bd-value"><span class="booking-badge badge-${status}">${status}</span></span></div>
        ${noteHtml}
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<p class="no-data-msg">Couldn't load booking details.</p>`;
  }
}

// ═══════════════════════════════════
//  DELETE & RECYCLE BIN
// ═══════════════════════════════════

window.deleteBooking = async function (key, dateKey) {
  if (!confirm("Move this booking to the Recycle Bin?")) return;
  try {
    const snap = await get(ref(db, `bookings/${dateKey}/${key}`));
    if (!snap.exists()) { showToast("Booking not found."); return; }
    const data = { ...snap.val(), deletedAt: Date.now(), deletedFrom: dateKey };
    await set(ref(db, `deleted/${dateKey}/${key}`), data);
    await remove(ref(db, `bookings/${dateKey}/${key}`));
    showToast("Moved to Recycle Bin.");
    loadBookings();
  } catch (e) {
    showToast("Error: couldn't delete booking.");
  }
};

window.restoreBooking = async function (key, dateKey) {
  try {
    const snap = await get(ref(db, `deleted/${dateKey}/${key}`));
    if (!snap.exists()) { showToast("Not found."); return; }
    const data = { ...snap.val() };
    delete data.deletedAt;
    delete data.deletedFrom;
    await set(ref(db, `bookings/${dateKey}/${key}`), data);
    await remove(ref(db, `deleted/${dateKey}/${key}`));
    showToast("Booking restored.");
    loadTrash();
  } catch (e) {
    showToast("Error: couldn't restore booking.");
  }
};

async function loadTrash() {
  const list    = document.getElementById("trash-list");
  const spinner = document.getElementById("trash-loading");
  list.innerHTML = "";
  spinner.classList.remove("hidden");

  let snap;
  try {
    snap = await get(ref(db, "deleted"));
  } catch (e) {
    spinner.classList.add("hidden");
    list.innerHTML = `<p class="no-data-msg">Couldn't load trash.</p>`;
    return;
  }

  spinner.classList.add("hidden");

  if (!snap.exists()) {
    list.innerHTML = `<p class="no-data-msg">Recycle Bin is empty.</p>`;
    return;
  }

  const items = [];
  snap.forEach(dateSnap => {
    dateSnap.forEach(c => {
      items.push({ _key: c.key, _dateKey: dateSnap.key, ...c.val() });
    });
  });
  items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "trash-card";
    const deletedDate = item.deletedAt
      ? new Date(item.deletedAt).toLocaleDateString("en-IN",
          { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "Unknown";
    const apptDate = item._dateKey
      ? new Date(item._dateKey + "T00:00:00").toLocaleDateString("en-IN",
          { day: "numeric", month: "short", year: "2-digit" })
      : "—";
    card.innerHTML = `
      <div class="trash-card-info">
        <div class="trash-name">${item.customerName || item.name || "Customer"}</div>
        <div class="trash-meta">${item.serviceName || item.service || "—"} &middot; ${apptDate}${item.startTime ? " " + formatDisplayTime(item.startTime) : ""}</div>
        <div class="trash-deleted-at">Deleted ${deletedDate}</div>
      </div>
      <div class="trash-card-actions">
        <button class="btn btn-sm btn-outline" onclick="restoreBooking('${item._key}','${item._dateKey}')">&#8629; Restore</button>
      </div>
    `;
    list.appendChild(card);
  });
}

async function loadReviews() {
  const list = document.getElementById("reviews-list");
  const spinner = document.getElementById("reviews-loading");
  list.innerHTML = "";
  spinner.classList.remove("hidden");

  let snap;
  try {
    snap = await get(ref(db, "reviews"));
  } catch (e) {
    spinner.classList.add("hidden");
    list.innerHTML = `<p class="no-data-msg">Couldn't load reviews.</p>`;
    return;
  }

  spinner.classList.add("hidden");

  if (!snap.exists()) {
    list.innerHTML = `<p class="no-data-msg">No reviews yet.</p>`;
    return;
  }
  
  const reviews = [];
  
  // Added curly braces to prevent returning the array length, 
  // which causes Firebase's forEach to cancel the iteration.
  snap.forEach(c => {
    reviews.push({ _key: c.key, ...c.val() });
  });

  reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  reviews.forEach(r => {
    const card = document.createElement("div");
    card.className = "review-card";
    
    const stars = [1, 2, 3, 4, 5].map(i =>
      `<span class="rv-star-sm${i <= r.rating ? " filled" : ""}">${i <= r.rating ? "★" : "☆"}</span>`
    ).join("");
    
    const date = new Date(r.createdAt).toLocaleDateString("en-IN", { 
      day: "numeric", 
      month: "short", 
      year: "2-digit" 
    });
    
    const textHtml = r.text ? `<p class="rv-text">"${r.text}"</p>` : "";
    
    card.innerHTML = `
      <div class="rv-card-top">
        <span class="rv-service">${r.serviceName || "—"}</span>
        <span class="rv-stars-row">${stars}</span>
      </div>
      ${textHtml}
      <div class="rv-meta">${r.customerName || "Customer"} · ${date}</div>
    `;
    list.appendChild(card);
  });
}

