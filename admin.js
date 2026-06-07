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

// ── State ──
let currentUser     = null;
let currentDateKey  = formatDateKey(new Date());
let editingBooking  = null;   // { key, dateKey, booking }
let noshowBooking   = null;   // { key, dateKey, booking }
let pendingEditTime = null;   // new start time string "HH:MM"
let unsubBookings   = null;   // real-time listener unsubscribe

// ═══════════════════════════════════
//  AUTH
// ═══════════════════════════════════

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    showApp();
    initFCM();
  } else {
    currentUser = null;
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById("screen-auth").classList.remove("hidden");
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("active");
}

function showApp() {
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
  if (unsubBookings) unsubBookings();
  await fbSignOut(auth);
};

function setAuthLoading(on) { document.getElementById("auth-loading").classList.toggle("hidden", !on); }
function showAuthError(msg) { const el=document.getElementById("auth-error"); el.textContent=msg; el.classList.remove("hidden"); }
function clearAuthError() { document.getElementById("auth-error").classList.add("hidden"); }

// ═══════════════════════════════════
//  FCM – PUSH NOTIFICATIONS
// ═══════════════════════════════════

async function initFCM() {
  try {
    // Register service worker
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("Notification permission denied.");
      return;
    }

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      // Save FCM token to DB for server-side use
      await set(ref(db, `admin/fcmTokens/${currentUser.uid}`), {
        token,
        updatedAt: Date.now()
      });
      console.log("FCM Token registered:", token);
    }

    // Handle foreground messages
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || "New Booking";
      const body  = payload.notification?.body  || "A new appointment was made.";
      showToast(`🔔 ${title}: ${body}`);
    });

  } catch (err) {
    console.error("FCM init error:", err);
  }
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
  if (tabId === "block") loadActiveBlocks();
  if (tabId === "noshows") loadNoshows();
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
  document.getElementById("bookings-date-label").textContent =
    d.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

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
    blocked:   "badge-blocked"
  };
  const badgeClass = statusMap[item.status] || "badge-confirmed";
  const statusLabel = item.status === "blocked" ? "Blocked" : (item.status || "confirmed");
  const sourceBadge = item.source === "admin"  ? `<span class="status-badge badge-walk-in">Walk-in</span>` : "";

  const actionsHtml = isBlock
    ? `<button class="btn btn-sm btn-danger" onclick="removeBlock('${item.key}')">Remove</button>`
    : item.status !== "noshow" && item.status !== "cancelled"
      ? `
        <button class="btn btn-sm btn-outline" onclick="openEditModal('${item.key}', '${currentDateKey}')">Edit Time</button>
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
      <div class="booking-meta">
        <span class="status-badge ${badgeClass}">${statusLabel}</span>
        ${sourceBadge}
        ${item.phone ? `<span class="source-tag">${item.phone}</span>` : ""}
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
  const duration = parseInt(durStr)   || 30;

  const startMinutes = timeToMinutes(timeVal);
  const endMinutes   = startMinutes + duration;

  if (endMinutes > 20*60+30) {
    errEl.textContent = "Appointment would end after closing time (8:30 PM).";
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

window.openEditModal = async function (bookingKey, dateKey) {
  const snap = await get(ref(db, `bookings/${dateKey}/${bookingKey}`));
  if (!snap.exists()) return;

  editingBooking = { key: bookingKey, dateKey, booking: snap.val() };
  const b = editingBooking.booking;

  document.getElementById("edit-booking-label").textContent =
    `${b.name} – ${b.serviceName} @ ${formatDisplayTime(b.startTime)}`;
  document.getElementById("edit-time-input").value = b.startTime;
  document.getElementById("overlap-warning").classList.add("hidden");
  document.getElementById("edit-overlap-confirm").classList.add("hidden");

  document.getElementById("modal-edit").classList.remove("hidden");
};

window.closeEditModal = function () {
  document.getElementById("modal-edit").classList.add("hidden");
  editingBooking = null;
  pendingEditTime = null;
};

window.saveEditTime = async function () {
  if (!editingBooking) return;
  const newTime  = document.getElementById("edit-time-input").value;
  if (!newTime) return;

  const b        = editingBooking.booking;
  const duration = b.duration;

  // Load all bookings for this date
  const snap = await get(ref(db, `bookings/${editingBooking.dateKey}`));
  let conflicts = [];

  if (snap.exists()) {
    snap.forEach(child => {
      if (child.key === editingBooking.key) return;  // skip self
      const other = child.val();
      if (other.status === "cancelled" || other.status === "noshow") return;

      const newStart  = timeToMinutes(newTime);
      const newEnd    = newStart + duration;
      const otherStart = timeToMinutes(other.startTime);
      const otherEnd   = otherStart + other.duration;

      if (newStart < otherEnd && newEnd > otherStart) {
        conflicts.push(other);
      }
    });
  }

  if (conflicts.length > 0) {
    const conflictNames = conflicts.map(c => `${c.name} (${formatDisplayTime(c.startTime)})`).join(", ");
    document.getElementById("overlap-detail").textContent =
      `Conflicts with: ${conflictNames}`;
    document.getElementById("overlap-warning").classList.remove("hidden");
    document.getElementById("edit-overlap-confirm").classList.remove("hidden");
    document.getElementById("btn-save-edit").classList.add("hidden");
    pendingEditTime = newTime;
  } else {
    await applyEditTime(newTime);
  }
};

window.forceEditTime = async function () {
  if (!pendingEditTime) return;
  await applyEditTime(pendingEditTime);
};

async function applyEditTime(newTime) {
  const b        = editingBooking.booking;
  const duration = b.duration;
  const newEnd   = minutesToTime(timeToMinutes(newTime) + duration);

  await update(ref(db, `bookings/${editingBooking.dateKey}/${editingBooking.key}`), {
    startTime: newTime,
    endTime:   newEnd
  });

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
