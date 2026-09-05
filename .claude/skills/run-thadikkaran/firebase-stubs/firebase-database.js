// Minimal stub — every read returns empty, every write is a no-op
const snap = {
  exists: () => false,
  val:    () => null,
  forEach: () => {},
  child:  () => snap,
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
    child: (path) => {
      let v = value;
      for (const seg of String(path).split('/')) {
        v = (v && typeof v === 'object') ? v[seg] : undefined;
      }
      return makeSnap(v === undefined ? null : v, String(path).split('/').pop());
    },
    hasChild: (path) => {
      let v = value;
      for (const seg of String(path).split('/')) {
        v = (v && typeof v === 'object') ? v[seg] : undefined;
      }
      return v !== undefined && v !== null;
    },
  };
}

export function getDatabase(app) { return { app, _stub: true }; }
export function ref(db, path)    { return { _path: path, _stub: true }; }
let _pushN = 0;
export function push(r, data)    {
  // Real Firebase returns a ThenableReference synchronously, so `push(ref).key`
  // works without awaiting. Mirror that or callers read undefined.
  const key = 'stub-' + (++_pushN) + '-' + Date.now();
  const done = data === undefined ? Promise.resolve() : recordWrite('push', r, data);
  // The resolved value must NOT itself be thenable, or `await push(...)`
  // recurses on it forever.
  const plainRef = { key, _path: (r && r._path ? r._path + '/' + key : key), _stub: true };
  return {
    ...plainRef,
    then:    (f, g) => done.then(() => (f ? f(plainRef) : plainRef), g),
    catch:   (f)    => done.catch(f),
    finally: (f)    => done.finally(f),
  };
}
function recordWrite(op, r, data) {
  if (typeof window !== 'undefined') {
    (window.__stubWrites ||= []).push({ op, path: r && r._path, data });
    // Preview scripts can make a specific path reject, to exercise error paths
    const fail = window.__stubFailPaths;
    const path = r && r._path;
    // entries may end with '*' to match a prefix (push keys are random)
    if (fail && path && fail.some(f =>
          f.endsWith('*') ? path.startsWith(f.slice(0, -1)) : f === path)) {
      return Promise.reject(new Error('PERMISSION_DENIED'));
    }
  }
  return Promise.resolve();
}
export function set(r, data)     { return recordWrite('set', r, data); }
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
export function remove(r)        { return recordWrite('remove', r); }
export function query(r, ...c)   { return r; }
export function orderByChild(p)  { return { _type: 'orderByChild', _path: p }; }
export function equalTo(v)       { return { _type: 'equalTo', _value: v }; }
export function onValue(r, cb)   {
  // Serve seeded preview data (window.__stubData) when the exact path matches
  const seeded = (typeof window !== 'undefined' && window.__stubData && r._path &&
    Object.prototype.hasOwnProperty.call(window.__stubData, r._path))
    ? makeSnap(window.__stubData[r._path], r._path.split('/').pop())
    : snap;
  setTimeout(() => cb(seeded), 100);
  return () => {};
}
export async function runTransaction(r, fn) {
  return { committed: false, snapshot: snap };
}
