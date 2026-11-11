from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    institution: Mapped[str] = mapped_column(String(100), default="")
    role: Mapped[str] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(255))          # Argon2id
    totp_secret: Mapped[str] = mapped_column(String(64))
    mfa_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)           # RSA-2048 PEM
    private_key_enc: Mapped[bytes] = mapped_column(LargeBinary)      # AES-GCM(master key) of RSA private PEM
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Record(Base):
    __tablename__ = "records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(40))
    filename: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(100))
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    nonce: Mapped[bytes] = mapped_column(LargeBinary)                # 96-bit GCM nonce
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)           # AES-256-GCM (tag appended)
    fingerprint: Mapped[str] = mapped_column(String(64))             # SHA-256 of plaintext
    signature: Mapped[bytes] = mapped_column(LargeBinary)            # RSA-PSS over fingerprint digest
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Grant(Base):
    """One row per (record, user): the AES data key wrapped with that user's RSA public key."""
    __tablename__ = "grants"
    __table_args__ = (UniqueConstraint("record_id", "user_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[str] = mapped_column(ForeignKey("records.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    granted_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    wrapped_dek: Mapped[bytes] = mapped_column(LargeBinary)          # RSA-OAEP(SHA-256); emptied on revoke
    status: Mapped[str] = mapped_column(String(10))                  # pending | active | revoked
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AcmEntry(Base):
    """Access Control Matrix cell: role x permission."""
    __tablename__ = "acm"
    __table_args__ = (UniqueConstraint("role", "permission"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    permission: Mapped[str] = mapped_column(String(40))
    granted: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(60))
    action: Mapped[str] = mapped_column(String(40))
    target: Mapped[str] = mapped_column(String(80))
    outcome: Mapped[str] = mapped_column(String(10))
    detail: Mapped[str] = mapped_column(Text, default="")
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
