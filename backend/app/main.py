"""Zero-Trust Secure Health Data Exchange Pipeline - FastAPI backend."""
import base64
import io
import re
import uuid
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from qrcode.image.svg import SvgPathImage
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import audit, crypto
from .config import LOCKOUT_MINUTES, MAX_FAILED_LOGINS, MAX_UPLOAD_BYTES
from .db import Base, SessionLocal, engine, get_db
from .models import AcmEntry, AuditLog, Grant, Record, RevokedToken, User
from .security import (PERMISSIONS, ROLES, bearer, current_user, decode_token, has_permission,
                       make_token, mfa_pending_user, rate_limit, require, seed_acm)

Base.metadata.create_all(engine)
with SessionLocal() as _db:
    seed_acm(_db)

app = FastAPI(title="Zero-Trust Secure Health Data Exchange")

SELF_REGISTER_ROLES = {"doctor", "lab", "patient"}
CATEGORIES = ["Lab Report", "Prescription", "Imaging", "Discharge Summary", "Consultation Note", "Other"]


# ------------------------------------------------------------------ schemas
class RegisterIn(BaseModel):
    username: str
    password: str
    full_name: str
    role: str
    institution: str = ""


class LoginIn(BaseModel):
    username: str
    password: str


class MfaIn(BaseModel):
    code: str


class ShareIn(BaseModel):
    username: str


class AcmIn(BaseModel):
    role: str
    permission: str
    granted: bool


def user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name,
            "role": u.role, "institution": u.institution}


def qr_data_uri(uri: str) -> str:
    buf = io.BytesIO()
    qrcode.make(uri, image_factory=SvgPathImage).save(buf)   # pure-python SVG, no Pillow needed
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


# ------------------------------------------------------------------ auth
@app.post("/api/auth/register", dependencies=[Depends(rate_limit(10))])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if body.role not in SELF_REGISTER_ROLES:
        raise HTTPException(400, "Role not available for self-registration")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", body.username):
        raise HTTPException(400, "Username: 3-40 letters, digits, _ . -")
    if len(body.password) < 10 or not re.search(r"[A-Za-z]", body.password) or not re.search(r"\d", body.password):
        raise HTTPException(400, "Password must be 10+ characters with letters and digits")
    if not body.full_name.strip():
        raise HTTPException(400, "Full name required")
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(400, "Username already taken")
    user = create_user(db, body.username, body.password, body.full_name.strip(), body.role, body.institution.strip())
    audit.log(db, user.username, "REGISTER", user.username, "OK", f"role={user.role}")
    uri = pyotp.TOTP(user.totp_secret).provisioning_uri(name=user.full_name, issuer_name={"doctor": "Doctor", "lab": "Lab Staff", "patient": "Patient"}.get(user.role, "Account"))
    return {"username": user.username, "totp_secret": user.totp_secret, "qr": qr_data_uri(uri)}


def create_user(db: Session, username: str, password: str, full_name: str, role: str, institution: str) -> User:
    pub, priv_enc = crypto.generate_keypair()
    user = User(username=username, full_name=full_name, institution=institution, role=role,
                password_hash=crypto.hash_password(password), totp_secret=pyotp.random_base32(),
                public_key=pub, private_key_enc=priv_enc)
    db.add(user)
    db.commit()
    return user


@app.post("/api/auth/login", dependencies=[Depends(rate_limit(15))])
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username).first()
    now = datetime.now(timezone.utc)
    if user and user.locked_until:
        locked = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if locked > now:
            audit.log(db, body.username, "LOGIN", "", "DENIED", "account locked")
            raise HTTPException(423, "Account temporarily locked after repeated failures")
    if not user or not user.is_active or not crypto.verify_password(body.password, user.password_hash):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_logins = 0
            db.commit()
        audit.log(db, body.username[:40], "LOGIN", "", "DENIED", "bad credentials")
        raise HTTPException(401, "Invalid credentials")
    return {"mfa_token": make_token(user, "mfa_pending"), "mfa_enrolled": user.mfa_confirmed}


@app.post("/api/auth/mfa", dependencies=[Depends(rate_limit(15))])
def verify_mfa(body: MfaIn, user: User = Depends(mfa_pending_user), db: Session = Depends(get_db)):
    if not pyotp.TOTP(user.totp_secret).verify(body.code.strip(), valid_window=1):
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_logins = 0
        db.commit()
        audit.log(db, user.username, "MFA", "", "DENIED", "bad TOTP code")
        raise HTTPException(401, "Invalid MFA code")
    user.failed_logins = 0
    user.mfa_confirmed = True
    db.commit()
    audit.log(db, user.username, "LOGIN", "", "OK", "password + TOTP")
    return {"token": make_token(user, "access"), "user": user_out(user)}


@app.post("/api/auth/logout")
def logout(creds=Depends(bearer), user: User = Depends(current_user), db: Session = Depends(get_db)):
    _, payload = decode_token(creds.credentials, "access", db)
    db.add(RevokedToken(jti=payload["jti"]))
    db.commit()
    audit.log(db, user.username, "LOGOUT", "", "OK")
    return {"ok": True}


@app.get("/api/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    perms = [p for p in PERMISSIONS if has_permission(db, user.role, p)]
    return {**user_out(user), "permissions": perms}


@app.get("/api/directory")
def directory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Users that can be selected as patient / share recipient (admins excluded)."""
    users = db.query(User).filter(User.is_active.is_(True), User.role != "admin").order_by(User.username).all()
    return [user_out(u) for u in users]


# ------------------------------------------------------------------ records
def _grant_for(db: Session, record_id: str, user_id: int) -> Grant | None:
    return db.query(Grant).filter_by(record_id=record_id, user_id=user_id).first()


def _record_or_404(db: Session, record_id: str) -> Record:
    rec = db.get(Record, record_id)
    if not rec:
        raise HTTPException(404, "Record not found")
    return rec


def _deny(db: Session, user: User, rec_id: str, why: str):
    audit.log(db, user.username, "ACCESS_DENIED", rec_id, "DENIED", why)
    raise HTTPException(403, why)


def record_out(db: Session, rec: Record, grant: Grant | None) -> dict:
    patient, owner = db.get(User, rec.patient_id), db.get(User, rec.owner_id)
    return {"id": rec.id, "title": rec.title, "category": rec.category, "filename": rec.filename,
            "mime": rec.mime, "patient": patient.full_name, "patient_username": patient.username,
            "uploaded_by": owner.full_name, "uploaded_by_username": owner.username, "institution": owner.institution,
            "created_at": rec.created_at.isoformat(), "fingerprint": rec.fingerprint,
            "grant_status": grant.status if grant else None}


@app.get("/api/categories")
def categories(user: User = Depends(current_user)):
    return CATEGORIES


@app.post("/api/records")
async def upload_record(title: str = Form(...), category: str = Form(...), patient_username: str = Form(...),
                        notes: str = Form(""), file: UploadFile | None = File(None),
                        user: User = Depends(require("record:create")), db: Session = Depends(get_db)):
    patient = db.query(User).filter_by(username=patient_username, role="patient", is_active=True).first()
    if not patient:
        raise HTTPException(400, "Patient not found")
    if category not in CATEGORIES:
        raise HTTPException(400, "Unknown category")
    if file is not None and file.filename:
        data, filename, mime = await file.read(MAX_UPLOAD_BYTES + 1), file.filename, file.content_type or "application/octet-stream"
    else:
        data, filename, mime = notes.encode(), "note.txt", "text/plain"
    if not data:
        raise HTTPException(400, "Empty record")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (2 MB max)")

    rec_id = str(uuid.uuid4())
    dek = crypto.new_dek()
    nonce, ct = crypto.aes_encrypt(dek, data, rec_id.encode())         # AES-256-GCM, record id as AAD
    fingerprint = crypto.sha256_hex(data)                               # SHA-256
    signature = crypto.sign_digest(user.private_key_enc, fingerprint)   # RSA-PSS by uploader

    rec = Record(id=rec_id, title=title.strip()[:200], category=category, filename=filename[:200], mime=mime[:100],
                 patient_id=patient.id, owner_id=user.id, nonce=nonce, ciphertext=ct,
                 fingerprint=fingerprint, signature=signature)
    db.add(rec)
    db.add(Grant(record_id=rec_id, user_id=user.id, granted_by=user.id,
                 wrapped_dek=crypto.wrap_key(user.public_key, dek), status="active"))
    if patient.id != user.id:
        db.add(Grant(record_id=rec_id, user_id=patient.id, granted_by=user.id,
                     wrapped_dek=crypto.wrap_key(patient.public_key, dek), status="active"))
    db.commit()
    audit.log(db, user.username, "UPLOAD", rec_id, "OK", f"patient={patient.username} sha256={fingerprint[:16]}")
    return record_out(db, rec, _grant_for(db, rec_id, user.id))


@app.get("/api/records")
def list_records(user: User = Depends(require("record:read")), db: Session = Depends(get_db)):
    grants = db.query(Grant).filter(Grant.user_id == user.id, Grant.status != "revoked").all()
    out = []
    for g in grants:
        rec = db.get(Record, g.record_id)
        out.append(record_out(db, rec, g))
    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out


@app.get("/api/records/pending")
def pending_consents(user: User = Depends(require("consent:manage")), db: Session = Depends(get_db)):
    """Share requests on this patient's records awaiting consent."""
    out = []
    for rec in db.query(Record).filter_by(patient_id=user.id).all():
        for g in db.query(Grant).filter_by(record_id=rec.id, status="pending").all():
            target, by = db.get(User, g.user_id), db.get(User, g.granted_by)
            out.append({"grant_id": g.id, "record_id": rec.id, "title": rec.title,
                        "recipient": user_out(target), "requested_by": by.full_name})
    return out


@app.get("/api/records/{record_id}")
def record_detail(record_id: str, user: User = Depends(require("record:read")), db: Session = Depends(get_db)):
    rec = _record_or_404(db, record_id)
    g = _grant_for(db, record_id, user.id)
    if not g or g.status == "revoked":
        _deny(db, user, record_id, "No access grant for this record")
    detail = record_out(db, rec, g)
    if user.id in (rec.patient_id, rec.owner_id):
        grants = db.query(Grant).filter_by(record_id=record_id).all()
        detail["grants"] = [{"grant_id": x.id, "user": user_out(db.get(User, x.user_id)),
                             "granted_by": db.get(User, x.granted_by).username, "status": x.status}
                            for x in grants if x.status != "revoked"]
    return detail


@app.get("/api/records/{record_id}/download")
def download(record_id: str, user: User = Depends(require("record:read")), db: Session = Depends(get_db)):
    rec = _record_or_404(db, record_id)
    g = _grant_for(db, record_id, user.id)
    if not g or g.status == "revoked":
        _deny(db, user, record_id, "No access grant for this record")
    if g.status != "active":
        _deny(db, user, record_id, "Patient consent pending for your access")

    dek = crypto.unwrap_key(user.private_key_enc, g.wrapped_dek)
    plaintext = crypto.aes_decrypt(dek, rec.nonce, rec.ciphertext, rec.id.encode())
    if plaintext is None:
        audit.log(db, user.username, "TAMPER_DETECTED", record_id, "DENIED", "AES-GCM authentication tag failed")
        raise HTTPException(409, {"message": "Integrity check failed: stored record was modified",
                                  "checks": {"gcm": False, "fingerprint": False, "signature": False}})
    fp_ok = crypto.sha256_hex(plaintext) == rec.fingerprint
    signer = db.get(User, rec.owner_id)
    sig_ok = fp_ok and crypto.verify_signature(signer.public_key, rec.fingerprint, rec.signature)
    audit.log(db, user.username, "VIEW", record_id, "OK" if (fp_ok and sig_ok) else "DENIED",
              f"gcm=ok fingerprint={fp_ok} signature={sig_ok}")
    if not (fp_ok and sig_ok):
        raise HTTPException(409, {"message": "Fingerprint or signature verification failed",
                                  "checks": {"gcm": True, "fingerprint": fp_ok, "signature": sig_ok}})
    return {"filename": rec.filename, "mime": rec.mime, "content_b64": base64.b64encode(plaintext).decode(),
            "checks": {"gcm": True, "fingerprint": True, "signature": True},
            "fingerprint": rec.fingerprint, "signed_by": signer.full_name}


@app.post("/api/records/{record_id}/share")
def share(record_id: str, body: ShareIn, user: User = Depends(require("record:share")),
          db: Session = Depends(get_db)):
    rec = _record_or_404(db, record_id)
    g = _grant_for(db, record_id, user.id)
    if not g or g.status != "active":
        _deny(db, user, record_id, "You do not hold active access to this record")
    target = db.query(User).filter_by(username=body.username, is_active=True).first()
    if not target or not has_permission(db, target.role, "record:read") or target.id == user.id:
        raise HTTPException(400, "Invalid recipient")
    existing = _grant_for(db, record_id, target.id)
    if existing and existing.status != "revoked":
        raise HTTPException(400, "Recipient already has access (or a pending request)")
    dek = crypto.unwrap_key(user.private_key_enc, g.wrapped_dek)
    wrapped = crypto.wrap_key(target.public_key, dek)           # re-wrap for the recipient (RSA-OAEP)
    # The patient shares immediately; anyone else needs the patient's consent.
    status = "active" if user.id == rec.patient_id else "pending"
    if existing:
        existing.wrapped_dek, existing.status, existing.granted_by = wrapped, status, user.id
    else:
        db.add(Grant(record_id=record_id, user_id=target.id, granted_by=user.id, wrapped_dek=wrapped, status=status))
    db.commit()
    audit.log(db, user.username, "SHARE", record_id, "OK", f"to={target.username} status={status}")
    return {"status": status}


def _patient_grant(db: Session, grant_id: int, user: User) -> tuple[Grant, Record]:
    g = db.get(Grant, grant_id)
    rec = db.get(Record, g.record_id) if g else None
    if not g or not rec:
        raise HTTPException(404, "Grant not found")
    if rec.patient_id != user.id:
        _deny(db, user, rec.id, "Only the record's patient can manage consent")
    return g, rec


@app.post("/api/grants/{grant_id}/approve")
def approve(grant_id: int, user: User = Depends(require("consent:manage")), db: Session = Depends(get_db)):
    g, rec = _patient_grant(db, grant_id, user)
    if g.status != "pending":
        raise HTTPException(400, "Grant is not pending")
    g.status = "active"
    db.commit()
    audit.log(db, user.username, "CONSENT_APPROVE", rec.id, "OK", f"user_id={g.user_id}")
    return {"ok": True}


@app.post("/api/grants/{grant_id}/revoke")
def revoke(grant_id: int, user: User = Depends(require("consent:manage")), db: Session = Depends(get_db)):
    g, rec = _patient_grant(db, grant_id, user)
    if g.user_id in (rec.patient_id, rec.owner_id):
        raise HTTPException(400, "Cannot revoke the patient's or uploader's own access")
    g.status, g.wrapped_dek = "revoked", b""           # wrapped key destroyed
    db.commit()
    audit.log(db, user.username, "CONSENT_REVOKE", rec.id, "OK", f"user_id={g.user_id}")
    return {"ok": True}


@app.get("/api/records/{record_id}/activity")
def record_activity(record_id: str, user: User = Depends(require("record:read")), db: Session = Depends(get_db)):
    rec = _record_or_404(db, record_id)
    if user.id not in (rec.patient_id, rec.owner_id):
        _deny(db, user, record_id, "Only the patient or uploader can view record activity")
    rows = db.query(AuditLog).filter_by(target=record_id).order_by(AuditLog.id.desc()).limit(50).all()
    return [{"ts": r.ts, "actor": r.actor, "action": r.action, "outcome": r.outcome, "detail": r.detail}
            for r in rows]


# ------------------------------------------------------------------ admin
@app.get("/api/admin/users")
def admin_users(user: User = Depends(require("user:manage")), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    out = []
    for u in db.query(User).order_by(User.id).all():
        locked = bool(u.locked_until and (u.locked_until if u.locked_until.tzinfo
                                          else u.locked_until.replace(tzinfo=timezone.utc)) > now)
        out.append({**user_out(u), "is_active": u.is_active, "locked": locked, "mfa": u.mfa_confirmed})
    return out


@app.post("/api/admin/users/{user_id}/{action}")
def admin_user_action(user_id: int, action: str, admin: User = Depends(require("user:manage")),
                      db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or action not in ("deactivate", "activate", "unlock"):
        raise HTTPException(404, "Not found")
    if target.id == admin.id and action == "deactivate":
        raise HTTPException(400, "You cannot deactivate yourself")
    if action == "deactivate":
        target.is_active = False
    elif action == "activate":
        target.is_active = True
    else:
        target.locked_until, target.failed_logins = None, 0
    db.commit()
    audit.log(db, admin.username, f"ADMIN_{action.upper()}", target.username, "OK")
    return {"ok": True}


def _user_records(db: Session, target: User) -> tuple[set, int, int]:
    owned = db.query(Record).filter_by(owner_id=target.id).all()
    as_patient = db.query(Record).filter_by(patient_id=target.id).all()
    return {r.id for r in owned} | {r.id for r in as_patient}, len(owned), len(as_patient)


@app.get("/api/admin/users/{user_id}/impact")
def user_impact(user_id: int, admin: User = Depends(require("user:manage")), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Not found")
    ids, uploaded, as_patient = _user_records(db, target)
    return {"username": target.username, "full_name": target.full_name, "uploaded": uploaded,
            "as_patient": as_patient, "records": len(ids)}


@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require("user:manage")), db: Session = Depends(get_db)):
    """Permanently remove a user and everything tied to them. The activity log keeps its history."""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Not found")
    if target.id == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    ids, _, _ = _user_records(db, target)
    if ids:
        db.query(Grant).filter(Grant.record_id.in_(ids)).delete(synchronize_session=False)
        db.query(Record).filter(Record.id.in_(ids)).delete(synchronize_session=False)
    db.query(Grant).filter((Grant.user_id == target.id) | (Grant.granted_by == target.id)).delete(synchronize_session=False)
    db.delete(target)
    db.commit()
    audit.log(db, admin.username, "ADMIN_DELETE", target.username, "OK", f"records_removed={len(ids)}")
    return {"ok": True, "records_removed": len(ids)}


@app.get("/api/acm")
def get_acm(user: User = Depends(require("acm:read")), db: Session = Depends(get_db)):
    cells = {(e.role, e.permission): e.granted for e in db.query(AcmEntry).all()}
    return {"roles": ROLES, "permissions": PERMISSIONS,
            "matrix": {r: {p: cells.get((r, p), False) for p in PERMISSIONS} for r in ROLES}}


@app.put("/api/acm")
def set_acm(body: AcmIn, user: User = Depends(require("acm:edit")), db: Session = Depends(get_db)):
    if body.role not in ROLES or body.permission not in PERMISSIONS:
        raise HTTPException(400, "Unknown role or permission")
    if body.role == "admin" and body.permission in ("acm:edit", "acm:read") and not body.granted:
        raise HTTPException(400, "Admin cannot remove its own matrix access")
    cell = db.query(AcmEntry).filter_by(role=body.role, permission=body.permission).first()
    cell.granted = body.granted
    db.commit()
    audit.log(db, user.username, "ACM_CHANGE", f"{body.role}:{body.permission}", "OK", f"granted={body.granted}")
    return {"ok": True}


@app.get("/api/audit")
def get_audit(limit: int = 200, user: User = Depends(require("audit:read")), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000)).all()
    titles = _titles(db, rows)
    return [{"id": r.id, "ts": r.ts, "actor": r.actor, "action": r.action, "target": r.target,
             "outcome": r.outcome, "detail": r.detail, "record_title": titles.get(r.target)} for r in rows]


@app.get("/api/audit/verify")
def verify_audit(user: User = Depends(require("audit:read")), db: Session = Depends(get_db)):
    return audit.verify_chain(db)


# ------------------------------------------------------------------ dashboards
def _titles(db: Session, rows) -> dict:
    ids = {r.target for r in rows if len(r.target) == 36}
    return {rec.id: rec.title for rec in db.query(Record).filter(Record.id.in_(ids or [""])).all()}


def _audit_row(r: AuditLog, titles: dict) -> dict:
    return {"ts": r.ts, "actor": r.actor, "action": r.action, "target": r.target, "outcome": r.outcome,
            "detail": r.detail, "record_title": titles.get(r.target)}


@app.get("/api/stats")
def stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Role-aware numbers for the Home dashboard."""
    if has_permission(db, user.role, "audit:read"):
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
        recent = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(300).all()
        by_action: dict[str, int] = {}
        for r in recent:
            by_action[r.action] = by_action.get(r.action, 0) + 1
        return {"kind": "admin", "users": db.query(User).count(), "records": db.query(Record).count(),
                "denied_24h": db.query(AuditLog).filter(AuditLog.outcome == "DENIED", AuditLog.ts >= since).count(),
                "chain": audit.verify_chain(db), "by_action": by_action,
                "recent": [_audit_row(r, _titles(db, recent[:8])) for r in recent[:8]]}
    mine = db.query(Grant).filter(Grant.user_id == user.id, Grant.status != "revoked").all()
    recent = db.query(AuditLog).filter_by(actor=user.username).order_by(AuditLog.id.desc()).limit(8).all()
    base = {"recent": [_audit_row(r, _titles(db, recent)) for r in recent]}
    if has_permission(db, user.role, "consent:manage"):
        my_ids = [r.id for r in db.query(Record).filter_by(patient_id=user.id).all()]
        pending = db.query(Grant).filter(Grant.record_id.in_(my_ids or [""]), Grant.status == "pending").count()
        views = db.query(AuditLog).filter(AuditLog.action == "VIEW", AuditLog.target.in_(my_ids or [""]),
                                          AuditLog.actor != user.username).count()
        return {"kind": "patient", "records": len(my_ids), "pending": pending, "accessed": views, **base}
    pending_mine = sum(1 for g in mine if g.status == "pending")
    uploaded = db.query(Record).filter_by(owner_id=user.id).count()
    shared_out = db.query(Grant).filter(Grant.granted_by == user.id, Grant.user_id != user.id).count()
    return {"kind": "staff", "records": len([g for g in mine if g.status == "active"]),
            "awaiting": pending_mine, "uploaded": uploaded, "shared": shared_out, **base}
