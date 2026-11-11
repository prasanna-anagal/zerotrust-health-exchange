"""End-to-end check against the running HTTPS backend (python run.py must be running).
Run: .venv/Scripts/python.exe e2e_test.py"""
import base64
import json
import sqlite3
import sys

import pyotp
import requests
import urllib3

from app.config import INSTANCE_DIR

urllib3.disable_warnings()
BASE = "https://127.0.0.1:8443/api"
CREDS = json.loads((INSTANCE_DIR / "demo_credentials.json").read_text())
DB = INSTANCE_DIR / "health.db"
failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


def call(method, path, token=None, **kw):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return requests.request(method, BASE + path, headers=h, verify=False, **kw)


def login(username):
    c = CREDS[username]
    r = call("POST", "/auth/login", json={"username": username, "password": c["password"]})
    assert r.status_code == 200, r.text
    r2 = call("POST", "/auth/mfa", r.json()["mfa_token"], json={"code": pyotp.TOTP(c["totp_secret"]).now()})
    assert r2.status_code == 200, r2.text
    return r2.json()["token"]


# --- registration -> password + TOTP login
r = call("POST", "/auth/register", json={"username": "e2e_user", "password": "S3cure-pass-99", "full_name": "E2E",
                                        "role": "doctor", "institution": "Test"}) \
    if not sqlite3.connect(DB).execute("select 1 from users where username='e2e_user'").fetchone() else None
if r is not None:
    check("register returns TOTP secret + QR", r.status_code == 200 and r.json().get("qr", "").startswith("data:image"))
    CREDS["e2e_user"] = {"password": "S3cure-pass-99", "totp_secret": r.json()["totp_secret"]}
r = call("POST", "/auth/login", json={"username": "dr.rao", "password": "wrong-password-1"})
check("wrong password rejected", r.status_code == 401)
r = call("POST", "/auth/login", json={"username": "dr.rao", "password": CREDS["dr.rao"]["password"]})
mfa_tok = r.json()["mfa_token"]
check("mfa_pending token cannot call API", call("GET", "/records", mfa_tok).status_code == 401)
check("wrong TOTP rejected", call("POST", "/auth/mfa", mfa_tok, json={"code": "000000"}).status_code in (401,))

tok = {u: login(u) for u in ("dr.rao", "dr.mehta", "prakash.s", "ramesh.h", "admin")}
check("password + TOTP login (all roles)", len(tok) == 5)

# --- upload by Dr. Rao for patient Asha
secret_text = "Hb 13.2 g/dL, WBC 6.1, glucose 92 mg/dL - CONFIDENTIAL"
r = call("POST", "/records", tok["dr.rao"], data={"title": "CBC Report", "category": "Lab Report",
                                                  "patient_username": "ramesh.h", "notes": secret_text})
check("upload (encrypt+sign)", r.status_code == 200, r.text[:80])
rid = r.json()["id"]

# --- ciphertext at rest is not plaintext
row = sqlite3.connect(DB).execute("select ciphertext from records where id=?", (rid,)).fetchone()[0]
check("stored ciphertext does not contain plaintext", b"Hb 13.2" not in row)

# --- doctor-owner download: 3 checks green
r = call("GET", f"/records/{rid}/download", tok["dr.rao"])
d = r.json()
check("owner download decrypts + 3 checks green",
      r.status_code == 200 and all(d["checks"].values()) and base64.b64decode(d["content_b64"]).decode() == secret_text)

# --- lab user without grant => 403 + denial logged
r = call("GET", f"/records/{rid}/download", tok["prakash.s"])
check("lab without grant gets 403", r.status_code == 403)
audit = call("GET", "/audit", tok["admin"]).json()
check("denial recorded in audit log", any(a["action"] == "ACCESS_DENIED" and a["actor"] == "prakash.s" and a["target"] == rid for a in audit))

# --- ACM: lab cannot hit admin endpoints; admin cannot read records
check("lab denied admin audit endpoint (ACM)", call("GET", "/audit", tok["prakash.s"]).status_code == 403)
check("admin denied record list (ACM)", call("GET", "/records", tok["admin"]).status_code == 403)

# --- share with Dr. Mehta: pending until patient consents
r = call("POST", f"/records/{rid}/share", tok["dr.rao"], json={"username": "dr.mehta"})
check("clinician share is pending", r.status_code == 200 and r.json()["status"] == "pending")
check("pending grantee cannot download", call("GET", f"/records/{rid}/download", tok["dr.mehta"]).status_code == 403)
pend = call("GET", "/records/pending", tok["ramesh.h"]).json()
check("patient sees consent request", len(pend) == 1)
check("patient approves", call("POST", f"/grants/{pend[0]['grant_id']}/approve", tok["ramesh.h"]).status_code == 200)
r = call("GET", f"/records/{rid}/download", tok["dr.mehta"])
d = r.json()
check("grantee downloads with 3 green verifications", r.status_code == 200 and all(d["checks"].values())
      and base64.b64decode(d["content_b64"]).decode() == secret_text)
check("non-patient cannot approve/revoke", call("POST", f"/grants/{pend[0]['grant_id']}/revoke", tok["dr.mehta"]).status_code == 403)
check("patient revokes", call("POST", f"/grants/{pend[0]['grant_id']}/revoke", tok["ramesh.h"]).status_code == 200)
check("revoked user locked out", call("GET", f"/records/{rid}/download", tok["dr.mehta"]).status_code == 403)

# --- admin permanently deletes a user (and their records); history stays and the chain stays valid
if "e2e_user" in CREDS:
    et = login("e2e_user")
    r = call("POST", "/records", et, data={"title": "Temp", "category": "Other", "patient_username": "ramesh.h", "notes": "temp"})
    temp_id = r.json()["id"]
    users_now = call("GET", "/admin/users", tok["admin"]).json()
    uid = [u for u in users_now if u["username"] == "e2e_user"][0]["id"]
    admin_id = [u for u in users_now if u["username"] == "admin"][0]["id"]
    imp = call("GET", f"/admin/users/{uid}/impact", tok["admin"]).json()
    check("delete preview counts linked records", imp["records"] == 1, str(imp))
    check("admin cannot delete self", call("DELETE", f"/admin/users/{admin_id}", tok["admin"]).status_code == 400)
    check("non-admin cannot delete users", call("DELETE", f"/admin/users/{uid}", tok["dr.rao"]).status_code == 403)
    check("admin deletes user", call("DELETE", f"/admin/users/{uid}", tok["admin"]).status_code == 200)
    check("deleted user gone from list", all(u["username"] != "e2e_user" for u in call("GET", "/admin/users", tok["admin"]).json()))
    check("deleted user's token rejected", call("GET", "/me", et).status_code == 401)
    check("their record removed for the patient", all(x["id"] != temp_id for x in call("GET", "/records", tok["ramesh.h"]).json()))
    check("deleted user gone from database", sqlite3.connect(DB).execute("select count(*) from users where username='e2e_user'").fetchone()[0] == 0)

# --- audit chain valid, then tamper ciphertext
check("audit chain valid", call("GET", "/audit/verify", tok["admin"]).json()["valid"] is True)
con = sqlite3.connect(DB)
orig = con.execute("select ciphertext from records where id=?", (rid,)).fetchone()[0]
flipped = bytes([orig[0] ^ 1]) + orig[1:]
con.execute("update records set ciphertext=? where id=?", (flipped, rid)); con.commit()
r = call("GET", f"/records/{rid}/download", tok["dr.rao"])
check("flipped ciphertext byte => download fails (GCM)", r.status_code == 409)
con.execute("update records set ciphertext=? where id=?", (orig, rid)); con.commit()
check("restored record downloads again", call("GET", f"/records/{rid}/download", tok["dr.rao"]).status_code == 200)

# --- tamper audit row
first = con.execute("select id from audit_log order by id limit 1 offset 2").fetchone()[0]
con.execute("update audit_log set outcome='OK', detail='edited' where id=?", (first,)); con.commit()
v = call("GET", "/audit/verify", tok["admin"]).json()
check("edited audit row flagged by chain check", v["valid"] is False and v["broken_at"] == first, str(v))

# --- logout revokes token
call("POST", "/auth/logout", tok["dr.mehta"])
check("logged-out token rejected", call("GET", "/me", tok["dr.mehta"]).status_code == 401)

# --- lockout after repeated failures
for _ in range(5):
    call("POST", "/auth/login", json={"username": "prakash.s", "password": "nope-nope-123"})
r = call("POST", "/auth/login", json={"username": "prakash.s", "password": CREDS["prakash.s"]["password"]})
check("account locked after 5 failures", r.status_code == 423)
call("POST", f"/admin/users/{[u for u in call('GET', '/admin/users', tok['admin']).json() if u['username']=='prakash.s'][0]['id']}/unlock", tok["admin"])

print("\nFAILED:" if failures else "\nALL CHECKS PASSED", failures or "")
sys.exit(1 if failures else 0)
