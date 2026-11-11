"""JWT sessions, per-request zero-trust checks, Access Control Matrix and rate limiting."""
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import audit
from .config import ACCESS_TOKEN_MINUTES, JWT_ALG, JWT_SECRET, MFA_TOKEN_MINUTES
from .db import get_db
from .models import AcmEntry, RevokedToken, User

bearer = HTTPBearer(auto_error=False)

ROLES = ["doctor", "lab", "patient", "admin"]
PERMISSIONS = ["record:create", "record:read", "record:share", "consent:manage",
               "user:manage", "audit:read", "acm:read", "acm:edit"]
DEFAULT_ACM = {
    "doctor":  {"record:create", "record:read", "record:share"},
    "lab":     {"record:create", "record:read", "record:share"},
    "patient": {"record:read", "consent:manage"},
    "admin":   {"user:manage", "audit:read", "acm:read", "acm:edit"},
}


def seed_acm(db: Session) -> None:
    if db.query(AcmEntry).count():
        return
    for role in ROLES:
        for perm in PERMISSIONS:
            db.add(AcmEntry(role=role, permission=perm, granted=perm in DEFAULT_ACM[role]))
    db.commit()


def has_permission(db: Session, role: str, permission: str) -> bool:
    e = db.query(AcmEntry).filter_by(role=role, permission=permission).first()
    return bool(e and e.granted)


# ---- JWT (HMAC-SHA256) ----
def make_token(user: User, scope: str) -> str:
    minutes = ACCESS_TOKEN_MINUTES if scope == "access" else MFA_TOKEN_MINUTES
    payload = {
        "sub": str(user.id), "scope": scope, "jti": uuid.uuid4().hex,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str, scope: str, db: Session) -> tuple[User, dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    if payload.get("scope") != scope:
        raise HTTPException(401, "Token not valid for this operation")
    if db.get(RevokedToken, payload["jti"]):
        raise HTTPException(401, "Token revoked")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(401, "Account disabled")
    return user, payload


def _raw(creds: HTTPAuthorizationCredentials | None) -> str:
    if not creds:
        raise HTTPException(401, "Authentication required")
    return creds.credentials


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    """Verified on EVERY request: signature, expiry, scope, revocation, account state."""
    return decode_token(_raw(creds), "access", db)[0]


def mfa_pending_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db)) -> User:
    return decode_token(_raw(creds), "mfa_pending", db)[0]


def require(permission: str):
    """Access Control Matrix enforcement as a route dependency."""
    def dep(user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
        if not has_permission(db, user.role, permission):
            audit.log(db, user.username, "ACCESS_DENIED", permission, "DENIED",
                      f"role {user.role} lacks {permission}")
            raise HTTPException(403, f"Role '{user.role}' is not permitted: {permission}")
        return user
    return dep


# ---- Rate limiting (sliding window, per IP + route) ----
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(limit: int, window: int = 60):
    def dep(request: Request):
        key = f"{request.client.host if request.client else '?'}:{request.url.path}"
        q = _hits[key]
        now = time.monotonic()
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, "Too many requests, slow down")
        q.append(now)
    return dep
