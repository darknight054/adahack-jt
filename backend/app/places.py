import math

import httpx

from . import config
from .routing import HEADERS

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
POI_FILTERS = [
    '["amenity"="cafe"]["name"]',
    '["shop"="coffee"]["name"]',
    '["shop"~"^(bakery|pastry)$"]["name"]',
    '["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"breakfast|brunch|bagel",i]["name"]',
    '["leisure"~"^(park|garden)$"]["name"]',
    '["tourism"~"^(viewpoint|attraction|artwork|museum)$"]["name"]',
    '["historic"~"^(monument|ruins|church|city_gate|archaeological_site|castle)$"]["name"]',
]
EARTH_R = 6371000.0


def haversine_m(a: list[float], b: list[float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def _thin(coords: list[list[float]], min_gap_m: float) -> list[list[float]]:
    kept = [coords[0]]
    for pt in coords[1:-1]:
        if haversine_m(kept[-1], pt) >= min_gap_m:
            kept.append(pt)
    return kept + [coords[-1]]


class RouteIndex:
    """Distance from a point to the route, and how far along the route that point is."""

    def __init__(self, coords: list[list[float]]):
        self.cos_lat = math.cos(math.radians(coords[0][0]))
        self.xy = [self._xy(lat, lon) for lat, lon in coords]
        self.cum = [0.0]
        for (ax, ay), (bx, by) in zip(self.xy, self.xy[1:]):
            self.cum.append(self.cum[-1] + math.hypot(bx - ax, by - ay))

    def _xy(self, lat: float, lon: float) -> tuple[float, float]:
        return math.radians(lon) * EARTH_R * self.cos_lat, math.radians(lat) * EARTH_R

    def nearest(self, lat: float, lon: float) -> tuple[float, float]:
        px, py = self._xy(lat, lon)
        best = (math.inf, 0.0)
        for i, ((ax, ay), (bx, by)) in enumerate(zip(self.xy, self.xy[1:])):
            dx, dy = bx - ax, by - ay
            seg2 = dx * dx + dy * dy
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d < best[0]:
                best = (d, self.cum[i] + t * math.sqrt(seg2))
        return best


def _overpass(query: str) -> list[dict]:
    error: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            resp = httpx.post(url, data={"data": query}, headers=HEADERS, timeout=200)
            resp.raise_for_status()
            return resp.json()["elements"]
        except httpx.HTTPError as exc:
            error = exc
    raise error


def _classify(tags: dict) -> tuple[str, str] | None:
    if tags.get("access") in ("private", "no"):
        return None
    cuisine = tags.get("cuisine", "").lower()
    if tags.get("shop") in ("bakery", "pastry"):
        return "breakfast", "Bakery"
    if any(k in cuisine for k in ("breakfast", "brunch", "bagel")):
        return "breakfast", "Breakfast"
    if tags.get("amenity") == "cafe" or tags.get("shop") == "coffee":
        return "coffee", "Café"
    if tags.get("tourism") == "viewpoint":
        return "scenic", "Viewpoint"
    if tags.get("leisure") in ("park", "garden"):
        return "scenic", tags["leisure"].capitalize()
    if tags.get("historic"):
        return "scenic", "Historic " + tags["historic"].replace("_", " ")
    if tags.get("tourism"):
        return "scenic", tags["tourism"].capitalize()
    return None


def fetch(south: float, west: float, north: float, east: float) -> list[dict]:
    """Named cafés, bakeries, breakfast spots and sights in a bounding box, from OpenStreetMap via Overpass."""
    box = f"({south:.5f},{west:.5f},{north:.5f},{east:.5f})"
    query = "[out:json][timeout:180];(" + "".join(f"nwr{f}{box};" for f in POI_FILTERS) + ");out center tags;"
    out = []
    for el in _overpass(query):
        tags = el.get("tags", {})
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        kind = _classify(tags)
        if lat is None or kind is None:
            continue
        out.append({
            "id": f"{el['type']}/{el['id']}", "name": tags["name"], "category": kind[0], "subtype": kind[1],
            "lat": lat, "lon": lon, "brand": int(bool(tags.get("brand"))),
            "opening_hours": tags.get("opening_hours"), "website": tags.get("website"),
        })
    return out


def stops_along(coords: list[list[float]], places: list[dict]) -> list[dict]:
    """Coffee, breakfast and scenic places near the route, spread along it, ordered by position."""
    index = RouteIndex(_thin(coords, min_gap_m=40))
    radius = config.STOP_RADIUS_M
    pad = radius * 2.5 / 111320
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    south, north = min(lats) - pad, max(lats) + pad
    west, east = min(lons) - pad * 1.6, max(lons) + pad * 1.6
    candidates: dict[str, list[dict]] = {c: [] for c in config.STOPS_PER_CATEGORY}

    for p in places:
        if not (south <= p["lat"] <= north and west <= p["lon"] <= east):
            continue
        off_route, along = index.nearest(p["lat"], p["lon"])
        # Parks are tagged at their centre, which can sit well away from the path.
        if off_route > radius * (2.5 if p["category"] == "scenic" else 1.5):
            continue
        candidates[p["category"]].append({
            "place_id": p["id"],
            "name": p["name"],
            "off_route_m": round(off_route),
            "along_km": round(along / 1000, 2),
            "detour_min": round(2 * off_route / config.WALK_M_PER_MIN),
            "_score": off_route + (150 if p["brand"] else 0),  # prefer independents
        })

    route_km = max(index.cum[-1] / 1000, 0.001)
    chosen = []
    for category, items in candidates.items():
        limit = config.STOPS_PER_CATEGORY[category]
        ranked, seen = [], set()
        for item in sorted(items, key=lambda s: s["_score"]):
            if item["name"].lower() not in seen:
                seen.add(item["name"].lower())
                ranked.append(item)
        # Take the best place in each stretch of the route first, so stops are spread out.
        best_per_stretch = {}
        for item in ranked:
            best_per_stretch.setdefault(min(limit - 1, int(item["along_km"] / route_km * limit)), item)
        picked = list(best_per_stretch.values())
        picked += [s for s in ranked if s not in picked][: limit - len(picked)]
        chosen.extend(picked)

    for item in chosen:
        del item["_score"], item["name"]
    return chosen
