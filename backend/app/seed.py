"""Builds data/street_miles.db for the demo.

Routes come from OSRM and places from Overpass (real OpenStreetMap data). Users, teams and their history are
generated, but every credit goes through the same rules the API uses (allowance, trip awards and caps, parking,
team bonus, listings and trades), so all totals are computed rather than typed in.

Run: uv run python -m app.seed   (seconds: reuses the routes, places and stops already in the DB)
     uv run python -m app.seed --refetch   (a few minutes: calls OSRM and Overpass again)
"""
import colorsys
import json
import random
import secrets
import shutil
import sys
import time
from datetime import timedelta

from . import auth, config, economy, market, places, routing, switch
from .db import BUNDLED, SCHEMA, connect
from .economy import iso
from .places import haversine_m

# (name, lat, lon, south of the river)
AREAS = [
    ("Bermondsey", 51.4979, -0.0707, True), ("Borough", 51.5016, -0.0943, True),
    ("Elephant and Castle", 51.4946, -0.1003, True), ("Kennington", 51.4882, -0.1053, True),
    ("Vauxhall", 51.4861, -0.1253, True), ("Waterloo", 51.5031, -0.1132, True),
    ("Bankside", 51.5076, -0.0994, True), ("Rotherhithe", 51.5010, -0.0520, True),
    ("Surrey Quays", 51.4934, -0.0475, True), ("Peckham", 51.4740, -0.0690, True),
    ("Camberwell", 51.4740, -0.0930, True), ("Brixton", 51.4627, -0.1145, True),
    ("Clapham", 51.4618, -0.1384, True), ("Deptford", 51.4780, -0.0260, True),
    ("Greenwich", 51.4826, -0.0077, True), ("Wapping", 51.5043, -0.0559, False),
    ("Shoreditch", 51.5246, -0.0786, False), ("Whitechapel", 51.5195, -0.0610, False),
    ("Bethnal Green", 51.5270, -0.0549, False), ("Stepney Green", 51.5216, -0.0465, False),
    ("Limehouse", 51.5123, -0.0397, False), ("Mile End", 51.5249, -0.0332, False),
    ("Bow", 51.5293, -0.0207, False), ("Canary Wharf", 51.5054, -0.0235, False),
    ("Hoxton", 51.5313, -0.0779, False), ("Haggerston", 51.5387, -0.0757, False),
    ("Dalston", 51.5463, -0.0752, False), ("Hackney Central", 51.5470, -0.0560, False),
    ("Hackney Wick", 51.5435, -0.0250, False), ("Stoke Newington", 51.5615, -0.0732, False),
    ("Barbican", 51.5200, -0.0936, False), ("Clerkenwell", 51.5246, -0.1048, False),
    ("Angel", 51.5322, -0.1058, False), ("Highbury", 51.5462, -0.1036, False),
    ("King's Cross", 51.5308, -0.1238, False), ("Bloomsbury", 51.5220, -0.1270, False),
    ("Camden Town", 51.5390, -0.1426, False), ("Kentish Town", 51.5507, -0.1405, False),
]
BRIDGES = {
    "Tower Bridge": (51.5055, -0.0754), "London Bridge": (51.5079, -0.0877),
    "Southwark Bridge": (51.5085, -0.0942), "Blackfriars Bridge": (51.5096, -0.1043),
}
TEAMS = [
    "Equities", "Options", "ETF Trading", "Fixed Income", "Commodities", "FX", "Quant Research", "Trading Infra",
    "Core Dev", "OCaml Tools", "Networking", "Data Platform", "Market Data", "Risk", "Compliance", "Operations",
    "Finance", "Legal", "Recruiting", "Facilities", "Security", "Hardware", "Order Routing", "Clearing",
    "Research Infra", "Desk Support",
]
FIRST = """Priya Tom Mei Jonas Sara Leo Ana Dev Kofi Hannah Ravi Elena Sam Yuki Omar Chloe Aisha Ben Carlos Dana Emeka
Fatima George Hiro Isla Jamal Kai Lena Marcus Nadia Oscar Pia Quinn Rosa Sanjay Tara Umar Vera Wei Xander Yara Zane
Amara Bruno Cleo Diego Esme Felix Grace Hugo Ines Jack Keira Luca Maya Noah Olu Petra Rhys Sofia Theo""".split()
LAST = """Shah Okafor Lin Berg Haddad Marsh Costa Patel Mensah Weiss Iyer Rossi Gold Tanaka Farouk Martin Khan Evans
Silva Novak Adeyemi Murphy Chen Kowalski Hughes Nakamura Osei Reyes Fischer Bell Duarte Ahmed Larsen Price Moreau
Walsh Gupta Ward Ibrahim Klein Byrne Sato Mendes Hart Nguyen Owusu Russo Hall Lund Cohen Bose Grant Petrov Dias
Fraser Kaur Lowe Yilmaz Quinn Abara""".split()
CAR_PARKS = ["London Wall car park", "Minories car park", "Baynard House car park", "Smithfield car park"]
DEMO_USER = ("Priya Shah", "Equities", "Bermondsey", "walk")
DEMO_DRIVER = "Petra Shah"  # always a driver, with no car-free offers yet, to demo them
# Every demo account signs in with its username (first.last) and this password.
DEMO_PASSWORD = "streetmiles"
WEEKS = 4
WALK_MAX_KM = 4.5

rng = random.Random(2026)
OFFICE = {"lat": config.OFFICE["lat"], "lon": config.OFFICE["lon"]}


def _thin(coords: list[list[float]], gap: float = 20) -> list[list[float]]:
    kept = [coords[0]]
    for c in coords[1:-1]:
        if haversine_m(kept[-1], c) >= gap:
            kept.append(c)
    return [[round(a, 5), round(b, 5)] for a, b in kept + [coords[-1]]]


def _colour(i: int) -> str:
    r, g, b = colorsys.hls_to_rgb((i * 0.618034) % 1, 0.42, 0.55)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def _osrm(fn, *args, **kwargs):
    time.sleep(0.25)  # be polite to the free FOSSGIS server
    return fn(*args, **kwargs)


def build_routes(conn) -> None:
    for name, lat, lon, south in AREAS:
        home = {"lat": lat, "lon": lon}
        car = _osrm(routing.route, "car", home, OFFICE)
        area_id = conn.execute(
            "INSERT INTO areas (name, lat, lon, car_distance_km, car_duration_min) VALUES (?,?,?,?,?)",
            (name, lat, lon, car["distance_km"], car["duration_min"]),
        ).lastrowid
        found: list[tuple[str, str, dict]] = []
        if south:
            near = sorted(BRIDGES.items(), key=lambda b: haversine_m([lat, lon], b[1]) + haversine_m(
                b[1], [OFFICE["lat"], OFFICE["lon"]]))[:2]
            for bridge, (blat, blon) in near:
                r = _osrm(routing.routes, "foot", home, {"lat": blat, "lon": blon}, OFFICE)[0]
                found.append(("walk", f"Via {bridge}", r))
        else:
            for r in _osrm(routing.routes, "foot", home, OFFICE, alternatives=True)[:2]:
                label = f"Via {r['main_street']}" if r["main_street"] else "Quickest walk"
                if label not in {f[1] for f in found}:
                    found.append(("walk", label, r))
        bike = _osrm(routing.routes, "bike", home, OFFICE)[0]
        found.append(("cycle", f"Via {bike['main_street']}" if bike["main_street"] else "Quickest by bike", bike))
        for mode in ("walk", "cycle"):
            ranked = sorted((f for f in found if f[0] == mode), key=lambda f: f[2]["distance_km"])
            for rank, (_, label, r) in enumerate(ranked):
                conn.execute(
                    "INSERT INTO routes (area_id, name, mode, distance_km, duration_min, coords, rank) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (area_id, label, mode, r["distance_km"], r["duration_min"], json.dumps(_thin(r["coords"])), rank),
                )
        print(f"  {name}: {len(found)} routes")


def build_places(conn) -> list[dict]:
    pts = [c for (coords,) in conn.execute("SELECT coords FROM routes") for c in json.loads(coords)]
    pad = 0.004
    south, north = min(p[0] for p in pts) - pad, max(p[0] for p in pts) + pad
    west, east = min(p[1] for p in pts) - pad * 1.6, max(p[1] for p in pts) + pad * 1.6
    found: dict[str, dict] = {}
    n = 3
    for i in range(n):
        for j in range(n):
            s = south + (north - south) * i / n
            w = west + (east - west) * j / n
            for attempt in range(4):  # the public Overpass servers time out under load; wait and retry
                try:
                    tile = places.fetch(s, w, s + (north - south) / n, w + (east - west) / n)
                    break
                except Exception as exc:
                    print(f"  tile {i * n + j + 1} failed ({exc}), retrying")
                    time.sleep(20 * (attempt + 1))
            else:
                raise RuntimeError("Overpass kept failing; run the seed again later")
            found.update({p["id"]: p for p in tile})
            print(f"  tile {i * n + j + 1}/{n * n}: {len(tile)} places")
            time.sleep(1)
    rows = list(found.values())
    conn.executemany(
        "INSERT INTO places VALUES (:id, :name, :category, :subtype, :lat, :lon, :brand, :opening_hours, :website)",
        rows,
    )
    return rows


def build_stops(conn, all_places: list[dict]) -> None:
    for rid, coords in conn.execute("SELECT id, coords FROM routes").fetchall():
        for s in places.stops_along(json.loads(coords), all_places):
            conn.execute("INSERT INTO route_stops VALUES (?,?,?,?,?)",
                         (rid, s["place_id"], s["off_route_m"], s["along_km"], s["detour_min"]))


def build_people(conn) -> None:
    for i, name in enumerate(TEAMS):
        conn.execute("INSERT INTO teams (name, colour) VALUES (?,?)", (name, _colour(i)))
    team_ids = dict(conn.execute("SELECT name, id FROM teams").fetchall())
    areas = conn.execute(
        "SELECT a.id, a.name, MIN(r.distance_km) AS walk_km FROM areas a JOIN routes r ON r.area_id = a.id "
        "AND r.mode = 'walk' GROUP BY a.id").fetchall()
    area_by_name = {a["name"]: a for a in areas}
    names = {DEMO_USER[0]}
    password = auth.hash_password(DEMO_PASSWORD)

    def insert(name: str, team_id: int, area_id: int, mode: str) -> None:
        conn.execute("INSERT INTO users (name, username, password_hash, team_id, area_id, usual_mode) "
                     "VALUES (?,?,?,?,?,?)", (name, auth.username_for(name), password, team_id, area_id, mode))

    name, team, area, mode = DEMO_USER
    insert(name, team_ids[team], area_by_name[area]["id"], mode)
    for team in TEAMS:
        size = rng.randint(4, 6) - (1 if team == DEMO_USER[1] else 0)
        for _ in range(size):
            while (name := f"{rng.choice(FIRST)} {rng.choice(LAST)}") in names:
                pass
            names.add(name)
            a = rng.choice(areas)
            roll = rng.random()  # the brief: most Jane Street staff drive in
            mode = "car" if roll < 0.55 else "bus" if roll < 0.65 else (
                "walk" if a["walk_km"] <= WALK_MAX_KM else "cycle")
            if name == DEMO_DRIVER:
                mode = "car"
            insert(name, team_ids[team], a["id"], mode)


def _record_trip(conn, user, mode: str, route, at, car_km: float) -> int:
    distance = route["distance_km"] if route else None
    credits = economy.trip_award(conn, user["id"], mode, distance, at)
    started = at - timedelta(minutes=route["duration_min"] if route else 40)
    trip_id = conn.execute(
        "INSERT INTO trips (user_id, mode, route_id, status, started_at, finished_at, distance_km, car_distance_km, "
        "credits, reasons) VALUES (?,?,?, 'verified', ?,?,?,?,?, '[]')",
        (user["id"], mode, route["id"] if route else None, iso(started), iso(at), distance, car_km, credits),
    ).lastrowid
    if route:
        miles = distance / config.KM_PER_MILE
        via = f" {route['name'][0].lower()}{route['name'][1:]}" if route["name"].startswith("Via") else ""
        detail = f"{'Walked' if mode == 'walk' else 'Cycled'} in{via}, {miles:.1f} mi"
    else:
        detail = f"Came in by {config.FLAT_TRIPS[mode]['label'].lower()}"
    economy.add(conn, user["id"], mode, credits, detail, at, f"trip:{trip_id}")
    return trip_id


def _commute(conn, user, persona, routes_by_area, areas, parks_by_area, at, now, funded: bool) -> None:
    area = areas[user["area_id"]]
    usual = user["usual_mode"]
    active_mode = usual if usual in config.MODES else (
        "walk" if routes_by_area[(area["id"], "walk")][0]["distance_km"] <= WALK_MAX_KM else "cycle")
    p = {"walk": (0.72, 0.08, 0.03, 0.05), "cycle": (0.72, 0.08, 0.03, 0.05),
         "bus": (0.25, 0.55, 0.0, 0.08), "car": (0.2, 0.05, 0.15, 0.5)}[usual]
    p_active = min(0.95, p[0] * persona)
    if funded:  # they asked to be paid to leave the car at home, and most then do
        p, p_active = (0, 0, 0, 0), 0.9
    roll = rng.random()
    if roll < p[3]:
        economy.add(conn, user["id"], "car_park", -config.CAR_PARK_PENALTY, f"Parked at {rng.choice(CAR_PARKS)}", at)
    elif roll < p[3] + p_active:
        options = routes_by_area[(area["id"], active_mode)]
        route = options[0] if len(options) == 1 or rng.random() < 0.7 else rng.choice(options[1:])
        switch.settle(conn, user["id"], _record_trip(conn, user, active_mode, route, at, area["car_distance_km"]), at)
        home_at = at.replace(hour=17) + timedelta(minutes=rng.randint(30, 120))
        if rng.random() < 0.45 and home_at < now:
            _record_trip(conn, user, active_mode, route, home_at, area["car_distance_km"])
    elif roll < p[3] + p_active + p[1]:
        _record_trip(conn, user, "bus", None, at, area["car_distance_km"])
    elif roll < p[3] + p_active + p[1] + p[2]:
        _record_trip(conn, user, "carshare", None, at, area["car_distance_km"])
    if rng.random() < 0.012 and parks_by_area[area["id"]]:
        park = rng.choice(parks_by_area[area["id"]])
        planted = at.replace(hour=12) + timedelta(minutes=rng.randint(0, 240))
        if planted < now:
            review = planted > now - timedelta(hours=36)
            conn.execute("INSERT INTO trees (user_id, place, lat, lon, status, created_at) VALUES (?,?,?,?,?,?)",
                         (user["id"], park["name"], park["lat"], park["lon"], "in_review" if review else "approved",
                          iso(planted)))
            if not review:
                economy.add(conn, user["id"], "tree", config.TREE_PLANTED, f"Planted a tree at {park['name']}", planted)


def _market_day(conn, users, day, progress: float, now) -> None:
    floor, house = market.prices(conn)
    fair = 17 + progress * 7

    def when():
        t = day.replace(hour=10) + timedelta(minutes=rng.randint(0, 420))
        return t if t < now else None

    for user in rng.sample(users, 6):
        at = when()
        available = economy.sellable(conn, user["id"])
        if at is None or available < 60:
            continue
        qty = min(available, rng.randint(3, 25) * 10)
        g = max(floor + 1, min(house - 1, round(fair + rng.uniform(-2, 5))))
        t = max(floor, g - rng.randint(0, 6))
        market.create_listing(conn, user["id"], qty, g, t, at)
    drivers = [u for u in users if u["usual_mode"] in ("car", "bus")] or users
    for _ in range(rng.randint(3, 7)):
        at = when()
        buyer = rng.choice(drivers if rng.random() < 0.7 else users)
        offers = market._open_for(conn, buyer["id"])
        if at is None or not offers:
            continue
        row = rng.choice(offers[:3])
        qty = min(row["qty_remaining"], rng.randint(2, 12) * 10)
        try:
            market.buy(conn, buyer["id"], row["id"], qty, row["price_dp"], at)
        except Exception as exc:  # a seller who spent their credits; the listing is cancelled, as in the app
            print(f"  skipped a fill: {exc}")
    if (at := when()) and rng.random() < 0.25:
        market.buy(conn, rng.choice(drivers)["id"], market.HOUSE, rng.randint(5, 20) * 10, house, at)
    for user in rng.sample(users, 3):
        at = when()
        free = economy.balance(conn, user["id"]) - economy.listed(conn, user["id"])
        if at and free > 700 and rng.random() < 0.6:
            to = "gbp" if rng.random() < 0.15 else "tokens"
            amount = config.MIN_CASHOUT_CREDITS if to == "gbp" else rng.randint(10, 40) * 10
            market.convert(conn, user["id"], to, amount, at)
    for lid, created in conn.execute("SELECT id, created_at FROM listings WHERE status = 'open'").fetchall():
        if economy.parse(created) < day - timedelta(days=4) and rng.random() < 0.3:
            conn.execute("UPDATE listings SET status = 'cancelled' WHERE id = ?", (lid,))


def _offers(conn, users, day: str, now, share: float) -> set[int]:
    """Some drivers make car-free offers for `day`. Returns who was funded, if its auction has run."""
    run_at = switch.runs_at(day)
    for u in users:
        if u["usual_mode"] in config.SWITCH_USUAL_MODES and u["name"] != DEMO_DRIVER and rng.random() < share:
            made = min(run_at, now) - timedelta(minutes=rng.randint(20, 1400))
            if made < now:
                conn.execute("INSERT INTO switch_offers (user_id, day, ask, status, created_at) VALUES (?,?,?, 'open', ?)",
                             (u["id"], day, rng.randint(4, 30) * 5, iso(made)))
    if run_at > now:
        return set()
    switch.run(conn, day, run_at)
    return {r[0] for r in conn.execute("SELECT user_id FROM switch_offers WHERE day = ? AND status = 'funded'", (day,))}


def simulate(conn) -> None:
    now = economy.now()
    users = conn.execute("SELECT * FROM users").fetchall()
    areas = {a["id"]: a for a in conn.execute("SELECT * FROM areas")}
    routes_by_area: dict[tuple[int, str], list] = {}
    for r in conn.execute("SELECT id, area_id, name, mode, distance_km, duration_min FROM routes ORDER BY rank"):
        routes_by_area.setdefault((r["area_id"], r["mode"]), []).append(r)
    parks = conn.execute("SELECT * FROM places WHERE subtype IN ('Park', 'Garden')").fetchall()
    parks_by_area = {a["id"]: [p for p in parks if haversine_m([a["lat"], a["lon"]], [p["lat"], p["lon"]]) < 1500]
                     for a in areas.values()}
    persona = {u["id"]: rng.uniform(0.6, 1.2) for u in users}
    persona[1] = 1.3

    first = economy.week_start(now) - timedelta(weeks=WEEKS - 1)
    for w in range(WEEKS):
        ws = economy.week_start(first + timedelta(days=7 * w + 1))
        for u in users:
            economy.add(conn, u["id"], "allowance", config.WEEKLY_ALLOWANCE, "Weekly allowance from Jane Street", ws,
                        iso(ws))
        for d in range(7):
            day = economy.day_start(ws + timedelta(days=d, hours=12))
            if d < 5:
                recent = now - timedelta(days=14) < day < now
                funded = _offers(conn, users, day.date().isoformat(), now, 0.15) if recent else set()
                for u in users:
                    at = day.replace(hour=8) + timedelta(minutes=rng.randint(-45, 75))
                    if at < now:
                        _commute(conn, u, persona[u["id"]], routes_by_area, areas, parks_by_area, at, now,
                                u["id"] in funded)
            if day > now - timedelta(days=10) and day < now:
                _market_day(conn, users, day, (day - (now - timedelta(days=10))) / timedelta(days=10), now)
        if economy.week_start(ws + timedelta(days=8)) <= now:
            economy.settle_week(conn, ws)

    _offers(conn, users, switch.open_day(now), now, 0.12)
    switch.tidy(conn, now)

    me = conn.execute("SELECT id FROM users WHERE name = ?", (DEMO_USER[0],)).fetchone()["id"]
    floor, house = market.prices(conn)
    if (n := min(120, economy.sellable(conn, me))) >= 10:
        market.create_listing(conn, me, n, 28, 20, now - timedelta(hours=15))


# Map data from OSRM and Overpass. It rarely changes, so a reseed copies it from the previous DB.
MAP_TABLES = ("areas", "routes", "places", "route_stops")


def _has_map(path) -> bool:
    try:
        c = connect(path)
        return all(c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in MAP_TABLES)
    except Exception:
        return False


def main() -> None:
    BUNDLED.parent.mkdir(exist_ok=True)
    previous = BUNDLED.with_suffix(".previous.db")
    reuse = "--refetch" not in sys.argv and BUNDLED.exists() and _has_map(BUNDLED)
    if reuse:
        shutil.copy(BUNDLED, previous)
    BUNDLED.unlink(missing_ok=True)
    conn = connect(BUNDLED)
    conn.executescript(SCHEMA.read_text())
    conn.execute("PRAGMA synchronous = OFF")
    conn.executemany("INSERT INTO settings VALUES (?,?)", [
        ("floor_price_dp", str(config.DEFAULT_FLOOR_PRICE_DECIPENCE)),
        ("house_price_dp", str(config.DEFAULT_HOUSE_PRICE_DECIPENCE)),
        ("office_totp_secret", secrets.token_hex(20)),
        ("staff_key", secrets.token_urlsafe(12)),
        ("session_secret", secrets.token_hex(32)),
    ])
    if reuse:
        print("Routes, places and stops from the previous DB (--refetch calls OSRM and Overpass again)…")
        conn.execute("ATTACH ? AS previous", (str(previous),))
        for t in MAP_TABLES:
            conn.execute(f"INSERT INTO {t} SELECT * FROM previous.{t}")
        conn.commit()
        conn.execute("DETACH previous")
        previous.unlink()
    else:
        print("Routes (OSRM)…")
        build_routes(conn)
        print("Places (Overpass)…")
        found = build_places(conn)
        print("Stops along routes…")
        build_stops(conn, found)
    print("People and four weeks of history…")
    build_people(conn)
    simulate(conn)
    conn.execute("VACUUM")
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("areas", "routes", "places", "route_stops", "teams", "users", "trips", "ledger",
                        "listings", "trades", "trees")}
    print(counts)
    print(f"Sign in as any user with first.last (e.g. priya.shah) and password {DEMO_PASSWORD!r}")
    print("Door kiosk: /door?key=" + conn.execute("SELECT value FROM settings WHERE key = 'staff_key'").fetchone()[0])
    conn.close()


if __name__ == "__main__":
    main()
