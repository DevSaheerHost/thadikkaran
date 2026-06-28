// Minimal stub — every read returns empty, every write is a no-op
const snap = {
  exists: () => false,
  val:    () => null,
  forEach: () => {},
  key: null,
};

// Build a Firebase-style nested snapshot from a plain JS value
function makeSnap(value, key = null) {
  return {
    key,
    exists: () => value !== null && value !== undefined,
    val:    () => value,
    forEach: (cb) => {
      if (value && typeof value === 'object') {
        for (const k of Object.keys(value)) cb(makeSnap(value[k], k));
      }
    },
  };
}

export function getDatabase(app) { return { app, _stub: true }; }
export function ref(db, path)    { return { _path: path, _stub: true }; }
export function push(r, data)    { return Promise.resolve({ key: 'stub-' + Date.now() }); }
export function set(r, data)     { return Promise.resolve(); }
export function get(r)           {
  // Allow preview scripts to grant admin access via window.__stubAdminUid
  if (typeof window !== 'undefined' && window.__stubAdminUid &&
      r._path && r._path.includes('allowedUids/' + window.__stubAdminUid)) {
    return Promise.resolve(makeSnap(true, window.__stubAdminUid));
  }
  // Allow preview scripts to seed data by exact path via window.__stubData
  if (typeof window !== 'undefined' && window.__stubData && r._path &&
      Object.prototype.hasOwnProperty.call(window.__stubData, r._path)) {
    return Promise.resolve(makeSnap(window.__stubData[r._path], r._path.split('/').pop()));
  }
  return Promise.resolve(snap);
}
export function update(r, data)  { return Promise.resolve(); }
export function remove(r)        { return Promise.resolve(); }
export function query(r, ...c)   { return r; }
export function orderByChild(p)  { return { _type: 'orderByChild', _path: p }; }
export function equalTo(v)       { return { _type: 'equalTo', _value: v }; }
export function onValue(r, cb)   {
  setTimeout(() => cb(snap), 100);
  return () => {};
}
export async function runTransaction(r, fn) {
  return { committed: false, snapshot: snap };
}
