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
  { id: "haircut",       name: "Hair Cut (Mens)",  defaultDuration: 30 },
  { id: "beard",         name: "Beard Setting",    defaultDuration: 30 },
  { id: "haircut_beard", name: "Hair Cut & Beard", defaultDuration: 40 },
  { id: "facial",        name: "Facial",           defaultDuration: 40 },
  { id: "hair_spa",      name: "Hair Spa",         defaultDuration: 20 },
];
let serviceDurations = {}; // { svcId: minutes } — overrides loaded from Firebase

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

  initServiceDurations();
  startNewBookingWatcher();
  switchTab("bookings", document.querySelector('.nav-link[data-tab="bookings"]'));
  loadNoshows();
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
  if (tabId === "settings") { loadServiceSettings(); loadNotifStatus(); }
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

      // Sort by startTime
      items.sort((a, b) => a.startTime.localeCompare(b.startTime));

      items.forEach(item => list.appendChild(buildBookingCard(item)));
      updateStats(items);

      if (items.length === 0) noMsg.classList.remove("hidden");
    });
  });
}

function buildBookingCard(item) {
  const isBlock = item.source === "block";
  const card = document.createElement("div");
  card.className = `booking-card status-${item.status || "confirmed"}`;

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
    ? `<button class="btn btn-sm btn-danger" onclick="removeBlock('${item.key}')">Remove</button>`
    : item.status !== "noshow" && item.status !== "cancelled" && item.status !== "finished"
      ? `
        <button class="btn btn-sm btn-success" onclick="finishBooking('${item.key}', '${currentDateKey}')">Finish</button>
        <button class="btn btn-sm btn-outline" onclick="openEditModal('${item.key}', '${currentDateKey}')">Edit Time</button>
        <button class="btn btn-sm btn-warning" onclick="openCancelModal('${item.key}', '${currentDateKey}')">Cancel</button>
        <button class="btn btn-sm btn-danger"  onclick="openNoshowModal('${item.key}', '${currentDateKey}')">No-Show</button>
      `
      : `<span class="source-tag">${statusLabel}</span>`;

  card.innerHTML = `
    <div class="booking-time">
      <div class="booking-time-start">${formatDisplayTime(item.startTime)}</div>
      <div class="booking-time-end">${formatDisplayTime(endStr)}</div>
    </div>
    <div class="booking-separator"></div>
    <div class="booking-info">
      <div class="booking-name">${item.name || "Blocked"}</div>
      <div class="booking-service">${isBlock ? (item.reason || "Break") : item.serviceName}</div>
      ${!isBlock && item.phone ? `<div class="booking-phone">📞 +91 ${item.phone}</div>` : ""}
      <div class="booking-meta">
        <span class="status-badge ${badgeClass}">${statusLabel}</span>
        ${sourceBadge}
      </div>
    </div>
    <div class="booking-actions">${actionsHtml}</div>
  `;

  return card;
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

  for (let min = OPEN; min <= CLOSE; min += 30) {
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
//  SERVICE DURATION SETTINGS
// ═══════════════════════════════════

async function initServiceDurations() {
  try {
    const snap = await get(ref(db, "settings/services"));
    if (snap.exists()) {
      snap.forEach(child => {
        if (child.val().duration) serviceDurations[child.key] = child.val().duration;
      });
    }
  } catch (e) { /* keep defaults on error */ }
}

function loadServiceSettings() {
  const list = document.getElementById("service-settings-list");
  if (!list) return;
  list.innerHTML = "";

  DEFAULT_SERVICES.forEach(svc => {
    const current = serviceDurations[svc.id] || svc.defaultDuration;
    const card = document.createElement("div");
    card.className = "svc-setting-card";
    card.innerHTML = `
      <div class="svc-setting-info">
        <div class="svc-setting-name">${svc.name}</div>
        <div class="svc-setting-default">Default: ${svc.defaultDuration} min</div>
      </div>
      <div class="svc-setting-controls">
        <button class="btn-icon svc-dur-adj" onclick="adjustDur('${svc.id}', -5)">−</button>
        <div class="svc-dur-display">
          <input type="number" class="svc-duration-input" id="dur-${svc.id}"
                 value="${current}" min="5" max="120" step="5" />
          <span class="svc-dur-unit">min</span>
        </div>
        <button class="btn-icon svc-dur-adj" onclick="adjustDur('${svc.id}', 5)">+</button>
        <button class="btn btn-sm btn-primary" onclick="saveServiceDuration('${svc.id}')">Save</button>
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

window.saveServiceDuration = async function (svcId) {
  const input = document.getElementById(`dur-${svcId}`);
  const val = parseInt(input?.value);
  if (!val || val < 5 || val > 120) { showToast("Duration must be 5–120 minutes."); return; }
  await set(ref(db, `settings/services/${svcId}/duration`), val);
  serviceDurations[svcId] = val;
  showToast(`✓ Duration updated to ${val} min.`);
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
          <div class="noshow-phone">${ns.phone || "No phone"}</div>
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

function showToast(msg, duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

window.closeModal = function (id) {
  document.getElementById(id).classList.add("hidden");
};
