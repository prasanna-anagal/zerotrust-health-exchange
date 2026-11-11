import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { useApp } from './ctx.js'
import { Badge, Empty, Icon, PageHead, Skeleton, actionLabel, describe, timeAgo } from './ui.jsx'

function Tile({ icon, label, value, tone = '', onClick, hint }) {
  return (
    <button className={`tile ${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="tile-icon"><Icon name={icon} size={20} /></span>
      <span className="tile-val">{value}</span>
      <span className="tile-label">{label}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </button>)
}

export function ActivityList({ rows, empty }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>
  return (
    <ul className="feed">
      {rows.map((r, i) => (
        <li key={i}>
          <span className={`dot ${r.outcome === 'OK' ? 'ok' : 'bad'}`} />
          <div><strong>{describe(r)}</strong><small>{r.actor}</small></div>
          <time>{timeAgo(r.ts)}</time>
        </li>))}
    </ul>)
}

export default function Home() {
  const { user, can, stats, go } = useApp()
  const [records, setRecords] = useState(null)
  const first = user.full_name.replace(/^Dr\.?\s+/, '').replace(/\s*\(.*\)/, '').split(' ')[0]
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { if (can('record:read')) api('/records').then((r) => setRecords(r.slice(0, 5))).catch(() => setRecords([])) }, [])

  return (
    <>
      <PageHead title={`${greet}, ${first}`} sub={{
        patient: 'An overview of your health records and who can see them.',
        admin: 'An overview of activity across the platform.',
      }[user.role] || 'Here’s what’s happening with your records today.'}>
        {can('record:create') && <button className="btn primary" onClick={() => go('records', 'new')}><Icon name="upload" size={16} />Upload record</button>}
      </PageHead>

      {!stats ? <Skeleton rows={2} /> : (
        <>
          <div className="tiles">
            {stats.kind === 'staff' && <>
              <Tile icon="file" label="Records available" value={stats.records} onClick={() => go('records')} />
              <Tile icon="upload" label="Uploaded by you" value={stats.uploaded} onClick={() => go('records')} />
              <Tile icon="share" label="Shared with others" value={stats.shared} />
              <Tile icon="clock" tone={stats.awaiting ? 'warn' : ''} label="Awaiting patient approval" value={stats.awaiting} onClick={() => go('records')} />
            </>}
            {stats.kind === 'patient' && <>
              <Tile icon="file" label="My records" value={stats.records} onClick={() => go('records')} />
              <Tile icon="inbox" tone={stats.pending ? 'warn' : ''} label="Pending requests" value={stats.pending} onClick={() => go('consent')}
                hint={stats.pending ? 'Review now' : ''} />
              <Tile icon="eye" label="Times your records were opened" value={stats.accessed} />
            </>}
            {stats.kind === 'admin' && <>
              <Tile icon="users" label="Users" value={stats.users} onClick={() => go('users')} />
              <Tile icon="file" label="Records" value={stats.records} />
              <Tile icon="alert" tone={stats.denied_24h ? 'warn' : ''} label="Blocked attempts, last 24 h" value={stats.denied_24h} onClick={() => go('audit')} />
              <Tile icon="shield" tone={stats.chain.valid ? 'ok' : 'bad'} label="Activity log status"
                value={stats.chain.valid ? 'Verified' : 'Needs review'} onClick={() => go('audit')} />
            </>}
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head"><h2>{stats.kind === 'admin' ? 'Recent activity' : 'Your recent activity'}</h2>
                {stats.kind === 'admin' && <button className="link" onClick={() => go('audit')}>View all</button>}</div>
              <ActivityList rows={stats.recent} empty="No activity yet." />
            </section>

            {stats.kind === 'admin' ? (
              <section className="card">
                <div className="card-head"><h2>Activity breakdown</h2></div>
                {Object.keys(stats.by_action).length === 0 ? <p className="muted pad">No activity yet.</p> : (
                  <div className="bars">
                    {Object.entries(stats.by_action).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([a, n]) => {
                      const max = Math.max(...Object.values(stats.by_action))
                      return <div key={a} className="bar-row"><span>{actionLabel(a)}</span><div className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></div><b>{n}</b></div>
                    })}
                  </div>)}
              </section>
            ) : (
              <section className="card">
                <div className="card-head"><h2>Recent records</h2><button className="link" onClick={() => go('records')}>View all</button></div>
                {!records ? <Skeleton rows={2} /> : !records.length ? (
                  <p className="muted pad">No records yet.</p>) : (
                  <ul className="mini-list">
                    {records.map((r) => (
                      <li key={r.id}><button onClick={() => go('records', r.id)}>
                        <span className="rec-icon sm"><Icon name="file" size={16} /></span>
                        <span><strong>{r.title}</strong><small>{r.category} · {r.patient}</small></span>
                        {r.grant_status === 'pending' && <Badge tone="warn">Pending</Badge>}
                      </button></li>))}
                  </ul>)}
              </section>)}
          </div>
        </>)}
    </>)
}
