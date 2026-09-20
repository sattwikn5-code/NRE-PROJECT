"""Demo graph mirroring the diagram: routes A (risky), B (best), C (too slow)."""


def load_sample(g):
    g.add_node("S", 22.5958, 88.2636)     # restaurant
    g.add_node("D", 22.5990, 88.2860)     # customer (demo coordinates)
    g.add_node("A1", 22.6000, 88.2750)
    g.add_node("B1", 22.5960, 88.2750)
    g.add_node("C1", 22.5930, 88.2750)
    # (u, v, km, risk, traffic_delay)
    for u, v, d, r, td in [
        ("S", "A1", 1.5, 0.8, 0.7), ("A1", "D", 1.5, 0.8, 0.7),      # A: 3.0 km, risky
        ("S", "B1", 1.75, 0.2, 0.2), ("B1", "D", 1.75, 0.2, 0.2),    # B: 3.5 km, safe
        ("S", "C1", 2.0, 0.3, 0.3), ("C1", "D", 2.0, 0.3, 0.3),      # C: 4.0 km, slow
    ]:
        g.add_edge(u, v, d, r, td)
