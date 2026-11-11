"""Cryptographic primitives used by the pipeline.

  AES-256-GCM        record encryption (confidentiality + integrity)
  RSA-2048 OAEP      wraps the per-record AES key for each authorised user
  RSA-PSS            digital signature by the uploader over the record digest
  SHA-256            record fingerprint and audit-log chain
  Argon2id           password hashing
"""
import hashlib
import os

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import MASTER_KEY

_ph = PasswordHasher()  # Argon2id, library defaults


# ---- Argon2id ----
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


# ---- SHA-256 ----
def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---- AES-256-GCM ----
def new_dek() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def aes_encrypt(dek: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)  # fresh 96-bit nonce per encryption
    return nonce, AESGCM(dek).encrypt(nonce, plaintext, aad)


def aes_decrypt(dek: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes | None:
    """Returns None if the GCM tag fails (ciphertext or AAD tampered)."""
    try:
        return AESGCM(dek).decrypt(nonce, ciphertext, aad)
    except InvalidTag:
        return None


# ---- RSA keys ----
def generate_keypair() -> tuple[bytes, bytes]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return pub, protect_private_key(priv)


def protect_private_key(priv_pem: bytes) -> bytes:
    """Private keys at rest are AES-256-GCM encrypted under the server master key."""
    nonce, ct = aes_encrypt(MASTER_KEY, priv_pem, b"user-private-key")
    return nonce + ct


def _load_private(priv_enc: bytes):
    pem = aes_decrypt(MASTER_KEY, priv_enc[:12], priv_enc[12:], b"user-private-key")
    if pem is None:
        raise ValueError("private key store corrupted")
    return serialization.load_pem_private_key(pem, password=None)


_OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
_PSS = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH)


def wrap_key(pub_pem: bytes, dek: bytes) -> bytes:
    return serialization.load_pem_public_key(pub_pem).encrypt(dek, _OAEP)


def unwrap_key(priv_enc: bytes, wrapped: bytes) -> bytes:
    return _load_private(priv_enc).decrypt(wrapped, _OAEP)


def sign_digest(priv_enc: bytes, digest_hex: str) -> bytes:
    return _load_private(priv_enc).sign(bytes.fromhex(digest_hex), _PSS, hashes.SHA256())


def verify_signature(pub_pem: bytes, digest_hex: str, signature: bytes) -> bool:
    try:
        serialization.load_pem_public_key(pub_pem).verify(
            signature, bytes.fromhex(digest_hex), _PSS, hashes.SHA256()
        )
        return True
    except InvalidSignature:
        return False
