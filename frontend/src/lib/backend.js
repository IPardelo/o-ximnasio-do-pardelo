// Single entry point to the Firebase backend (lib/firebase.js). Loaded on demand so builds that
// never sign in — demo, static, mobile — don't download the Firebase SDK at all.
const env = import.meta.env

// The app talks to Firebase only when a project is configured at build time (see
// frontend/.env.example and docs/FIREBASE.md). Without it the build is local-only.
export const FIREBASE_CONFIGURED = !!(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID)

let mod = null
export const backend = () => (mod ||= import('./firebase.js'))
