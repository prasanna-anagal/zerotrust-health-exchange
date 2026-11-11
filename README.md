# ZeroTrust Health Exchange

A secure platform for sharing patient health records between doctors, laboratories and patients, built on the
**zero-trust** principle: *never trust, always verify*. Every user is authenticated with a password **and** a
one-time code, every request is checked against a permission table, records are encrypted and digitally signed, and
every action is written to a tamper-evident activity log.

---

## Table of contents
1. [Features](#features)
2. [Roles and permissions](#roles-and-permissions)
3. [Cryptography](#cryptography)
4. [Tech stack](#tech-stack)
5. [Project structure](#project-structure)
6. [Getting started](#getting-started)
7. [Sample accounts and authenticator setup](#sample-accounts-and-authenticator-setup)
8. [Live verification-code board](#live-verification-code-board)
9. [Example walkthrough](#example-walkthrough)
10. [Testing](#testing)
11. [Resetting data](#resetting-data)
12. [Security notes](#security-notes)
13. [Troubleshooting](#troubleshooting)

---

## Features
- **Two-step sign-in:** password plus a 6-digit code from an authenticator app (TOTP).
- **Encrypted patient records:** upload a file (up to 2 MB) or a written note. Each record is encrypted and digitally signed.
- **Consent-based sharing:** a clinician can share a record with another clinician, but the **patient must approve**
  before the recipient can open it. The patient can remove anyone's access at any time.
- **Verified viewing:** when a record is opened, the system confirms it is unchanged since upload. A tampered record is refused.
- **Role-based permissions:** an editable permission grid controls what each role may do.
- **Administration:** manage users (deactivate, reactivate, unlock, permanently delete), edit permissions, and read the
  activity log with a one-click integrity check that detects edited or removed entries.
- **Account protection:** lockout after 5 failed sign-ins, request rate limiting, and short-lived sessions that are revoked on sign-out.

## Roles and permissions

| Role | Can | Cannot |
|---|---|---|
| **Doctor** | Upload records for patients, view records shared with them, share with other clinicians (patient approves) | Manage users or permissions, read the activity log |
| **Lab staff** | Same as a doctor; typically uploads test results | Same limits as a doctor |
| **Patient** | View own records, approve or decline access requests, remove anyone's access | Upload or share records |
| **Administrator** | Manage users, edit the permission grid, read and verify the activity log | Open patient records (deliberately not permitted) |

Permissions are stored as a role × permission table. An administrator can change them on the **Permissions** page, and a
change applies to the very next request. Defaults:

| Permission | Doctor | Lab | Patient | Admin |
|---|:-:|:-:|:-:|:-:|
| Upload records | ✔ | ✔ | | |
| View records | ✔ | ✔ | ✔ | |
| Share records | ✔ | ✔ | | |
| Manage consent | | | ✔ | |
| Manage users | | | | ✔ |
| View activity log | | | | ✔ |
| View / edit permissions | | | | ✔ |

## Cryptography

| Algorithm | Purpose |
|---|---|
| **AES-256-GCM** | Encrypts every record. A fresh random key and nonce are used per record, and the record id is bound in as authenticated data. |
| **RSA-2048 (OAEP, SHA-256)** | Wraps each record's AES key separately for every person allowed to open it. Sharing re-wraps the key for the recipient; removing access destroys that person's wrapped key. |
| **RSA-PSS digital signature** | The uploader signs each record. The signature is verified every time the record is opened. |
| **SHA-256** | Record fingerprint (integrity check) and the hash chain of the activity log. |
| **Argon2id** | Salted password hashing. |
| **TLS / HTTPS** | The backend is served over TLS using a self-signed certificate generated on first run. |

Also used: **JWT** sessions (HMAC-SHA256, 15 minutes, revocable on sign-out), **TOTP** two-step verification (RFC 6238),
and **role-based access control with an Access Control Matrix** enforced on every API request.

## Tech stack
- **Frontend:** React 18 + Vite (plain CSS, no UI framework)
- **Backend:** Python, FastAPI, SQLAlchemy
- **Database:** SQLite (a single file; no database server required)
- **Libraries:** `cryptography`, `argon2-cffi`, `PyJWT`, `pyotp`

## Project structure
```
zerotrust-health-exchange/
├── backend/
│   ├── app/
│   │   ├── main.py        API routes (auth, records, sharing, consent, admin, stats)
│   │   ├── crypto.py      AES-GCM, RSA-OAEP, RSA-PSS, SHA-256, Argon2id
│   │   ├── security.py    JWT, permission checks (Access Control Matrix), rate limiting
│   │   ├── audit.py       Hash-chained activity log and integrity check
│   │   ├── models.py      Database tables
│   │   ├── config.py      Settings; generates secrets on first run
│   │   └── db.py
│   ├── run.py             Starts the backend over HTTPS (creates the certificate, seeds sample accounts)
│   ├── seed.py            Creates the sample accounts and the authenticator setup page
│   ├── codes.py           Live board of verification codes (see below)
│   ├── e2e_test.py        End-to-end test suite
│   ├── requirements.txt
│   └── instance/          Generated at first run: secrets, keys, database
├── frontend/              React app (src/ holds the pages)
├── start_backend.bat      Start the backend, keeping existing data
├── start_frontend.bat     Start the frontend
└── reset_and_start.bat    Delete all data, then start the backend
```

## Getting started
**Requirements:** Python 3.11+ and Node.js 18+. The `.bat` files are Windows conveniences; on other systems run the
equivalent commands shown below.

**1. Backend** (first time)
```bash
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe run.py
```
The backend listens on `https://127.0.0.1:8443`. On first run it generates, inside `backend/instance/`: a JWT secret,
the master key that protects stored private keys, a TLS certificate, the SQLite database, the sample accounts, and a
local page for adding the accounts to an authenticator app.

**2. Frontend** (second terminal)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**.

On later runs, use `start_backend.bat` and `start_frontend.bat`.

## Sample accounts and authenticator setup
The first run creates five fictional accounts:

| Role | Name | Username | Password |
|---|---|---|---|
| Administrator | System Administrator | `admin` | `Admin@123456` |
| Doctor | Dr. Anita Rao, City General Hospital | `dr.rao` | `Rao@123456` |
| Doctor | Dr. Vikram Mehta, Metro Heart Institute | `dr.mehta` | `Mehta@123456` |
| Lab staff | Prakash Shetty, City General Hospital Lab | `prakash.s` | `Prakash@123456` |
| Patient | Ramesh Hiremath | `ramesh.h` | `Ramesh@123456` |

Signing in also requires a 6-digit code. To add the accounts to **Google Authenticator** (or any TOTP app):

1. Open **`backend/instance/accounts_and_authenticator.html`** in a browser. It is generated on startup and shows a QR code for each account.
2. In the authenticator app, choose **+ → Scan a QR code** and scan each one. Accounts appear as *Role: Name*
   (for example *Doctor: Dr. Anita Rao*).
   - If scanning is not possible, choose **+ → Enter a setup key**, type the role and name, paste the key printed under the QR code, and select **Time based**.
3. Sign in with the username and password, then enter the 6-digit code shown for that account.

Authenticator keys are random for each installation and are stored in `backend/instance/`, so they remain valid after
a database reset. Users who register through the app are shown their own QR code and key during sign-up.

## Live verification-code board
`codes.py` prints the current verification code for every registered user and refreshes every second:

```bash
cd backend
.venv\Scripts\python.exe codes.py
```

It reads the user list from the backend database and computes the same time-based codes that an authenticator app
shows, with a countdown to the next code. Users appear within a second of registering and disappear when deleted.
Press **Ctrl+C** to exit. The terminal window should be at least 14 lines tall.

## Example walkthrough
1. **Doctor uploads.** Sign in as `dr.rao`, open **Records → Upload record**, enter a title (for example *Complete blood count*),
   choose the patient *Ramesh Hiremath*, add a note, and select **Upload**. Open the record and choose **View document**;
   a green *Verified* line confirms it is unchanged.
2. **Doctor shares.** On the record, select **Share** and choose *Dr. Vikram Mehta*. The request is sent to the patient.
3. **Recipient is blocked until approval.** As `dr.mehta`, the record is marked *Pending* and cannot be opened.
4. **Patient approves.** As `ramesh.h`, open **Requests** and select **Approve**.
5. **Access works.** As `dr.mehta`, the record can now be opened.
6. **Patient removes access.** As `ramesh.h`, open the record and use **Remove** under *People with access*.
   `dr.mehta` can no longer see it.
7. **Unauthorised access is refused.** As `prakash.s`, a record that has not been shared cannot be opened, and the attempt is logged.
8. **Administrator.** As `admin`:
   - **Activity log:** every action in plain language; **Check log integrity** confirms no entry was altered.
   - **Permissions:** change what a role may do (for example, give Lab staff *Share records*).
   - **Users:** deactivate, unlock or permanently delete a user. The confirmation dialog lists the records that will be removed with them.

## Testing
With the backend running:
```bash
cd backend
.venv\Scripts\python.exe e2e_test.py
```
The suite runs **34 checks**: sign-in with password and code, encrypted storage, permission denials, patient consent,
removal of access, a tampered record being refused, an edited activity-log entry being detected, account lockout, and user deletion.
The test intentionally edits an activity-log entry, so run `reset_and_start.bat` afterwards to restore a clean database.

## Resetting data
`reset_and_start.bat` (stop any running backend first) deletes the database, including all records, activity and extra
users, and starts again with the five sample accounts. Authenticator entries stay valid.

## Security notes
- Each record has its own AES key. Users' RSA private keys are stored **encrypted under a server master key**
  (`backend/instance/secrets.json`).
- Records are decrypted on the server after the user has been authorised.
- Administrators cannot open patient records, but they can read activity metadata (who did what, and when).
- Deleting a user also deletes every record tied to them. Their past entries in the activity log are kept.
- The TLS certificate is self-signed, so browsers show a warning when `https://127.0.0.1:8443` is opened directly. The web
  app is used through the frontend at `http://localhost:5173`, which proxies requests to the backend.

## Troubleshooting
| Problem | Fix |
|---|---|
| *Invalid credentials* on sign-in | Check the username (for example `dr.rao`, with a dot) and the password. |
| *Invalid verification code* | Codes last 30 seconds. Make sure the phone's clock is set automatically, or compare with `codes.py`. |
| *Account temporarily locked* | Five wrong attempts lock an account for 5 minutes. An administrator can unlock it from **Users**. |
| The page loads but nothing works | The backend is not running. Start it with `start_backend.bat`. |
| Port already in use | Another instance is running. Stop it, or end the process using port 8443 (backend) or 5173 (frontend). |
| The authenticator page is missing | Start the backend once; it recreates `backend/instance/accounts_and_authenticator.html`. |
