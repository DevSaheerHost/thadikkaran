import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove } from 'firebase/database';
import { readFileSync } from 'fs';
const RULES = process.argv[2] || '/home/user/thadikkaran/database.rules.json';
const env = await initializeTestEnvironment({
  projectId: 'thadikkaran',
  database: { rules: readFileSync(RULES,'utf8'), host:'127.0.0.1', port:9000 },
});
await env.clearDatabase();
await env.withSecurityRulesDisabled(async c => {
  const d = c.database();
  await set(ref(d,'/'), {
    admin: { allowedUids: { adminUid: true }, fcmTokens: { adminUid: { token:'admin-tok' } } },
    bookings: { '2026-09-10': {
      bk1:{uid:'victimUid',name:'Victim',serviceName:'Hair Cut (Mens)',price:150,startTime:'10:00',duration:40,status:'confirmed',source:'client'},
      bk2:{uid:'other1',name:'Someone',serviceName:'Facial',price:200,startTime:'11:00',duration:40,status:'confirmed',source:'client'},
      bk3:{name:'Walkin',serviceName:'Beard Setting',price:100,startTime:'12:00',duration:40,status:'confirmed',source:'admin'},
    }},
    contacts: { '2026-09-10': { bk1:{phone:'+919812345678',name:'Victim'} } },
    users: { victimUid:{name:'Victim',phone:'+919812345678',fcmToken:'tok-victim',blocked:false,visits:5},
             attackerUid:{name:'Attacker',blocked:true} },
    notes: { victimUid:{text:'private note',updatedAt:1} },
    reviews: { r1:{uid:'other1',rating:5,text:'Great cut',bookingId:'bk2',createdAt:1} },
    reminders: { victimUid:{ x:{at:1} } },
    waitlist: { '2026-09-10': { other1:{at:1} } },
    blockedPhones: { abc123:{last4:'4867',blockedAt:1} },
    settings: { closure:{active:false}, lunch:{start:'13:00'} },
  });
});

const attacker = env.authenticatedContext('attackerUid').database();
const victim   = env.authenticatedContext('victimUid').database();
const admin    = env.authenticatedContext('adminUid').database();
const anon     = env.unauthenticatedContext().database();
const DB = { attacker, victim, admin, anon };

let crit=0, warn=0, okc=0; const R=[];
async function probe(sev, label, who, fn, expectAllowed=false){
  let allowed=true, err='';
  try { await fn(DB[who]); } catch(e){ allowed=false; err=e.code||e.message; }
  const good = expectAllowed ? allowed : !allowed;
  if (good){ okc++; R.push(['ok',label,allowed?'allowed':'blocked']); }
  else { if(sev==='CRIT') crit++; else warn++;
         R.push([sev,label, allowed?'ALLOWED':`BLOCKED (app needs this!) ${err}`]); }
}
const B='bookings/2026-09-10';

// ── the app must keep working ──
await probe('CRIT','[app] customer books (transaction rewrites whole day)','victim', d=>set(ref(d,B),{
  bk1:{uid:'victimUid',name:'Victim',serviceName:'Hair Cut (Mens)',price:150,startTime:'10:00',duration:40,status:'confirmed',source:'client'},
  bk2:{uid:'other1',name:'Someone',serviceName:'Facial',price:200,startTime:'11:00',duration:40,status:'confirmed',source:'client'},
  bk3:{name:'Walkin',serviceName:'Beard Setting',price:100,startTime:'12:00',duration:40,status:'confirmed',source:'admin'},
  bk4:{uid:'victimUid',name:'Victim',serviceName:'Facial',price:200,startTime:'14:00',duration:40,status:'confirmed',source:'client'},
}), true);
await probe('CRIT','[app] customer cancels their OWN booking','victim', d=>update(ref(d,B+'/bk1'),{status:'cancelled',cancelReason:'plans'}), true);
await probe('CRIT','[app] customer confirms own booking from reminder','victim', d=>update(ref(d,B+'/bk4'),{clientConfirmed:true}), true);
await probe('CRIT','[app] customer writes own contact phone','victim', d=>set(ref(d,'contacts/2026-09-10/bk4'),{phone:'+919812345678',name:'Victim'}), true);
await probe('CRIT','[app] customer reads the day for availability','victim', d=>get(ref(d,B)), true);
await probe('CRIT','[app] customer saves own FCM token','victim', d=>set(ref(d,'users/victimUid/fcmToken'),'tok-new'), true);
await probe('CRIT','[app] customer reads own profile stats','victim', d=>get(ref(d,'users/victimUid')), true);
await probe('CRIT','[app] customer joins the waitlist','victim', d=>set(ref(d,'waitlist/2026-09-10/victimUid'),{at:2}), true);
await probe('CRIT','[app] customer posts a review','victim', d=>set(ref(d,'reviews/bk1'),{uid:'victimUid',bookingId:'bk1',dateKey:'2026-09-10',serviceName:'Hair Cut (Mens)',rating:5,text:'nice',customerName:'Victim',createdAt:1}), true);
await probe('CRIT','[app] customer checks the phone blocklist','victim', d=>get(ref(d,'blockedPhones')), true);
await probe('CRIT','[app] admin marks a booking finished','admin', d=>update(ref(d,B+'/bk2'),{status:'finished',finishedAt:1}), true);
await probe('CRIT','[app] admin deletes a booking','admin', d=>remove(ref(d,B+'/bk4')), true);
await probe('CRIT','[app] admin saves a private note','admin', d=>set(ref(d,'notes/other1'),{text:'scissors only',updatedAt:1}), true);
await probe('CRIT','[app] admin publishes an announcement','admin', d=>set(ref(d,'settings/announcement'),{id:'a1',text:'Prices rise',expiresAt:9e15}), true);
await probe('CRIT','[app] admin updates customer visit stats','admin', d=>update(ref(d,'users/victimUid'),{visits:6,lastVisitAt:1}), true);
await probe('CRIT','[app] admin reads all contacts','admin', d=>get(ref(d,'contacts')), true);

// ── attacker = any ordinary signed-in Google account ──
await probe('CRIT','[attack] WIPE a whole day of bookings','attacker', d=>remove(ref(d,B)));
await probe('CRIT','[attack] overwrite the day with junk','attacker', d=>set(ref(d,B),{x:{junk:true}}));
await probe('CRIT','[attack] delete someone else\'s booking','attacker', d=>remove(ref(d,B+'/bk2')));
await probe('CRIT','[attack] cancel someone else\'s booking','attacker', d=>update(ref(d,B+'/bk2'),{status:'cancelled'}));
await probe('CRIT','[attack] move someone else\'s appointment','attacker', d=>update(ref(d,B+'/bk3'),{startTime:'23:00'}));
await probe('WARN','[attack] book under someone else\'s uid','attacker', d=>set(ref(d,B+'/evil'),{uid:'victimUid',name:'Victim',serviceName:'X',startTime:'15:00',status:'confirmed'}));
await probe('CRIT','[attack] un-block themselves','attacker', d=>set(ref(d,'users/attackerUid/blocked'),false));
await probe('CRIT','[attack] read another customer profile (phone!)','attacker', d=>get(ref(d,'users/victimUid')));
await probe('CRIT','[attack] read ALL customers','attacker', d=>get(ref(d,'users')));
await probe('CRIT','[attack] read admin-only contacts (all phones)','attacker', d=>get(ref(d,'contacts')));
await probe('CRIT','[attack] read private customer notes','attacker', d=>get(ref(d,'notes')));
await probe('CRIT','[attack] make themselves an admin','attacker', d=>set(ref(d,'admin/allowedUids/attackerUid'),true));
await probe('CRIT','[attack] change shop settings','attacker', d=>set(ref(d,'settings/closure'),{active:true,reason:'lol'}));
await probe('CRIT','[attack] publish a fake announcement','attacker', d=>set(ref(d,'settings/announcement'),{id:'x',text:'Closed forever',expiresAt:9e15}));
await probe('CRIT','[attack] clear the phone blocklist','attacker', d=>remove(ref(d,'blockedPhones')));
await probe('CRIT','[attack] wipe ALL reviews','attacker', d=>set(ref(d,'reviews'),{}));
await probe('WARN','[attack] overwrite an existing review','attacker', d=>set(ref(d,'reviews/r1'),{uid:'other1',rating:1,text:'hacked'}));
await probe('WARN','[attack] steal the admin FCM token','attacker', d=>get(ref(d,'admin/fcmTokens')));
await probe('WARN','[attack] read another customer\'s reminders','attacker', d=>get(ref(d,'reminders/victimUid')));
await probe('WARN','[attack] enumerate the admin uids','attacker', d=>get(ref(d,'admin/allowedUids')));
await probe('WARN','[attack] read the whole waitlist','attacker', d=>get(ref(d,'waitlist/2026-09-10')));
await probe('WARN','[attack] dump 300KB junk into a booking','attacker', d=>set(ref(d,B+'/spam'),{uid:'attackerUid',blob:'x'.repeat(300000),startTime:'16:00',status:'confirmed'}));
await probe('WARN','[attack] forge a review under another uid','attacker', d=>set(ref(d,'reviews/bk3'),{uid:'victimUid',rating:1,text:'forged'}));
await probe('WARN','[attack] post a 6-star review','attacker', d=>set(ref(d,'reviews/bk9'),{uid:'attackerUid',rating:99,text:'x'}));
await probe('CRIT','[app] customer edits their OWN review','victim', d=>set(ref(d,'reviews/bk1'),{uid:'victimUid',bookingId:'bk1',rating:4,text:'edited',createdAt:2}), true);
await probe('CRIT','[app] anyone reads reviews (sign-in screen)','anon', d=>get(ref(d,'reviews')), true);
await probe('CRIT','[app] admin checks own admin flag','admin', d=>get(ref(d,'admin/allowedUids/adminUid')), true);
await probe('CRIT','[app] customer checks own admin flag (denied gracefully)','victim', d=>get(ref(d,'admin/allowedUids/victimUid')), true);
await probe('CRIT','[app] customer with NO phone still writes contacts','victim', d=>set(ref(d,'contacts/2026-09-10/bk1x'),{phone:'',name:'Victim'}), true);
await probe('CRIT','[app] admin adds a walk-in (no uid on booking)','admin', d=>set(ref(d,B+'/walkin2'),{name:'Walk In',serviceName:'Hair Cut (Mens)',price:150,startTime:'18:00',duration:40,status:'confirmed',source:'admin'}), true);
await probe('CRIT','[app] admin edits a customer booking time','admin', d=>update(ref(d,B+'/bk1'),{startTime:'16:00',endTime:'16:40'}), true);
await probe('CRIT','[app] admin cancels a customer booking','admin', d=>update(ref(d,B+'/bk2'),{status:'cancelled',cancelReason:'shop closed'}), true);
await probe('CRIT','[attack] read bookings while signed OUT','anon', d=>get(ref(d,'bookings')));
await probe('CRIT','[attack] read users while signed OUT','anon', d=>get(ref(d,'users')));

R.forEach(([s,l,d])=>console.log(`${s==='ok'?'  ok  ':(s==='CRIT'?' CRIT ':' warn ')} ${l}  → ${d}`));
console.log(`\nCRITICAL: ${crit}   warnings: ${warn}   passed: ${okc}`);
await env.cleanup();
process.exit(crit>0?1:0);
