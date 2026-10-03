import re
from urllib.parse import quote

import httpx

HEADERS = {"User-Agent": "StreetMiles/0.1 (AdaHack 2026)"}
OSRM_URL = "https://routing.openstreetmap.de/routed-{profile}/route/v1/driving/{a};{b}"
LATLON = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")
POSTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.I)


def _get(url: str, **params) -> dict | list:
    resp = httpx.get(url, params=params or None, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def geocode(query: str) -> dict:
    """Accepts 'lat,lon', a UK postcode (postcodes.io) or a place name (Nominatim)."""
    q = query.strip()
    if m := LATLON.match(q):
        return {"lat": float(m[1]), "lon": float(m[2]), "label": q}
    if POSTCODE.match(q):
        res = _get(f"https://api.postcodes.io/postcodes/{quote(q.replace(' ', ''))}")["result"]
        return {"lat": res["latitude"], "lon": res["longitude"], "label": res["postcode"]}
    hits = _get("https://nominatim.openstreetmap.org/search",
                q=f"{q}, London", format="jsonv2", limit=1, countrycodes="gb")
    if not hits:
        raise LookupError(f"Couldn't find '{q}'")
    hit = hits[0]
    return {"lat": float(hit["lat"]), "lon": float(hit["lon"]), "label": hit["display_name"].split(",")[0]}


def route(profile: str, a: dict, b: dict) -> dict:
    """Route with FOSSGIS OSRM. profile: foot, bike or car. Coords are [lat, lon] pairs."""
    url = OSRM_URL.format(profile=profile, a=f"{a['lon']},{a['lat']}", b=f"{b['lon']},{b['lat']}")
    data = _get(url, overview="full", geometries="geojson")
    if data.get("code") != "Ok":
        raise LookupError(f"No {profile} route found")
    r = data["routes"][0]
    return {
        "distance_km": r["distance"] / 1000,
        "duration_min": r["duration"] / 60,
        "coords": [[lat, lon] for lon, lat in r["geometry"]["coordinates"]],
    }


def routes(profile: str, *points: dict, alternatives: bool = False) -> list[dict]:
    """Every route OSRM offers through `points`, each tagged with the street it spends longest on."""
    path = ";".join(f"{p['lon']},{p['lat']}" for p in points)
    url = f"https://routing.openstreetmap.de/routed-{profile}/route/v1/driving/{path}"
    data = _get(url, overview="full", geometries="geojson", steps="true", alternatives=str(alternatives).lower())
    if data.get("code") != "Ok":
        raise LookupError(f"No {profile} route found")
    out = []
    for r in data["routes"]:
        streets: dict[str, float] = {}
        for leg in r["legs"]:
            for step in leg["steps"]:
                if step.get("name"):
                    streets[step["name"]] = streets.get(step["name"], 0) + step["distance"]
        out.append({
            "distance_km": r["distance"] / 1000,
            "duration_min": r["duration"] / 60,
            "coords": [[lat, lon] for lon, lat in r["geometry"]["coordinates"]],
            "main_street": max(streets, key=streets.get) if streets else None,
        })
    return out
