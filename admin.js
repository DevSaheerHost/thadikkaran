// ═══════════════════════════════════════════════
//  THADIKKARAN – ADMIN PANEL
//  Bookings, Blocks, No-Shows, Edit + FCM
// ═══════════════════════════════════════════════

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
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
const auth      = getAuth(app);
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
    if (!snap.exists() || snap.val() !== true) {
      showAccessDenied();
      return;
    }
  } catch (e) {
    showAccessDenied();
    return;
  }

  currentUser = user;
  showApp();
  initFCM();
});

function showAccessDenied() {
  hideSplash();
  document.body.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;
                background:#0a0a0a;font-family:sans-serif;padding:2rem;text-align:center">
      <div>
        <div style="color:#d4a34e;font-size:2rem;margin-bottom:1rem">✦</div>
        <h2 style="color:#fff;font-size:1.3rem;font-weight:600;margin-bottom:.5rem">Access Denied</h2>
        <p style="color:#666;font-size:.9rem;margin-bottom:2rem;line-height:1.6">
          This page is for shop staff only.<br>Your account doesn't have admin access.
        </p>
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
        loadBookings();
        switchTab("bookings", document.querySelector('.nav-link[data-tab="bookings"]'));
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
  if (tabId === "settings") { loadLunchSettings(); loadServiceSettings(); loadClosedDates(); loadNotifStatus(); }
  if (tabId === 'reviews') {
    localStorage.setItem('reviewsSeenAt', Date.now());
    updateReviewsBadge();
    loadReviews();
  }
  if (tabId === 'trash') loadTrash();
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

    let items = [];
    snap.forEach(child => {
      items.push({ key: child.key, ...child.val() });
    });

    // Also load blocks
    get(ref(db, `blocked/${currentDateKey}`)).then(blockSnap => {
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

      items.forEach(item => list.appendChild(buildBookingCard(item)));
      updateStats(items);
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
  const sourceBadge = item.source === "admin"  ? `<span class="status-badge badge-walk-in">Walk-in</span>` : "";

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
        ${sourceBadge}
      </div>
      ${!isBlock && item.createdAt ? `<div class="booking-booked-at">Booked ${formatBookedAt(item.createdAt)}</div>` : ""}
      ${item.status === "finished" && !isBlock ? `<div class="booking-review-stars"></div>` : ""}
      ${item.status === "cancelled" && item.cancelReason ? `<div class="booking-cancel-reason">"${item.cancelReason}"</div>` : ""}
    </div>
    <div class="booking-actions">${actionsHtml}</div>
  `;

  return card;
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
  const confirmed = items.filter(b => b.status === "confirmed" || b.status === "walk-in");
  const noshows   = items.filter(b => b.status === "noshow");
  const revenue   = confirmed.reduce((sum, b) => sum + (b.price || 0), 0);

  document.getElementById("stat-total").textContent     = items.filter(b => b.source !== "block").length;
  document.getElementById("stat-confirmed").textContent = confirmed.length;
  document.getElementById("stat-noshow").textContent    = noshows.length;
  document.getElementById("stat-revenue").textContent   = `₹${revenue}`;
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

  if (endMinutes > 20*60) {
    errEl.textContent = "Appointment would end after closing time (8:00 PM).";
    errEl.classList.remove("hidden");
    return;
  }

  const booking = {
    name,
    phone,
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
    await push(ref(db, `bookings/${dateVal}`), booking);
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

  // Build slot grid 9:00 AM – 8:00 PM
  const grid = document.getElementById("edit-slots-grid");
  grid.innerHTML = "";
  const OPEN = 9 * 60, CLOSE = 20 * 60;

  for (let min = OPEN; min <= CLOSE; min += 40) {
    const timeStr  = minutesToTime(min);
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
  closeModal("modal-cancel");
  showToast("Booking cancelled.");
  loadBookings();
  cancellingBooking = null;
};

window.finishBooking = async function (key, dateKey) {
  const now    = new Date();
  const endStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const snap   = await get(ref(db, `bookings/${dateKey}/${key}`));
  if (!snap.exists()) return;
  const b            = snap.val();
  const startMin     = timeToMinutes(b.startTime);
  const endMin       = timeToMinutes(endStr);
  const actualDur    = Math.max(endMin - startMin, 1);

  await update(ref(db, `bookings/${dateKey}/${key}`), {
    status:      "finished",
    endTime:     endStr,
    duration:    actualDur,
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
      if (b.status === "cancelled" || b.status === "noshow") return;
      occupied.push({
        start: timeToMinutes(b.startTime),
        end:   timeToMinutes(b.startTime) + (b.duration || 30),
        label: b.name ? `${b.name} – ${b.serviceName || ""}` : (b.serviceName || "Booking"),
        status: b.status || "confirmed",
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

  // Generate slots — fixed 40-min grid + lunch end injection
  const OPEN = 9 * 60, CLOSE = 20 * 60, STEP = 40;
  const mins = new Set();
  for (let m = OPEN; m <= CLOSE; m += STEP) mins.add(m);
  // Inject lunch break end time (2:30 PM is off the 40-min grid)
  if (lunchBreakConfig.enabled && lunchBreakConfig.endTime) {
    const [eh, em] = lunchBreakConfig.endTime.split(":").map(Number);
    const le = eh * 60 + em;
    if (le > OPEN && le < CLOSE) mins.add(le);
  }
  const slots = [...mins].sort((a, b) => a - b);

  const grid = document.getElementById("slot-view-grid");
  grid.innerHTML = "";
  document.getElementById("slot-view-loading").classList.add("hidden");

  const now = new Date();
  const isToday = currentDateKey === formatDateKey(now);

  slots.forEach(min => {
    if (min >= CLOSE) return;
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
        <div class="trash-meta">${item.serviceName || item.service || "—"} &middot; ${apptDate}${item.startTime ? " " + item.startTime : ""}</div>
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
  const list    = document.getElementById("reviews-list");
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
  snap.forEach(c => reviews.push({ _key: c.key, ...c.val() }));
  reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  reviews.forEach(r => {
    const card = document.createElement("div");
    card.className = "review-card";
    const stars = [1,2,3,4,5].map(i =>
      `<span class="rv-star-sm${i <= r.rating ? " filled" : ""}">${i <= r.rating ? "★" : "☆"}</span>`
    ).join("");
    const date = new Date(r.createdAt).toLocaleDateString("en-IN",
      { day: "numeric", month: "short", year: "2-digit" });
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
