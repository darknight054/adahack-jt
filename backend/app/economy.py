"""Credits: the ledger, weekly allowance, trip awards, wallet and team standings."""
import sqlite3
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from . import config
from .db import write

LONDON = ZoneInfo(config.TIMEZONE)
EARN = config.EARN_KINDS
SCORE = config.SCORE_KINDS


def now() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds")


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s)


def day_start(dt: datetime) -> datetime:
    return dt.astimezone(LONDON).replace(hour=0, minute=0, second=0, microsecond=0)


def week_start(dt: datetime) -> datetime:
    d = day_start(dt)
    return d - timedelta(days=d.weekday())


def week_bounds(dt: datetime) -> tuple[datetime, datetime]:
    start = week_start(dt)
    return start, week_start(start + timedelta(days=7, hours=12))


def _in(kinds: tuple[str, ...]) -> str:
    return "(" + ",".join(f"'{k}'" for k in kinds) + ")"


def add(conn: sqlite3.Connection, user_id: int, kind: str, credits: int, detail: str, at: datetime,
        ref: str | None = None) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO ledger (user_id, kind, credits, ref, detail, created_at) VALUES (?,?,?,?,?,?)",
        (user_id, kind, credits, ref, detail, iso(at)),
    )


def balance(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT COALESCE(SUM(credits), 0) FROM ledger WHERE user_id = ?", (user_id,)).fetchone()[0]


def listed(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute(
        "SELECT COALESCE(SUM(qty_remaining), 0) FROM listings WHERE seller_id = ? AND status = 'open'", (user_id,)
    ).fetchone()[0]


def sellable(conn: sqlite3.Connection, user_id: int) -> int:
    """Only earned credits can be sold; the weekly allowance can be spent but not traded."""
    earned, sold = conn.execute(
        f"""SELECT COALESCE(SUM(CASE WHEN kind IN {_in(EARN)} THEN credits END), 0),
                   COALESCE(-SUM(CASE WHEN kind = 'sell' THEN credits END), 0)
            FROM ledger WHERE user_id = ?""",
        (user_id,),
    ).fetchone()
    return max(0, min(balance(conn, user_id), earned - sold) - listed(conn, user_id))


def earned_today(conn: sqlite3.Connection, user_id: int, at: datetime) -> int:
    start = day_start(at)
    return conn.execute(
        "SELECT COALESCE(SUM(credits), 0) FROM ledger WHERE user_id = ? AND kind IN ('walk','cycle','bus','carshare') "
        "AND created_at >= ? AND created_at < ?",
        (user_id, iso(start), iso(day_start(start + timedelta(hours=30)))),
    ).fetchone()[0]


def trip_award(conn: sqlite3.Connection, user_id: int, mode: str, distance_km: float | None, at: datetime) -> int:
    if mode in config.MODES:
        miles = (distance_km or 0) / config.KM_PER_MILE
        raw = round(miles * config.MODES[mode]["credits_per_mile"]) if miles >= config.MIN_LEG_MI else 0
    else:
        raw = config.FLAT_TRIPS[mode]["credits"]
    return max(0, min(raw, config.DAILY_CAP - earned_today(conn, user_id, at)))


def parked_on(conn: sqlite3.Connection, user_id: int, at: datetime) -> bool:
    start = day_start(at)
    return conn.execute(
        "SELECT 1 FROM ledger WHERE user_id = ? AND kind = 'car_park' AND created_at >= ? AND created_at < ?",
        (user_id, iso(start), iso(day_start(start + timedelta(hours=30)))),
    ).fetchone() is not None


def team_scores(conn: sqlite3.Connection, start: datetime, end: datetime) -> list[sqlite3.Row]:
    """Every team's credits earned in [start, end), net of parking penalties, highest first."""
    return conn.execute(
        f"""SELECT t.id, t.name, t.colour,
                   (SELECT COUNT(*) FROM users m WHERE m.team_id = t.id) AS members,
                   COALESCE((SELECT SUM(l.credits) FROM ledger l JOIN users u ON u.id = l.user_id
                             WHERE u.team_id = t.id AND l.kind IN {_in(SCORE)}
                               AND l.created_at >= ? AND l.created_at < ?), 0) AS credits
            FROM teams t ORDER BY credits DESC, t.name""",
        (iso(start), iso(end)),
    ).fetchall()


def settle_week(conn: sqlite3.Connection, start: datetime) -> None:
    """Pay the team bonus for the week starting at `start`. Ties all win. Safe to call repeatedly."""
    ref = iso(start)
    if conn.execute("SELECT 1 FROM team_awards WHERE week_start = ?", (ref,)).fetchone():
        return
    end = week_start(start + timedelta(days=7, hours=12))
    scores = team_scores(conn, start, end)
    if not scores or scores[0]["credits"] <= 0:
        return
    top = scores[0]["credits"]
    for team in (s for s in scores if s["credits"] == top):
        conn.execute("INSERT OR IGNORE INTO team_awards VALUES (?,?,?)", (ref, team["id"], top))
        for (uid,) in conn.execute("SELECT id FROM users WHERE team_id = ?", (team["id"],)).fetchall():
            add(conn, uid, "team_bonus", config.TEAM_WIN_BONUS, f"{team['name']} won the week", end, ref)


def ensure_current(conn: sqlite3.Connection, user_id: int, at: datetime) -> None:
    """Grant this week's allowance and settle last week's team bonus the first time they're needed."""
    start = week_start(at)
    ref = iso(start)
    has_allowance = conn.execute(
        "SELECT 1 FROM ledger WHERE user_id = ? AND kind = 'allowance' AND ref = ?", (user_id, ref)
    ).fetchone()
    last = week_start(start - timedelta(days=3))
    settled = conn.execute("SELECT 1 FROM team_awards WHERE week_start = ?", (iso(last),)).fetchone()
    if has_allowance and settled:
        return
    with write(conn):
        add(conn, user_id, "allowance", config.WEEKLY_ALLOWANCE, "Weekly allowance from Jane Street", start, ref)
        settle_week(conn, last)


def wallet(conn: sqlite3.Connection, user_id: int, at: datetime) -> dict:
    start = iso(week_start(at))
    rows = dict(conn.execute(
        "SELECT kind, SUM(credits) FROM ledger WHERE user_id = ? AND created_at >= ? GROUP BY kind", (user_id, start)
    ).fetchall())
    carried = conn.execute(
        "SELECT COALESCE(SUM(credits), 0) FROM ledger WHERE user_id = ? AND created_at < ?", (user_id, start)
    ).fetchone()[0]
    return {
        "balance": balance(conn, user_id),
        "listed": listed(conn, user_id),
        "sellable": sellable(conn, user_id),
        "week": {
            "carried_over": carried,
            "allowance": rows.get("allowance", 0),
            "earned": sum(rows.get(k, 0) for k in EARN),
            "penalties": -rows.get("car_park", 0),
            "bought": rows.get("buy", 0),
            "sold": -rows.get("sell", 0),
            "converted": -(rows.get("convert_tokens", 0) + rows.get("convert_gbp", 0)),
        },
    }
