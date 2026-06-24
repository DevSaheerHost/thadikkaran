// ═══════════════════════════════════════════════
//  THADIKKARAN – CLIENT APP
//  Firebase Auth + Realtime DB Booking Logic
// ═══════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  initializeAuth,
  browserLocalPersistence,
  inMemoryPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  update,
  query,
  orderByChild,
  equalTo,
  onValue,
  runTransaction
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
const auth      = initializeAuth(app, { persistence: [browserLocalPersistence, inMemoryPersistence] });
const db        = getDatabase(app);
const messaging = getMessaging(app);

const VAPID_KEY = "BJljfSryCZol-Pg9YfT2x9OKMP4kom5Q6OBeuzgN4773-PLqhvhTPFOVA2PRvwTKDCc3ZeN1h1Uc0ilieNj6NQQ";
// Shop location — update coordinates after confirming on Google Maps
const SHOP_MAPS_URL = "https://maps.app.goo.gl/jXQPye2JHpAyTq4M9";
const SHOP_LAT = 10.17878;
const SHOP_LNG = 76.330631;

// ── Services Data ──
const SERVICES = [
  { id: "haircut",       name: "Hair Cut (Mens)",    price: 150,  duration: 40,  priceDisplay: "₹150" },
  { id: "beard",         name: "Beard Setting",      price: 100,  duration: 40,  priceDisplay: "₹100" },
  { id: "haircut_beard", name: "Hair Cut & Beard",   price: 250,  duration: 40,  priceDisplay: "₹250" },
  { id: "facial",        name: "Facial",             price: null, duration: 40,  priceDisplay: "At Store" },
  { id: "hair_spa",      name: "Hair Spa",           price: null, duration: 40,  priceDisplay: "At Store" },
];

// ── Shop Config ──
const SHOP = {
  openHour:  9,    // 9:00 AM
  openMin:   0,
  closeHour: 20,   // 8:00 PM
  closeMin:  0,
  slotStep:  40,   // minutes per slot (all services are 40 min)
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
let lunchBreakConfig  = { enabled: true, startTime: "13:00", endTime: "14:30" };
let unsubLunchBreak   = null;
let closedDatesSet    = new Set();
let unsubClosedDates  = null;
let reviewedSet    = new Set(); // bookingIds already reviewed this session
let serviceRatings = {};       // serviceName → { avg, count }

// ═══════════════════════════════════
//  AUTH LOGIC
// ═══════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  hideSplash();
  if (user) {
    currentUser = user;

    // Check if user is blocked before showing anything
    const blockedSnap = await get(ref(db, `users/${user.uid}/blocked`));
    if (blockedSnap.exists() && blockedSnap.val() === true) {
      showBlockedScreen();
      return;
    }

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

function showBlockedScreen() {
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-auth").classList.remove("active");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("active");
  document.getElementById("screen-blocked").classList.remove("hidden");
  document.getElementById("screen-blocked").classList.add("active");
}

async function showApp(user) {
  document.getElementById("screen-auth").classList.remove("active");
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("screen-app").classList.add("active");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user.displayName ? `, ${user.displayName.split(" ")[0]}` : "";
  document.getElementById("header-greeting").textContent = `${greeting}${name}`;

  await loadServiceDurations();
  await loadServiceRatings();
  watchLunchBreak();
  watchClosedDates();
  buildServicesUI();
  buildCalendarUI();
  watchRescheduledBookings();
  initClientFCM();
  // Seed history so the phone back button navigates between steps
  history.replaceState({ step: 1 }, '');
}

async function loadServiceDurations() {
  try {
    const snap = await get(ref(db, "settings/services"));
    if (!snap.exists()) return;
    snap.forEach(child => {
      const svc = SERVICES.find(s => s.id === child.key);
      if (!svc) return;
      const v = child.val();
      if (v.duration) svc.duration = v.duration;
      if (v.price !== undefined) {
        svc.price = v.price > 0 ? v.price : null;
        svc.priceDisplay = v.price > 0 ? `₹${v.price}` : "At Store";
      }
    });
  } catch (e) { /* keep built-in defaults on error */ }
}

function watchLunchBreak() {
  if (unsubLunchBreak) { unsubLunchBreak(); unsubLunchBreak = null; }
  unsubLunchBreak = onValue(ref(db, "settings/lunchBreak"), snap => {
    if (snap.exists()) lunchBreakConfig = { ...lunchBreakConfig, ...snap.val() };
    scheduleRerender();
  });
}

function watchClosedDates() {
  if (unsubClosedDates) { unsubClosedDates(); unsubClosedDates = null; }
  unsubClosedDates = onValue(ref(db, "settings/closedDates"), snap => {
    closedDatesSet.clear();
    if (snap.exists()) snap.forEach(child => closedDatesSet.add(child.key));
    if (currentStep === 1) buildCalendarUI();
  });
}

// Google Sign-In — popup on desktop, redirect on mobile (avoids popup blocking)
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

window.signInWithGoogle = async function () {
  setAuthLoading(true);
  try {
    if (isMobile) {
      await signInWithRedirect(auth, new GoogleAuthProvider());
      // page navigates away — onAuthStateChanged handles the result on return
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
      clearAuthError();
      setAuthLoading(false);
    }
  } catch (err) {
    showAuthError("Google sign-in failed. Please try again.");
    setAuthLoading(false);
  }
};

// Handle redirect result after returning from Google sign-in
getRedirectResult(auth).catch(() => {});

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
  if (unsubLunchBreak)  { unsubLunchBreak();  unsubLunchBreak  = null; }
  if (unsubClosedDates) { unsubClosedDates(); unsubClosedDates = null; }
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
    const rd = serviceRatings[svc.name];
    const ratingHtml = rd
      ? `<span class="service-meta-dot"></span><span class="svc-rating">★ ${rd.avg}<span class="svc-rating-count"> (${rd.count})</span></span>`
      : "";
    card.innerHTML = `
      <div class="service-info">
        <div class="service-name">${svc.name}</div>
        <div class="service-meta">
          <span>${svc.duration} mins</span>${ratingHtml}
        </div>
      </div>
      <div class="service-right">
        <div class="service-price ${svc.price === null ? 'tbd' : ''}">${svc.priceDisplay}</div>
        <div class="service-check">✓</div>
      </div>
    `;

    card.addEventListener("click", () => {
      const isAlreadySelected = card.classList.contains("selected");
      document.querySelectorAll(".service-card").forEach(c => c.classList.remove("selected"));
      if (isAlreadySelected) {
        selectedService = null;
        document.getElementById("btn-next-3").disabled = true;
      } else {
        card.classList.add("selected");
        selectedService = svc;
        document.getElementById("btn-next-3").disabled = false;
      }
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

  const now = new Date();
  const todayCutoffPassed = now.getHours() > 21 || (now.getHours() === 21 && now.getMinutes() >= 30);

  for (let i = 0; i <= SHOP.maxAdvanceDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const isToday   = i === 0;
    const isHoliday = SHOP.holidayDays.includes(d.getDay()) || closedDatesSet.has(formatDateKey(d));
    const disabled  = isHoliday || (isToday && todayCutoffPassed);

    const dayEl = document.createElement("div");
    dayEl.className = "cal-day" + (disabled ? " disabled" : "") + (isToday ? " today" : "");
    dayEl.innerHTML = `
      <span class="cal-day-name">${isToday ? "Today" : DAY_NAMES[d.getDay()]}</span>
      <span class="cal-day-num">${d.getDate()}</span>
      <span class="cal-day-month">${MONTH_NAMES[d.getMonth()]}</span>
    `;

    if (!disabled) {
      dayEl.addEventListener("click", () => {
        document.querySelectorAll(".cal-day").forEach(c => c.classList.remove("selected"));
        dayEl.classList.add("selected");
        selectedDate = new Date(d);
        document.getElementById("btn-next-1").disabled = false;
      });
    }

    container.appendChild(dayEl);
  }
}

// ═══════════════════════════════════
//  TIME SLOTS
// ═══════════════════════════════════

// ── Real-time slot state ──
let liveSlotData  = { bookings: null, blocks: null }; // null = not yet loaded
let slotsUnsubFns = [];
let rerenderTimer = null;

function loadSlots() {
  if (!selectedDate) return;

  document.getElementById("slots-grid").innerHTML = "";
  document.getElementById("no-slots-msg").classList.add("hidden");
  document.getElementById("slots-loading").classList.remove("hidden");
  document.getElementById("btn-next-2").disabled = true;
  hideSlotTakenBanner();

  document.getElementById("slots-sub").textContent =
    `Available for ${selectedDate.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"short" })}`;

  const dateKey = formatDateKey(selectedDate);
  liveSlotData = { bookings: null, blocks: null };
  stopLiveSlotWatch();

  // Live listener: bookings
  const u1 = onValue(ref(db, `bookings/${dateKey}`), (snap) => {
    liveSlotData.bookings = {};
    if (snap.exists()) snap.forEach(c => { liveSlotData.bookings[c.key] = c.val(); });
    scheduleRerender();
  }, () => { liveSlotData.bookings = {}; scheduleRerender(); });

  // Live listener: admin blocks
  const u2 = onValue(ref(db, `blocked/${dateKey}`), (snap) => {
    liveSlotData.blocks = {};
    if (snap.exists()) snap.forEach(c => { liveSlotData.blocks[c.key] = c.val(); });
    scheduleRerender();
  }, () => { liveSlotData.blocks = {}; scheduleRerender(); });

  slotsUnsubFns = [u1, u2];
}

function stopLiveSlotWatch() {
  slotsUnsubFns.forEach(u => u());
  slotsUnsubFns = [];
  clearTimeout(rerenderTimer);
}

function scheduleRerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(rerenderSlots, 40); // debounce rapid twin-listener fires
}

function rerenderSlots() {
  if (currentStep !== 2) return;
  // Wait until both sources have responded at least once
  if (liveSlotData.bookings === null || liveSlotData.blocks === null) return;

  const bookedSlots = [];
  const mySlotTimes = new Set(); // current user's active bookings on this date
  Object.entries(liveSlotData.bookings).forEach(([, b]) => {
    if (b && b.status !== "cancelled" && b.status !== "finished") {
      bookedSlots.push({ start: b.startTime, duration: b.duration });
      if (b.uid && currentUser && b.uid === currentUser.uid) mySlotTimes.add(b.startTime);
    }
  });
  Object.values(liveSlotData.blocks).forEach(bl => {
    if (bl) bookedSlots.push({ start: bl.startTime, duration: bl.duration || 30 });
  });
  if (lunchBreakConfig.enabled && lunchBreakConfig.startTime && lunchBreakConfig.endTime) {
    const [lh, lm] = lunchBreakConfig.startTime.split(":").map(Number);
    const [eh, em] = lunchBreakConfig.endTime.split(":").map(Number);
    bookedSlots.push({ start: lunchBreakConfig.startTime, duration: (eh * 60 + em) - (lh * 60 + lm) });
  }

  const allSlots    = generateSlots();
  const svcDuration = selectedService?.duration || SHOP.slotStep;
  const grid        = document.getElementById("slots-grid");
  const prevSlot    = selectedSlot; // capture before any mutation
  let hasAvailable  = false;
  let selectedGone  = false;

  grid.innerHTML = "";

  allSlots.forEach(slot => {
    const isUnavailable = isSlotUnavailable(slot, svcDuration, bookedSlots, allSlots);
    const isPast        = isSlotPast(slot);
    const isTaken       = isSlotTakenByBooking(slot, svcDuration, bookedSlots);
    const wasSelected   = prevSlot && slot[0] === prevSlot[0] && slot[1] === prevSlot[1];

    if (wasSelected && isUnavailable) {
      selectedSlot = null;
      document.getElementById("btn-next-2").disabled = true;
      selectedGone = true;
    } else if (wasSelected && !isUnavailable) {
      document.getElementById("btn-next-2").disabled = false;
    }

    const btn = document.createElement("button");
    const slotTimeStr  = `${String(slot[0]).padStart(2,"0")}:${String(slot[1]).padStart(2,"0")}`;
    const isMyBooking  = mySlotTimes.has(slotTimeStr);
    const isBufferZone = isUnavailable && !isPast && !isTaken;
    btn.className = "slot-btn" +
      (isTaken || isBufferZone ? " booked" : "") +
      (isPast      ? " past"        : "") +
      (isMyBooking ? " my-booking"  : "") +
      (wasSelected && !isUnavailable ? " selected" : "");
    btn.disabled = isUnavailable;

    if (isPast) {
      btn.innerHTML = `<span class="slot-time">${formatTime(slot)}</span><span class="slot-past-label">Past</span>`;
    } else if (isMyBooking) {
      btn.innerHTML = `<span class="slot-time">${formatTime(slot)}</span><span class="slot-my-label">Your booking</span>`;
    } else {
      btn.textContent = formatTime(slot);
    }

    if (!isUnavailable) {
      hasAvailable = true;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".slot-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedSlot = slot;
        document.getElementById("btn-next-2").disabled = false;
        hideSlotTakenBanner();
      });
    }

    grid.appendChild(btn);
  });

  document.getElementById("slots-loading").classList.add("hidden");
  document.getElementById("no-slots-msg").classList.toggle("hidden", hasAvailable);
  if (selectedGone) showSlotTakenBanner();
}

function showSlotTakenBanner() {
  let el = document.getElementById("slot-taken-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "slot-taken-banner";
    el.className = "slot-taken-banner";
    document.getElementById("slots-grid").before(el);
  }
  el.textContent = "⚡ Your selected time was just booked! Please choose another slot.";
  el.classList.remove("hidden");
}

function hideSlotTakenBanner() {
  document.getElementById("slot-taken-banner")?.classList.add("hidden");
}

/** Generate fixed time slots as [hour, minute] pairs.
 *  Base grid: every slotStep (40 min) from open to close.
 *  Lunch break end is injected as an extra origin since 14:30 is off the 40-min grid.
 */
function generateSlots() {
  const openMin  = SHOP.openHour  * 60 + SHOP.openMin;
  const closeMin = SHOP.closeHour * 60 + SHOP.closeMin;

  const mins = new Set();
  for (let m = openMin; m <= closeMin; m += SHOP.slotStep) mins.add(m);

  // Inject lunch break end so the first afternoon slot aligns with break end
  if (lunchBreakConfig.enabled && lunchBreakConfig.endTime) {
    const [eh, em] = lunchBreakConfig.endTime.split(":").map(Number);
    const lunchEnd = eh * 60 + em;
    if (lunchEnd > openMin && lunchEnd < closeMin) mins.add(lunchEnd);
  }

  return [...mins].sort((a, b) => a - b).map(m => [Math.floor(m / 60), m % 60]);
}

/** Returns true if the slot overlaps a real booking/block (ignoring past check) */
function isSlotTakenByBooking(slot, duration, bookedSlots) {
  const slotStart = slot[0] * 60 + slot[1];
  const slotEnd   = slotStart + duration;
  for (const b of bookedSlots) {
    const [bh, bm] = b.start.split(":").map(Number);
    const bStart = bh * 60 + bm;
    const bEnd   = bStart + b.duration;
    if (slotStart < bEnd && slotEnd > bStart) return true;
  }
  return false;
}

/** Returns true only when the slot's start time has actually passed (no buffer) */
function isSlotPast(slot) {
  const now        = new Date();
  const todayKey   = formatDateKey(now);
  const selDateKey = formatDateKey(selectedDate);
  if (selDateKey !== todayKey) return false;
  const slotStart  = slot[0] * 60 + slot[1];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return slotStart <= nowMinutes;
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
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (slotStart <= nowMinutes) return true;
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

function timeStrToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
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

window.goToStep = function (step, fromHistory = false) {
  // Only validate forward navigation (backward is always allowed)
  if (step > currentStep) {
    if (step === 2 && !selectedDate) return;
    if (step === 3 && !selectedSlot) return;
    if (step === 4 && !selectedService) return;
  }

  // Stop real-time slot watch when leaving step 2
  if (currentStep === 2 && step !== 2) {
    stopLiveSlotWatch();
    hideSlotTakenBanner();
  }

  // Push a history entry for every step change (except when called from popstate)
  if (!fromHistory) {
    history.pushState({ step }, '');
  }

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

  // Trigger slot loading when reaching step 2
  if (step === 2) loadSlots();

  // Populate confirm screen
  if (step === 4) populateConfirm();

  window.scrollTo({ top: 0, behavior: "smooth" });
};

// Handle browser/phone back button
window.addEventListener("popstate", (e) => {
  const step = e.state?.step ?? 1;
  goToStep(step, true);
});

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

  // Guard: re-check block status at submit time
  const blockedSnap = await get(ref(db, `users/${currentUser.uid}/blocked`));
  if (blockedSnap.exists() && blockedSnap.val() === true) {
    showBlockedScreen();
    return;
  }

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
    const bookingKey  = push(bookingsRef).key; // pre-generate unique key
    const sMin = selectedSlot[0] * 60 + selectedSlot[1];
    const eMin = sMin + selectedService.duration;

    // Atomic transaction: check for overlaps and write in one operation
    const txResult = await runTransaction(bookingsRef, (current) => {
      const data = current || {};
      for (const b of Object.values(data)) {
        if (!b || b.status === "cancelled" || b.status === "finished") continue;
        const bS = timeStrToMin(b.startTime), bE = bS + (b.duration || 30);
        if (sMin < bE && eMin > bS) return; // conflict — abort
      }
      data[bookingKey] = booking;
      return data;
    });

    if (!txResult.committed) {
      document.getElementById("booking-error").textContent =
        "⚡ This slot was just booked by someone else! Please go back and choose a different time.";
      document.getElementById("booking-error").classList.remove("hidden");
      btn.textContent = "Confirm Appointment";
      btn.disabled = false;
      return;
    }

    const bookingId = bookingKey;

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
  stopLiveSlotWatch();
  selectedService = null;
  selectedDate    = null;
  selectedSlot    = null;
  document.getElementById("modal-success").classList.add("hidden");
  document.getElementById("booking-error").classList.add("hidden");
  document.getElementById("btn-confirm").textContent = "Confirm Appointment";
  document.getElementById("btn-confirm").disabled    = false;
  history.replaceState({ step: 1 }, '');
  goToStep(1, true);

  // Deselect all service cards and reset all next buttons
  document.querySelectorAll(".service-card").forEach(c => c.classList.remove("selected"));
  document.querySelectorAll(".cal-day").forEach(c => c.classList.remove("selected"));
  document.getElementById("btn-next-1").disabled = true;
  document.getElementById("btn-next-2").disabled = true;
  document.getElementById("btn-next-3").disabled = true;
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

  let liveData;
  try {
    liveData = await recoverUserBookings(currentUser.uid);
  } catch (e) {
    container.innerHTML = `<p class="mb-empty">Couldn't load bookings. Please try again.</p>`;
    return;
  }

  // Schedule a re-load when the earliest review window expires (finishedAt + 24h)
  const soonestReviewExp = liveData
    .filter(b => b.status === "finished" && b.finishedAt)
    .map(b => b.finishedAt + 24 * 60 * 60 * 1000)
    .sort((a, z) => a - z)[0];
  if (soonestReviewExp && soonestReviewExp > Date.now()) {
    setTimeout(loadMyBookings, soonestReviewExp - Date.now() + 500);
  }

  renderMyBookingsList(liveData, container);
}

/** Scan recent + upcoming dates in bookings/ to find entries for this UID */
async function recoverUserBookings(uid) {
  const results = [];
  const today = new Date();
  const dates = [];
  for (let i = -14; i <= (SHOP.maxAdvanceDays || 30); i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(formatDateKey(d));
  }
  await Promise.all(dates.map(async dateKey => {
    try {
      const snap = await get(ref(db, `bookings/${dateKey}`));
      if (!snap.exists()) return;
      snap.forEach(child => {
        const b = child.val();
        if (b && b.uid === uid) results.push({ ...b, dateKey, bookingId: child.key });
      });
    } catch (_) {}
  }));
  return results;
}

/** Shared render logic used by both the normal and recovery paths */
function renderMyBookingsList(liveData, container) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const valid = liveData.filter(Boolean).filter(b => {
    if (!b.dateKey) return false;
    // Never show cancelled or no-show bookings
    if (b.status === "cancelled" || b.status === "noshow") return false;
    // Hide finished bookings after 24h review window
    if (b.status === "finished") {
      return Date.now() < (b.finishedAt || 0) + DAY_MS;
    }
    return true;
  });

  valid.sort((a, b) => {
    const aF = a.status === "finished", bF = b.status === "finished";
    if (aF !== bF) return aF ? 1 : -1;
    const aMs = new Date(`${a.dateKey}T${a.startTime || "00:00"}:00`).getTime();
    const bMs = new Date(`${b.dateKey}T${b.startTime || "00:00"}:00`).getTime();
    return bMs - aMs;
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
    cancelled: { label: "Cancelled", cls: "mb-badge-cancelled" },
    noshow:    { label: "No Show",   cls: "mb-badge-noshow" },
    finished:  { label: "Done",      cls: "mb-badge-confirmed" },
  };
  const { label: sLabel, cls: sCls } = statusMap[b.status] || statusMap.confirmed;

  const canCancel = !isPast
    && b.bookingId
    && b.status !== "cancelled"
    && b.status !== "noshow"
    && b.status !== "finished";

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

  // Check if this booking has been reviewed (session cache or will be loaded)
  const isFinished = b.status === "finished";
  const reviewHtml = isFinished && b.bookingId
    ? `<div class="mb-review-row" id="review-row-${b.bookingId}">
         <button class="btn btn-sm mb-review-btn" onclick="openReviewModal('${b.bookingId}','${b.dateKey}','${(b.serviceName||'').replace(/'/g,"\\'")}')">
           ⭐ Rate your visit
         </button>
       </div>`
    : "";

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
    ${canCancel ? `<button class="btn btn-sm mb-cancel-btn" onclick="openClientCancelModal('${b.bookingId}','${b.dateKey}')">Cancel Booking</button>` : ""}
    ${reviewHtml}
  `;

  if (isFinished && b.bookingId) {
    get(ref(db, `reviews/${b.bookingId}`)).then(snap => {
      if (snap.exists()) {
        const r = snap.val();
        const row = card.querySelector(`#review-row-${b.bookingId}`);
        if (row) row.innerHTML = renderStars(r.rating) + (r.text ? `<p class="mb-review-text">"${r.text}"</p>` : "");
        reviewedSet.add(b.bookingId);
      }
    });
  }
  return card;
}

function renderStars(rating) {
  return `<div class="mb-stars-display">${[1,2,3,4,5].map(i =>
    `<span class="mb-star${i <= rating ? ' filled' : ''}">${i <= rating ? '★' : '☆'}</span>`
  ).join('')}</div>`;
}

// ═══════════════════════════════════
//  CLIENT BOOKING CANCELLATION
// ═══════════════════════════════════

let cancelTarget = null; // { bookingId, dateKey }

window.openClientCancelModal = function (bookingId, dateKey) {
  cancelTarget = { bookingId, dateKey };
  document.getElementById("client-cancel-reason").value = "";
  document.getElementById("client-cancel-error").classList.add("hidden");
  document.getElementById("modal-client-cancel").classList.remove("hidden");
};

window.closeClientCancelModal = function () {
  document.getElementById("modal-client-cancel").classList.add("hidden");
  cancelTarget = null;
};

window.confirmClientCancel = async function () {
  if (!cancelTarget || !currentUser) return;
  const { bookingId, dateKey } = cancelTarget;
  const reason = document.getElementById("client-cancel-reason").value.trim();
  const btn = document.getElementById("btn-client-cancel-confirm");
  btn.textContent = "Cancelling…";
  btn.disabled = true;
  try {
    await update(ref(db, `bookings/${dateKey}/${bookingId}`), {
      status:       "cancelled",
      cancelledAt:  Date.now(),
      cancelReason: reason || "Cancelled by customer",
      cancelledBy:  "client"
    });
    window.closeClientCancelModal();
    loadMyBookings();
  } catch (e) {
    document.getElementById("client-cancel-error").textContent = "Failed to cancel. Please try again.";
    document.getElementById("client-cancel-error").classList.remove("hidden");
    btn.textContent = "Yes, Cancel Booking";
    btn.disabled = false;
  }
};

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

const TEN_MIN_MS = 10 * 60 * 1000;

function bookingExpireMs(b, dateKey) {
  // Returns timestamp when the "finished" booking should disappear from the UI
  if (b.finishedAt) return b.finishedAt + TEN_MIN_MS;
  // Fallback: reconstruct end time from startTime + duration
  const [sh, sm] = (b.startTime || "00:00").split(":").map(Number);
  const endMin = sh * 60 + sm + (b.duration || 40);
  const endH = Math.floor(endMin / 60), endM = endMin % 60;
  const endMs = new Date(`${dateKey}T${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}:00`).getTime();
  return endMs + TEN_MIN_MS;
}

async function evaluateDot(entries) {
  const now = Date.now();
  let showDot = false;
  let earliestExpiry = null; // for scheduling a re-check

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
    if (!booking) continue;
    const status = booking.status || "confirmed";
    if (status === "cancelled" || status === "noshow") continue;

    if (status === "finished") {
      const exp = bookingExpireMs(booking, e.dateKey);
      if (now < exp) {
        showDot = true;
        if (!earliestExpiry || exp < earliestExpiry) earliestExpiry = exp;
      }
      continue;
    }

    // Confirmed / active: show dot if booking date is upcoming or today
    const bookingMs = new Date(`${e.dateKey}T${booking.startTime || "00:00"}:00`).getTime();
    if (bookingMs >= now - 2 * 60 * 60 * 1000) { // within 2h in the past or future
      showDot = true;
    }

    // Rescheduled: always show dot (urgent)
    if (booking.originalStartTime && booking.originalStartTime !== booking.startTime) {
      showDot = true;
    }
  }

  const dotEl = document.getElementById("bookings-notif-dot");
  dotEl?.classList.toggle("hidden", !showDot);

  // Re-evaluate exactly when the next "finished" booking expires
  if (earliestExpiry) {
    const delay = earliestExpiry - Date.now() + 500;
    setTimeout(() => evaluateDot(entries), delay);
  }
}

function fmtTimeStr(timeStr) {
  if (!timeStr) return "—";
  const [h, m] = timeStr.split(":").map(Number);
  return formatTime([h, m]);
}

// ═══════════════════════════════════
//  REVIEWS
// ═══════════════════════════════════

async function loadServiceRatings() {
  try {
    const snap = await get(ref(db, "reviews"));
    if (!snap.exists()) return;
    const buckets = {};
    snap.forEach(c => {
      const r = c.val();
      if (!r.serviceName || !r.rating) return;
      if (!buckets[r.serviceName]) buckets[r.serviceName] = { sum: 0, count: 0 };
      buckets[r.serviceName].sum   += r.rating;
      buckets[r.serviceName].count += 1;
    });
    Object.entries(buckets).forEach(([name, d]) => {
      serviceRatings[name] = { avg: Math.round(d.sum / d.count * 10) / 10, count: d.count };
    });
  } catch (e) {}
}

let reviewTarget = null; // { bookingId, dateKey, serviceName }
let reviewRating = 0;

window.openReviewModal = function (bookingId, dateKey, serviceName) {
  if (reviewedSet.has(bookingId)) return;
  reviewTarget = { bookingId, dateKey, serviceName };
  reviewRating = 0;
  document.getElementById("review-service-name").textContent = serviceName;
  document.getElementById("review-text").value = "";
  document.getElementById("review-error").classList.add("hidden");
  setReviewStar(0); // reset stars
  document.getElementById("modal-review").classList.remove("hidden");
};

window.closeReviewModal = function () {
  document.getElementById("modal-review").classList.add("hidden");
  reviewTarget = null;
};

window.setReviewStar = function (val) {
  reviewRating = val;
  document.querySelectorAll("#review-stars .rv-star").forEach(s => {
    const v = parseInt(s.dataset.v);
    s.textContent = v <= val ? "★" : "☆";
    s.classList.toggle("active", v <= val);
  });
};

window.submitReview = async function () {
  if (!reviewTarget || !currentUser) return;
  if (reviewRating === 0) {
    document.getElementById("review-error").textContent = "Please select a star rating.";
    document.getElementById("review-error").classList.remove("hidden");
    return;
  }
  const btn = document.querySelector("#modal-review .btn-primary");
  btn.textContent = "Submitting…";
  btn.disabled = true;
  const text = document.getElementById("review-text").value.trim();
  try {
    await set(ref(db, `reviews/${reviewTarget.bookingId}`), {
      uid:         currentUser.uid,
      bookingId:   reviewTarget.bookingId,
      dateKey:     reviewTarget.dateKey,
      serviceName: reviewTarget.serviceName,
      rating:      reviewRating,
      text:        text,
      customerName: currentUser.displayName || "",
      createdAt:   Date.now(),
    });
    reviewedSet.add(reviewTarget.bookingId);
    // Update the card in the drawer
    const row = document.getElementById(`review-row-${reviewTarget.bookingId}`);
    if (row) row.innerHTML = renderStars(reviewRating) + (text ? `<p class="mb-review-text">"${text}"</p>` : "");
    closeReviewModal();
  } catch (e) {
    document.getElementById("review-error").textContent = "Failed to submit. Try again.";
    document.getElementById("review-error").classList.remove("hidden");
    btn.textContent = "Submit";
    btn.disabled = false;
  }
};

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
