import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { backend } from '../lib/backend.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const toast = msg => useUI.getState().toast(msg)
// Backend errors carry an English message that is also the i18n key; a closed Google window is
// not an error worth a toast.
const fail = (e, fallback) => { if (e?.code !== 'cancelled') toast(t(e?.message || fallback)) }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// After any successful sign-in: a profile created on a device that already holds guest data
// takes that data with it; otherwise the profile's synced data is pulled down.
async function enter(u, isNew) {
  const { setUser, pushState, pullState } = useStore.getState()
  setUser(u)
  if (isNew && hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data from this device moved into it')) }
  else { await pullState(); toast(t(isNew ? 'Welcome, {0}' : 'Welcome back, {0}', u.name)) }
}

// A brand-new Google account needs an invite code too — otherwise the invite gate on
// email/password sign-up would be pointless, since anyone could just use Google instead.
// An already-linked Google account never sees this. Closing the sheet without finishing throws
// the half-created Google sign-in away, so no profile-less account lingers.
function GoogleInviteSheet({ close }) {
  const [code, setCode] = useState('')
  const done = useRef(false)
  const alive = useRef(false)
  const ref = useRef(null)
  useEffect(() => {
    alive.current = true
    setTimeout(() => ref.current?.focus(), 250)
    // Deferred so React's dev-mode double mount (unmount + immediate remount) doesn't count as
    // the user closing the sheet.
    return () => {
      alive.current = false
      setTimeout(() => { if (!alive.current && !done.current) backend().then(fb => fb.abandonGoogle()).catch(() => {}) }, 0)
    }
  }, [])
  const go = async () => {
    if (!code.trim()) { toast(t('An invite code is required')); return }
    try {
      const u = await (await backend()).finishGoogle(code)
      done.current = true
      close()
      await enter(u, true)
    } catch (e) { fail(e, 'Sign-in failed') }
  }
  return <>
    <h3>{t('One more step')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('This Google account is new here — enter the invite code you were given to finish creating your profile.')}</div>
    <input ref={ref} className="input" placeholder={t('Invite code')} maxLength={40} value={code}
      onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Continue')}</Button>
  </>
}

function RegisterSheet({ close }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // The first account of a fresh instance becomes the admin and needs no invite code.
  const [first, setFirst] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { backend().then(fb => fb.isFirstUser()).then(setFirst).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (!EMAIL_RE.test(email.trim())) { toast(t('Enter a valid email')); return }
    if (password.length < 8) { toast(t('Password must be at least 8 characters')); return }
    if (!first && !code.trim()) { toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await (await backend()).register(n, email, password, code)
      close()
      await enter(u, true)
    } catch (e) { fail(e, 'Registration failed') }
    setBusy(false)
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="email" placeholder={t('Email')} maxLength={254} value={email}
      onChange={e => setEmail(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="email" />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('Password (8+ characters)')} value={password}
      onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
    <div style={{ height: 10 }} />
    {first
      ? <div className="dim small" style={{ marginTop: 6 }}>{t('You’re the first one here — this profile will be the administrator.')}</div>
      : <>
        <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
        <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
      </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{t('Create profile')}</Button>
  </>
}

function ResetSheet({ email: initial, close }) {
  const [email, setEmail] = useState(initial || '')
  const go = async () => {
    if (!EMAIL_RE.test(email.trim())) { toast(t('Enter a valid email')); return }
    try { await (await backend()).resetPassword(email); close(); toast(t('Check your email for the reset link')) }
    catch (e) { fail(e, 'Something went wrong') }
  }
  return <>
    <h3>{t('Reset password')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('We’ll email you a link to choose a new password.')}</div>
    <input className="input" type="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)}
      autoCapitalize="none" autoCorrect="off" autoComplete="email" />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Send link')}</Button>
  </>
}

export default function Login() {
  const { setGuest } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const google = async () => {
    setBusy(true)
    try {
      const r = await (await backend()).loginGoogle()
      if (r.needsInvite) useUI.getState().openSheet(close => <GoogleInviteSheet close={close} />)
      else await enter(r.user, !!r.isNew)
    } catch (e) { fail(e, 'Sign-in failed') }
    setBusy(false)
  }

  const signIn = async () => {
    if (!email.trim() || !password) { toast(t('Enter your email and password')); return }
    setBusy(true)
    try { await enter(await (await backend()).login(email, password), false) }
    catch (e) { fail(e, 'Sign-in failed') }
    setBusy(false)
  }

  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>O Ximnasio do Pardelo</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Sign-in and sync across your devices come with the O Ximnasio do Pardelo server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 26 }}>{t('Your workouts. Your weights. Your profile.')}</div>

      {/* Google sign-in needs a browser window; the mobile (Capacitor) app is email-only */}
      {!MOBILE && <>
        <Button onClick={google} disabled={busy}>{t('Continue with Google')}</Button>
        <div className="dim small" style={{ margin: '16px 0' }}>{t('or')}</div>
      </>}

      <input className="input" type="email" placeholder={t('Email')} maxLength={254} value={email}
        onChange={e => setEmail(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="email" />
      <div style={{ height: 10 }} />
      <input className="input" type="password" placeholder={t('Password')} value={password} autoComplete="current-password"
        onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && signIn()} />
      <div style={{ height: 10 }} />
      <Button variant="primary" icon="person" onClick={signIn} disabled={busy}>{t('Sign in')}</Button>
      <div style={{ height: 10 }} />
      <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
      <div className="small" style={{ marginTop: 14 }}>
        <a href="#" onClick={e => { e.preventDefault(); useUI.getState().openSheet(close => <ResetSheet email={email} close={close} />) }}>{t('Forgot your password?')}</a>
      </div>

      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        Desarrollado por <a href="https://ipardelo.es" target="_blank" rel="noopener">ipardelo</a>
      </div>
    </div>
  )
}
