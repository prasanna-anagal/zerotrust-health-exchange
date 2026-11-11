import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { useApp } from './ctx.js'
import { Avatar, Badge, Empty, Icon, Modal, PageHead, PERM_GROUPS, PERM_LABEL, ROLE_LABEL, Skeleton, actionLabel, describe, fmtDate } from './ui.jsx'

/* ------------------------------------------------------------------ users */
export function Users() {
  const { user: me, toast, refresh } = useApp()
  const [users, setUsers] = useState(null)
  const [del, setDel] = useState(null)
  const [q, setQ] = useState('')
  const load = useCallback(() => api('/admin/users').then(setUsers).catch((e) => toast(e.message, 'error')), [])
  useEffect(() => { load() }, [load])
  const act = async (u, a, msg) => {
    try { await api(`/admin/users/${u.id}/${a}`, { method: 'POST' }); toast(msg); load() } catch (e) { toast(e.message, 'error') }
  }
  const askDelete = async (u) => {
    try { setDel({ user: u, impact: await api(`/admin/users/${u.id}/impact`) }) } catch (e) { toast(e.message, 'error') }
  }
  const confirmDelete = async () => {
    try { await api(`/admin/users/${del.user.id}`, { method: 'DELETE' }); toast(`${del.user.full_name} was permanently deleted`); setDel(null); load(); refresh() }
    catch (e) { toast(e.message, 'error') }
  }
  const shown = (users || []).filter((u) => `${u.full_name} ${u.username} ${u.role} ${u.institution}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHead title="Users" sub="Manage who has access to the platform." />
      <div className="toolbar"><div className="search"><Icon name="search" size={16} /><input placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></div></div>
      {!users ? <Skeleton rows={4} /> : (
        <section className="card flush">
          <div className="scroll">
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th>Organisation</th><th>Two-step verification</th><th>Status</th><th /></tr></thead>
              <tbody>{shown.map((u) => (
                <tr key={u.id}>
                  <td><div className="cell-user"><Avatar name={u.full_name} /><div><strong>{u.full_name.replace(/\s*\(.*\)/, '')}</strong><small>@{u.username}</small></div></div></td>
                  <td>{ROLE_LABEL[u.role]}</td><td>{u.institution || <span className="muted">—</span>}</td>
                  <td>{u.mfa ? <Badge tone="ok" icon="check">On</Badge> : <Badge>Not set up</Badge>}</td>
                  <td>{!u.is_active ? <Badge tone="bad">Deactivated</Badge> : u.locked ? <Badge tone="warn" icon="lock">Locked</Badge> : <Badge tone="ok">Active</Badge>}</td>
                  <td className="right">
                    {u.locked && <button className="btn ghost sm" onClick={() => act(u, 'unlock', `${u.username} unlocked`)}>Unlock</button>}
                    {u.id !== me.id && (u.is_active
                      ? <button className="btn danger sm" onClick={() => act(u, 'deactivate', `${u.username} deactivated`)}>Deactivate</button>
                      : <button className="btn ghost sm" onClick={() => act(u, 'activate', `${u.username} reactivated`)}>Reactivate</button>)}
                    {u.id !== me.id && <button className="btn danger sm" onClick={() => askDelete(u)}><Icon name="trash" size={14} />Delete</button>}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>)}
      {del && (
        <Modal title="Delete user permanently?" onClose={() => setDel(null)}>
          <div className="modal-body">
            <div className="who-del"><Avatar name={del.user.full_name} /><div><strong>{del.user.full_name}</strong><small>@{del.user.username} · {ROLE_LABEL[del.user.role]}</small></div></div>
            <p>This removes the account and signs them out immediately.</p>
            {del.impact.records > 0
              ? <div className="notice warn"><Icon name="alert" size={16} /><span>{del.impact.records} record{del.impact.records === 1 ? '' : 's'} linked to this person will also be permanently deleted
                ({del.impact.uploaded} uploaded by them, {del.impact.as_patient} belonging to them as a patient), along with all sharing of those records.</span></div>
              : <p className="muted">No records are linked to this account.</p>}
            <p className="muted">Their past entries in the activity log are kept. <b>This cannot be undone.</b></p>
          </div>
          <div className="modal-foot"><span className="spacer" /><button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger solid" onClick={confirmDelete}><Icon name="trash" size={15} />Delete permanently</button></div>
        </Modal>)}
    </>)
}

/* ------------------------------------------------------------------ permissions */
const ROLE_NOTE = { doctor: 'Clinician', lab: 'Diagnostics', patient: 'Record owner', admin: 'Platform operator' }

export function Permissions() {
  const { can, toast } = useApp()
  const edit = can('acm:edit')
  const [acm, setAcm] = useState(null)
  const load = useCallback(() => api('/acm').then(setAcm).catch((e) => toast(e.message, 'error')), [])
  useEffect(() => { load() }, [load])
  const toggle = async (role, perm, granted) => {
    try {
      await api('/acm', { method: 'PUT', body: { role, permission: perm, granted } })
      toast(`${PERM_LABEL[perm][0]} ${granted ? 'allowed' : 'blocked'} for ${ROLE_LABEL[role]}`); load()
    } catch (e) { toast(e.message, 'error') }
  }
  if (!acm) return <><PageHead title="Permissions" /><Skeleton rows={5} /></>
  const perms = PERM_GROUPS.flatMap(([, ps]) => ps)
  return (
    <>
      <PageHead title="Permissions" sub="Choose what each role is allowed to do.">
        <div className="legend"><span><i className="lg on" />Allowed</span><span><i className="lg off" />Not allowed</span></div>
      </PageHead>
      <section className="card flush">
        <div className="scroll">
          <table className="matrix">
            <thead>
              <tr><th rowSpan={2} className="corner">Role</th>
                {PERM_GROUPS.map(([g, ps]) => <th key={g} colSpan={ps.length} className="group">{g}</th>)}</tr>
              <tr>{perms.map((p) => <th key={p} title={PERM_LABEL[p][1]}>{PERM_LABEL[p][0]}</th>)}</tr>
            </thead>
            <tbody>
              {acm.roles.map((r) => (
                <tr key={r}>
                  <th className="role"><strong>{ROLE_LABEL[r]}</strong><small>{ROLE_NOTE[r]}</small></th>
                  {perms.map((p) => {
                    const on = acm.matrix[r][p]
                    return <td key={p}><button className={on ? 'cell on' : 'cell off'} disabled={!edit}
                      aria-label={`${ROLE_LABEL[r]}: ${PERM_LABEL[p][0]} — ${on ? 'allowed' : 'not allowed'}`}
                      title={`${PERM_LABEL[p][1]}${edit ? ' — click to change' : ''}`}
                      onClick={() => toggle(r, p, !on)}><Icon name={on ? 'check' : 'x'} size={16} /></button></td>
                  })}
                </tr>))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted pad">{edit ? 'Click a cell to change a permission. Changes apply immediately.' : 'You have view-only access to this page.'}</p>
    </>)
}

/* ------------------------------------------------------------------ activity log */
export function AuditLog() {
  const { toast } = useApp()
  const [rows, setRows] = useState(null)
  const [chain, setChain] = useState(null)
  const [checking, setChecking] = useState(false)
  const [q, setQ] = useState('')
  const [onlyDenied, setOnlyDenied] = useState(false)
  const load = useCallback(() => api('/audit?limit=500').then(setRows).catch((e) => toast(e.message, 'error')), [])
  useEffect(() => { load() }, [load])

  const verify = async () => {
    setChecking(true); setChain(null)
    try { const [r] = await Promise.all([api('/audit/verify'), new Promise((res) => setTimeout(res, 700))]); setChain(r) }
    catch (e) { toast(e.message, 'error') } finally { setChecking(false) }
  }
  const shown = useMemo(() => (rows || []).filter((r) => (!onlyDenied || r.outcome !== 'OK') &&
    `${r.actor} ${actionLabel(r.action)} ${describe(r)}`.toLowerCase().includes(q.toLowerCase())), [rows, q, onlyDenied])

  return (
    <>
      <PageHead title="Activity log" sub="A complete, tamper-proof record of who did what, and when.">
        <button className="btn ghost" onClick={load}>Refresh</button>
        <button className="btn primary" onClick={verify} disabled={checking}><Icon name="shield" size={16} />{checking ? 'Checking…' : 'Check log integrity'}</button>
      </PageHead>

      {checking && <div className="notice info"><span className="spinner" />Checking every entry…</div>}
      {chain && <div className={`notice ${chain.valid ? 'success' : 'error'}`}>
        <Icon name={chain.valid ? 'check' : 'alert'} size={16} />
        {chain.valid ? 'All entries are intact. No changes or deletions detected.' : `Entry #${chain.broken_at} does not match its original record. The log may have been altered.`}</div>}

      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input placeholder="Search activity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" /></div>
        <button className={onlyDenied ? 'chip active' : 'chip'} onClick={() => setOnlyDenied(!onlyDenied)}><Icon name="alert" size={13} />Blocked only</button>
      </div>

      {!rows ? <Skeleton rows={5} /> : !shown.length ? <Empty icon="activity" title="No matching activity">Try a different search.</Empty> : (
        <section className="card flush">
          <div className="scroll">
            <table className="table compact">
              <thead><tr><th>Time</th><th>User</th><th>Activity</th><th>Result</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap muted">{fmtDate(r.ts)}</td><td><strong>{r.actor}</strong></td>
                  <td>{describe(r)}</td>
                  <td><Badge tone={r.outcome === 'OK' ? 'ok' : 'bad'}>{r.outcome === 'OK' ? 'Completed' : 'Blocked'}</Badge></td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>)}
    </>)
}
