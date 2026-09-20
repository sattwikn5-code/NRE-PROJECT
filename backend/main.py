"""Route10 backend (FastAPI).

Run:   py -m uvicorn main:app --reload        (docs: http://127.0.0.1:8000/docs)
Env:   ORS_API_KEY  - OpenRouteService key (needed only for real-road routing)

Two routing modes, chosen automatically:
  * graph mode - both points are within SNAP_KM of a node in the road network
                 (demo / custom network) -> Dijkstra/A* + Random Forest risk.
  * ors mode   - otherwise -> real roads from OpenRouteService, with a rough
                 risk estimate (no per-road data is available for these).
"""
import os
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import services
from optimizer import Graph, VEHICLES, edge_weight, find_route, haversine_km, nearest_node
from risk_model import cnn_features, load_model, predict_risk
from sample_data import load_sample

app = FastAPI(title="Route10 Smart Delivery API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    # any localhost / 127.0.0.1 port (Live Server, http.server, ...) + file:// pages ("null")
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|null)$",
    allow_methods=["*"],
    allow_headers=["*"],
)

SNAP_KM = 0.3                       # how close a point must be to a graph node
ORS_PROFILES = {"bike": "cycling-regular", "scooter": "driving-car", "car": "driving-car"}

graph = Graph()
_model = None


def get_model():
    global _model
    if _model is None:
        _model = load_model()
    return _model


def level(x):
    return "low" if x <= 0.3 else "moderate" if x <= 0.6 else "high"


# ------------------------------------------------------------------ models
class Place(BaseModel):
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    address: Optional[str] = None


class RouteRequest(BaseModel):
    source: Place
    destination: Place
    vehicle: str = "bike"
    speed_kmh: float = 25.0                      # sent by the UI; the vehicle table decides
    time_limit_minutes: float = Field(10.0, gt=0, le=180)
    use_astar: bool = False
    use_live_weather: bool = True
    weather_delay: float = Field(0.0, ge=0, le=1)


class NodeIn(BaseModel):
    id: str = Field(..., min_length=1)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class EdgeIn(BaseModel):
    u: str
    v: str
    distance_km: float = Field(..., gt=0)
    traffic_delay: float = Field(0.0, ge=0, le=1)
    accidents: float = Field(0.0, ge=0, le=1)
    width: float = Field(0.5, ge=0, le=1)
    surface: float = Field(0.5, ge=0, le=1)
    slope: float = Field(0.0, ge=0, le=1)
    weather_delay: float = Field(0.0, ge=0, le=1)


# ------------------------------------------------------------------ health / vehicles
@app.get("/")
@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "healthy", "ors_configured": bool(os.getenv("ORS_API_KEY"))}


@app.get("/vehicles")
def vehicles():
    return {name: {"max_risk": r, "speed_kmph": s, "usable": u}
            for name, (r, s, u) in VEHICLES.items()}


# ------------------------------------------------------------------ road network
@app.get("/graph")
def get_graph():
    nodes = [{"id": n, "lat": lat, "lon": lon} for n, (lat, lon) in graph.coords.items()]
    edges, seen = [], set()
    for u, neighbours in graph.adj.items():
        for v, d, r, td in neighbours:
            key = frozenset((u, v))
            if key in seen:                       # roads are two-way: report once
                continue
            seen.add(key)
            edges.append({"u": u, "v": v, "distance_km": d, "risk": round(r, 3),
                          "traffic_delay": td})
    return {"nodes": nodes, "edges": edges}


@app.delete("/graph")
def clear_graph():
    graph.adj.clear()
    graph.coords.clear()
    return {"nodes": 0, "edges": 0}


@app.post("/nodes")
def add_nodes(nodes: List[NodeIn]):
    for n in nodes:
        graph.add_node(n.id, n.lat, n.lon)
    return {"nodes": len(graph.coords)}


@app.post("/edges")
def add_edges(edges: List[EdgeIn]):
    missing = sorted({x for e in edges for x in (e.u, e.v) if x not in graph.coords})
    if missing:
        raise HTTPException(400, f"Unknown point(s): {', '.join(missing)}. Add them first.")
    if any(e.u == e.v for e in edges):
        raise HTTPException(400, "A road must join two different points.")

    # feature order = risk_model: CNN(3), weather, traffic, accidents, width, surface, slope
    rows = [[*cnn_features(), e.weather_delay, e.traffic_delay, e.accidents,
             e.width, e.surface, e.slope] for e in edges]
    risks = predict_risk(get_model(), rows)          # one batch call for all edges
    for e, r in zip(edges, risks):
        graph.add_edge(e.u, e.v, e.distance_km, r, e.traffic_delay)
    return {"edges_added": len(edges)}


@app.post("/demo")
def load_demo():
    clear_graph()
    load_sample(graph)
    return {"nodes": len(graph.coords), "edges": len(get_graph()["edges"])}


# ------------------------------------------------------------------ helpers
def encode_polyline(points):
    """[(lat, lon), ...] -> Google-style encoded polyline (precision 5), what app.js decodes."""
    out, plat, plon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for delta in (ilat - plat, ilon - plon):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def resolve(place: Place, label: str):
    if place.lat is not None and place.lon is not None:
        return place.lat, place.lon
    if place.address and place.address.strip():
        point = services.geocode(place.address.strip())
        if point is None:
            raise HTTPException(404, f"Could not find the {label} address.")
        return point
    raise HTTPException(422, f"Enter the {label} address.")


def snap(lat, lon):
    """Nearest graph node if it is close enough, else None."""
    if not graph.coords:
        return None
    n = nearest_node(graph, lat, lon)
    return n if haversine_km(graph.coords[n], (lat, lon)) <= SNAP_KM else None


def rough_road_risk(distance_km):
    """Placeholder risk for ORS routes (no accident / surface data). NOT real risk."""
    return 0.1 if distance_km <= 2 else 0.2 if distance_km <= 5 else 0.3 if distance_km <= 10 else 0.4


# ------------------------------------------------------------------ routing
def graph_mode(req, src_pt, dst_pt, s_node, d_node, wd):
    try:
        r = find_route(graph, s_node, d_node, req.vehicle, wd,
                       req.time_limit_minutes, req.use_astar)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if r is None:
        raise HTTPException(
            404, "No route fits this vehicle's risk limit and the time limit. "
                 "Try a longer time limit or a different vehicle.")

    steps = [{"instruction": f"{s['from']} → {s['to']}",
              "distance": s["distance_km"] * 1000, "duration": s["time_min"] * 60}
             for s in r["segments"]]
    r["geometry"] = encode_polyline([graph.coords[n] for n in r["path"]])
    r["segments"] = [{"steps": steps}]
    r["mode"] = "graph"
    r["source"] = {"lat": src_pt[0], "lon": src_pt[1]}
    r["destination"] = {"lat": dst_pt[0], "lon": dst_pt[1]}
    return r


def ors_mode(req, src_pt, dst_pt, wd):
    if not os.getenv("ORS_API_KEY"):
        raise HTTPException(
            503, "These points are outside the road network and ORS_API_KEY is not set. "
                 "Set ORS_API_KEY, or load the demo network and use its points.")
    try:
        data = services.ors_route(*src_pt, *dst_pt, profile=ORS_PROFILES[req.vehicle])
    except requests.HTTPError as e:
        code = e.response.status_code
        if code == 404:
            raise HTTPException(404, "No road route found near these points.")
        raise HTTPException(502, f"OpenRouteService error ({code}): {e.response.text[:300]}")
    except requests.RequestException as e:
        raise HTTPException(502, f"OpenRouteService request failed: {e}")

    routes = data.get("routes") or []
    if not routes:
        raise HTTPException(404, "OpenRouteService returned no route.")
    route = routes[0]
    dist = route["summary"]["distance"] / 1000
    minutes = route["summary"]["duration"] / 60

    risk = rough_road_risk(dist)
    max_risk = VEHICLES[req.vehicle][0]
    traffic = 0.0                                    # no live-traffic source connected yet
    return {
        "mode": "ors",
        "vehicle": req.vehicle,
        "vehicle_compatible": True,
        "path": [],
        "total_distance_km": round(dist, 2),
        "estimated_time_min": round(minutes, 1),
        "within_time_limit": minutes <= req.time_limit_minutes,
        "total_weight": round(edge_weight(minutes, risk, traffic, wd, req.time_limit_minutes), 4),
        "risk_score": risk,
        "risk_level": level(risk),
        "traffic_delay": traffic,
        "traffic_level": level(traffic),
        "weather_delay": round(wd, 3),
        "weather_level": level(wd),
        "geometry": route["geometry"],               # encoded polyline (precision 5)
        "segments": route.get("segments", []),
        "source": {"lat": src_pt[0], "lon": src_pt[1]},
        "destination": {"lat": dst_pt[0], "lon": dst_pt[1]},
        "warning": ("Risk is a rough estimate from route length and traffic is not included "
                    "for real-road routes. Use the demo/custom network for ML-based risk."
                    + ("" if risk <= max_risk else " Estimated risk is above this vehicle's limit.")),
    }


@app.post("/route")
def route(req: RouteRequest):
    if req.vehicle not in VEHICLES:
        raise HTTPException(422, f"Unknown vehicle '{req.vehicle}'.")
    if not VEHICLES[req.vehicle][2]:
        raise HTTPException(422, f"'{req.vehicle}' is not feasible for 10-minute delivery.")

    src_pt = resolve(req.source, "pickup")
    dst_pt = resolve(req.destination, "customer")

    wd = services.weather_delay(*src_pt) if req.use_live_weather else req.weather_delay

    s_node, d_node = snap(*src_pt), snap(*dst_pt)
    if s_node and d_node and s_node != d_node:
        return graph_mode(req, src_pt, dst_pt, s_node, d_node, wd)
    return ors_mode(req, src_pt, dst_pt, wd)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
