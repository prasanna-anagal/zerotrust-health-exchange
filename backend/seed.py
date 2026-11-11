"""Create the initial accounts and write two PRIVATE files (git-ignored) into backend/instance/:
   demo_credentials.json            usernames, passwords and authenticator keys
   accounts_and_authenticator.html  a page with a QR code per account for Google Authenticator

Authenticator keys are random but kept in demo_credentials.json, so resetting the database does not
force you to re-add the accounts on your phone."""
import base64
import html
import io
import json

import pyotp
import qrcode
from qrcode.image.svg import SvgPathImage

from app.config import INSTANCE_DIR
from app.db import SessionLocal
from app.main import create_user
from app.models import User

# username, full name, role, organisation, password
ACCOUNTS = [
    ("admin", "System Administrator", "admin", "", "Admin@123456"),
    ("dr.rao", "Dr. Anita Rao", "doctor", "City General Hospital", "Rao@123456"),
    ("dr.mehta", "Dr. Vikram Mehta", "doctor", "Metro Heart Institute", "Mehta@123456"),
    ("prakash.s", "Prakash Shetty", "lab", "City General Hospital Lab", "Prakash@123456"),
    ("ramesh.h", "Ramesh Hiremath", "patient", "", "Ramesh@123456"),
]
CRED_FILE = INSTANCE_DIR / "demo_credentials.json"
SETUP_PAGE = INSTANCE_DIR / "accounts_and_authenticator.html"
ROLE = {"admin": "Administrator", "doctor": "Doctor", "lab": "Lab Staff", "patient": "Patient"}


def qr_uri(text: str) -> str:
    buf = io.BytesIO()
    qrcode.make(text, image_factory=SvgPathImage).save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def write_setup_page(creds: dict) -> None:
    cards = []
    for username, name, role, org, _ in ACCOUNTS:
        c = creds[username]
        uri = pyotp.TOTP(c["totp_secret"]).provisioning_uri(name=name, issuer_name=ROLE[role])
        cards.append(f"""<div class="card"><img src="{qr_uri(uri)}" alt="QR for {html.escape(username)}">
<h2>{html.escape(name)}</h2><p class="role">{ROLE[role]}{' · ' + html.escape(org) if org else ''}</p>
<dl><dt>Username</dt><dd>{html.escape(username)}</dd><dt>Password</dt><dd>{html.escape(c['password'])}</dd>
<dt>Setup key</dt><dd class="key">{c['totp_secret']}</dd></dl></div>""")
    SETUP_PAGE.write_text(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accounts and authenticator setup</title><style>
body{{font-family:Segoe UI,system-ui,sans-serif;background:#f5f7fa;color:#101828;margin:0;padding:32px}}
h1{{margin:0 0 6px}}p.sub{{color:#667085;margin:0 0 24px;max-width:760px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}}
.card{{background:#fff;border:1px solid #e4e8ee;border-radius:14px;padding:18px;text-align:center}}
.card img{{width:200px;height:200px;border:1px solid #e4e8ee;border-radius:10px;padding:8px}}
h2{{font-size:16px;margin:10px 0 0}}.role{{color:#667085;margin:2px 0 12px;font-size:13px}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;text-align:left;font-size:13px;margin:0}}dt{{color:#667085}}dd{{margin:0}}
.key{{font-family:Consolas,monospace;word-break:break-all}}</style></head><body>
<h1>Accounts and authenticator setup</h1>
<p class="sub">Private page - do not share or commit. In Google Authenticator tap <b>+</b>, then <b>Scan a QR code</b> and point your phone at a QR below.
Or tap <b>Enter a setup key</b>, type the role and name (for example Doctor: Dr. Anita Rao) as the account name, paste the setup key and choose <b>Time based</b>.</p>
<div class="grid">{''.join(cards)}</div></body></html>""", encoding="utf-8")


def main():
    saved = json.loads(CRED_FILE.read_text()) if CRED_FILE.exists() else {}
    creds = {}
    created = 0
    with SessionLocal() as db:
        for username, name, role, org, pw in ACCOUNTS:
            secret = saved.get(username, {}).get("totp_secret") or pyotp.random_base32()
            creds[username] = {"password": pw, "totp_secret": secret, "role": role}
            if not db.query(User).filter_by(username=username).first():
                u = create_user(db, username, pw, name, role, org)
                u.totp_secret = secret
                db.commit()
                created += 1
    CRED_FILE.write_text(json.dumps(creds, indent=2))
    write_setup_page(creds)
    print(f"Accounts ready ({created} created). Setup page: {SETUP_PAGE}")


if __name__ == "__main__":
    main()
