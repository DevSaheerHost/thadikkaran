const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getAuth } = require("firebase-admin/auth");

const DATABASE_URL = "https://todolistformarcket-default-rtdb.firebaseio.com";

function initFirebase() {
  if (getApps().length > 0) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  initializeApp({ credential: cert(sa), databaseURL: DATABASE_URL });
}

/**
 * Gate an endpoint behind a real admin sign-in.
 *
 * Broadcast endpoints reach every customer's phone, so an unauthenticated
 * POST would let anyone spam the whole customer base. The caller sends the
 * Firebase ID token of the signed-in admin; we verify it and confirm the uid
 * is listed under admin/allowedUids.
 *
 * Returns the admin uid, or null after sending the error response itself.
 */
async function requireAdmin(req, res) {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!idToken) {
    res.status(401).json({ error: "Missing admin token" });
    return null;
  }
  try {
    initFirebase();
    const decoded = await getAuth().verifyIdToken(idToken);
    const allowed = await getDatabase()
      .ref(`admin/allowedUids/${decoded.uid}`).get();
    if (allowed.val() !== true) {
      res.status(403).json({ error: "Not an admin" });
      return null;
    }
    return decoded.uid;
  } catch (err) {
    res.status(401).json({ error: "Invalid admin token" });
    return null;
  }
}

module.exports = { initFirebase, requireAdmin, DATABASE_URL };
