import os
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

BUNDLED = Path(__file__).resolve().parent.parent / "data" / "street_miles.db"
SCHEMA = Path(__file__).with_name("schema.sql")


def _path() -> Path:
    if path := os.environ.get("DATABASE_PATH"):
        return Path(path)
    if os.environ.get("VERCEL"):
        # Vercel function filesystems are read-only apart from /tmp, so each instance writes to its own copy.
        # Writes are lost when the instance is recycled and are not shared between instances.
        tmp = Path("/tmp/street_miles.db")
        if not tmp.exists():
            shutil.copy(BUNDLED, tmp)
        return tmp
    return BUNDLED


DB_PATH = _path()


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB_PATH, timeout=15, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def write(conn: sqlite3.Connection):
    """BEGIN IMMEDIATE takes the write lock up front, so concurrent writers queue instead of interleaving."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def setting(conn: sqlite3.Connection, key: str) -> str:
    return conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()[0]
