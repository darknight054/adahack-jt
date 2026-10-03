"""Demo replay: one of the user's routes run through the real tracking checks on a simulated clock.

The trip starts the route's duration ago and gets GPS points along the route in the same 15 s batches a phone
sends. It then finishes at the office with the door code for that moment. Verification, credits, the daily
cap and team scores all work as they would for a real commute. Set DEMO_REPLAY=0 to turn this off.
"""
import json
import sqlite3
from datetime import datetime, timedelta

from . import config, economy, trips
from .db import write
from .errors import Rejected
from .places import haversine_m

POINT_EVERY_S = 5  # roughly how often a phone's watchPosition fires while walking


def _along(coords: list[list[float]], duration_s: float) -> list[tuple[int, float, float]]:
    """(seconds from start, lat, lon) every POINT_EVERY_S, at a steady pace along the route."""
    cum = [0.0]
    for a, b in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine_m(a, b))
    out, seg = [], 0
    for t in range(0, int(duration_s) + 1, POINT_EVERY_S):
        target = cum[-1] * t / duration_s
        while seg < len(cum) - 2 and cum[seg + 1] < target:
            seg += 1
        f = (target - cum[seg]) / ((cum[seg + 1] - cum[seg]) or 1)
        a, b = coords[seg], coords[seg + 1]
        out.append((t, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def _fix(lat: float, lon: float, at: datetime) -> dict:
    return {"lat": lat, "lon": lon, "accuracy_m": 10.0, "t_ms": int(at.timestamp() * 1000)}


def replay(conn: sqlite3.Connection, user_id: int, route_id: int, now: datetime) -> dict:
    route = conn.execute("SELECT r.* FROM routes r JOIN users u ON u.area_id = r.area_id WHERE r.id = ? AND u.id = ?",
                         (route_id, user_id)).fetchone()
    if not route:
        raise Rejected(404, "That isn't one of your routes.")
    duration_s = route["duration_min"] * 60
    begin = now - timedelta(seconds=duration_s)
    points = _along(json.loads(route["coords"]), duration_s)

    trip_id = trips.start(conn, user_id, route["mode"], _fix(*points[0][1:], begin), begin)["id"]
    batch, seq = [], 1
    for i, (t, lat, lon) in enumerate(points[1:], start=1):
        batch.append(_fix(lat, lon, begin + timedelta(seconds=t)))
        if t % config.TRACK_UPLOAD_EVERY_S == 0 or i == len(points) - 1:
            trips.add_points(conn, user_id, trip_id, seq, batch, begin + timedelta(seconds=t))
            batch, seq = [], seq + 1
    office = trips.finish_point()
    result = trips.finish(conn, user_id, trip_id, trips.door_code(conn, now), _fix(office["lat"], office["lon"], now),
                          now)

    via = route["name"][0].lower() + route["name"][1:]
    verb = "Walked" if route["mode"] == "walk" else "Cycled"
    with write(conn):
        conn.execute("UPDATE trips SET route_id = ? WHERE id = ?", (route_id, trip_id))
        conn.execute("UPDATE ledger SET detail = ? WHERE user_id = ? AND ref = ?",
                     (f"{verb} in {via}, {result['credited_mi']:.1f} mi (demo replay)", user_id, f"trip:{trip_id}"))
    return result | {"route": route["name"], "simulated_min": round(route["duration_min"]),
                      "capped": economy.earned_today(conn, user_id, now) >= config.DAILY_CAP}
