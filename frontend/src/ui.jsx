import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

/* ---------- icons (feather-style, inline SVG) ---------- */
const P = {
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M9 22V12h6v10',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2|M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M23 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75',
  grid: 'M3 3h7v7H3z|M14 3h7v7h-7z|M14 14h7v7h-7z|M3 14h7v7H3z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z|M7 11V7a5 5 0 0 1 10 0v4',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18|M6 6l12 12',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M8.59 13.51l6.83 3.98|M15.41 6.51l-6.82 3.98',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01',
  plus: 'M12 5v14|M5 12h14',
  back: 'M19 12H5|M12 19l-7-7 7-7',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  hash: 'M4 9h16|M4 15h16|M10 3L8 21|M16 3l-2 18',
  building: 'M3 21h18|M5 21V7l8-4v18|M19 21V11l-6-4|M9 9v.01|M9 12v.01|M9 15v.01',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3',
  chevron: 'M6 9l6 6 6-6',
  trash: 'M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
}
export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(P[name] || '').split('|').map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

/* ---------- friendly labels ---------- */
export const ROLE_LABEL = { doctor: 'Doctor', lab: 'Lab Staff', patient: 'Patient', admin: 'Administrator' }
export const PERM_LABEL = {
  'record:create': ['Upload records', 'Add new patient records to the system'],
  'record:read': ['View records', 'Open records they have been given access to'],
  'record:share': ['Share records', 'Send a record on to another clinician'],
  'consent:manage': ['Manage consent', 'Approve or revoke who may see their own records'],
  'user:manage': ['Manage users', 'Deactivate, reactivate and unlock accounts'],
  'audit:read': ['View activity log', 'Read and check the activity log'],
  'acm:read': ['View permissions', 'See which roles can do what'],
  'acm:edit': ['Edit permissions', 'Change what each role can do'],
}
export const PERM_GROUPS = [
  ['Records', ['record:create', 'record:read', 'record:share']],
  ['Consent', ['consent:manage']],
  ['Administration', ['user:manage', 'audit:read', 'acm:read', 'acm:edit']],
]
export const ACTION_LABEL = {
  REGISTER: 'Account created', LOGIN: 'Signed in', MFA: 'MFA check', LOGOUT: 'Signed out', UPLOAD: 'Uploaded record',
  VIEW: 'Opened record', SHARE: 'Shared record', CONSENT_APPROVE: 'Consent approved', CONSENT_REVOKE: 'Access removed',
  ACCESS_DENIED: 'Access blocked', TAMPER_DETECTED: 'Integrity check failed', ACM_CHANGE: 'Permission changed',
  ADMIN_DEACTIVATE: 'User deactivated', ADMIN_ACTIVATE: 'User activated', ADMIN_UNLOCK: 'User unlocked', ADMIN_DELETE: 'User deleted',
}
export const actionLabel = (a) => ACTION_LABEL[a] || a

export function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
export const initials = (name) => name.replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((text, type = 'success') => {
    const id = Math.random()
    setItems((x) => [...x, { id, text, type }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}><Icon name={t.type === 'error' ? 'alert' : 'check'} size={16} />{t.text}</div>))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- small building blocks ---------- */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  )
}
export const Badge = ({ tone = 'neutral', children, icon }) => (
  <span className={`badge ${tone}`}>{icon && <Icon name={icon} size={12} />}{children}</span>)
export const Avatar = ({ name, tone }) => <span className={`avatar ${tone || ''}`}>{initials(name)}</span>
export const Empty = ({ icon = 'file', title, children }) => (
  <div className="empty"><div className="empty-icon"><Icon name={icon} size={26} /></div><h3>{title}</h3><p>{children}</p></div>)
export const Skeleton = ({ rows = 3 }) => (
  <div className="skeletons">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>)
export const PageHead = ({ title, sub, children }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="page-actions">{children}</div></div>)

/* ---------- plain-language descriptions of activity ---------- */
const kv = (s) => Object.fromEntries((s || '').split(' ').filter((x) => x.includes('=')).map((x) => [x.split('=')[0], x.slice(x.indexOf('=') + 1)]))

export function describe(r, { self = false } = {}) {
  const d = kv(r.detail)
  const t = self ? 'this record' : r.record_title ? `“${r.record_title}”` : 'a record'
  const ok = r.outcome === 'OK'
  switch (r.action) {
    case 'REGISTER': return 'Account created'
    case 'LOGIN': return ok ? 'Signed in' : r.detail === 'account locked' ? 'Sign-in blocked — account locked' : 'Failed sign-in attempt'
    case 'MFA': return 'Incorrect verification code'
    case 'LOGOUT': return 'Signed out'
    case 'UPLOAD': return `Uploaded ${t}${d.patient && !self ? ` for ${d.patient}` : ''}`
    case 'VIEW': return ok ? `Opened ${t}` : `${self ? 'This record' : t} could not be verified`
    case 'SHARE': return `Shared ${t}${d.to ? ` with ${d.to}` : ''}${d.status === 'pending' ? ' — awaiting patient approval' : ''}`
    case 'CONSENT_APPROVE': return `Patient approved access to ${t}`
    case 'CONSENT_REVOKE': return `Access to ${t} was removed`
    case 'TAMPER_DETECTED': return `${self ? 'This record' : t} failed its integrity check`
    case 'ACCESS_DENIED': return r.record_title || r.target?.length === 36 ? `Blocked from opening ${t} — no access` : 'Blocked — action not allowed for this role'
    case 'ACM_CHANGE': {
      const i = (r.target || '').indexOf(':'); const role = r.target.slice(0, i), perm = r.target.slice(i + 1)
      return `${PERM_LABEL[perm]?.[0] || perm} ${d.granted === 'True' ? 'allowed' : 'blocked'} for ${ROLE_LABEL[role] || role}`
    }
    case 'ADMIN_DEACTIVATE': return `Deactivated ${r.target}`
    case 'ADMIN_ACTIVATE': return `Reactivated ${r.target}`
    case 'ADMIN_UNLOCK': return `Unlocked ${r.target}`
    case 'ADMIN_DELETE': return `Permanently deleted ${r.target}`
    default: return actionLabel(r.action)
  }
}

export function useOutside(ref, onOut) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && onOut()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
}
