"""External APIs: Open-Meteo (weather), Nominatim (geocoding), OpenRouteService (routing).
Each /route request makes a handful of calls (not per edge); weather is cached 5 min."""
import os
import time
import requests

# Set ORS_BASE_URL only if you use a self-hosted / different ORS server.
ORS_BASE_URL = os.getenv("ORS_BASE_URL", "https://api.openrouteservice.org")

_cache = {}   # (rounded lat, lon) -> (timestamp, weather_delay)


def weather_delay(lat, lon):
    """Weather delay 0-1 from rainfall + wind. Returns 0 if the API is down."""
    key = (round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        cur = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": lat, "longitude": lon,
                    "current": "precipitation,wind_speed_10m"},
            timeout=3).json()["current"]
        wd = round(min(1.0, cur["precipitation"] / 5 + cur["wind_speed_10m"] / 80), 2)
    except Exception:
        return 0.0
    _cache[key] = (time.time(), wd)
    return wd


def geocode(address):
    """Address -> (lat, lon), or None."""
    try:
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"q": address, "format": "json", "limit": 1},
                         headers={"User-Agent": "delivery-router"}, timeout=5).json()
        return float(r[0]["lat"]), float(r[0]["lon"])
    except Exception:
        return None


def ors_route(source_lat, source_lon, dest_lat, dest_lon, profile="driving-car"):
    """OpenRouteService directions. Raises requests.HTTPError on a non-2xx reply."""
    api_key = os.getenv("ORS_API_KEY")
    if not api_key:
        raise RuntimeError("ORS_API_KEY is not set")

    response = requests.post(
        f"{ORS_BASE_URL}/v2/directions/{profile}",
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        json={
            "coordinates": [[source_lon, source_lat], [dest_lon, dest_lat]],  # ORS wants lon,lat
            "instructions": True,   # the frontend's "Road by road" list needs steps
        },
        timeout=15)
    response.raise_for_status()
    return response.json()
