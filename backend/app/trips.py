"""Commute tracking: a foreground GPS track plus a rotating door code, checked on the server (docs/TRACKING.md)."""
import hashlib
import hmac
import json
import os
import sqlite3
import struct
from datetime import UTC, datetime, timedelta

from . import config, economy, routing, switch
from .db import setting, write
from .economy import iso
from .errors import Rejected
from .places import RouteIndex, haversine_m


def finish_point() -> dict:
    """The office, unless TRACKING_OFFICE="lat,lon" moves the finish line (e.g. for a demo away from London)."""
    if override := os.environ.get("TRACKING_OFFICE"):
        lat, lon = (float(x) for x in override.split(","))
        return {"lat": lat, "lon": lon}
    return {"lat": config.OFFICE["lat"], "lon": config.OFFICE["lon"]}


def _secret(conn: sqlite3.Connection) -> bytes:
    return (os.environ.get("OFFICE_TOTP_SECRET") or setting(conn, "office_totp_secret")).encode()


def door_code(conn: sqlite3.Connection, at: datetime, offset: int = 0) -> str:
    """RFC 6238 TOTP: 6 digits, 30 s steps."""
    step = int(at.timestamp()) // config.TOTP_STEP_S + offset
    digest = hmac.new(_secret(conn), struct.pack(">Q", step), hashlib.sha1).digest()
    o = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def door_code_valid(conn: sqlite3.Connection, code: str, at: datetime) -> bool:
    return any(hmac.compare_digest(code, door_code(conn, at, k)) for k in (-1, 0, 1))


def staff_key_valid(conn: sqlite3.Connection, key: str | None) -> bool:
    expected = os.environ.get("STAFF_KEY") or setting(conn, "staff_key")
    return bool(key) and hmac.compare_digest(key, expected)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _active(conn: sqlite3.Connection, user_id: int, at: datetime) -> sqlite3.Row | None:
    stale = iso(at - timedelta(hours=config.TRACK_STALE_AFTER_H))
    conn.execute("UPDATE trips SET status = 'abandoned' WHERE user_id = ? AND status = 'active' AND started_at < ?",
                 (user_id, stale))
    return conn.execute("SELECT * FROM trips WHERE user_id = ? AND status = 'active'", (user_id,)).fetchone()


def _store_points(conn, trip_id: int, seq: int, points: list[dict], at: datetime) -> tuple[int, list[dict]]:
    accepted, dropped = 0, []
    for i, p in enumerate(points):
        age_s = (_ms(at) - p["t_ms"]) / 1000
        if age_s < -30:
            dropped.append({"i": i, "reason": "timestamp in the future"})
        elif age_s > config.TRACK_MAX_POINT_AGE_S:
            dropped.append({"i": i, "reason": "sent too late"})
        elif p["accuracy_m"] > config.TRACK_MAX_ACCURACY_M:
            dropped.append({"i": i, "reason": "location too coarse"})
        else:
            cur = conn.execute(
                "INSERT OR IGNORE INTO trip_points VALUES (?,?,?,?,?,?,?,?)",
                (trip_id, seq, i, iso(datetime.fromtimestamp(p["t_ms"] / 1000, UTC)), iso(at),
                 p["lat"], p["lon"], p["accuracy_m"]),
            )
            accepted += cur.rowcount
    return accepted, dropped


def active(conn: sqlite3.Connection, user_id: int, at: datetime) -> dict | None:
    with write(conn):
        trip = _active(conn, user_id, at)
    if not trip:
        return None
    count = conn.execute("SELECT COUNT(*) FROM trip_points WHERE trip_id = ?", (trip["id"],)).fetchone()[0]
    return {"id": trip["id"], "mode": trip["mode"], "started_at": trip["started_at"], "points": count,
            "upload_every_s": config.TRACK_UPLOAD_EVERY_S, "max_accuracy_m": config.TRACK_MAX_ACCURACY_M}


def start(conn: sqlite3.Connection, user_id: int, mode: str, fix: dict, at: datetime) -> dict:
    with write(conn):
        if _active(conn, user_id, at):
            raise Rejected(409, "You already have a commute in progress. Finish or cancel it first.")
        cur = conn.execute("INSERT INTO trips (user_id, mode, status, started_at) VALUES (?,?, 'active', ?)",
                           (user_id, mode, iso(at)))
        _store_points(conn, cur.lastrowid, 0, [fix], at)
    return active(conn, user_id, at)


def add_points(conn: sqlite3.Connection, user_id: int, trip_id: int, seq: int, points: list[dict],
               at: datetime) -> dict:
    with write(conn):
        trip = _active(conn, user_id, at)
        if not trip or trip["id"] != trip_id:
            raise Rejected(409, "This commute is no longer in progress.")
        accepted, dropped = _store_points(conn, trip_id, seq, points, at)
    return {"accepted": accepted, "dropped": dropped}


def cancel(conn: sqlite3.Connection, user_id: int, trip_id: int) -> None:
    with write(conn):
        conn.execute("UPDATE trips SET status = 'abandoned' WHERE id = ? AND user_id = ? AND status = 'active'",
                     (trip_id, user_id))


def _check(conn, trip: sqlite3.Row, pts: list[sqlite3.Row], at: datetime) -> tuple[str, list[str], dict]:
    """Returns (status, reasons, routed) where routed is the OSRM route from the first fix to the finish."""
    mode = trip["mode"]
    reject, review = [], []
    times = [economy.parse(p["t_client"]).timestamp() for p in pts]
    coords = [[p["lat"], p["lon"]] for p in pts]
    end = finish_point()
    routed = routing.route(config.MODES[mode]["osrm_profile"], {"lat": coords[0][0], "lon": coords[0][1]}, end)

    duration_s = (at - economy.parse(trip["started_at"])).total_seconds()
    if duration_s < routed["duration_min"] * 60 * config.TRACK_MIN_DURATION_FACTOR:
        reject.append(f"Arrived faster than anyone could {mode} that route.")

    gaps = [(times[i + 1] - times[i], haversine_m(coords[i], coords[i + 1])) for i in range(len(pts) - 1)]
    lo, hi, window_max = config.TRACK_SPEED_KMH[mode]
    if any(dt > config.TRACK_MAX_GAP_S and d / dt * 3.6 > window_max for dt, d in gaps):
        reject.append("The track jumps further than you could travel in the gap, as on the Tube or in a car.")
    elif any(dt > config.TRACK_MAX_GAP_S for dt, _ in gaps):
        review.append("Tracking paused for more than 3 minutes. Keep the page open with the screen on.")
    if times[-1] - times[0] < duration_s * config.TRACK_MIN_COVERAGE:
        review.append("The track covers too little of the trip.")

    tracked_s = max(times[-1] - times[0], 1)
    avg_kmh = sum(d for _, d in gaps) / tracked_s * 3.6
    fast_s = 0.0
    i = 0
    for j in range(len(pts)):
        while times[j] - times[i] > 60:
            i += 1
        span = times[j] - times[i]
        if span >= 30 and sum(d for _, d in gaps[i:j]) / span * 3.6 > window_max:
            fast_s += gaps[j - 1][0] if j else 0
    if avg_kmh > hi or fast_s > 120:
        reject.append(f"Too fast for {config.MODES[mode]['label'].lower()}ing ({avg_kmh:.0f} km/h on average).")

    corridors = [RouteIndex(routed["coords"])] + [
        RouteIndex(json.loads(r["coords"])) for r in conn.execute(
            "SELECT coords FROM routes WHERE area_id = (SELECT area_id FROM users WHERE id = ?)", (trip["user_id"],))
    ]
    inside = sum(1 for p in coords if min(c.nearest(*p)[0] for c in corridors) <= config.TRACK_CORRIDOR_M)
    if inside / len(coords) < config.TRACK_MIN_IN_CORRIDOR:
        review.append("Most of the track is off your usual routes, so a person will check it.")

    if economy.parked_on(conn, trip["user_id"], at):
        reject.append("You parked a car today, so today's commute doesn't earn credits.")
    status = "rejected" if reject else "review" if review else "verified"
    return status, reject + review, routed


def finish(conn: sqlite3.Connection, user_id: int, trip_id: int, office_code: str, fix: dict, at: datetime) -> dict:
    trip = conn.execute("SELECT * FROM trips WHERE id = ? AND user_id = ?", (trip_id, user_id)).fetchone()
    if not trip or trip["status"] != "active":
        raise Rejected(409, "This commute is no longer in progress.")
    if not door_code_valid(conn, office_code, at):
        raise Rejected(422, "That door code has expired or is wrong. Scan the code on the office door again.")
    if haversine_m([fix["lat"], fix["lon"]], [finish_point()["lat"], finish_point()["lon"]]) > config.TRACK_FINISH_RADIUS_M:
        raise Rejected(422, "You need to be at the office door to finish. Your location is too far away.")
    with write(conn):
        _store_points(conn, trip_id, 1_000_000, [fix], at)
    pts = conn.execute("SELECT * FROM trip_points WHERE trip_id = ? ORDER BY t_client", (trip_id,)).fetchall()
    if len(pts) < 3:
        status, reasons, routed = "rejected", ["Not enough location points were recorded."], None
    else:
        status, reasons, routed = _check(conn, trip, pts, at)

    credits = bonus = 0
    distance_km = routed["distance_km"] if routed else None
    car = routing.route("car", {"lat": pts[0]["lat"], "lon": pts[0]["lon"]}, finish_point()) if routed else None
    with write(conn):
        if status == "verified":
            credits = economy.trip_award(conn, user_id, trip["mode"], distance_km, at)
            miles = distance_km / config.KM_PER_MILE
            economy.add(conn, user_id, trip["mode"], credits,
                        f"{'Walked' if trip['mode'] == 'walk' else 'Cycled'} in, {miles:.1f} mi", at, f"trip:{trip_id}")
            bonus = switch.settle(conn, user_id, trip_id, at)
        conn.execute(
            "UPDATE trips SET status = ?, finished_at = ?, distance_km = ?, car_distance_km = ?, credits = ?, "
            "reasons = ? WHERE id = ?",
            (status, iso(at), distance_km, car["distance_km"] if car else None, credits, json.dumps(reasons), trip_id),
        )
    return {"status": status, "credits": credits, "switch_bonus": bonus,
            "credited_mi": round(distance_km / config.KM_PER_MILE, 2) if distance_km else 0, "reasons": reasons}
