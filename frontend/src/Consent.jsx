import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { useApp } from './ctx.js'
import { Avatar, Empty, Icon, PageHead, ROLE_LABEL, Skeleton } from './ui.jsx'

export default function Consent() {
  const { toast, refresh } = useApp()
  const [items, setItems] = useState(null)
  const load = useCallback(() => api('/records/pending').then(setItems).catch((e) => { toast(e.message, 'error'); setItems([]) }), [])
  useEffect(() => { load() }, [load])

  const act = async (i, what) => {
    try {
      await api(`/grants/${i.grant_id}/${what}`, { method: 'POST' })
      toast(what === 'approve' ? `${i.recipient.full_name} can now view “${i.title}”` : 'Request declined')
      load(); refresh()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHead title="Requests" sub="Clinicians asking to view your records. Nothing is shared without your approval." />
      {!items ? <Skeleton rows={2} /> : !items.length ? (
        <Empty icon="inbox" title="No pending requests">When someone asks to view one of your records, it will appear here.</Empty>) : (
        <div className="cards one">
          {items.map((i) => (
            <div className="consent-card" key={i.grant_id}>
              <Avatar name={i.recipient.full_name} />
              <div className="consent-body">
                <strong>{i.recipient.full_name}</strong>
                <span className="muted">{ROLE_LABEL[i.recipient.role]}{i.recipient.institution ? ` · ${i.recipient.institution}` : ''}</span>
                <p>is requesting access to <b>“{i.title}”</b>, shared by {i.requested_by}.</p>
              </div>
              <div className="consent-actions">
                <button className="btn primary" onClick={() => act(i, 'approve')}>Approve</button>
                <button className="btn danger" onClick={() => act(i, 'revoke')}>Decline</button>
              </div>
            </div>))}
        </div>)}
    </>)
}
