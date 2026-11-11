"""Live board of the current 6-digit verification code for EVERY user in the backend database.
New users appear automatically as soon as they register. The codes match the authenticator app.

Run:   .venv\\Scripts\\python.exe codes.py        (Ctrl+C to stop; add --once to print a single time)
"""
import shutil
import sqlite3
import sys
import time

import pyotp

from app.config import INSTANCE_DIR

DB = INSTANCE_DIR / "health.db"
ROLE = {"admin": "Administrator", "doctor": "Doctor", "lab": "Lab Staff", "patient": "Patient"}
ESC = "\033"
G, Y, D, B, R = ESC + "[92m", ESC + "[93m", ESC + "[2m", ESC + "[1m", ESC + "[0m"
NL = chr(10)


def users():
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True, timeout=2)
    try:
        return con.execute("select username, full_name, role, totp_secret, is_active from users order by id").fetchall()
    finally:
        con.close()


def board(max_lines: int = 999) -> str:
    left = 30 - int(time.time()) % 30
    filled = round(left / 30 * 30)
    colour = G if left > 8 else Y
    rows = users()
    head = [f"{B}ZeroTrust Health Exchange - live verification codes{R}",
            f"{D}Read from the backend user database - {len(rows)} users{R}", "",
            f"{B}{'ROLE':<15}{'NAME':<24}{'USERNAME':<14}{'CODE':<10}{R}", "-" * 62]
    foot = ["", f"{colour}{'█' * filled}{D}{'░' * (30 - filled)}{R}  new codes in {left:2d}s"]
    room = max(1, max_lines - len(head) - len(foot))
    shown = rows if len(rows) <= room else rows[: room - 1]
    body = []
    for username, name, role, secret, active in shown:
        code = pyotp.TOTP(secret).now()
        status = "" if active else f"  {D}(deactivated){R}"
        body.append(f"{ROLE.get(role, role):<15}{name.split(' (')[0][:23]:<24}{username:<14}"
                    f"{colour}{B}{code[:3]} {code[3:]}{R}{status}")
    if len(shown) < len(rows):
        body.append(f"{D}… and {len(rows) - len(shown)} more (enlarge the window){R}")
    return NL.join(head + body + foot)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--once" in sys.argv:
        print(board())
    else:
        # Full-screen mode (alternate buffer): never scrolls, so the board always redraws cleanly.
        print(ESC + "[?1049h" + ESC + "[?25l", end="", flush=True)
        try:
            while True:
                try:
                    height = shutil.get_terminal_size((100, 30)).lines
                    text = board(height - 1)
                except sqlite3.Error:
                    text = "Waiting for the backend database…"
                frame = ESC + "[H" + text.replace(NL, ESC + "[K" + NL) + ESC + "[K" + ESC + "[J"
                print(frame, end="", flush=True)
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            print(ESC + "[?25h" + ESC + "[?1049l", end="", flush=True)
