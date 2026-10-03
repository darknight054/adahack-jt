"""Car-free offers: a reverse auction for commutes that would otherwise be by car.

A driver asks for a bonus to walk or cycle in on a given day. At SWITCH_RUN_HOUR the evening before, Jane Street
funds the cheapest asks that fit SWITCH_BUDGET (each is paid what it asked for). A funded offer pays out on that
person's next verified commute, and expires unpaid if they don't make one by the end of the day.
"""
import sqlite3
from datetime import date, datetime, timedelta

from . import config, economy, market
from .db import write
from .economy import LONDON, iso
from .errors import Rejected


def _day(d: str) -> datetime:
    return datetime.combine(date.fromisoformat(d), datetime.min.time(), LONDON)


def runs_at(d: str) -> datetime:
    return _day(d) - timedelta(hours=24 - config.SWITCH_RUN_HOUR)


def open_day(at: datetime) -> str:
    """The next weekday whose auction hasn't run yet: offers made now are for that day."""
    d = economy.day_start(at)
    while True:
        d = economy.day_start(d + timedelta(days=1, hours=12))
        if d.weekday() < 5 and runs_at(d.date().isoformat()) > at:
            return d.date().isoformat()


def day_label(d: str) -> str:
    return _day(d).strftime("%A %-d %b")


def run(conn: sqlite3.Connection, day: str, at: datetime) -> None:
    """Fund the cheapest open asks for `day` that fit the budget; the rest are waitlisted. Call inside write()."""
    left = config.SWITCH_BUDGET
    for o in conn.execute("SELECT id, ask FROM switch_offers WHERE day = ? AND status = 'open' "
                          "ORDER BY ask, created_at", (day,)).fetchall():
        funded = o["ask"] <= left
        left -= o["ask"] if funded else 0
        conn.execute("UPDATE switch_offers SET status = ?, decided_at = ? WHERE id = ?",
                     ("funded" if funded else "waitlisted", iso(at), o["id"]))


def tidy(conn: sqlite3.Connection, at: datetime) -> None:
    """Run any auction whose time has passed and expire funded offers whose day is over. Call inside write()."""
    for (day,) in conn.execute("SELECT DISTINCT day FROM switch_offers WHERE status = 'open'").fetchall():
        if runs_at(day) <= at:
            run(conn, day, runs_at(day))
    conn.execute("UPDATE switch_offers SET status = 'expired' WHERE status = 'funded' AND day < ?",
                 (economy.day_start(at).date().isoformat(),))


def settle(conn: sqlite3.Connection, user_id: int, trip_id: int, at: datetime) -> int:
    """Pay the user's funded offer on a verified commute. Returns the bonus paid. Call inside write()."""
    tidy(conn, at)
    o = conn.execute("SELECT * FROM switch_offers WHERE user_id = ? AND status = 'funded' AND decided_at <= ? "
                     "ORDER BY day LIMIT 1", (user_id, iso(at))).fetchone()
    if not o:
        return 0
    economy.add(conn, user_id, "switch", o["ask"], f"Left the car at home (offer for {day_label(o['day'])})", at,
                f"switch:{o['id']}")
    conn.execute("UPDATE switch_offers SET status = 'paid', trip_id = ? WHERE id = ?", (trip_id, o["id"]))
    return o["ask"]


def _eligible(conn: sqlite3.Connection, user_id: int) -> bool:
    mode = conn.execute("SELECT usual_mode FROM users WHERE id = ?", (user_id,)).fetchone()[0]
    return mode in config.SWITCH_USUAL_MODES


def offer(conn: sqlite3.Connection, user_id: int, ask: int, at: datetime) -> None:
    if not _eligible(conn, user_id):
        raise Rejected(403, "Car-free offers are for colleagues who usually drive in.")
    if not config.SWITCH_ASK_MIN <= ask <= config.SWITCH_ASK_MAX:
        raise Rejected(422, f"Ask for between {config.SWITCH_ASK_MIN} and {config.SWITCH_ASK_MAX} credits.")
    day = open_day(at)
    with write(conn):
        tidy(conn, at)
        if conn.execute("SELECT 1 FROM switch_offers WHERE day = ? AND status != 'open'", (day,)).fetchone():
            raise Rejected(409, f"The auction for {day_label(day)} has already run.")
        conn.execute("INSERT INTO switch_offers (user_id, day, ask, status, created_at) VALUES (?,?,?, 'open', ?) "
                     "ON CONFLICT (user_id, day) DO UPDATE SET ask = excluded.ask, created_at = excluded.created_at "
                     "WHERE status = 'open'",
                     (user_id, day, ask, iso(at)))


def withdraw(conn: sqlite3.Connection, user_id: int, offer_id: int) -> None:
    with write(conn):
        if not conn.execute("DELETE FROM switch_offers WHERE id = ? AND user_id = ? AND status = 'open'",
                            (offer_id, user_id)).rowcount:
            raise Rejected(409, "Only offers waiting for the auction can be withdrawn.")


def run_now(conn: sqlite3.Connection, at: datetime) -> None:
    """Demo only: run the next auction now instead of at SWITCH_RUN_HOUR."""
    with write(conn):
        run(conn, open_day(at), at)


def book(conn: sqlite3.Connection, user_id: int, at: datetime) -> dict:
    if conn.execute("SELECT 1 FROM switch_offers WHERE status = 'open' OR status = 'funded' LIMIT 1").fetchone():
        with write(conn):
            tidy(conn, at)
    day = open_day(at)
    rows = conn.execute("SELECT * FROM switch_offers WHERE day = ? ORDER BY ask, created_at", (day,)).fetchall()
    left, offers = config.SWITCH_BUDGET, []
    for o in rows:
        # While the auction is open, show who the budget would fund if it ran now.
        fits = o["ask"] <= left if o["status"] == "open" else o["status"] in ("funded", "paid")
        left -= o["ask"] if fits else 0
        offers.append({"id": o["id"], "person": market.person(conn, o["user_id"]), "ask": o["ask"],
                       "status": o["status"], "fits": fits, "mine": o["user_id"] == user_id})

    week = economy.week_start(at).date().isoformat()
    mine = conn.execute("SELECT * FROM switch_offers WHERE user_id = ? AND (day >= ? OR (status = 'paid' AND day >= ?)) "
                        "ORDER BY day DESC LIMIT 1",
                        (user_id, economy.day_start(at).date().isoformat(), week)).fetchone()
    paid = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(o.ask), 0) AS credits, COALESCE(SUM(t.car_distance_km), 0) AS car_km "
        "FROM switch_offers o JOIN trips t ON t.id = o.trip_id WHERE o.status = 'paid' AND o.day >= ?", (week,),
    ).fetchone()
    price = market.summary(conn, user_id, at)["last_price_pence"] or market.pence(market.prices(conn)[1])
    return {
        "day": day, "day_label": day_label(day), "runs_at": iso(runs_at(day)),
        "decided": any(o["status"] != "open" for o in offers),
        "budget": config.SWITCH_BUDGET, "ask_min": config.SWITCH_ASK_MIN, "ask_max": config.SWITCH_ASK_MAX,
        "eligible": _eligible(conn, user_id),
        "offers": offers,
        "mine": mine and {"id": mine["id"], "ask": mine["ask"], "status": mine["status"],
                          "day_label": day_label(mine["day"])},
        "week": {"switches": paid["n"], "credits": paid["credits"], "price_pence": price,
                 "co2_kg": round(paid["car_km"] * config.CAR_KG_CO2E_PER_KM, 1)},
    }
