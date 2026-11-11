import React, { useCallback, useEffect, useState } from 'react'
import { AppCtx } from './ctx.js'
import { api, setToken, setUnauthorizedHandler } from './api.js'
import Login from './Login.jsx'
import Home from './Home.jsx'
import { RecordsPage } from './Records.jsx'
import Consent from './Consent.jsx'
import { Users, Permissions, AuditLog } from './Admin.jsx'
import { Avatar, Icon, ROLE_LABEL, ToastProvider, useToast } from './ui.jsx'

const safe = (fn, fallback) => { try { return fn() } catch { return fallback } }
const jwtExp = (t) => safe(() => JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000, Date.now() + 9e5)

function UserBadge({ user, onLogout }) {
  return (
    <>
      <div className="me" title={user.institution || ''}>
        <Avatar name={user.full_name} />
        <span className="me-text"><strong>{user.full_name.replace(/\s*\(.*\)/, '')}</strong><small>{ROLE_LABEL[user.role]}</small></span>
      </div>
      <button className="btn ghost sm signout" onClick={() => onLogout(false)}><Icon name="logout" size={15} />Sign out</button>
    </>)
}

function Shell({ user, token, onLogout }) {
  const toast = useToast()
  const [nav, setNav] = useState({ page: 'home', id: null })
  const [stats, setStats] = useState(null)
  const [dark, setDark] = useState(() => safe(() => localStorage.getItem('zt_theme') === 'dark' ||
    (!localStorage.getItem('zt_theme') && matchMedia('(prefers-color-scheme: dark)').matches), false))

  const can = useCallback((p) => user.permissions.includes(p), [user])
  const go = useCallback((page, id = null) => { setNav({ page, id }); window.scrollTo(0, 0) }, [])
  const refresh = useCallback(() => api('/stats').then(setStats).catch(() => {}), [])

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; safe(() => localStorage.setItem('zt_theme', dark ? 'dark' : 'light')) }, [dark])
  useEffect(() => { refresh() }, [nav.page, refresh])
  useEffect(() => {
    const t = setInterval(() => {
      if (jwtExp(token) - Date.now() <= 0) { toast('Your session has ended. Please sign in again.', 'error'); onLogout(true) }
    }, 5000)
    return () => clearInterval(t)
  }, [token])

  const items = [
    ['home', 'Home', 'home', true],
    ['records', 'Records', 'file', can('record:read')],
    ['consent', 'Requests', 'inbox', can('consent:manage')],
    ['users', 'Users', 'users', can('user:manage')],
    ['permissions', 'Permissions', 'grid', can('acm:read')],
    ['audit', 'Activity log', 'activity', can('audit:read')],
  ].filter((i) => i[3])
  const pendingBadge = stats?.kind === 'patient' ? stats.pending : 0
  const current = items.find((i) => i[0] === nav.page)

  return (
    <AppCtx.Provider value={{ user, can, go, toast, stats, refresh }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand"><span className="brand-mark"><Icon name="shield" size={20} /></span><span>ZeroTrust<small>Health Exchange</small></span></div>
          <nav aria-label="Main">
            {items.map(([k, label, ic]) => (
              <button key={k} className={nav.page === k ? 'nav-item active' : 'nav-item'} onClick={() => go(k)} aria-current={nav.page === k ? 'page' : undefined}>
                <Icon name={ic} size={18} />{label}
                {k === 'consent' && pendingBadge > 0 && <span className="count">{pendingBadge}</span>}
              </button>))}
          </nav>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="crumb">{current?.[1]}</div>
            <div className="top-right">
              <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode"><Icon name={dark ? 'sun' : 'moon'} /></button>
              <UserBadge user={user} onLogout={onLogout} />
            </div>
          </header>
          <main className="content">
            {nav.page === 'home' && <Home />}
            {nav.page === 'records' && <RecordsPage initialId={nav.id} />}
            {nav.page === 'consent' && <Consent />}
            {nav.page === 'users' && <Users />}
            {nav.page === 'permissions' && <Permissions />}
            {nav.page === 'audit' && <AuditLog />}
          </main>
        </div>
      </div>
    </AppCtx.Provider>
  )
}

function Root() {
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [booting, setBooting] = useState(true)

  const logout = useCallback(async (silent) => {
    if (!silent) { try { await api('/auth/logout', { method: 'POST' }) } catch {} }
    setToken(null); safe(() => sessionStorage.removeItem('zt_token')); setSession(null)
  }, [])

  const start = useCallback(async (token) => {
    setToken(token)
    const me = await api('/me')
    safe(() => sessionStorage.setItem('zt_token', token))
    setSession({ user: me, token })
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => { logout(true); toast('Your session has ended. Please sign in again.', 'error') })
    const t = safe(() => sessionStorage.getItem('zt_token'), null)
    if (t) start(t).catch(() => logout(true)).finally(() => setBooting(false)); else setBooting(false)
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = safe(() => localStorage.getItem('zt_theme'), null) ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') }, [])

  if (booting) return null
  return session ? <Shell user={session.user} token={session.token} onLogout={logout} /> : <Login onLoggedIn={start} />
}

export default function App() { return <ToastProvider><Root /></ToastProvider> }
