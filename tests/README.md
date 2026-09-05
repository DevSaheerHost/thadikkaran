# Security-rules audit

Probes `database.rules.json` against a real Firebase Realtime Database
emulator: every operation the app performs must still be allowed, and every
attack an ordinary signed-in customer might attempt must be blocked.

An "attacker" here is just someone who signed in with Google — which anyone
can do — so these are the permissions a stranger really has.

## Run it

```bash
npm i -g firebase-tools                       # once; downloads the emulator jar
java -jar ~/.cache/firebase/emulators/firebase-database-emulator-v*.jar \
     --port 9000 --host 127.0.0.1 &
cd tests && npm i @firebase/rules-unit-testing firebase
node rules-audit.mjs ../database.rules.json
```

Exits non-zero if any CRITICAL check fails.

## Known residual

`[attack] delete someone else's booking` still passes. Customers create
bookings with a transaction on the whole `bookings/{date}` node (for the
atomic overlap check), so they need write permission there — and Firebase
`.validate` rules are skipped for deletes, so nothing can distinguish
"pass this booking through untouched" from "remove it".

Closing it means the client no longer transacting on the day node — e.g.
claiming a per-slot lock that rules can enforce as create-only, then writing
only its own booking. That is a code change to the booking flow, not a rules
change.
