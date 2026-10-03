import json
import sqlite3
from datetime import timedelta
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import auth, config, economy, market, trips
from .db import get_conn, write
from .economy import iso, now
from .errors import Rejected

app = FastAPI(title="Street Miles API")
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


@app.exception_handler(Rejected)
def rejected(_req: Request, exc: Rejected):
    return JSONResponse(status_code=exc.status, content={"detail": exc.detail})


@app.exception_handler(httpx.HTTPError)
def upstream_failed(_req: Request, exc: httpx.HTTPError):
    return JSONResponse(status_code=502, content={"detail": f"A map service didn't answer: {exc}"})


def current_user(request: Request, conn: Conn) -> sqlite3.Row:
    uid = auth.verify(conn, request.cookies.get(auth.COOKIE))
    user = uid and conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not user:
        raise Rejected(401, "Sign in to continue.")
    economy.ensure_current(conn, user["id"], now())
    return user


User = Annotated[sqlite3.Row, Depends(current_user)]


# --- Auth ---

class Login(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: Login, response: Response, conn: Conn):
    user = conn.execute("SELECT * FROM users WHERE username = ?", (body.username.strip().lower(),)).fetchone()
    if not user or not auth.check_password(body.password, user["password_hash"]):
        raise Rejected(401, "That username and password don't match.")
    response.set_cookie(auth.COOKIE, auth.sign(conn, user["id"]), max_age=auth.MAX_AGE_S, httponly=True,
                        samesite="lax", secure=False)
    return me(user, conn)


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(auth.COOKIE)


@app.get("/api/me")
def me(user: User, conn: Conn):
    area = conn.execute("SELECT name FROM areas WHERE id = ?", (user["area_id"],)).fetchone()["name"]
    return market.person(conn, user["id"]) | {"username": user["username"], "team_id": user["team_id"],
                                               "home_label": area}


# --- Reference data ---

@app.get("/api/config")
def get_config(conn: Conn):
    floor, house = market.prices(conn)
    return {
        "office": config.OFFICE,
        "modes": {k: {"label": v["label"], "credits_per_mile": v["credits_per_mile"]} for k, v in config.MODES.items()},
        "flat_trips": config.FLAT_TRIPS,
        "credits": {
            "weekly_allowance": config.WEEKLY_ALLOWANCE,
            "car_park_penalty": config.CAR_PARK_PENALTY,
            "tree_planted": config.TREE_PLANTED,
            "team_win_bonus": config.TEAM_WIN_BONUS,
            "daily_cap": config.DAILY_CAP,
            "min_leg_mi": config.MIN_LEG_MI,
        },
        "conversions": {
            "tokens_per_credit": config.TOKENS_PER_CREDIT,
            "pence_per_credit": config.PENCE_PER_CREDIT,
            "min_cashout_credits": config.MIN_CASHOUT_CREDITS,
        },
        "market": {"floor_price_pence": market.pence(floor), "house_price_pence": market.pence(house)},
    }


def _area_mode(conn: sqlite3.Connection, area_id: int) -> str:
    walk = conn.execute("SELECT MIN(distance_km) FROM routes WHERE area_id = ? AND mode = 'walk'",
                        (area_id,)).fetchone()[0]
    return "walk" if walk <= 4.5 else "cycle"


@app.get("/api/network")
def network(conn: Conn):
    out = []
    for a in conn.execute("SELECT a.id, a.name, COUNT(u.id) AS n FROM areas a JOIN users u ON u.area_id = a.id "
                          "GROUP BY a.id"):
        mode = _area_mode(conn, a["id"])
        r = conn.execute("SELECT coords FROM routes WHERE area_id = ? AND mode = ? AND rank = 0",
                         (a["id"], mode)).fetchone()
        out.append({"id": a["id"], "label": a["name"], "mode": mode, "colleagues": a["n"],
                    "coords": json.loads(r["coords"])})
    return out


@app.get("/api/stats/week")
def week_stats(conn: Conn):
    start = iso(economy.week_start(now()))
    t = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS people, "
        "SUM(CASE WHEN mode = 'walk' THEN distance_km END) AS walk_km, "
        "SUM(CASE WHEN mode = 'cycle' THEN distance_km END) AS cycle_km, "
        "SUM(CASE WHEN mode IN ('walk','cycle') THEN car_distance_km END) AS car_km "
        "FROM trips WHERE status = 'verified' AND finished_at >= ?", (start,)).fetchone()
    one = lambda sql: conn.execute(sql, (start,)).fetchone()[0] or 0  # noqa: E731
    return {
        "participants": t["people"],
        "miles_walked": round((t["walk_km"] or 0) / config.KM_PER_MILE, 1),
        "miles_cycled": round((t["cycle_km"] or 0) / config.KM_PER_MILE, 1),
        "co2_kg_avoided": round((t["car_km"] or 0) * config.CAR_KG_CO2E_PER_KM),
        "trees_planted": one("SELECT COUNT(*) FROM trees WHERE status = 'approved' AND created_at >= ?"),
        "car_parks": one("SELECT COUNT(*) FROM ledger WHERE kind = 'car_park' AND created_at >= ?"),
        "credits_traded": one("SELECT SUM(qty) FROM trades WHERE created_at >= ?"),
    }


# --- Routes and trips ---

def _day_cost_gbp(car_km: float) -> float:
    fuel = 2 * car_km / config.KM_PER_MILE * config.FUEL_GBP_PER_MILE
    return config.CONGESTION_CHARGE_GBP + config.PARKING_GBP_PER_HOUR * config.PARKING_HOURS + fuel


@app.get("/api/routes")
def get_routes(user: User, conn: Conn):
    area = conn.execute("SELECT * FROM areas WHERE id = ?", (user["area_id"],)).fetchone()
    car_min = area["car_duration_min"] * config.CAR_PEAK_FACTOR + config.PARKING_SEARCH_MIN
    co2_day = 2 * area["car_distance_km"] * config.CAR_KG_CO2E_PER_KM
    rows = conn.execute("SELECT * FROM routes WHERE area_id = ? ORDER BY mode != ?, rank",
                        (area["id"], user["usual_mode"] if user["usual_mode"] in config.MODES else "walk")).fetchall()
    out = []
    for r in rows:
        miles = r["distance_km"] / config.KM_PER_MILE
        rate = config.MODES[r["mode"]]
        out.append({
            "id": r["id"], "name": r["name"], "mode": r["mode"],
            "distance_km": round(r["distance_km"], 2), "distance_mi": round(miles, 2),
            "duration_min": round(r["duration_min"]),
            "credits": min(round(miles * rate["credits_per_mile"]), config.DAILY_CAP) if miles >= config.MIN_LEG_MI else 0,
            "coords": json.loads(r["coords"]),
            "stats": {
                "active_min": round(r["duration_min"]), "car_min": round(car_min),
                "co2_kg_day": round(co2_day, 2), "money_day_gbp": round(_day_cost_gbp(area["car_distance_km"]), 2),
                "kcal_trip": round(rate["met"] * config.BODY_KG * r["duration_min"] / 60),
            },
        })
    return {"home_label": area["name"], "routes": out}


@app.get("/api/routes/{route_id}/stops")
def get_stops(route_id: int, _user: User, conn: Conn):
    rows = conn.execute(
        "SELECT p.*, s.off_route_m, s.along_km, s.detour_min FROM route_stops s JOIN places p ON p.id = s.place_id "
        "WHERE s.route_id = ? ORDER BY s.along_km", (route_id,)).fetchall()
    return [dict(r) | {"brand": bool(r["brand"]), "osm_url": f"https://www.openstreetmap.org/{r['id']}"}
            for r in rows]


@app.get("/api/trips")
def get_trips(user: User, conn: Conn):
    start = iso(economy.week_start(now()))
    rows = conn.execute(
        "SELECT t.*, r.name AS route_name FROM trips t LEFT JOIN routes r ON r.id = t.route_id "
        "WHERE t.user_id = ? AND t.status != 'active' ORDER BY t.started_at DESC LIMIT 12", (user["id"],)).fetchall()
    week = conn.execute(
        "SELECT COUNT(*) AS n, SUM(distance_km) AS km, SUM(car_distance_km) AS car_km FROM trips "
        "WHERE user_id = ? AND status = 'verified' AND mode IN ('walk','cycle') AND finished_at >= ?",
        (user["id"], start)).fetchone()
    car_km = conn.execute("SELECT car_distance_km FROM areas WHERE id = ?", (user["area_id"],)).fetchone()[0]
    active = lambda t: t["mode"] in config.MODES and t["status"] == "verified"  # noqa: E731
    return {
        "week": {
            "commutes": week["n"],
            "miles": round((week["km"] or 0) / config.KM_PER_MILE, 1),
            "co2_kg_avoided": round((week["car_km"] or 0) * config.CAR_KG_CO2E_PER_KM, 1),
            "money_saved_gbp": round(week["n"] * _day_cost_gbp(car_km) / 2, 2),
        },
        "trips": [{
            "id": t["id"],
            "mode": t["mode"],
            "status": t["status"],
            "route_name": t["route_name"] or (config.MODES.get(t["mode"]) or config.FLAT_TRIPS[t["mode"]])["label"],
            "distance_mi": round(t["distance_km"] / config.KM_PER_MILE, 2) if t["distance_km"] else None,
            "credits": t["credits"],
            "co2_kg_avoided": round(t["car_distance_km"] * config.CAR_KG_CO2E_PER_KM, 2) if active(t) else 0,
            "fuel_gbp_saved": round(t["car_distance_km"] / config.KM_PER_MILE * config.FUEL_GBP_PER_MILE, 2)
            if active(t) else 0,
            "reasons": json.loads(t["reasons"] or "[]"),
            "at": t["finished_at"] or t["started_at"],
        } for t in rows],
    }


class Fix(BaseModel):
    lat: float
    lon: float
    accuracy_m: float
    t_ms: int


class StartTrip(BaseModel):
    mode: Literal["walk", "cycle"]
    fix: Fix


class TripPoints(BaseModel):
    seq: int
    points: list[Fix] = Field(max_length=200)


class FinishTrip(BaseModel):
    office_code: str
    fix: Fix


@app.get("/api/trips/active")
def trip_active(user: User, conn: Conn):
    return trips.active(conn, user["id"], now())


@app.post("/api/trips/start")
def trip_start(body: StartTrip, user: User, conn: Conn):
    return trips.start(conn, user["id"], body.mode, body.fix.model_dump(), now())


@app.post("/api/trips/{trip_id}/points")
def trip_points(trip_id: int, body: TripPoints, user: User, conn: Conn):
    return trips.add_points(conn, user["id"], trip_id, body.seq, [p.model_dump() for p in body.points], now())


@app.post("/api/trips/{trip_id}/finish")
def trip_finish(trip_id: int, body: FinishTrip, user: User, conn: Conn):
    return trips.finish(conn, user["id"], trip_id, body.office_code.strip(), body.fix.model_dump(), now())


@app.post("/api/trips/{trip_id}/cancel", status_code=204)
def trip_cancel(trip_id: int, user: User, conn: Conn):
    trips.cancel(conn, user["id"], trip_id)


@app.get("/api/office/code")
def office_code(conn: Conn, x_staff_key: Annotated[str | None, Header()] = None):
    """For the screen on the office door, which shows this code as a QR."""
    if not trips.staff_key_valid(conn, x_staff_key):
        raise Rejected(403, "This screen needs the staff key.")
    at = now()
    return {"code": trips.door_code(conn, at), "expires_in": config.TOTP_STEP_S - int(at.timestamp()) % config.TOTP_STEP_S}


# --- Team ---

def _teammates(conn: sqlite3.Connection, user: sqlite3.Row) -> list[int]:
    return [r[0] for r in conn.execute("SELECT id FROM users WHERE team_id = ? AND id != ?",
                                       (user["team_id"], user["id"]))]


@app.get("/api/activity")
def activity(user: User, conn: Conn, scope: Literal["team"] = "team"):
    ids = _teammates(conn, user)
    rows = conn.execute(
        f"SELECT * FROM ledger WHERE user_id IN ({','.join('?' * len(ids))}) AND kind IN "
        "('walk','cycle','bus','carshare','tree','car_park','sell','team_bonus') ORDER BY created_at DESC LIMIT 15",
        ids).fetchall() if ids else []
    return [{"id": r["id"], "user": market.person(conn, r["user_id"]), "kind": r["kind"], "credits": r["credits"],
             "detail": r["detail"], "at": r["created_at"]} for r in rows]


@app.get("/api/team/trees")
def team_trees(user: User, conn: Conn):
    ids = _teammates(conn, user)
    rows = conn.execute(
        f"SELECT user_id, place, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS trees FROM trees "
        f"WHERE status = 'approved' AND lat IS NOT NULL AND user_id IN ({','.join('?' * len(ids))}) "
        "GROUP BY user_id, place", ids).fetchall() if ids else []
    return [{"user": market.person(conn, r["user_id"]), "place": r["place"], "lat": r["lat"], "lon": r["lon"],
             "trees": r["trees"]} for r in rows]


@app.post("/api/trees")
async def plant_tree(user: User, conn: Conn, photo: Annotated[UploadFile, File()],
                     place: Annotated[str, Form()] = "", lat: Annotated[float | None, Form()] = None,
                     lon: Annotated[float | None, Form()] = None):
    if not (photo.content_type or "").startswith("image/"):
        raise Rejected(422, "Add a photo of the tree you planted.")
    data = await photo.read()
    with write(conn):
        tid = conn.execute(
            "INSERT INTO trees (user_id, place, lat, lon, photo, photo_type, status, created_at) "
            "VALUES (?,?,?,?,?,?, 'in_review', ?)",
            (user["id"], place.strip() or "Not given", lat, lon, data, photo.content_type, iso(now()))).lastrowid
    return {"id": tid, "status": "in_review", "credits": config.TREE_PLANTED}


@app.post("/api/trees/{tree_id}/approve")
def approve_tree(tree_id: int, conn: Conn, x_staff_key: Annotated[str | None, Header()] = None):
    if not trips.staff_key_valid(conn, x_staff_key):
        raise Rejected(403, "Approving trees needs the staff key.")
    at = now()
    with write(conn):
        tree = conn.execute("SELECT * FROM trees WHERE id = ? AND status = 'in_review'", (tree_id,)).fetchone()
        if not tree:
            raise Rejected(404, "No tree waiting for review with that id.")
        conn.execute("UPDATE trees SET status = 'approved' WHERE id = ?", (tree_id,))
        economy.add(conn, tree["user_id"], "tree", config.TREE_PLANTED, f"Planted a tree at {tree['place']}", at,
                    f"tree:{tree_id}")
    return {"id": tree_id, "status": "approved"}


@app.get("/api/leaderboard")
def leaderboard(user: User, conn: Conn, q: str = ""):
    at = now()
    start, end = economy.week_bounds(at)
    scores = economy.team_scores(conn, start, end)
    ranked, prev, rank = [], None, 0
    for i, s in enumerate(scores):
        rank = rank if s["credits"] == prev else i + 1
        prev = s["credits"]
        ranked.append(dict(s) | {"rank": rank})
    last = iso(economy.week_start(start - timedelta(days=3)))
    winners = conn.execute("SELECT t.id, t.name, t.colour, a.credits FROM team_awards a JOIN teams t "
                           "ON t.id = a.team_id WHERE a.week_start = ?", (last,)).fetchall()
    needle = q.strip().lower()
    return {
        "week": {"starts_at": iso(start), "ends_at": iso(end)},
        "bonus_per_member": config.TEAM_WIN_BONUS,
        "my_team_id": user["team_id"],
        "total_teams": len(ranked),
        "leader_credits": ranked[0]["credits"] if ranked else 0,
        "my_team": next(t for t in ranked if t["id"] == user["team_id"]),
        "teams": [t for t in ranked if needle in t["name"].lower()],
        "last_winners": [dict(w) for w in winners],
    }


# --- Wallet and market ---

@app.get("/api/wallet")
def get_wallet(user: User, conn: Conn):
    return economy.wallet(conn, user["id"], now())


class Convert(BaseModel):
    to: Literal["tokens", "gbp"]
    credits: int


@app.post("/api/wallet/convert")
def convert(body: Convert, user: User, conn: Conn):
    return market.convert(conn, user["id"], body.to, body.credits, now())


@app.get("/api/market")
def market_summary(user: User, conn: Conn):
    return market.summary(conn, user["id"], now())


@app.get("/api/market/listings")
def listings(user: User, conn: Conn):
    return market.listings(conn, user["id"])


@app.get("/api/market/listings/mine")
def my_listings(user: User, conn: Conn):
    return market.my_listings(conn, user["id"])


class NewListing(BaseModel):
    qty: int
    global_price_pence: float
    teammate_price_pence: float


@app.post("/api/market/listings")
def create_listing(body: NewListing, user: User, conn: Conn):
    return market.create_listing(conn, user["id"], body.qty, round(body.global_price_pence * 10),
                                 round(body.teammate_price_pence * 10), now())


@app.delete("/api/market/listings/{listing_id}", status_code=204)
def cancel_listing(listing_id: int, user: User, conn: Conn):
    market.cancel_listing(conn, user["id"], listing_id)


class Buy(BaseModel):
    listing_id: int | Literal["house"]
    qty: int
    price_pence: float


@app.post("/api/market/buy")
def buy(body: Buy, user: User, conn: Conn):
    return market.buy(conn, user["id"], body.listing_id, body.qty, round(body.price_pence * 10), now())


@app.get("/api/market/trades")
def my_trades(user: User, conn: Conn):
    return market.my_trades(conn, user["id"])
