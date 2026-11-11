import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { useApp } from './ctx.js'
import { Avatar, Badge, Empty, Icon, Modal, PageHead, ROLE_LABEL, Skeleton, describe, fmtDate, timeAgo } from './ui.jsx'

const CAT = {
  'Lab Report': ['activity', 'teal'], Prescription: ['file', 'violet'], Imaging: ['eye', 'blue'],
  'Discharge Summary': ['building', 'amber'], 'Consultation Note': ['user', 'rose'], Other: ['file', 'slate'],
}
const catTone = (c) => (CAT[c] || CAT.Other)

export function RecordsPage({ initialId }) {
  const { can, refresh } = useApp()
  const [selected, setSelected] = useState(initialId && initialId !== 'new' ? initialId : null)
  const [upload, setUpload] = useState(initialId === 'new')
  const [records, setRecords] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')

  const load = useCallback(() => api('/records').then(setRecords).catch(() => setRecords([])), [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => (records || []).filter((r) =>
    (cat === 'All' || r.category === cat) &&
    `${r.title} ${r.patient} ${r.category} ${r.uploaded_by}`.toLowerCase().includes(q.toLowerCase())), [records, q, cat])
  const cats = useMemo(() => ['All', ...new Set((records || []).map((r) => r.category))], [records])

  if (selected) return <RecordDetail id={selected} onBack={() => { setSelected(null); load(); refresh() }} />

  return (
    <>
      <PageHead title="Records" sub="Patient records you have uploaded or been given access to.">
        {can('record:create') && <button className="btn primary" onClick={() => setUpload(true)}><Icon name="upload" size={16} />Upload record</button>}
      </PageHead>

      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input placeholder="Search records" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search records" /></div>
        <div className="chips">{cats.map((c) => <button key={c} className={c === cat ? 'chip active' : 'chip'} onClick={() => setCat(c)}>{c}</button>)}</div>
      </div>

      {!records ? <Skeleton rows={4} /> : !shown.length ? (
        <Empty icon="file" title={records.length ? 'No matching records' : 'No records yet'}>
          {records.length ? 'Try a different search or filter.' : can('record:create') ? 'Upload a record to get started.' : 'Records shared with you will appear here.'}
        </Empty>) : (
        <div className="cards">
          {shown.map((r) => {
            const [ic, tone] = catTone(r.category)
            return (
              <button key={r.id} className="rec-card" onClick={() => setSelected(r.id)}>
                <span className={`rec-icon ${tone}`}><Icon name={ic} size={20} /></span>
                <span className="rec-body">
                  <strong>{r.title}</strong>
                  <span className="muted">{r.category} · {r.patient}</span>
                  <span className="muted small">{r.uploaded_by}{r.institution ? `, ${r.institution}` : ''} · {timeAgo(r.created_at)}</span>
                </span>
                {r.grant_status === 'pending' && <Badge tone="warn" icon="clock">Pending</Badge>}
              </button>)
          })}
        </div>)}

      {upload && <UploadWizard onClose={() => setUpload(false)} onDone={() => { setUpload(false); load(); refresh() }} />}
    </>)
}

/* ------------------------------------------------------------------ upload */
function UploadWizard({ onClose, onDone }) {
  const { toast } = useApp()
  const [step, setStep] = useState(0)
  const [patients, setPatients] = useState([])
  const [cats, setCats] = useState([])
  const [f, setF] = useState({ title: '', category: 'Lab Report', patient_username: '', notes: '' })
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef()

  useEffect(() => {
    api('/directory').then((d) => setPatients(d.filter((u) => u.role === 'patient')))
    api('/categories').then(setCats)
  }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const patient = patients.find((p) => p.username === f.patient_username)

  const submit = async () => {
    setErr(''); setBusy(true)
    const form = new FormData()
    Object.entries(f).forEach(([k, v]) => form.append(k, v))
    if (file) form.append('file', file)
    try { await api('/records', { method: 'POST', form }); setStep(3); toast('Record uploaded') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Upload record" onClose={onClose} wide>
      <ol className="stepper small">
        {['Details', 'Content', 'Review'].map((s, i) => (
          <li key={s} className={step > i || step === 3 ? 'done' : i === step ? 'current' : ''}>
            <span>{step > i || step === 3 ? <Icon name="check" size={12} /> : i + 1}</span>{s}</li>))}
      </ol>
      {err && <div className="notice error"><Icon name="alert" size={16} />{err}</div>}

      {step === 0 && (
        <div className="modal-body">
          <label>Title<input value={f.title} onChange={set('title')} placeholder="e.g. Complete blood count" autoFocus /></label>
          <div className="row">
            <label>Category<select value={f.category} onChange={set('category')}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Patient<select value={f.patient_username} onChange={set('patient_username')}>
              <option value="">Select a patient</option>
              {patients.map((p) => <option key={p.id} value={p.username}>{p.full_name}</option>)}</select></label>
          </div>
        </div>)}

      {step === 1 && (
        <div className="modal-body">
          <div className={drag ? 'drop over' : 'drop'} onClick={() => input.current.click()} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0] || null) }}>
            <span className="drop-icon"><Icon name="upload" size={22} /></span>
            {file ? <><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · click to replace</span></>
              : <><strong>Drag a file here, or click to browse</strong><span>PDF, image or text · up to 2 MB</span></>}
            <input ref={input} type="file" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
          </div>
          {file ? <button className="btn ghost sm" onClick={() => setFile(null)}>Remove file</button>
            : <label>Or write a note<textarea rows={5} value={f.notes} onChange={set('notes')} placeholder="Findings, diagnosis, prescription…" /></label>}
        </div>)}

      {step === 2 && (
        <div className="modal-body">
          <dl className="summary">
            <dt>Title</dt><dd>{f.title}</dd><dt>Category</dt><dd>{f.category}</dd>
            <dt>Patient</dt><dd>{patient?.full_name}</dd><dt>Content</dt><dd>{file ? file.name : 'Written note'}</dd>
          </dl>
          <p className="muted pad">Only you and the patient will be able to see this record until you share it.</p>
        </div>)}

      {step === 3 && (
        <div className="modal-body center">
          <span className="big-check"><Icon name="check" size={26} /></span>
          <h3>Record uploaded</h3>
          <p className="muted">“{f.title}” has been added for {patient?.full_name}.</p>
        </div>)}

      <div className="modal-foot">
        {step > 0 && step < 3 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <span className="spacer" />
        {step < 2 && <button className="btn primary" disabled={step === 0 ? !(f.title.trim() && f.patient_username) : !(file || f.notes.trim())}
          onClick={() => setStep(step + 1)}>Continue</button>}
        {step === 2 && <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Uploading…' : 'Upload'}</button>}
        {step === 3 && <button className="btn primary" onClick={onDone}>Done</button>}
      </div>
    </Modal>)
}

/* ------------------------------------------------------------------ record view */
const EVENT_ICON = { UPLOAD: 'file', SHARE: 'share', CONSENT_APPROVE: 'check', CONSENT_REVOKE: 'x', VIEW: 'eye', ACCESS_DENIED: 'alert', TAMPER_DETECTED: 'alert' }

function RecordDetail({ id, onBack }) {
  const { user, can, toast, refresh } = useApp()
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [activity, setActivity] = useState([])
  const [doc, setDoc] = useState(null) // {content, signed_by} | {error}
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState(false)

  const load = useCallback(async () => {
    try {
      const det = await api(`/records/${id}`)
      setD(det)
      if (det.grants) setActivity(await api(`/records/${id}/activity`))
    } catch (e) { setErr(e.message) }
  }, [id])
  useEffect(() => { load() }, [load])

  const open = async () => {
    setBusy(true); setDoc(null)
    try {
      const r = await api(`/records/${id}/download`)
      const bytes = Uint8Array.from(atob(r.content_b64), (c) => c.charCodeAt(0))
      setDoc({ signed_by: r.signed_by, content: { filename: r.filename, mime: r.mime, bytes, text: r.mime.startsWith('text/') ? new TextDecoder().decode(bytes) : null } })
    } catch (e) { setDoc({ error: true }) }
    finally { setBusy(false); load() }
  }
  const revoke = async (gid) => {
    try { await api(`/grants/${gid}/revoke`, { method: 'POST' }); toast('Access removed'); load() } catch (e) { toast(e.message, 'error') }
  }
  const save = (c) => {
    const url = URL.createObjectURL(new Blob([c.bytes], { type: c.mime }))
    const a = document.createElement('a'); a.href = url; a.download = c.filename; a.click(); URL.revokeObjectURL(url)
  }
  const imgUrl = useMemo(() => doc?.content?.mime.startsWith('image/') ? URL.createObjectURL(new Blob([doc.content.bytes], { type: doc.content.mime })) : null, [doc])

  if (err) return <><button className="back" onClick={onBack}><Icon name="back" size={16} />Records</button>
    <div className="notice error"><Icon name="alert" size={16} />{err}</div></>
  if (!d) return <Skeleton rows={4} />
  const isPatient = d.patient_username === user.username
  const [ic, tone] = catTone(d.category)

  return (
    <>
      <button className="back" onClick={onBack}><Icon name="back" size={16} />Records</button>
      <div className="record-head">
        <span className={`rec-icon lg ${tone}`}><Icon name={ic} size={26} /></span>
        <div><h1>{d.title}</h1><p>{d.category} · {d.patient} · {fmtDate(d.created_at)}</p></div>
        {d.grant_status !== 'active' && <Badge tone="warn" icon="clock">Pending approval</Badge>}
      </div>

      <div className="detail">
        <div className="detail-main">
          <section className="card">
            <div className="card-head"><h2>Document</h2>
              {doc?.content && <button className="btn ghost sm" onClick={() => save(doc.content)}><Icon name="download" size={14} />Download</button>}</div>
            {d.grant_status !== 'active' ? (
              <div className="notice warn"><Icon name="clock" size={16} />Waiting for the patient to approve your access. You’ll be able to view this record as soon as they do.</div>
            ) : !doc ? (
              <div className="doc-empty">
                <span className="doc-icon"><Icon name="file" size={28} /></span>
                <p className="muted">{d.filename}</p>
                <button className="btn primary" onClick={open} disabled={busy}><Icon name="eye" size={16} />{busy ? 'Opening…' : 'View document'}</button>
              </div>
            ) : doc.error ? (
              <div className="notice error"><Icon name="alert" size={16} />This record could not be verified and may have been altered. It has not been displayed. Please contact your administrator.</div>
            ) : (
              <>
                <div className="verified"><Icon name="check" size={15} />Verified · unchanged since upload by {doc.signed_by}</div>
                <div className="viewer">
                  {doc.content.text !== null ? <pre>{doc.content.text}</pre>
                    : imgUrl ? <img src={imgUrl} alt="" className="preview" />
                    : <p className="muted pad">Preview isn’t available for this file type. Use Download to open it.</p>}
                </div>
              </>)}
          </section>

          {can('record:share') && d.grant_status === 'active' && (
            <section className="card row-card">
              <div><h2>Share this record</h2>
                <p className="muted">{isPatient ? 'Give another clinician access to this record.' : 'Send this record to another clinician. The patient will be asked to approve.'}</p></div>
              <button className="btn" onClick={() => setShare(true)}><Icon name="share" size={16} />Share</button>
            </section>)}
        </div>

        <div className="detail-side">
          <section className="card">
            <div className="card-head"><h2>Details</h2></div>
            <dl className="summary">
              <dt>Patient</dt><dd>{d.patient}</dd>
              <dt>Uploaded by</dt><dd>{d.uploaded_by}{d.institution ? <small>{d.institution}</small> : null}</dd>
              <dt>File</dt><dd>{d.filename}</dd>
              <dt>Uploaded</dt><dd>{fmtDate(d.created_at)}</dd>
            </dl>
          </section>

          {d.grants && (
            <section className="card">
              <div className="card-head"><h2>People with access</h2></div>
              <ul className="people">
                {d.grants.map((g) => (
                  <li key={g.grant_id}>
                    <Avatar name={g.user.full_name} />
                    <div><strong>{g.user.full_name}</strong><small>{ROLE_LABEL[g.user.role]}{g.user.institution ? ` · ${g.user.institution}` : ''}</small></div>
                    {g.status === 'pending' && <Badge tone="warn">Pending</Badge>}
                    {isPatient && can('consent:manage') && g.user.username !== d.patient_username && g.user.username !== d.uploaded_by_username &&
                      <button className="btn danger sm" onClick={() => revoke(g.grant_id)}>Remove</button>}
                  </li>))}
              </ul>
            </section>)}

          {d.grants && (
            <section className="card">
              <div className="card-head"><h2>Activity</h2></div>
              {!activity.length ? <p className="muted">No activity yet.</p> : (
                <ol className="timeline">
                  {activity.map((a, i) => (
                    <li key={i} className={a.outcome === 'OK' ? '' : 'bad'}>
                      <span className="t-dot"><Icon name={EVENT_ICON[a.action] || 'activity'} size={12} /></span>
                      <div><strong>{describe(a, { self: true })}</strong><small>{a.actor} · {fmtDate(a.ts)}</small></div></li>))}
                </ol>)}
            </section>)}
        </div>
      </div>

      {share && <ShareDialog id={id} isPatient={isPatient} onClose={() => setShare(false)} onDone={() => { load(); refresh() }} />}
    </>)
}

/* ------------------------------------------------------------------ share */
function ShareDialog({ id, isPatient, onClose, onDone }) {
  const { user } = useApp()
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api('/directory').then((d) => setPeople(d.filter((u) => u.role !== 'patient' && u.username !== user.username))) }, [])
  const list = people.filter((p) => `${p.full_name} ${p.institution} ${p.role}`.toLowerCase().includes(q.toLowerCase()))

  const send = async () => {
    setErr(''); setBusy(true)
    try { const r = await api(`/records/${id}/share`, { method: 'POST', body: { username: pick.username } }); setOutcome(r.status); onDone() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Share record" onClose={onClose}>
      {err && <div className="notice error"><Icon name="alert" size={16} />{err}</div>}
      {!outcome ? (
        <>
          <div className="modal-body">
            <div className="search"><Icon name="search" size={16} /><input placeholder="Search by name or organisation" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search people" /></div>
            <ul className="pick">
              {list.map((p) => (
                <li key={p.id}><button className={pick?.id === p.id ? 'pick-item active' : 'pick-item'} onClick={() => setPick(p)}>
                  <Avatar name={p.full_name} /><span><strong>{p.full_name}</strong><small>{ROLE_LABEL[p.role]}{p.institution ? ` · ${p.institution}` : ''}</small></span>
                  {pick?.id === p.id && <Icon name="check" size={16} />}</button></li>))}
              {!list.length && <li className="muted pad">No matching people.</li>}
            </ul>
            {!isPatient && <p className="hint">The patient will be asked to approve before the recipient can view this record.</p>}
          </div>
          <div className="modal-foot"><span className="spacer" /><button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!pick || busy} onClick={send}>{busy ? 'Sharing…' : 'Share'}</button></div>
        </>) : (
        <>
          <div className="modal-body center">
            <span className={outcome === 'active' ? 'big-check' : 'big-check warn'}><Icon name={outcome === 'active' ? 'check' : 'clock'} size={26} /></span>
            <h3>{outcome === 'active' ? 'Record shared' : 'Request sent to patient'}</h3>
            <p className="muted">{outcome === 'active' ? `${pick.full_name} can now view this record.` : `${pick.full_name} will be able to view this record once the patient approves.`}</p>
          </div>
          <div className="modal-foot"><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></div>
        </>)}
    </Modal>)
}
