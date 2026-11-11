"""Configuration. All secrets are generated on first run into backend/instance/ (git-ignored)."""
import json
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(exist_ok=True)

SECRETS_FILE = INSTANCE_DIR / "secrets.json"
DB_URL = f"sqlite:///{(INSTANCE_DIR / 'health.db').as_posix()}"
CERT_FILE = INSTANCE_DIR / "cert.pem"
KEY_FILE = INSTANCE_DIR / "key.pem"

ACCESS_TOKEN_MINUTES = 15
MFA_TOKEN_MINUTES = 5
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 5
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
JWT_ALG = "HS256"


def _load_secrets() -> dict:
    if SECRETS_FILE.exists():
        return json.loads(SECRETS_FILE.read_text())
    data = {
        "jwt_secret": secrets.token_hex(32),      # HMAC-SHA256 key for JWT
        "master_key": secrets.token_hex(32),      # AES-256 key protecting stored private keys
    }
    SECRETS_FILE.write_text(json.dumps(data))
    return data


_S = _load_secrets()
JWT_SECRET = os.environ.get("JWT_SECRET", _S["jwt_secret"])
MASTER_KEY = bytes.fromhex(_S["master_key"])
