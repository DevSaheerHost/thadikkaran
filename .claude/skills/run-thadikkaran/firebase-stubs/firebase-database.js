// Minimal stub — every read returns empty, every write is a no-op
const snap = {
  exists: () => false,
  val:    () => null,
  forEach: () => {},
  key: null,
};

export function getDatabase(app) { return { app, _stub: true }; }
export function ref(db, path)    { return { _path: path, _stub: true }; }
export function push(r, data)    { return Promise.resolve({ key: 'stub-' + Date.now() }); }
export function set(r, data)     { return Promise.resolve(); }
export function get(r)           { return Promise.resolve(snap); }
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
