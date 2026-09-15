// Backend — Firebase Authentication + Cloud Firestore, called straight from the browser. There is
// no server of our own any more: every rule about who can read or write what lives in
// firebase/firestore.rules, which Firestore enforces on its side. This module is only ever
// loaded through lib/backend.js (a dynamic import), so the demo, static and mobile builds never
// download the Firebase SDK.
//
// Data model:
//   users/{uid}               profile: name, email, provider, admin, disabled, sessionVer,
//                             invitedBy, createdAt + a small summary (lastSync, workouts,
//                             lastWorkout) the admin list reads without opening anyone's data
//   users/{uid}/state/meta    { parts, ts, ver } — the synced app state is one JSON string split
//   users/{uid}/state/p0..pN  { s } — across N docs, since a Firestore doc caps at 1 MiB
//   presence/{uid}            "training now" heartbeat for the admin dashboard
//   config/invite             { code } — the shared invite code (admins only)
//   config/setup              { owner, at } — written with the first profile, which becomes admin
//
// The web and the mobile (Capacitor) builds share all of this; the mobile one just has no
// Google sign-in (see the auth setup below).
import { initializeApp } from 'firebase/app'
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, sendPasswordResetEmail, signOut as fbSignOut, deleteUser,
} from 'firebase/auth'
import {
  initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  writeBatch, serverTimestamp, increment,
} from 'firebase/firestore'

const env = import.meta.env
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (env.VITE_FIREBASE_PROJECT_ID + '.firebaseapp.com'),
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
// Inside the Capacitor shell (mobile build) the default getAuth() tries to load Google's
// popup/redirect helper iframe, which the native WebView can't serve and which can leave sign-in
// hanging on iOS. The mobile build only offers email + password, so it initialises auth with
// plain IndexedDB persistence and no popup support at all.
const auth = env.VITE_MOBILE === '1'
  ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
  : getAuth(app)
const db = initializeFirestore(app, { ignoreUndefinedProperties: true })

// Error with a stable `code` the UI can branch on, and an English message that doubles as the
// i18n key (see locales/*.js) — same convention as every other user-facing string in the app.
export class BackendError extends Error {
  constructor(message, code) { super(message); this.code = code }
}
const MESSAGES = {
  'auth/invalid-credential': 'Wrong email or password',
  'auth/wrong-password': 'Wrong email or password',
  'auth/user-not-found': 'Wrong email or password',
  'auth/invalid-email': 'Enter a valid email',
  'auth/missing-email': 'Enter a valid email',
  'auth/email-already-in-use': 'That email already has a profile',
  'auth/weak-password': 'Password must be at least 8 characters',
  'auth/too-many-requests': 'Too many attempts — try again later',
  'auth/network-request-failed': 'No connection — try again',
  'auth/popup-blocked': 'The browser blocked the Google window — allow pop-ups for this site',
  'auth/operation-not-allowed': 'This sign-in method is not enabled',
  'auth/unauthorized-domain': 'This domain is not authorised for sign-in',
  unavailable: 'No connection — try again',
}
const wrap = e => {
  if (e instanceof BackendError) return e
  const code = e?.code || 'unknown'
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return new BackendError('', 'cancelled')
  return new BackendError(MESSAGES[code] || e?.message || 'Something went wrong', code)
}
const guard = fn => async (...a) => { try { return await fn(...a) } catch (e) { throw wrap(e) } }

/* ---------------- profile & session ---------------- */

// "Sign out everywhere" bumps users/{uid}.sessionVer. Each device remembers the version it signed
// in with; a device holding an older one signs itself out on its next start, and Firestore
// refuses its state writes in the meantime (firestore.rules checks `ver` on state/meta).
const VER_KEY = 'gym_sver'
const localVer = () => Number(localStorage.getItem(VER_KEY) || 0)

const userRef = uid => doc(db, 'users', uid)
const publicUser = (uid, p) => ({ id: uid, name: p.name, email: p.email || null, admin: !!p.admin })

async function getProfile(uid) {
  const s = await getDoc(userRef(uid))
  return s.exists() ? s.data() : null
}

const setupRef = () => doc(db, 'config', 'setup')

// True until the first account has been created. That first account becomes the admin with no
// invite code needed (firestore.rules allows it exactly once, while config/setup is missing).
// Readable without signing in, so the sign-up form knows whether to ask for a code.
export const isFirstUser = guard(async () => !(await getDoc(setupRef())).exists())

async function createProfile(fbUser, name, code, provider) {
  const first = await isFirstUser()
  const profile = {
    name: String(name).trim().slice(0, 40), email: fbUser.email || null, provider,
    admin: first, disabled: false, sessionVer: 0,
    invitedBy: first ? null : String(code || '').trim().toUpperCase(),
    createdAt: serverTimestamp(), lastSync: null, workouts: 0, lastWorkout: null,
  }
  if (!first && !profile.invitedBy) throw new BackendError('An invite code is required', 'invite')
  try {
    if (first) {
      // Profile and config/setup in one batch: either both land or neither does, so two people
      // signing up at the same moment can't both become admin.
      const b = writeBatch(db)
      b.set(userRef(fbUser.uid), profile)
      b.set(setupRef(), { owner: fbUser.uid, at: serverTimestamp() })
      await b.commit()
    } else {
      await setDoc(userRef(fbUser.uid), profile)
    }
  } catch (e) {
    // The rules only let a profile be created when invitedBy matches config/invite — a denial
    // here means the code was wrong (or no code has been set up yet). For the first account it
    // means someone else finished setting the app up a moment earlier.
    if (e?.code === 'permission-denied') {
      throw first
        ? new BackendError('Someone already set up this app — you need an invite code', 'invite')
        : new BackendError('Invite code is invalid', 'invite')
    }
    throw e
  }
  // The first admin gets an invite code ready to share straight away (also changeable from the
  // admin dashboard). Best-effort: the profile already exists either way.
  if (first) await adminNewInvite().catch(() => {})
}

// An instance whose admin was set up by hand (before this first-account path existed) has no
// config/setup yet; the admin's next sign-in creates it so nobody else can claim the path.
async function closeSetup(uid) {
  try { if (!(await getDoc(setupRef())).exists()) await setDoc(setupRef(), { owner: uid, at: serverTimestamp() }) }
  catch { /* retried on the next sign-in */ }
}

// Turns a signed-in Firebase account into an app session — or refuses one that has no profile
// (an abandoned Google sign-up) or was disabled by an admin.
async function openSession(uid) {
  const p = await getProfile(uid)
  if (!p) throw new BackendError('Sign-in failed', 'no-profile')
  if (p.disabled) { await fbSignOut(auth); throw new BackendError('This account has been disabled', 'disabled') }
  localStorage.setItem(VER_KEY, String(p.sessionVer || 0))
  if (p.admin) await closeSetup(uid)
  return publicUser(uid, p)
}

// Boot: who is signed in on this device? null = nobody (or the session was ended elsewhere).
// Throws when the network is down, so the caller can keep its cached user and run offline.
export const currentSession = guard(async () => {
  await auth.authStateReady()
  const u = auth.currentUser
  if (!u) return null
  const p = await getProfile(u.uid)
  if (!p) { await fbSignOut(auth); return null }
  if (p.disabled) { await fbSignOut(auth); throw new BackendError('This account has been disabled', 'disabled') }
  const had = localStorage.getItem(VER_KEY)
  if (had !== null && Number(had) !== (p.sessionVer || 0)) { localStorage.removeItem(VER_KEY); await fbSignOut(auth); return null }
  localStorage.setItem(VER_KEY, String(p.sessionVer || 0))
  return publicUser(u.uid, p)
})

export const register = guard(async (name, email, password, code) => {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
  try { await createProfile(cred.user, name, code, 'password') }
  catch (e) { await deleteUser(cred.user).catch(() => fbSignOut(auth)); throw e }
  return openSession(cred.user.uid)
})

export const login = guard(async (email, password) => {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
  return openSession(cred.user.uid)
})

// First step of Google sign-in. A Google account that already has a profile is signed straight
// in; a new one comes back as { needsInvite: true } and stays half signed-in until
// finishGoogle(code) creates its profile or abandonGoogle() throws the account away. The very
// first account of the instance needs no code: its profile (admin) is created right here.
export const loginGoogle = guard(async () => {
  const cred = await signInWithPopup(auth, new GoogleAuthProvider())
  const p = await getProfile(cred.user.uid)
  if (!p) {
    if (!(await isFirstUser())) return { needsInvite: true }
    const u = cred.user
    try { await createProfile(u, u.displayName || (u.email || 'user').split('@')[0], '', 'google') }
    catch (e) { await abandonGoogle(); throw e }
    return { user: await openSession(u.uid), isNew: true }
  }
  return { user: await openSession(cred.user.uid) }
})

export const finishGoogle = guard(async code => {
  const u = auth.currentUser
  if (!u) throw new BackendError('Sign-in failed', 'no-user')
  await createProfile(u, u.displayName || (u.email || 'user').split('@')[0], code, 'google')
  return openSession(u.uid)
})

export async function abandonGoogle() {
  const u = auth.currentUser
  if (!u) return
  // Only an account that verifiably has no profile is deleted; if the check itself fails (offline),
  // just sign out — never risk deleting a real profile's account.
  let p
  try { p = await getProfile(u.uid) } catch { await fbSignOut(auth).catch(() => {}); return }
  if (p) return
  await deleteUser(u).catch(() => fbSignOut(auth))
}

export const resetPassword = guard(email => sendPasswordResetEmail(auth, email.trim()))

export const signOutHere = guard(async () => {
  localStorage.removeItem(VER_KEY)
  await fbSignOut(auth)
})

export const signOutEverywhere = guard(async () => {
  const u = auth.currentUser
  if (!u) throw new BackendError('Sign-in failed', 'no-user')
  await updateDoc(userRef(u.uid), { sessionVer: increment(1) })
  localStorage.removeItem(VER_KEY)
  await fbSignOut(auth)
})

/* ---------------- synced state ---------------- */

// Characters per part. Firestore caps a document at 1 MiB of UTF-8; at worst 3 bytes per
// UTF-16 unit, 300k chars stays under that with room to spare.
const PART = 300000
const knownParts = new Map()   // uid → part count last read/written, so stale tail parts get deleted

export const loadState = guard(async uid => {
  // One query = one consistent snapshot: meta and parts can't come from two different saves.
  const snap = await getDocs(collection(db, 'users', uid, 'state'))
  const docs = new Map(snap.docs.map(d => [d.id, d.data()]))
  const meta = docs.get('meta')
  if (!meta) return null
  knownParts.set(uid, Math.max(meta.parts || 0, docs.size - 1))
  let json = ''
  for (let i = 0; i < meta.parts; i++) {
    const p = docs.get('p' + i)
    if (!p) throw new BackendError('Synced data is incomplete', 'corrupt')
    json += p.s
  }
  return JSON.parse(json)
})

export const saveState = guard(async (uid, S) => {
  const st = { ...S }
  delete st.active   // an in-progress workout stays on the device it's running on
  const ts = st._ts || Date.now()
  const json = JSON.stringify(st)
  const parts = Math.max(1, Math.ceil(json.length / PART))
  const prev = knownParts.get(uid) || 0

  const b = writeBatch(db)
  for (let i = 0; i < parts; i++) b.set(doc(db, 'users', uid, 'state', 'p' + i), { s: json.slice(i * PART, (i + 1) * PART) })
  for (let i = parts; i < prev; i++) b.delete(doc(db, 'users', uid, 'state', 'p' + i))
  b.set(doc(db, 'users', uid, 'state', 'meta'), { parts, ts, ver: localVer() })
  const w = st.workouts || []
  b.update(userRef(uid), { lastSync: ts, workouts: w.length, lastWorkout: w.length ? (w[w.length - 1].d || null) : null })
  await b.commit()
  knownParts.set(uid, parts)
  return ts
})

/* ---------------- presence ("training now") ---------------- */

export const setPresence = guard(async (uid, info) => {
  const ref = doc(db, 'presence', uid)
  if (!info) return deleteDoc(ref)
  return setDoc(ref, {
    name: String(info.name || '').slice(0, 60),
    exIdx: info.exIdx | 0, exTotal: info.exTotal | 0,
    setsDone: info.setsDone | 0, setsTotal: info.setsTotal | 0,
    startedAt: info.startedAt || Date.now(), updatedAt: Date.now(),
  })
})

/* ---------------- admin ---------------- */

const PRESENCE_TTL = 70000
const iso = ts => (ts?.toDate ? ts.toDate().toISOString() : null)

export const adminListUsers = guard(async () => {
  const [us, ps] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'presence'))])
  const now = Date.now()
  const pres = new Map(ps.docs.map(d => [d.id, d.data()]))
  return us.docs.map(d => {
    const u = d.data()
    const p = pres.get(d.id)
    const live = p && now - (p.updatedAt || 0) <= PRESENCE_TTL
      ? { name: p.name, exIdx: p.exIdx, exTotal: p.exTotal, setsDone: p.setsDone, setsTotal: p.setsTotal, startedAt: p.startedAt }
      : null
    return {
      id: d.id, name: u.name, email: u.email || null, created: iso(u.createdAt),
      disabled: !!u.disabled, admin: !!u.admin, invitedBy: u.invitedBy || null,
      workouts: u.workouts || 0, lastWorkout: u.lastWorkout || null, lastSync: u.lastSync || null, live,
    }
  }).sort((a, b) => (b.lastSync || 0) - (a.lastSync || 0))
})

export const adminUser = guard(async id => {
  const [u, S] = await Promise.all([getProfile(id), loadState(id)])
  if (!u) throw new BackendError('No such user', 'not-found')
  const st = S || {}
  return {
    user: {
      id, name: u.name, email: u.email || null, created: iso(u.createdAt),
      disabled: !!u.disabled, admin: !!u.admin, invitedBy: u.invitedBy || null,
    },
    unit: st.unit || 'kg',
    lastSync: u.lastSync || null,
    routines: (st.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
    bodyweight: st.bodyweight || [],
    workouts: [...(st.workouts || [])].reverse(),
  }
})

export const adminSetDisabled = guard(async (id, disabled) => {
  await updateDoc(userRef(id), { disabled: !!disabled })
  if (disabled) await deleteDoc(doc(db, 'presence', id)).catch(() => {})
})

export const adminGetInvite = guard(async () => {
  const s = await getDoc(doc(db, 'config', 'invite'))
  return s.exists() ? String(s.data().code || '') : ''
})

// 10 hex chars = 40 bits, uppercase to match how the sign-up form types codes in.
export const adminNewInvite = guard(async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  const code = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  await setDoc(doc(db, 'config', 'invite'), { code })
  return code
})
