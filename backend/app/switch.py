"""Car-free offers: a reverse auction for commutes that would otherwise be by car.

A driver asks for a bonus to walk or cycle in on a given day. At SWITCH_RUN_HOUR the evening before, Jane Street
funds asks in order of credits per mile of driving replaced (so someone who lives further away can ask for more and
still win), until the next one doesn't fit SWITCH_BUDGET. Each funded driver is paid what they asked for. A funded offer pays out on that
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


def _offers(conn: sqlite3.Connection, day: str, status: str | None = None) -> list:
    """`day`'s offers in merit order: fewest credits per mile of driving replaced first, then earliest."""
    rows = conn.execute(
        "SELECT o.*, a.car_distance_km AS car_km, a.name AS area FROM switch_offers o "
        "JOIN users u ON u.id = o.user_id JOIN areas a ON a.id = u.area_id "
        "WHERE o.day = ? AND (? IS NULL OR o.status = ?)", (day, status, status)).fetchall()
    return sorted(rows, key=lambda o: (o["ask"] / o["car_km"], o["created_at"]))


def run(conn: sqlite3.Connection, day: str, at: datetime) -> None:
    """Fund open asks for `day` in merit order until one doesn't fit the budget; the rest are waitlisted.
    Call inside write()."""
    left, full = config.SWITCH_BUDGET, False
    for o in _offers(conn, day, "open"):
        funded = not full and o["ask"] <= left
        full = not funded
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
    rows = _offers(conn, day)
    left, full, offers = config.SWITCH_BUDGET, False, []
    for o in rows:
        # While the auction is open, show who the budget would fund if it ran now.
        fits = (not full and o["ask"] <= left) if o["status"] == "open" else o["status"] in ("funded", "paid")
        full = full or not fits
        left -= o["ask"] if fits else 0
        offers.append({"id": o["id"], "person": market.person(conn, o["user_id"]), "ask": o["ask"],
                       "area": o["area"], "car_mi": round(o["car_km"] / config.KM_PER_MILE, 1),
                       "per_mile": round(o["ask"] / (o["car_km"] / config.KM_PER_MILE), 1),
                       "status": o["status"], "fits": fits, "mine": o["user_id"] == user_id})

    # The most this user could ask and still be funded, if no other offers came in before the auction.
    my_km = conn.execute("SELECT a.car_distance_km FROM users u JOIN areas a ON a.id = u.area_id WHERE u.id = ?",
                         (user_id,)).fetchone()[0]
    others = [(o["ask"] / o["car_km"], o["ask"]) for o in rows if o["status"] == "open" and o["user_id"] != user_id]
    decided = any(o["status"] != "open" for o in rows)
    fund_up_to = None if decided else next(
        (a for a in range(config.SWITCH_ASK_MAX, config.SWITCH_ASK_MIN - 1, -1)
         if sum(x for k, x in others if k <= a / my_km) + a <= config.SWITCH_BUDGET), None)
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
        "decided": decided,
        "budget": config.SWITCH_BUDGET, "ask_min": config.SWITCH_ASK_MIN, "ask_max": config.SWITCH_ASK_MAX,
        "eligible": _eligible(conn, user_id), "fund_up_to": fund_up_to, "my_car_mi": round(my_km / config.KM_PER_MILE, 1),
        "offers": offers,
        "mine": mine and {"id": mine["id"], "ask": mine["ask"], "status": mine["status"],
                          "day_label": day_label(mine["day"]),
                          "trip_credits": mine["trip_id"] and conn.execute(
                              "SELECT credits FROM trips WHERE id = ?", (mine["trip_id"],)).fetchone()[0]},
        "week": {"switches": paid["n"], "credits": paid["credits"], "price_pence": price,
                 "co2_kg": round(paid["car_km"] * config.CAR_KG_CO2E_PER_KM, 1)},
    }
