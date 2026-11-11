"""Start the backend over HTTPS (self-signed certificate generated on first run)."""
import datetime
import ipaddress

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.config import CERT_FILE, KEY_FILE


def ensure_cert():
    if CERT_FILE.exists() and KEY_FILE.exists():
        return
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"),
                                                        x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
            .sign(key, hashes.SHA256()))
    KEY_FILE.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


if __name__ == "__main__":
    ensure_cert()
    import seed
    seed.main()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8443,
                ssl_keyfile=str(KEY_FILE), ssl_certfile=str(CERT_FILE))
