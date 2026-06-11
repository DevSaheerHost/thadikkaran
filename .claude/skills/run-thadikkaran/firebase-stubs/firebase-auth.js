let _authCallback = null;
let _resolveWith = null; // set by window.__stubAuthUser before page load

export function getAuth(app) { return { app, currentUser: null, _stub: true }; }

export class GoogleAuthProvider { static credential() {} }

export async function signInWithPopup(auth, provider) {
  throw new Error('[stub] Google sign-in not available locally');
}

export function onAuthStateChanged(auth, callback) {
  _authCallback = callback;
  // Simulate unauthenticated after short delay (null = not logged in → auth screen shows)
  const user = (typeof window !== 'undefined' && window.__stubAuthUser) || null;
  setTimeout(() => callback(user), 300);
  return () => { _authCallback = null; };
}

export async function signOut(auth) {
  if (_authCallback) _authCallback(null);
}

export class RecaptchaVerifier {
  constructor() {}
  render() { return Promise.resolve(0); }
  clear() {}
  verify() { return Promise.resolve('stub-token'); }
}

export async function signInWithPhoneNumber(auth, phone, verifier) {
  throw new Error('[stub] Phone auth not available locally');
}
