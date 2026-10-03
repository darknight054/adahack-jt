"""Username and password sign-in. Sessions are signed cookies, so they work across serverless instances."""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import unicodedata

from .db import setting

COOKIE = "sm_session"
MAX_AGE_S = 14 * 24 * 3600


def username_for(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z.]", "", plain.lower().replace(" ", "."))


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$")
    return hmac.compare_digest(hash_password(password, bytes.fromhex(salt)), stored)


def _secret(conn: sqlite3.Connection) -> bytes:
    return (os.environ.get("SESSION_SECRET") or setting(conn, "session_secret")).encode()


def sign(conn: sqlite3.Connection, user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + MAX_AGE_S}"
    return f"{payload}.{hmac.new(_secret(conn), payload.encode(), hashlib.sha256).hexdigest()}"


def verify(conn: sqlite3.Connection, token: str | None) -> int | None:
    try:
        uid, exp, sig = (token or "").split(".")
    except ValueError:
        return None
    good = hmac.new(_secret(conn), f"{uid}.{exp}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, good) or int(exp) < time.time():
        return None
    return int(uid)
