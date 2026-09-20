# Route10 – 10-minute delivery route optimizer

```
route10-project/
├── backend/    FastAPI + your optimizer (main.py has a few small additions)
└── frontend/   index.html, style.css, app.js  (no build step)
```

## Run it (Windows PowerShell)

1. Unzip the project, then go into the **backend** folder using the full path where you unzipped it, for example:

   ```powershell
   cd C:\Users\SATTWIK\Downloads\route10-project\backend
   ```

2. Install the packages (first time only):

   ```powershell
   pip install -r requirements.txt
   ```

3. Start the server:

   ```powershell
   uvicorn main:app --reload
   ```

4. Open **http://127.0.0.1:8000** in your browser.

The backend serves the frontend, so there is only one thing to run. The first start trains a small demo Random Forest and saves `risk_rf.joblib`, so it takes a few seconds.

## Try it

1. Press **Load demo network**.
2. Press **Fill demo points**, then **Find route**. Route B (green) should be chosen.
3. Set the time limit to 5 min to see the "No route" message.
4. Type real addresses instead. They are looked up with Nominatim, then snapped to the nearest point of the loaded network, so the demo network only makes sense for addresses near it (Howrah, Kolkata).

## What changed in `backend/main.py`

Your routing, risk model and services are untouched. `main.py` gained:

| Addition | Why |
|---|---|
| CORS middleware | lets the page call the API if you open it from another port |
| `GET /health` | the green/red status light |
| `GET /graph` | the frontend needs point coordinates to draw roads and the route |
| `DELETE /graph` | "Clear network", and avoids duplicate roads when reloading the demo |
| `/route` also returns `source` / `destination` (typed place, snapped point, distance) | shows a warning when an address is far from the network |
| `/edges` checks that both points exist | clear error instead of a crash on an unknown point |
| static mount at `/` | serves `frontend/` |

## Files

- `frontend/app.js` – small functions: `api()` for requests, `findRoute()`, `showResult()`, `drawRoute()`, `loadGraph()`, and the network builder handlers.
- Colours are variables at the top of `frontend/style.css`.
- If you host the frontend somewhere else, set `API` at the top of `app.js` to the backend URL.
