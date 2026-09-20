"""Manual check for the ORS key (needs internet). Run:  python test_ors.py
Not a pytest test, so it is guarded and will not run during test collection."""
from services import ors_route

if __name__ == "__main__":
    result = ors_route(22.5958, 88.2636, 22.5990, 88.2860)   # was 22.2860 (typo)
    print(result["routes"][0]["summary"])
