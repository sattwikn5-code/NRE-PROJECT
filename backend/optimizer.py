"""Core routing logic for 10-minute delivery.

Search: Dijkstra (or A*) with a min-heap  ->  O((V + E) log V) time, O(V + E) space.
Vehicle-blocked edges and edges that break the time limit are skipped on the fly,
so the graph is never copied per request.
"""
import heapq
from math import radians, sin, cos, asin, sqrt

W_TIME, W_RISK, W_TRAFFIC, W_WEATHER = 0.4, 0.3, 0.2, 0.1   # must sum to 1
DELAY_FACTOR = 0.5   # how strongly traffic / weather slow the vehicle down

# vehicle -> (max risk threshold, avg speed km/h, usable for delivery?)
VEHICLES = {
    "bike":    (0.6, 25, True),
    "scooter": (0.5, 30, True),
    "car":     (0.4, 35, True),
    "lorry":   (0.2, 20, False),   # marked not feasible in the diagram
}


class Graph:
    def __init__(self):
        self.adj = {}      # node -> list of (neighbor, distance_km, risk, traffic_delay)
        self.coords = {}   # node -> (lat, lon)

    def add_node(self, node, lat, lon):
        self.coords[node] = (lat, lon)
        self.adj.setdefault(node, [])

    def add_edge(self, u, v, dist_km, risk, traffic_delay=0.0, two_way=True):
        self.adj.setdefault(u, []).append((v, dist_km, risk, traffic_delay))
        self.adj.setdefault(v, [])
        if two_way:
            self.adj[v].append((u, dist_km, risk, traffic_delay))


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(radians, (*a, *b))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * asin(sqrt(h))


def nearest_node(g, lat, lon):
    """Snap a GPS point to the closest graph node. O(V)."""
    return min(g.coords, key=lambda n: haversine_km(g.coords[n], (lat, lon)))


def travel_time(dist_km, speed, traffic, weather):
    """Minutes. Traffic and weather slow the vehicle down."""
    return dist_km / speed * 60 * (1 + DELAY_FACTOR * traffic + DELAY_FACTOR * weather)


def edge_weight(t, risk, traffic, weather, limit):
    """W = w1*T + w2*R + w3*TD + w4*WD, with each edge's terms scaled by its
    share of the time budget (t / limit), so splitting a road into more
    segments does not change a route's cost."""
    return (t / limit) * (W_TIME + W_RISK * risk + W_TRAFFIC * traffic + W_WEATHER * weather)


def _level(x):
    return "low" if x <= 0.3 else "moderate" if x <= 0.6 else "high"


def _search(g, src, dst, max_risk, speed, wd, limit, by_time, astar):
    coords = g.coords
    use_h = astar and src in coords and dst in coords
    # lower bound on remaining cost (admissible: real time >= straight-line time)
    scale = 1.0 if by_time else W_TIME / limit
    h = (lambda n: haversine_km(coords[n], coords[dst]) / speed * 60 * scale) if use_h else (lambda n: 0.0)

    cost = {src: 0.0}
    elapsed = {src: 0.0}
    parent = {}
    done = set()
    heap = [(h(src), src)]                       # priority queue (min weight)

    while heap:
        _, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        if u == dst:
            break
        for v, d, r, td in g.adj[u]:
            if r > max_risk:                     # vehicle compatibility
                continue
            t = travel_time(d, speed, td, wd)
            e = elapsed[u] + t
            if e > limit:                        # time constraint
                continue
            nc = cost[u] + (t if by_time else edge_weight(t, r, td, wd, limit))
            if nc < cost.get(v, float("inf")):
                cost[v], elapsed[v], parent[v] = nc, e, (u, d, r, td, t)
                heapq.heappush(heap, (nc + h(v), v))

    if dst not in done:
        return None

    segs, node = [], dst
    while node != src:
        prev, d, r, td, t = parent[node]
        segs.append({"from": prev, "to": node, "distance_km": round(d, 2),
                     "time_min": round(t, 2), "risk": round(r, 3), "risk_level": _level(r),
                     "traffic_delay": round(td, 3)})
        node = prev
    segs.reverse()

    dist = sum(s["distance_km"] for s in segs)
    total_t = elapsed[dst]
    avg = lambda vals: sum(v * s["distance_km"] for v, s in zip(vals, segs)) / dist if dist else 0.0
    avg_r = avg([s["risk"] for s in segs])
    avg_td = avg([s["traffic_delay"] for s in segs])
    return {
        "path": [src] + [s["to"] for s in segs],
        "total_distance_km": round(dist, 2),
        "estimated_time_min": round(total_t, 1),
        "within_time_limit": total_t <= limit,
        "total_weight": round(cost[dst], 4) if not by_time else None,
        "risk_score": round(avg_r, 3),
        "risk_level": _level(avg_r),
        "traffic_delay": round(avg_td, 3),
        "traffic_level": _level(avg_td),
        "weather_delay": round(wd, 3),
        "weather_level": _level(wd),
        "segments": segs,
    }


def find_route(g, src, dst, vehicle, weather_delay=0.0, limit=10.0, use_astar=False):
    """Best route for the vehicle that also fits the time limit.
    Returns None if no feasible route exists."""
    if vehicle not in VEHICLES:
        raise ValueError(f"unknown vehicle '{vehicle}'")
    max_risk, speed, usable = VEHICLES[vehicle]
    if not usable:
        raise ValueError(f"'{vehicle}' is not feasible for 10-minute delivery")
    if src not in g.adj or dst not in g.adj:
        raise ValueError("source/destination not in graph")

    args = (g, src, dst, max_risk, speed, weather_delay, limit)
    route = _search(*args, by_time=False, astar=use_astar)
    if route is None:
        # Lowest-cost search can miss a feasible path when it prunes by time.
        # The fastest path is the best possible chance of meeting the limit.
        route = _search(*args, by_time=True, astar=use_astar)
    if route:
        route["vehicle"] = vehicle
        route["vehicle_compatible"] = True
    return route
