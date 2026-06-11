export function getMessaging(app) { return { app, _stub: true }; }
export async function getToken(msg, opts) { return null; }
export function onMessage(msg, cb)        { return () => {}; }
