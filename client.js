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

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

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

    // Also update user's booking history
    await push(ref(db, `users/${currentUser.uid}/bookings`), {
      dateKey, startTime: startStr, serviceName: selectedService.name, status: "confirmed"
    });

    // Fire-and-forget: notify admin via Vercel serverless function
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, dateKey, booking }),
    }).catch(() => {});

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
//  PWA SERVICE WORKER
// ═══════════════════════════════════

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(
    new URL("./client-sw.js", import.meta.url).href,
    { scope: "./" }
  ).catch(() => {});
}
