// ═══════════════════════════════════════════════
//  THADIKKARAN – CLIENT APP
//  Firebase Auth + Realtime DB Booking Logic
// ═══════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  query,
  orderByChild,
  equalTo,
  onValue
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

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getDatabase(app);
const messaging = getMessaging(app);

const VAPID_KEY = "BJljfSryCZol-Pg9YfT2x9OKMP4kom5Q6OBeuzgN4773-PLqhvhTPFOVA2PRvwTKDCc3ZeN1h1Uc0ilieNj6NQQ";
// Shop location — update coordinates after confirming on Google Maps
const SHOP_MAPS_URL = "https://maps.app.goo.gl/jXQPye2JHpAyTq4M9";
const SHOP_LAT = null; // e.g. 10.8505
const SHOP_LNG = null; // e.g. 76.2711

// ── Services Data ──
const SERVICES = [
  { id: "haircut",       name: "Hair Cut (Mens)",    price: 150,  duration: 30,  priceDisplay: "₹150" },
  { id: "beard",         name: "Beard Setting",      price: 100,  duration: 30,  priceDisplay: "₹100" },
  { id: "haircut_beard", name: "Hair Cut & Beard",   price: 250,  duration: 40,  priceDisplay: "₹250" },
  { id: "facial",        name: "Facial",             price: null, duration: 40,  priceDisplay: "At Store" },
  { id: "hair_spa",      name: "Hair Spa",           price: null, duration: 20,  priceDisplay: "At Store" },
];

// ── Shop Config ──
const SHOP = {
  openHour:  9,    // 9:00 AM
  openMin:   0,
  closeHour: 20,   // 8:00 PM
  closeMin:  0,
  slotStep:  30,   // minutes per base slot
  maxAdvanceDays: 6,
  holidayDays: [2] // Tuesday = 2 (0=Sun, 1=Mon, 2=Tue...)
};

// ── State ──
let currentStep = 1;
let selectedService = null;
let selectedDate = null;
let selectedSlot = null;
let currentUser = null;
let userPhone   = null;   // collected phone number

// ═══════════════════════════════════
//  AUTH LOGIC
// ═══════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  hideSplash();
  if (user) {
    currentUser = user;
    // Resolve phone: Google profile → Firebase DB → ask user
    if (user.phoneNumber) {
      userPhone = user.phoneNumber;
      showApp(user);
    } else {
      const snap = await get(ref(db, `users/${user.uid}/phone`));
      if (snap.exists() && snap.val()) {
        userPhone = snap.val();
        showApp(user);
      } else {
        showPhoneModal();
      }
    }
  } else {
    currentUser = null;
    userPhone   = null;
    showAuthScreen();
  }
});

function hideSplash() {
  const el = document.getElementById("screen-loading");
  if (!el || el.classList.contains("hidden")) return;
  el.classList.add("sl-fade-out");
  setTimeout(() => el.classList.add("hidden"), 380);
}

function showAuthScreen() {
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("screen-auth").classList.remove("hidden");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("active");
}

function showApp(user) {
  document.getElementById("screen-auth").classList.remove("active");
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("screen-app").classList.add("active");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user.displayName ? `, ${user.displayName.split(" ")[0]}` : "";
  document.getElementById("header-greeting").textContent = `${greeting}${name}`;

  buildServicesUI();
  buildCalendarUI();
  watchRescheduledBookings();
  initClientFCM();
}

// Google Sign-In
window.signInWithGoogle = async function () {
  setAuthLoading(true);
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    clearAuthError();
  } catch (err) {
    showAuthError("Google sign-in failed. Please try again.");
  } finally {
    setAuthLoading(false);
  }
};

function showPhoneModal() {
  document.getElementById("modal-phone").classList.remove("hidden");
  document.getElementById("modal-phone-input").focus();
}

window.submitPhoneModal = async function () {
  const raw = document.getElementById("modal-phone-input").value.trim();
  const errEl = document.getElementById("modal-phone-error");
  errEl.classList.add("hidden");

  if (!/^\d{10}$/.test(raw)) {
    errEl.textContent = "Enter a valid 10-digit mobile number.";
    errEl.classList.remove("hidden");
    return;
  }

  const phone = "+91" + raw;
  try {
    await set(ref(db, `users/${currentUser.uid}/phone`), phone);
    userPhone = phone;
    document.getElementById("modal-phone").classList.add("hidden");
    showApp(currentUser);
  } catch (e) {
    errEl.textContent = "Could not save. Please try again.";
    errEl.classList.remove("hidden");
  }
};

// Sign Out
window.signOut = async function () {
  dotListeners.forEach(u => u());
  dotListeners = [];
  await fbSignOut(auth);
  resetBooking();
};

function setAuthLoading(on) {
  document.getElementById("auth-loading").classList.toggle("hidden", !on);
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}

// ═══════════════════════════════════
//  SERVICES UI
// ═══════════════════════════════════

function buildServicesUI() {
  const container = document.getElementById("services-list");
  container.innerHTML = "";

  SERVICES.forEach(svc => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.dataset.id = svc.id;
    card.innerHTML = `
      <div class="service-info">
        <div class="service-name">${svc.name}</div>
        <div class="service-meta">
          <span>${svc.duration} mins</span>
        </div>
      </div>
      <div class="service-right">
        <div class="service-price ${svc.price === null ? 'tbd' : ''}">${svc.priceDisplay}</div>
        <div class="service-check">✓</div>
      </div>
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".service-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedService = svc;
      document.getElementById("btn-next-1").disabled = false;
    });

    container.appendChild(card);
  });
}

// ═══════════════════════════════════
//  CALENDAR UI
// ═══════════════════════════════════

function buildCalendarUI() {
  const container = document.getElementById("calendar-strip");
  container.innerHTML = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  for (let i = 0; i <= SHOP.maxAdvanceDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const isHoliday = SHOP.holidayDays.includes(d.getDay());

    const dayEl = document.createElement("div");
    dayEl.className = "cal-day" + (isHoliday ? " disabled" : "") + (i === 0 ? " today" : "");
    dayEl.innerHTML = `
      <span class="cal-day-name">${DAY_NAMES[d.getDay()]}</span>
      <span class="cal-day-num">${d.getDate()}</span>
      <span class="cal-day-month">${MONTH_NAMES[d.getMonth()]}</span>
    `;

    if (!isHoliday) {
      dayEl.addEventListener("click", () => {
        document.querySelectorAll(".cal-day").forEach(c => c.classList.remove("selected"));
        dayEl.classList.add("selected");
        selectedDate = new Date(d);
        document.getElementById("btn-next-2").disabled = false;
      });
    }

    container.appendChild(dayEl);
  }
}

// ═══════════════════════════════════
//  TIME SLOTS
// ═══════════════════════════════════

async function loadSlots() {
  if (!selectedDate || !selectedService) return;

  const slotsGrid = document.getElementById("slots-grid");
  const noSlotsMsg = document.getElementById("no-slots-msg");
  const loading = document.getElementById("slots-loading");

  slotsGrid.innerHTML = "";
  noSlotsMsg.classList.add("hidden");
  loading.classList.remove("hidden");
  document.getElementById("btn-next-3").disabled = true;

  const dateKey = formatDateKey(selectedDate);
  document.getElementById("slots-sub").textContent =
    `Available for ${selectedDate.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"short" })}`;

  // Fetch bookings for this date (including admin blocks)
  const bookingsRef = ref(db, `bookings/${dateKey}`);
  let bookedSlots = [];

  try {
    const snap = await get(bookingsRef);
    if (snap.exists()) {
      snap.forEach(child => {
        const b = child.val();
        if (b.status !== "cancelled") {
          bookedSlots.push({ start: b.startTime, duration: b.duration });
        }
      });
    }
  } catch (e) {
    console.error("Error fetching slots:", e);
  }

  // Also fetch blocked slots
  const blockedRef = ref(db, `blocked/${dateKey}`);
  try {
    const snap2 = await get(blockedRef);
    if (snap2.exists()) {
      snap2.forEach(child => {
        const bl = child.val();
        bookedSlots.push({ start: bl.startTime, duration: bl.duration || 30 });
      });
    }
  } catch (e) {}

  loading.classList.add("hidden");

  // Generate all possible slots
  const allSlots = generateSlots();
  const svcDuration = selectedService.duration;
  let hasAvailable = false;

  allSlots.forEach(slot => {
    const isUnavailable = isSlotUnavailable(slot, svcDuration, bookedSlots, allSlots);
    const btn = document.createElement("button");
    btn.className = "slot-btn" + (isUnavailable ? " booked" : "");
    btn.textContent = formatTime(slot);
    btn.disabled = isUnavailable;

    if (!isUnavailable) {
      hasAvailable = true;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".slot-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedSlot = slot;
        document.getElementById("btn-next-3").disabled = false;
      });
    }

    slotsGrid.appendChild(btn);
  });

  if (!hasAvailable) noSlotsMsg.classList.remove("hidden");
}

/** Generate all time slots in [hour, minute] pairs */
function generateSlots() {
  const slots = [];
  let h = SHOP.openHour, m = SHOP.openMin;
  const endMinutes = SHOP.closeHour * 60 + SHOP.closeMin;

  while (h * 60 + m <= endMinutes) {
    slots.push([h, m]);
    m += SHOP.slotStep;
    if (m >= 60) { h += 1; m -= 60; }
  }
  return slots;
}

/** Check if a slot overlaps with any booked booking, or is in the past */
function isSlotUnavailable(slot, duration, bookedSlots, allSlots) {
  const slotStart = slot[0] * 60 + slot[1];
  const slotEnd   = slotStart + duration;
  const shopEnd   = SHOP.closeHour * 60 + SHOP.closeMin;

  // Disallow slots that start after closing time (8 PM slot itself is allowed)
  if (slotStart > shopEnd) return true;

  // ── PAST SLOT CHECK ──
  // If the selected date is TODAY, hide any slot whose start time
  // is before (current time + 30 min buffer)
  const now        = new Date();
  const todayKey   = formatDateKey(now);
  const selDateKey = formatDateKey(selectedDate);

  if (selDateKey === todayKey) {
    const nowMinutes   = now.getHours() * 60 + now.getMinutes();
    const bufferMinutes = 30; // minimum lead time in minutes
    if (slotStart < nowMinutes + bufferMinutes) return true;
  }

  // Check overlap with any booked slot
  for (const b of bookedSlots) {
    const [bh, bm] = b.start.split(":").map(Number);
    const bStart = bh * 60 + bm;
    const bEnd   = bStart + b.duration;

    // Overlap: new slot [slotStart, slotEnd) overlaps [bStart, bEnd)?
    if (slotStart < bEnd && slotEnd > bStart) return true;
  }

  return false;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function formatTime([h, m]) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}

// ═══════════════════════════════════
//  STEP NAVIGATION
// ═══════════════════════════════════

window.goToStep = function (step) {
  if (step === 3 && (!selectedDate || !selectedService)) return;
  if (step === 4 && !selectedSlot) return;

  // Update step indicators
  document.querySelectorAll(".step").forEach(el => {
    const n = parseInt(el.dataset.step);
    el.classList.toggle("active", n === step);
    el.classList.toggle("completed", n < step);
  });

  // Hide all step content
  document.querySelectorAll(".step-content").forEach(el => {
    el.classList.remove("active");
    el.classList.add("hidden");
  });

  // Show target step
  const target = document.getElementById(`step-${step}`);
  target.classList.remove("hidden");
  target.classList.add("active");

  currentStep = step;

  // Trigger slot loading when reaching step 3
  if (step === 3) loadSlots();

  // Populate confirm screen
  if (step === 4) populateConfirm();

  window.scrollTo({ top: 0, behavior: "smooth" });
};

function populateConfirm() {
  document.getElementById("confirm-service").textContent  = selectedService.name;
  document.getElementById("confirm-date").textContent     = selectedDate.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  document.getElementById("confirm-time").textContent     = formatTime(selectedSlot);
  document.getElementById("confirm-duration").textContent = `${selectedService.duration} minutes`;
  document.getElementById("confirm-price").textContent    = selectedService.priceDisplay;
}

// ═══════════════════════════════════
//  BOOKING SUBMISSION
// ═══════════════════════════════════

window.confirmBooking = async function () {
  if (!currentUser || !selectedService || !selectedDate || !selectedSlot) return;

  const btn = document.getElementById("btn-confirm");
  btn.textContent = "Booking...";
  btn.disabled = true;

  const dateKey  = formatDateKey(selectedDate);
  const startStr = `${String(selectedSlot[0]).padStart(2,"0")}:${String(selectedSlot[1]).padStart(2,"0")}`;
  const endMin   = selectedSlot[0] * 60 + selectedSlot[1] + selectedService.duration;
  const endStr   = `${String(Math.floor(endMin/60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;

  const booking = {
    uid:         currentUser.uid,
    name:        currentUser.displayName || "Client",
    phone:       userPhone || "",
    serviceId:   selectedService.id,
    serviceName: selectedService.name,
    price:       selectedService.price,
    duration:    selectedService.duration,
    dateKey:     dateKey,
    startTime:   startStr,
    endTime:     endStr,
    status:      "confirmed",
    createdAt:   Date.now(),
    noShowCount: 0,
    source:      "client"
  };

  try {
    const bookingsRef = ref(db, `bookings/${dateKey}`);
    const newRef = await push(bookingsRef, booking);
    const bookingId = newRef.key;

    // Also update user's booking history (bookingId links to live data)
    await push(ref(db, `users/${currentUser.uid}/bookings`), {
      bookingId, dateKey, startTime: startStr, serviceName: selectedService.name, status: "confirmed"
    });

    // Fire-and-forget: notify admin via Vercel serverless function
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, dateKey, booking }),
    }).catch(() => {});

    // Schedule client reminder notifications
    scheduleReminders(bookingId, booking);

    showSuccessModal();
  } catch (err) {
    document.getElementById("booking-error").textContent = "Booking failed. Please try again.";
    document.getElementById("booking-error").classList.remove("hidden");
    btn.textContent = "Confirm Appointment";
    btn.disabled = false;
  }
};

function showSuccessModal() {
  document.getElementById("success-details").innerHTML = `
    <strong>${selectedService.name}</strong><br>
    📅 ${selectedDate.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"short" })}<br>
    🕐 ${formatTime(selectedSlot)}<br>
    💰 ${selectedService.priceDisplay} — Pay at Store
  `;
  document.getElementById("modal-success").classList.remove("hidden");
}

window.resetBooking = function () {
  selectedService = null;
  selectedDate    = null;
  selectedSlot    = null;
  document.getElementById("modal-success").classList.add("hidden");
  document.getElementById("booking-error").classList.add("hidden");
  document.getElementById("btn-confirm").textContent = "Confirm Appointment";
  document.getElementById("btn-confirm").disabled    = false;
  goToStep(1);

  // Deselect all service cards
  document.querySelectorAll(".service-card").forEach(c => c.classList.remove("selected"));
  document.getElementById("btn-next-1").disabled = true;
};

// ═══════════════════════════════════
//  LOCATION
// ═══════════════════════════════════

window.openLocationPanel = function () {
  document.getElementById("drawer-location").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Try to calculate distance if coordinates are configured
  if (SHOP_LAT && SHOP_LNG && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const km = haversineKm(coords.latitude, coords.longitude, SHOP_LAT, SHOP_LNG);
      const walkMin = Math.round(km / 5 * 60);
      const driveMin = Math.round(km / 30 * 60);
      document.getElementById("loc-distance").textContent =
        `${km < 1 ? (km * 1000).toFixed(0) + " m" : km.toFixed(1) + " km"} away · ~${driveMin} min drive`;
    }, () => {});
  }
};

window.closeLocationPanel = function (event) {
  if (event && event.target !== document.getElementById("drawer-location")) return;
  document.getElementById("drawer-location").classList.add("hidden");
  document.body.style.overflow = "";
};

window.openDirections = function () {
  if (navigator.geolocation && SHOP_LAT && SHOP_LNG) {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        window.open(`https://www.google.com/maps/dir/${coords.latitude},${coords.longitude}/${SHOP_LAT},${SHOP_LNG}`, "_blank");
      },
      () => window.open(SHOP_MAPS_URL, "_blank")
    );
  } else {
    window.open(SHOP_MAPS_URL, "_blank");
  }
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ═══════════════════════════════════
//  CLIENT FCM + REMINDERS
// ═══════════════════════════════════

let _clientSwReg = null;

async function initClientFCM() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
  try {
    _clientSwReg = await navigator.serviceWorker.getRegistration(
      new URL("./firebase-messaging-sw.js", import.meta.url).href
    ) || await navigator.serviceWorker.ready;

    if (Notification.permission === "granted") {
      await saveClientFCMToken();
    }
    // Listen for foreground FCM messages (app is open)
    onMessage(messaging, (payload) => {
      const type = payload.data?.type;
      if (!type || type === "booking") return; // admin message, ignore on client
      triggerSwNotification(
        payload.notification?.title || "✂ Thadikkaran",
        payload.notification?.body  || "",
        type
      );
    });
  } catch (e) { /* silent — notifications are enhancement only */ }
}

async function saveClientFCMToken() {
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: _clientSwReg });
    if (token && currentUser) {
      await set(ref(db, `users/${currentUser.uid}/fcmToken`), token);
    }
  } catch (e) { /* ignore */ }
}

function triggerSwNotification(title, body, reminderType) {
  if (!_clientSwReg?.active) return;
  _clientSwReg.active.postMessage({ type: "SHOW_REMINDER", title, body, reminderType });
}

async function scheduleReminders(bookingId, booking) {
  const startMs = new Date(`${booking.dateKey}T${booking.startTime}:00`).getTime();
  const endMs   = new Date(`${booking.dateKey}T${booking.endTime}:00`).getTime();
  const name    = currentUser?.displayName?.split(" ")[0] || "there";

  const reminders = [
    {
      key: "tenMin",
      time: startMs - 10 * 60 * 1000,
      title: "✂ Appointment in 10 Minutes",
      body:  `Your ${booking.serviceName} starts at ${fmtTimeStr(booking.startTime)}. Head over now!`
    },
    {
      key: "onTime",
      time: startMs,
      title: "✂ Your Appointment Starts Now",
      body:  `Time for your ${booking.serviceName} at Thadikkaran!`
    },
    {
      key: "thanks",
      time: endMs + 5 * 60 * 1000,
      title: `✂ Thank You, ${name}!`,
      body:  `Hope you loved your ${booking.serviceName}. See you again at Thadikkaran!`
    }
  ];

  // Save to Firebase for server-side cron delivery (works when app is closed)
  if (currentUser) {
    const reminderData = { serviceName: booking.serviceName, dateKey: booking.dateKey, startTime: booking.startTime };
    reminders.forEach(r => { reminderData[r.key] = { time: r.time, sent: false }; });
    set(ref(db, `reminders/${currentUser.uid}/${bookingId}`), reminderData).catch(() => {});
  }

  // Also schedule in-browser timers (works when app/tab stays open or in background)
  if (Notification.permission !== "granted") {
    // Silently request permission for future reminders
    Notification.requestPermission().then(p => { if (p === "granted") saveClientFCMToken(); });
  }

  const now = Date.now();
  reminders.forEach(r => {
    const delay = r.time - now;
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      setTimeout(() => triggerSwNotification(r.title, r.body, r.key), delay);
    }
  });
}

// ═══════════════════════════════════
//  MY BOOKINGS DRAWER
// ═══════════════════════════════════

window.openMyBookings = function () {
  // Clear notification dot when user opens the drawer
  document.getElementById("bookings-notif-dot")?.classList.add("hidden");
  const drawer = document.getElementById("drawer-bookings");
  drawer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  loadMyBookings();
};

window.closeMyBookings = function (event) {
  if (event && event.target !== document.getElementById("drawer-bookings")) return;
  document.getElementById("drawer-bookings").classList.add("hidden");
  document.body.style.overflow = "";
};

async function loadMyBookings() {
  const container = document.getElementById("my-bookings-list");
  container.innerHTML = `<div class="mb-loading"><div class="spinner" style="border-color:#e0e0e0;border-top-color:#0a0a0a"></div></div>`;

  if (!currentUser) return;

  const snap = await get(ref(db, `users/${currentUser.uid}/bookings`));
  if (!snap.exists()) {
    container.innerHTML = `<p class="mb-empty">No bookings yet.</p>`;
    return;
  }

  const entries = [];
  snap.forEach(c => entries.push(c.val()));

  // Fetch live canonical data for each entry
  const liveData = await Promise.all(
    entries.map(async e => {
      // Fast path: bookingId stored (new bookings)
      if (e.bookingId && e.dateKey) {
        const s = await get(ref(db, `bookings/${e.dateKey}/${e.bookingId}`));
        if (s.exists()) return { ...s.val(), dateKey: e.dateKey, bookingId: e.bookingId };
      }
      // Fallback: scan the day's bookings by uid + startTime match
      // Handles old bookings that didn't store bookingId, AND admin-rescheduled times
      // (originalStartTime === e.startTime covers the rescheduled case)
      if (e.dateKey && currentUser) {
        const daySnap = await get(ref(db, `bookings/${e.dateKey}`));
        if (daySnap.exists()) {
          let found = null;
          daySnap.forEach(child => {
            const b = child.val();
            if (b.uid === currentUser.uid &&
                (b.startTime === e.startTime || b.originalStartTime === e.startTime)) {
              found = { ...b, dateKey: e.dateKey, bookingId: child.key };
            }
          });
          if (found) return found;
        }
      }
      return e; // absolute fallback (snapshot data only)
    })
  );

  const valid = liveData.filter(Boolean).filter(b => b.dateKey);

  // Sort: upcoming first (ascending), then past (descending)
  const now = Date.now();
  valid.sort((a, b) => {
    const aMs = new Date(`${a.dateKey}T${a.startTime || "00:00"}:00`).getTime();
    const bMs = new Date(`${b.dateKey}T${b.startTime || "00:00"}:00`).getTime();
    const aUp = aMs >= now, bUp = bMs >= now;
    if (aUp && !bUp) return -1;
    if (!aUp && bUp) return 1;
    return aUp ? aMs - bMs : bMs - aMs;
  });

  if (!valid.length) {
    container.innerHTML = `<p class="mb-empty">No bookings yet.</p>`;
    return;
  }

  container.innerHTML = "";
  valid.forEach(b => container.appendChild(buildMyBookingCard(b)));
}

function buildMyBookingCard(b) {
  const dateObj = new Date(b.dateKey + "T00:00:00");
  const dateStr = dateObj.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "2-digit" });

  const isRescheduled = b.originalStartTime && b.originalStartTime !== b.startTime;
  const isPast = new Date(`${b.dateKey}T${b.startTime || "00:00"}:00`).getTime() < Date.now();

  const statusMap = {
    confirmed: { label: "Confirmed", cls: "mb-badge-confirmed" },
    cancelled:  { label: "Cancelled",  cls: "mb-badge-cancelled" },
    noshow:     { label: "No Show",    cls: "mb-badge-noshow" },
  };
  const { label: sLabel, cls: sCls } = statusMap[b.status] || statusMap.confirmed;

  let timeHtml;
  if (isRescheduled) {
    timeHtml = `
      <div class="mb-time-row">
        <span class="mb-time-old">${fmtTimeStr(b.originalStartTime)}</span>
        <span class="mb-time-arrow">→</span>
        <span class="mb-time-new">${fmtTimeStr(b.startTime)}</span>
      </div>
      <div class="mb-reschedule-note">⚠ Time changed by shop</div>`;
  } else {
    timeHtml = `<div class="mb-time-row"><span class="mb-time">${fmtTimeStr(b.startTime)}</span></div>`;
  }

  const card = document.createElement("div");
  card.className = `mb-card${isRescheduled ? " mb-rescheduled" : ""}${isPast ? " mb-past" : ""}`;
  card.innerHTML = `
    <div class="mb-top">
      <span class="mb-service">${b.serviceName || "—"}</span>
      <span class="mb-badge ${sCls}">${sLabel}</span>
    </div>
    <div class="mb-date">${dateStr}</div>
    ${timeHtml}
    <div class="mb-price">${b.price ? `₹${b.price} · Pay at Store` : "Pay at Store"}</div>
  `;
  return card;
}

// ── state ──
let dotListeners = [];

async function watchRescheduledBookings() {
  // Tear down any previous listeners (e.g. on re-login)
  dotListeners.forEach(u => u());
  dotListeners = [];
  if (!currentUser) return;

  const snap = await get(ref(db, `users/${currentUser.uid}/bookings`));
  if (!snap.exists()) return;

  const entries = [];
  snap.forEach(c => entries.push(c.val()));

  // Track which paths we've already subscribed to (avoid duplicates)
  const watched = new Set();

  entries.forEach(e => {
    if (!e.dateKey) return;
    // For new bookings we have a direct ID; for old ones listen to the whole day
    const path = e.bookingId
      ? `bookings/${e.dateKey}/${e.bookingId}`
      : `bookings/${e.dateKey}`;
    if (watched.has(path)) return;
    watched.add(path);

    const unsub = onValue(ref(db, path), () => evaluateDot(entries));
    dotListeners.push(unsub);
  });
}

async function evaluateDot(entries) {
  for (const e of entries) {
    let booking = null;
    if (e.bookingId && e.dateKey) {
      const s = await get(ref(db, `bookings/${e.dateKey}/${e.bookingId}`));
      if (s.exists()) booking = s.val();
    } else if (e.dateKey) {
      const daySnap = await get(ref(db, `bookings/${e.dateKey}`));
      if (daySnap.exists()) {
        daySnap.forEach(child => {
          const b = child.val();
          if (b.uid === currentUser.uid &&
              (b.startTime === e.startTime || b.originalStartTime === e.startTime)) {
            booking = b;
          }
        });
      }
    }
    if (booking?.originalStartTime &&
        booking.originalStartTime !== booking.startTime &&
        booking.status !== "cancelled" && booking.status !== "noshow") {
      document.getElementById("bookings-notif-dot")?.classList.remove("hidden");
      return;
    }
  }
  // All clear — dot only hidden here if it was previously shown for a reverted edit
  document.getElementById("bookings-notif-dot")?.classList.add("hidden");
}

function fmtTimeStr(timeStr) {
  if (!timeStr) return "—";
  const [h, m] = timeStr.split(":").map(Number);
  return formatTime([h, m]);
}

// ═══════════════════════════════════
//  PWA SERVICE WORKER
// ═══════════════════════════════════

// firebase-messaging-sw.js handles both PWA caching and FCM for client
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(
    new URL("./firebase-messaging-sw.js", import.meta.url).href,
    { scope: "./" }
  ).then(reg => { _clientSwReg = reg; }).catch(() => {});
}
