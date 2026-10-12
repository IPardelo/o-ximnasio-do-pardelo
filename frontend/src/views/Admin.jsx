import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { backend } from '../lib/backend.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Admin-only operator dashboard (users/{uid}.admin; firestore.rules enforces it again on every read/write).
// Translated like the rest of the app (keys are the English strings, see lib/i18n.js).

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0} min ago', Math.floor(s / 60))
  if (s < 86400) return t('{0} h ago', Math.floor(s / 3600))
  return t('{0} d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { backend().then(fb => fb.adminUser(id)).then(setD).catch(e => toast(t(e.message || 'Something went wrong'))) }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    backend().then(fb => fb.adminSetDisabled(u.id, disabled))
      .then(() => { toast(t(disabled ? 'User disabled' : 'User enabled')); onChanged(); close() })
      .catch(e => toast(t(e.message || 'Something went wrong')))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    {u.email && <div className="dim small">{u.email}</div>}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">{t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They can no longer sync or sign in until re-enabled — any device they are on is signed out the next time the app opens.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {t(u.disabled ? 'Enable account' : 'Disable account')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

// A single shared code required to create an account (Firestore config/invite) —
// not a list of one-time codes. Rotating it only blocks NEW sign-ups with the old code; accounts
// already created keep working, since it's never re-checked after registration.
function InviteCodeCard({ code, reload }) {
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast(t('Copied {0}', code)) }
  const regen = () => confirmSheet({
    title: t('Generate a new invite code?'),
    message: t('The current code stops working for new sign-ups right away. Accounts already created are not affected.'),
    confirmText: t('Generate new code'),
    onConfirm: () => backend().then(fb => fb.adminNewInvite())
      .then(code => { navigator.clipboard?.writeText(code).catch(() => {}); toast(t('New code {0} created & copied', code)); reload() })
      .catch(e => toast(t(e.message || 'Something went wrong'))),
  })
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite code')}</h2>
      <Button variant="primary" size="sm" onClick={regen} icon="reset">{t('Generate new')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('Required to create an account — share it with whoever you want to invite.')}</div>
    {code
      ? <div className="row between" style={{ padding: '7px 2px' }}>
          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 600, letterSpacing: '.1em', fontSize: '1.05rem' }}
            onClick={copy}>{code}</span>
          <button className="iconbtn" onClick={copy} aria-label={t('Copy')}><Icon name="clipboard" /></button>
        </div>
      : <div className="dim small">{t('No code set yet — generate one to let people sign up.')}</div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [inviteCode, setInviteCode] = useState('')

  const loadUsers = () => backend().then(fb => fb.adminListUsers()).then(setUsers).catch(e => toast(t(e.message || 'Failed to load')))
  const loadInviteCode = () => backend().then(fb => fb.adminGetInvite()).then(setInviteCode).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInviteCode(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInviteCode() }} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · {t('ex {0}/{1}', u.live.exIdx, u.live.exTotal)} · {t('{0}/{1} sets', u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <InviteCodeCard code={inviteCode} reload={loadInviteCode} />

    <h4 className="sec">{t('Users')}</h4>
    <div className="list">
      {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>{t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : t('{0} workouts', u.workouts) + (u.lastWorkout ? ' · ' + t('last {0}', fmtDate(u.lastWorkout)) : '') + ' · ' + t('synced {0}', rel(u.lastSync))}</div></div>
<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">{t('No users yet.')}</div>}
    </div>
  </div>
}
