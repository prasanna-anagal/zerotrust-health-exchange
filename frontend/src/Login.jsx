import React, { useRef, useState } from 'react'
import { api } from './api.js'
import { Icon } from './ui.jsx'

const ROLES = [['doctor', 'Doctor'], ['lab', 'Laboratory staff'], ['patient', 'Patient']]

function OtpInput({ value, onChange, onComplete }) {
  const refs = useRef([])
  const digits = value.padEnd(6, ' ').split('')
  const setAt = (i, ch) => {
    const arr = value.padEnd(6, ' ').split('')
    arr[i] = ch
    const next = arr.join('').replace(/\s/g, '')
    onChange(next)
    if (next.length === 6) onComplete?.(next)
  }
  return (
    <div className="otp" onPaste={(e) => {
      const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
      if (t) { e.preventDefault(); onChange(t); if (t.length === 6) onComplete?.(t) }
    }}>
      {digits.map((d, i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" maxLength={1} autoFocus={i === 0}
          value={d.trim()} aria-label={`Digit ${i + 1}`}
          onChange={(e) => { const ch = e.target.value.replace(/\D/g, '').slice(-1); if (!ch) return; setAt(i, ch); refs.current[i + 1]?.focus() }}
          onKeyDown={(e) => { if (e.key === 'Backspace') { e.preventDefault(); setAt(i, ' '); if (!digits[i].trim()) refs.current[i - 1]?.focus() } }} />))}
    </div>
  )
}

function Hero() {
  return (
    <aside className="auth-side">
      <div className="brand light"><span className="brand-mark"><Icon name="shield" size={20} /></span>ZeroTrust Health Exchange</div>
      <div className="hero-copy">
        <h1>Connected care,<br />protected data.</h1>
        <p>A secure place for hospitals, laboratories and clinicians to share patient records — with the patient’s approval.</p>
      </div>
      <svg className="hero-art" viewBox="0 0 400 300" fill="none" aria-hidden="true">
        <circle cx="270" cy="150" r="120" fill="rgba(255,255,255,.05)" />
        <circle cx="270" cy="150" r="80" fill="rgba(255,255,255,.06)" />
        <rect x="70" y="70" width="150" height="190" rx="18" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.3)" />
        <rect x="90" y="96" width="70" height="8" rx="4" fill="rgba(255,255,255,.55)" />
        <rect x="90" y="116" width="110" height="6" rx="3" fill="rgba(255,255,255,.28)" />
        <rect x="90" y="132" width="96" height="6" rx="3" fill="rgba(255,255,255,.28)" />
        <rect x="90" y="148" width="104" height="6" rx="3" fill="rgba(255,255,255,.28)" />
        <path d="M120 215h20l10-24 14 44 10-20h24" stroke="#5ad6cc" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="290" cy="150" r="46" fill="#0f8f88" stroke="rgba(255,255,255,.5)" strokeWidth="2" />
        <path d="M290 126l24 9v14c0 14-10 24-24 30-14-6-24-16-24-30v-14z" fill="rgba(255,255,255,.18)" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
        <path d="M280 152l8 8 14-16" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </aside>)
}

export default function Login({ onLoggedIn }) {
  const [view, setView] = useState('login') // login | mfa | register | enroll
  const [f, setF] = useState({ username: '', password: '', full_name: '', role: 'doctor', institution: '' })
  const [mfaToken, setMfaToken] = useState(null)
  const [code, setCode] = useState('')
  const [enroll, setEnroll] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const run = async (fn) => { setErr(''); setBusy(true); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const step1 = (username, password) => run(async () => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } })
    setMfaToken(r.mfa_token); setCode(''); setView('mfa')
  })
  const submitMfa = (c) => run(async () => {
    const r = await api('/auth/mfa', { method: 'POST', body: { code: c }, auth: mfaToken })
    await onLoggedIn(r.token)
  })
  const register = (e) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/register', { method: 'POST', body: f }); setEnroll(r); setView('enroll')
  }) }

  return (
    <div className="auth">
      <Hero />
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-logo"><span className="brand-mark"><Icon name="shield" size={20} /></span></div>
          {err && <div className="notice error"><Icon name="alert" size={16} />{err}</div>}

          {view === 'login' && (
            <>
              <h2>Sign in</h2>
              <p className="muted">Enter your credentials to continue.</p>
              <form onSubmit={(e) => { e.preventDefault(); step1(f.username, f.password) }}>
                <label>Username<input value={f.username} onChange={set('username')} autoFocus required autoComplete="username" /></label>
                <label>Password<input type="password" value={f.password} onChange={set('password')} required autoComplete="current-password" /></label>
                <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
              </form>
              <p className="switch">Don’t have an account? <a onClick={() => { setErr(''); setView('register') }}>Create one</a></p>
            </>)}

          {view === 'mfa' && (
            <>
              <h2>Verification code</h2>
              <p className="muted">Enter the 6-digit code from your authenticator app.</p>
              <OtpInput value={code} onChange={setCode} onComplete={submitMfa} />
              <button className="btn primary block" disabled={busy || code.length !== 6} onClick={() => submitMfa(code)}>
                {busy ? 'Verifying…' : 'Verify'}</button>
              <p className="switch"><a onClick={() => { setErr(''); setView('login') }}>← Back to sign in</a></p>
            </>)}

          {view === 'register' && (
            <>
              <h2>Create account</h2>
              <p className="muted">Join your organisation on the platform.</p>
              <form onSubmit={register}>
                <label>Full name<input value={f.full_name} onChange={set('full_name')} required autoFocus /></label>
                <div className="row">
                  <label>Username<input value={f.username} onChange={set('username')} required /></label>
                  <label>Role<select value={f.role} onChange={set('role')}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                {f.role !== 'patient' && <label>Organisation<input value={f.institution} onChange={set('institution')} placeholder="Hospital or laboratory" /></label>}
                <label>Password<small>At least 10 characters, with letters and numbers</small>
                  <input type="password" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /></label>
                <button className="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
              </form>
              <p className="switch">Already have an account? <a onClick={() => { setErr(''); setView('login') }}>Sign in</a></p>
            </>)}

          {view === 'enroll' && enroll && (
            <div className="enroll">
              <h2>Set up two-step verification</h2>
              <p className="muted">Scan this code with Google Authenticator, Microsoft Authenticator or Authy. You’ll need it each time you sign in.</p>
              <img src={enroll.qr} alt="Authenticator QR code" className="qr" />
              <p className="muted center">Can’t scan? Enter this key instead</p>
              <code className="secret">{enroll.totp_secret}</code>
              <button className="btn primary block" onClick={() => { setView('login'); setF({ ...f, password: '' }) }}>Continue to sign in</button>
            </div>)}
        </div>
      </main>
    </div>
  )
}
