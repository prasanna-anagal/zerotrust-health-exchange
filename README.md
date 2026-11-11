# ZeroTrust Health Exchange

A secure platform for sharing patient health records between doctors, laboratories and patients — built on the
**zero-trust** principle: *never trust, always verify*. Every user is authenticated with a password **and** a
one-time code, every request is checked against a permission table, records are encrypted and digitally signed, and
every action is written to a tamper-evident activity log.

> Course project for **Cryptography and Network Security (26ECSC403)** — Team 7.

---

## Table of contents
1. [What it does](#what-it-does)
2. [Roles and what each can do](#roles-and-what-each-can-do)
3. [Cryptography used](#cryptography-used)
4. [Tech stack](#tech-stack)
5. [Project structure](#project-structure)
6. [Setup and run](#setup-and-run)
7. [Accounts and Google Authenticator](#accounts-and-google-authenticator)
8. [Live verification-code board](#live-verification-code-board)
9. [Demo walkthrough](#demo-walkthrough)
10. [Testing](#testing)
11. [Resetting data](#resetting-data)
12. [Security design notes and limitations](#security-design-notes-and-limitations)
13. [Troubleshooting](#troubleshooting)

---

## What it does
- **Sign in securely** with a password plus a 6-digit code from an authenticator app (two-step verification).
- **Upload patient records** (a file up to 2 MB, or a written note). Each record is encrypted and digitally signed.
- **Share records between clinicians.** When a clinician shares a record, the **patient must approve** before the
  recipient can open it. The patient can remove anyone's access at any time.
- **Open a record** and see whether it is verified (unchanged since upload). A tampered record is refused.
- **Role-based permissions** that an administrator can edit from a permissions grid.
- **Administrator tools:** manage users (deactivate, reactivate, unlock, permanently delete), edit permissions, and
  read the activity log, with a one-click integrity check that detects edited or deleted entries.
- **Account protection:** lockout after 5 failed sign-ins, request rate limiting, short-lived sessions that are revoked on sign-out.

## Roles and what each can do

| Role | Can | Cannot |
|---|---|---|
| **Doctor** | Upload records for patients, view records they were given access to, share with other clinicians (patient approves) | Manage users or permissions, read the activity log |
| **Lab staff** | Same as a doctor — typically uploads test results | Same limits as a doctor |
| **Patient** | View own records, approve or decline access requests, remove anyone's access | Upload or share records |
| **Administrator** | Manage users, edit the permissions grid, read and verify the activity log | Open any patient record (deliberately not permitted) |

Permissions are stored in a table (role × permission). The administrator can change them on the **Permissions** page and
the change applies to the very next request. Defaults:

| Permission | Doctor | Lab | Patient | Admin |
|---|:-:|:-:|:-:|:-:|
| Upload records | ✔ | ✔ | | |
| View records | ✔ | ✔ | ✔ | |
| Share records | ✔ | ✔ | | |
| Manage consent | | | ✔ | |
| Manage users | | | | ✔ |
| View activity log | | | | ✔ |
| View / edit permissions | | | | ✔ |

## Cryptography used

| Algorithm | Where it is used |
|---|---|
| **AES-256-GCM** | Encrypts every record. Fresh random key and nonce per record; the record id is bound in as authenticated data. |
| **RSA-2048 (OAEP, SHA-256)** | Wraps each record's AES key separately for every person allowed to open it. Sharing = re-wrapping the key for the recipient; revoking = destroying that person's wrapped key. |
| **RSA-PSS digital signature** | The uploader signs each record. Verified every time the record is opened. |
| **SHA-256** | Record fingerprint (integrity check) and the hash chain of the activity log. |
| **Argon2id** | Password hashing (salted). |
| **TLS / HTTPS** | The backend is served over TLS (self-signed certificate generated on first run). |

Also: **JWT** sessions (HMAC-SHA256, 15 minutes, revocable on sign-out), **TOTP** two-step verification (RFC 6238),
and **RBAC with an Access Control Matrix** enforced on every API request.

## Tech stack
- **Frontend:** React 18 + Vite (plain CSS, no UI framework)
- **Backend:** Python, FastAPI, SQLAlchemy
- **Database:** SQLite (a single file; no database server needed)
- **Crypto libraries:** `cryptography`, `argon2-cffi`, `PyJWT`, `pyotp`

## Project structure
```
zerotrust-health-exchange/
├── backend/
│   ├── app/
│   │   ├── main.py        API routes (auth, records, sharing, consent, admin, stats)
│   │   ├── crypto.py      AES-GCM, RSA-OAEP, RSA-PSS, SHA-256, Argon2id
│   │   ├── security.py    JWT, permission checks (Access Control Matrix), rate limiting
│   │   ├── audit.py       Hash-chained activity log + integrity check
│   │   ├── models.py      Database tables
│   │   ├── config.py      Settings; generates secrets on first run
│   │   └── db.py
│   ├── run.py             Starts the backend over HTTPS (creates certificate, seeds accounts)
│   ├── seed.py            Creates the 5 starting accounts and the authenticator setup page
│   ├── codes.py           Live board of verification codes (see below)
│   ├── e2e_test.py        End-to-end test suite
│   ├── requirements.txt
│   └── instance/          Generated at first run — secrets, keys, database (NOT in git)
├── frontend/              React app (src/ holds the pages)
├── start_backend.bat      Start backend, keep data
├── start_frontend.bat     Start frontend
└── reset_and_start.bat    Wipe all data, then start backend
```

## Setup and run
Requires **Python 3.11+** and **Node.js 18+** (Windows; the `.bat` files are Windows conveniences).

**1. Backend** (first time)
```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe run.py
```
It starts at `https://127.0.0.1:8443`. On first run it creates, inside `backend/instance/`:
a JWT secret, the master key that protects stored private keys, a TLS certificate, the SQLite database, the 5 starting
accounts, and a private page for setting up your authenticator app. None of these are committed to git.

**2. Frontend** (second terminal)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**.

Next time, just double-click `start_backend.bat` and `start_frontend.bat`.

## Accounts and Google Authenticator
The first run creates these five accounts (all fictional):

| Role | Name | Username | Password |
|---|---|---|---|
| Administrator | System Administrator | `admin` | `Admin@123456` |
| Doctor | Dr. Anita Rao — City General Hospital | `dr.rao` | `Rao@123456` |
| Doctor | Dr. Vikram Mehta — Metro Heart Institute | `dr.mehta` | `Mehta@123456` |
| Lab staff | Prakash Shetty — City General Hospital Lab | `prakash.s` | `Prakash@123456` |
| Patient | Ramesh Hiremath | `ramesh.h` | `Ramesh@123456` |

These are demonstration passwords for a coursework project. **Never reuse them for anything real.**

Signing in also needs a 6-digit code. Add the accounts to **Google Authenticator** (or any authenticator app):

1. After the first run, open **`backend/instance/accounts_and_authenticator.html`** in a browser. It shows a QR code per account.
2. In the app tap **+ → Scan a QR code** and scan each one. Each account appears as *Role: Name* (for example *Doctor: Dr. Anita Rao*).
   - Can't scan? Tap **+ → Enter a setup key**, type the role and name, paste the key shown under the QR code and choose **Time based**.
3. Sign in with username + password, then type the 6-digit code shown for that account.

Authenticator keys are random per installation and are kept in `backend/instance/`, so they survive a database reset.
New users who register in the app are shown their own QR code and key during sign-up.

## Live verification-code board
For presentations you can show the live code for every user — including users who register later:

```bash
cd backend
.venv\Scripts\python.exe codes.py
```

It reads the user list from the backend database and generates the same time-based codes that the authenticator app
shows, refreshing every second with a countdown. New users appear within a second; deleted users disappear.
Press **Ctrl+C** to stop. Keep the window at least 14 lines tall.

> This is a presentation aid only. It displays everyone's second-factor codes, which a real deployment must never do.

## Demo walkthrough
1. **Doctor uploads.** Sign in as `dr.rao` → **Records → Upload record** → title *Complete blood count*, patient *Ramesh Hiremath*,
   write a note → **Upload**. Open the record → **View document**: a green *Verified* line appears.
2. **Doctor shares.** On the record click **Share**, choose *Dr. Vikram Mehta*. It shows *Request sent to patient*. Sign out.
3. **Other doctor is blocked.** Sign in as `dr.mehta`: the record is marked *Pending* and cannot be opened.
4. **Patient approves.** Sign in as `ramesh.h` → **Requests** (badge shows the count) → **Approve**.
5. **Access works.** Sign in as `dr.mehta` again → open the record → it displays.
6. **Patient removes access.** As `ramesh.h` open the record → **People with access → Remove**. `dr.mehta` can no longer see it.
7. **Lab staff.** As `prakash.s` the *Records* list is empty until a record is shared; opening someone else's record is refused and logged.
8. **Administrator.** As `admin`:
   - **Activity log** — every action in plain language; **Check log integrity** confirms nothing was altered.
   - **Permissions** — click a cell (for example, give Lab staff *Share records*) and see the effect on the next sign-in.
   - **Users** — deactivate, unlock or **permanently delete** a user (the dialog shows exactly which records go with them).

## Testing
With the backend running:
```bash
cd backend
.venv\Scripts\python.exe e2e_test.py
```
Runs **34 checks**: sign-in with password and code, encrypted storage, permission denials, patient consent, revocation,
a tampered record being refused, an edited activity-log entry being detected, lockout, and user deletion.
The test deliberately edits an activity-log entry, so afterwards run `reset_and_start.bat` to restore a clean database.

## Resetting data
`reset_and_start.bat` (close any running backend first) deletes the database — all records, activity and any extra users —
and starts fresh with the 5 starting accounts. Your authenticator entries keep working.

## Security design notes and limitations
- Each record has its own AES key. Users' RSA private keys are stored **encrypted under a server master key**
  (`backend/instance/secrets.json`). A production system would hold that key in a KMS or HSM and unlock private keys with
  user-held secrets. The master key is never committed.
- The server performs decryption on the user's behalf after authorising them; this is not end-to-end encryption.
- Administrators cannot open patient records, but they can read activity metadata (who did what, when).
- Deleting a user also deletes every record tied to them; their past entries in the activity log are kept by design.
- The TLS certificate is self-signed, so browsers warn if you open `https://127.0.0.1:8443` directly. The app itself is
  used through the frontend at `http://localhost:5173`, which proxies to the backend.
- SQLite and an in-memory rate limiter suit a single-server demo, not horizontal scaling.
- The starting account passwords are in `backend/seed.py` and this README by design (coursework demo).

## Troubleshooting
| Problem | Fix |
|---|---|
| Sign-in says *Invalid credentials* | Check the username (for example `dr.rao`, with a dot) and password. |
| *Invalid verification code* | Codes last 30 s. Check your phone's clock is automatic. Or compare with `codes.py`. |
| *Account temporarily locked* | 5 wrong attempts. Wait 5 minutes or sign in as `admin` → Users → **Unlock**. |
| Page loads but nothing works | The backend isn't running. Start `start_backend.bat`. |
| Port already in use | Another backend is running. Close it, or end the `python` process using port 8443. |
| Need the authenticator page again | Run the backend once; it is regenerated at `backend/instance/accounts_and_authenticator.html`. |
