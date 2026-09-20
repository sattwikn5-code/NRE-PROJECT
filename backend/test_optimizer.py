from optimizer import Graph, find_route, W_TIME, W_RISK, W_TRAFFIC, W_WEATHER
from sample_data import load_sample

def sample():
    g = Graph(); load_sample(g); return g

def test_weights_sum_to_one():
    assert abs(W_TIME + W_RISK + W_TRAFFIC + W_WEATHER - 1) < 1e-9

def test_diagram_scenario_selects_route_b():
    for astar in (False, True):
        r = find_route(sample(), "S", "D", "bike", weather_delay=0.1, use_astar=astar)
        assert r["path"] == ["S", "B1", "D"]           # A too risky, C too slow
        assert r["estimated_time_min"] <= 10 and r["risk_level"] == "low"

def test_car_also_avoids_risky_route():
    assert find_route(sample(), "S", "D", "car", 0.1)["path"] == ["S", "B1", "D"]

def test_lorry_not_feasible():
    try:
        find_route(sample(), "S", "D", "lorry"); assert False
    except ValueError:
        pass

def test_time_limit_blocks_everything():
    assert find_route(sample(), "S", "D", "bike", 0.1, limit=5) is None

def test_single_path_within_limit():
    g = Graph()
    g.add_edge("S", "X", 2.0, 0.1, 0.0)   # low-cost but slow
    g.add_edge("X", "D", 2.0, 0.1, 0.0)
    r = find_route(g, "S", "D", "bike", 0.0, limit=10)
    assert r and r["estimated_time_min"] <= 10
