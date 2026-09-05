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

## Coverage

61 checks, 0 critical, 0 warnings. Every operation the app performs is
verified to still work, and the destructive things an ordinary signed-in
customer might try are all blocked.

### How the booking write is kept safe

`bookings/{date}` is admin-only. A customer writes just their own booking at
`bookings/{date}/{id}`, and cannot delete it (only cancel it), so nobody can
touch anyone else's appointment.

Two people tapping the same slot at once is settled by `slots/{date}/{HH:MM}`,
which the rules make create-only — the database picks the winner and the
loser's write is rejected. The lock is self-healing: it can be reclaimed once
the booking it points at is cancelled, marked no-show, deleted, or moved to a
different time. Nothing has to clean locks up, so a cancellation frees its
slot on its own.
