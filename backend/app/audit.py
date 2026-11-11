"""Tamper-evident audit log: every entry stores SHA-256(prev_hash | fields)."""
import threading
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .crypto import sha256_hex
from .models import AuditLog

_lock = threading.Lock()
GENESIS = "0" * 64


def _entry_hash(prev: str, ts: str, actor: str, action: str, target: str, outcome: str, detail: str) -> str:
    return sha256_hex("|".join([prev, ts, actor, action, target, outcome, detail]).encode())


def log(db: Session, actor: str, action: str, target: str = "", outcome: str = "OK", detail: str = "") -> None:
    with _lock:
        last = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
        prev = last.hash if last else GENESIS
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
        h = _entry_hash(prev, ts, actor, action, target, outcome, detail)
        db.add(AuditLog(ts=ts, actor=actor, action=action, target=target, outcome=outcome,
                        detail=detail, prev_hash=prev, hash=h))
        db.commit()


def verify_chain(db: Session) -> dict:
    prev = GENESIS
    for e in db.query(AuditLog).order_by(AuditLog.id).all():
        expected = _entry_hash(e.prev_hash, e.ts, e.actor, e.action, e.target, e.outcome, e.detail)
        if e.prev_hash != prev or e.hash != expected:
            return {"valid": False, "broken_at": e.id}
        prev = e.hash
    return {"valid": True, "broken_at": None}
