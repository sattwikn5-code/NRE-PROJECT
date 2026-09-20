// ROUTE10 frontend
// Plain JavaScript - no build step
// Backend: FastAPI
// Routing: OpenRouteService
// Traffic: not connected yet (backend reports 0)
// Weather: Open-Meteo


// ============================================================
// BACKEND URL
// ============================================================

const API = "http://127.0.0.1:8000";


const COLORS = {
  low: "#39d98a",
  moderate: "#f0b429",
  high: "#ff6978"
};


let map;
let graphLayer;
let routeLayer;

let nodeById = {};
let vehicles = {};


const $ = (id) =>
  document.getElementById(id);


// ============================================================
// START
// ============================================================

window.addEventListener(
  "DOMContentLoaded",
  () => {

    // --------------------------------------------------------
    // MAP
    // --------------------------------------------------------

    map = L.map("map").setView(
      [22.5958, 88.2636],
      13
    );


    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          "&copy; OpenStreetMap contributors",

        maxZoom: 19
      }
    ).addTo(map);


    graphLayer =
      L.layerGroup().addTo(map);


    routeLayer =
      L.layerGroup().addTo(map);


    // --------------------------------------------------------
    // ROUTE FORM
    // --------------------------------------------------------

    $("routeForm").addEventListener(
      "submit",
      (e) => {

        e.preventDefault();

        findRoute();
      }
    );


    // --------------------------------------------------------
    // BUTTONS
    // --------------------------------------------------------

    $("btnFill").addEventListener(
      "click",
      fillDemoPoints
    );


    $("btnLocate").addEventListener(
      "click",
      useMyLocation
    );


    $("btnDemo").addEventListener(
      "click",
      loadDemo
    );


    $("btnClear").addEventListener(
      "click",
      clearGraph
    );


    $("nodeForm").addEventListener(
      "submit",
      addNode
    );


    $("edgeForm").addEventListener(
      "submit",
      addEdge
    );


    // --------------------------------------------------------
    // TARGET SLIDER
    // --------------------------------------------------------

    $("target").addEventListener(
      "input",
      () => {

        $("targetValue").textContent =
          $("target").value + " min";
      }
    );


    // --------------------------------------------------------
    // WEATHER SLIDER
    // --------------------------------------------------------

    $("weather").addEventListener(
      "input",
      () => {

        $("weatherValue").textContent =
          Number(
            $("weather").value
          ).toFixed(2);
      }
    );


    // --------------------------------------------------------
    // AUTO WEATHER
    // --------------------------------------------------------

    $("autoWeather").addEventListener(
      "change",
      () => {

        $("weatherBox").classList.toggle(
          "hidden",
          $("autoWeather").checked
        );
      }
    );


    // --------------------------------------------------------
    // MAP CLICK
    // --------------------------------------------------------

    map.on(
      "click",
      (e) => {

        if (!$("builder").open) {
          return;
        }


        $("nLat").value =
          e.latlng.lat.toFixed(6);


        $("nLon").value =
          e.latlng.lng.toFixed(6);
      }
    );


    // --------------------------------------------------------
    // INITIAL LOAD
    // --------------------------------------------------------

    checkBackend();

    loadVehicles();

    loadGraph(true);
  }
);


// ============================================================
// API HELPER
// ============================================================

async function api(
  path,
  method = "GET",
  body
) {

  const options = {

    method: method,

    headers: {}
  };


  if (body !== undefined) {

    options.headers[
      "Content-Type"
    ] = "application/json";


    options.body =
      JSON.stringify(body);
  }


  let response;


  try {

    response =
      await fetch(
        API + path,
        options
      );

  } catch (error) {

    throw new Error(
      "Cannot reach backend. Start FastAPI first."
    );
  }


  let data = null;


  try {

    data =
      await response.json();

  } catch (error) {

    // Backend did not return JSON
  }


  if (!response.ok) {

    throw new Error(
      errorText(
        data,
        response.status
      )
    );
  }


  return data;
}


// ============================================================
// ERROR TEXT
// ============================================================

function errorText(
  data,
  status
) {

  if (
    data &&
    typeof data.detail === "string"
  ) {

    return data.detail;
  }


  if (
    data &&
    Array.isArray(data.detail)
  ) {

    return data.detail
      .map(
        (d) => {

          let location = "";

          if (
            d.loc &&
            d.loc.length > 1
          ) {

            location =
              d.loc
                .slice(1)
                .join(" ");
          }


          return (
            location
            + ": "
            + d.msg
          );
        }
      )
      .join("; ");
  }


  return "Backend error (" + status + ")";
}


// ============================================================
// BACKEND CHECK
// ============================================================

async function checkBackend() {

  try {

    await api("/health");


    $("statusDot").className =
      "ok";


    $("statusText").textContent =
      "Backend connected";

  } catch (error) {

    $("statusDot").className =
      "bad";


    $("statusText").textContent =
      "Backend offline";
  }
}


// ============================================================
// VEHICLES
// ============================================================

async function loadVehicles() {

  try {

    vehicles =
      await api("/vehicles");

  } catch (error) {

    // Fallback vehicle
    vehicles = {

      bike: {

        max_risk: 0.6,

        speed_kmph: 25,

        usable: true
      }
    };
  }


  const select =
    $("vehicle");


  select.innerHTML = "";


  for (
    const name in vehicles
  ) {

    const vehicle =
      vehicles[name];


    const option =
      document.createElement(
        "option"
      );


    option.value =
      name;


    option.textContent =
      cap(name)
      + " – "
      + vehicle.speed_kmph
      + " km/h, risk up to "
      + Number(
        vehicle.max_risk
      ).toFixed(2)
      + (
        vehicle.usable
          ? ""
          : " (not for delivery)"
      );


    option.disabled =
      !vehicle.usable;


    select.appendChild(
      option
    );
  }
}


// ============================================================
// PLACE PARSER
// ============================================================

function parsePlace(
  text,
  label
) {

  text =
    text.trim();


  if (!text) {

    throw new Error(
      "Enter the "
      + label
      + " address."
    );
  }


  // ----------------------------------------------------------
  // COORDINATES
  // Example:
  // 22.5958, 88.2636
  // ----------------------------------------------------------

  const match =
    text.match(
      /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/
    );


  if (match) {

    return {

      lat:
        Number(
          match[1]
        ),

      lon:
        Number(
          match[2]
        )
    };
  }


  // ----------------------------------------------------------
  // ADDRESS
  // Backend can geocode it
  // ----------------------------------------------------------

  return {

    address: text
  };
}


// ============================================================
// FIND ROUTE
// ============================================================

async function findRoute() {

  let body;


  try {

    const vehicleName =
      $("vehicle").value;


    const vehicleData =
      vehicles[
        vehicleName
      ];


    // --------------------------------------------------------
    // IMPORTANT:
    // Backend expects source/destination
    // as objects.
    // --------------------------------------------------------

    body = {

      source:
        parsePlace(
          $("source").value,
          "pickup"
        ),


      destination:
        parsePlace(
          $("destination").value,
          "customer"
        ),


      vehicle:
        vehicleName,


      speed_kmh:
        vehicleData
          ? Number(
              vehicleData.speed_kmph
            )
          : 25,


      time_limit_minutes:
        Number(
          $("target").value
        ),


      use_astar:
        $("astar").checked,


      use_live_weather:
        $("autoWeather").checked
    };


  } catch (error) {

    showFailure(
      error.message
    );

    return;
  }


  // ----------------------------------------------------------
  // MANUAL WEATHER
  // ----------------------------------------------------------

  if (
    !$("autoWeather").checked
  ) {

    body.weather_delay =
      Number(
        $("weather").value
      );
  }


  // ----------------------------------------------------------
  // LOADING
  // ----------------------------------------------------------

  setLoading(true);


  try {

    console.log(
      "Sending route request:",
      body
    );


    const result =
      await api(
        "/route",
        "POST",
        body
      );


    console.log(
      "Route response:",
      result
    );


    showResult(
      result,
      body.time_limit_minutes
    );


  } catch (error) {

    console.error(
      "Route error:",
      error
    );


    showFailure(
      error.message
    );


  } finally {

    setLoading(false);
  }
}


// ============================================================
// LOADING
// ============================================================

function setLoading(
  on
) {

  $("btnRoute").disabled =
    on;


  $("btnRoute").textContent =
    on
      ? "Finding route..."
      : "Find route";
}


// ============================================================
// SHOW RESULT
// ============================================================

function showResult(
  r,
  targetMinutes
) {

  // ----------------------------------------------------------
  // DRAW ROUTE
  // ----------------------------------------------------------

  drawRoute(r);


  // ----------------------------------------------------------
  // SHOW RESULT UI
  // ----------------------------------------------------------

  $("empty").classList.add(
    "hidden"
  );


  $("result").classList.remove(
    "hidden"
  );


  $("metrics").classList.remove(
    "hidden"
  );


  $("checks").classList.remove(
    "hidden"
  );


  // ----------------------------------------------------------
  // TARGET STATUS
  // ----------------------------------------------------------

  if (
    r.within_time_limit
  ) {

    $("banner").classList.remove(
      "bad"
    );


    $("bannerIcon").textContent =
      "✓";


    $("bannerTitle").textContent =
      "Route within target";


    $("bannerText").textContent =
      r.total_distance_km
      + " km · "
      + r.estimated_time_min
      + " min";

  } else {

    $("banner").classList.add(
      "bad"
    );


    $("bannerIcon").textContent =
      "!";


    $("bannerTitle").textContent =
      "Route exceeds target";


    $("bannerText").textContent =
      r.total_distance_km
      + " km · "
      + r.estimated_time_min
      + " min";
  }


  // ----------------------------------------------------------
  // WARNING
  // ----------------------------------------------------------

  $("warning").textContent =
    r.warning || "";


  $("warning").classList.toggle(
    "hidden",
    !r.warning
  );


  // ----------------------------------------------------------
  // TIME
  // ----------------------------------------------------------

  $("mTime").textContent =
    Number(
      r.estimated_time_min || 0
    ).toFixed(1)
    + " min";


  // ----------------------------------------------------------
  // DISTANCE
  // ----------------------------------------------------------

  $("mDist").textContent =
    Number(
      r.total_distance_km || 0
    ).toFixed(2)
    + " km";


  // ----------------------------------------------------------
  // RISK
  // ----------------------------------------------------------

  const risk =
    Number(
      r.risk_score || 0
    );


  $("mRisk").textContent =
    risk.toFixed(2)
    + " · "
    + (
      r.risk_level ||
      "not_calculated"
    );


  // ----------------------------------------------------------
  // TRAFFIC
  // ----------------------------------------------------------

  const traffic =
    Number(
      r.traffic_delay || 0
    );


  let trafficLevel =
    r.traffic_level;


  if (!trafficLevel) {

    if (traffic < 0.3) {

      trafficLevel =
        "low";

    } else if (traffic < 0.6) {

      trafficLevel =
        "medium";

    } else {

      trafficLevel =
        "high";
    }
  }


  $("mTraffic").textContent =
    traffic.toFixed(2)
    + " · "
    + trafficLevel;


  // ----------------------------------------------------------
  // WEATHER
  // ----------------------------------------------------------

  const weather =
    Number(
      r.weather_delay || 0
    );


  let weatherLevel =
    r.weather_level;


  if (!weatherLevel) {

    if (weather < 0.3) {

      weatherLevel =
        "low";

    } else if (weather < 0.6) {

      weatherLevel =
        "medium";

    } else {

      weatherLevel =
        "high";
    }
  }


  $("mWeather").textContent =
    weather.toFixed(2)
    + " · "
    + weatherLevel;


  // ----------------------------------------------------------
  // ROUTE COST
  // ----------------------------------------------------------

  if (
    r.total_weight !== undefined
    &&
    r.total_weight !== null
  ) {

    $("mWeight").textContent =
      Number(
        r.total_weight
      ).toFixed(3);

  } else {

    $("mWeight").textContent =
      "–";
  }


  // ----------------------------------------------------------
  // CHECKS
  // ----------------------------------------------------------

  const vehicle =
    vehicles[
      r.vehicle
    ];


  const maxRisk =
    vehicle
      ? Number(
          vehicle.max_risk
        )
      : 1;


  setCheck(
    "cTime",
    r.within_time_limit
  );


  setCheck(
    "cVehicle",
    r.vehicle_compatible !== false
  );


  setCheck(
    "cRisk",
    risk <= maxRisk
  );


  // ----------------------------------------------------------
  // ROAD-BY-ROAD
  // ----------------------------------------------------------

  const list =
    $("segments");


  list.innerHTML = "";


  let stepCount = 0;


  if (
    r.segments &&
    r.segments.length > 0
  ) {

    for (
      const segment of r.segments
    ) {

      if (
        !segment.steps
        ||
        segment.steps.length === 0
      ) {

        continue;
      }


      for (
        const step of segment.steps
      ) {

        stepCount++;


        const li =
          document.createElement(
            "li"
          );


        const dot =
          document.createElement(
            "i"
          );


        dot.className =
          "dot low";


        const names =
          document.createElement(
            "span"
          );


        names.className =
          "names";


        names.textContent =
          step.instruction
          || "Continue on road";


        const meta =
          document.createElement(
            "span"
          );


        meta.className =
          "meta";


        const distance =
          Number(
            step.distance || 0
          ) / 1000;


        const time =
          Number(
            step.duration || 0
          ) / 60;


        meta.textContent =
          distance.toFixed(2)
          + " km · "
          + time.toFixed(1)
          + " min";


        li.append(
          dot,
          names,
          meta
        );


        list.appendChild(
          li
        );
      }
    }
  }


  // ----------------------------------------------------------
  // NO STEPS
  // ----------------------------------------------------------

  if (
    stepCount === 0
  ) {

    const li =
      document.createElement(
        "li"
      );


    li.textContent =
      "Road-by-road instructions are not available.";


    list.appendChild(
      li
    );
  }


  // ----------------------------------------------------------
  // MAP TIME
  // ----------------------------------------------------------

  $("mapTime").textContent =
    Number(
      r.estimated_time_min || 0
    ).toFixed(1)
    + " min";
}


// ============================================================
// FAILURE
// ============================================================

function showFailure(
  message
) {

  $("empty").classList.add(
    "hidden"
  );


  $("result").classList.remove(
    "hidden"
  );


  $("metrics").classList.add(
    "hidden"
  );


  $("checks").classList.add(
    "hidden"
  );


  $("warning").classList.add(
    "hidden"
  );


  $("segments").innerHTML =
    "";


  $("banner").classList.add(
    "bad"
  );


  $("bannerIcon").textContent =
    "!";


  $("bannerTitle").textContent =
    "No route";


  $("bannerText").textContent =
    message;


  $("mapTime").textContent =
    "–";
}


// ============================================================
// CHECK
// ============================================================

function setCheck(
  id,
  ok
) {

  const element =
    $(id);


  element.textContent =
    ok
      ? "Yes"
      : "No";


  element.classList.toggle(
    "no",
    !ok
  );
}


// ============================================================
// DRAW ROUTE
// ============================================================

function drawRoute(
  r
) {

  routeLayer.clearLayers();


  // ----------------------------------------------------------
  // ORS GEOMETRY
  // ----------------------------------------------------------

  if (
    r.geometry
  ) {

    const coordinates =
      decodePolyline(
        r.geometry
      );


    if (
      coordinates.length > 0
    ) {

      const line =
        L.polyline(
          coordinates,
          {
            color:
              "#a64dff",

            weight:
              7,

            opacity:
              0.95,

            className:
              "route-line"
          }
        ).addTo(
          routeLayer
        );


      line.bindTooltip(
        "Route · "
        + Number(
            r.total_distance_km || 0
          ).toFixed(2)
        + " km · "
        + Number(
            r.estimated_time_min || 0
          ).toFixed(1)
        + " min"
      );


      map.fitBounds(
        line.getBounds(),
        {
          padding:
            [50, 50]
        }
      );
    }
  }


  // ----------------------------------------------------------
  // SOURCE MARKER
  // ----------------------------------------------------------

  if (
    r.source
    &&
    r.source.lat !== undefined
    &&
    r.source.lon !== undefined
  ) {

    L.marker(
      [
        r.source.lat,
        r.source.lon
      ]
    )
      .addTo(
        routeLayer
      )
      .bindPopup(
        "Warehouse / Pickup"
      );
  }


  // ----------------------------------------------------------
  // DESTINATION MARKER
  // ----------------------------------------------------------

  if (
    r.destination
    &&
    r.destination.lat !== undefined
    &&
    r.destination.lon !== undefined
  ) {

    L.marker(
      [
        r.destination.lat,
        r.destination.lon
      ]
    )
      .addTo(
        routeLayer
      )
      .bindPopup(
        "Customer / Destination"
      );
  }
}


// ============================================================
// POLYLINE DECODER
// ============================================================

function decodePolyline(
  encoded
) {

  let index = 0;

  let lat = 0;

  let lon = 0;

  const coordinates = [];


  while (
    index < encoded.length
  ) {

    let shift = 0;

    let result = 0;

    let byte;


    // Latitude

    do {

      byte =
        encoded.charCodeAt(
          index++
        ) - 63;


      result |=
        (byte & 0x1f)
        << shift;


      shift += 5;

    } while (
      byte >= 0x20
    );


    const deltaLat =
      (
        result & 1
      )
        ? ~(result >> 1)
        : (result >> 1);


    lat +=
      deltaLat;


    // Longitude

    shift = 0;

    result = 0;


    do {

      byte =
        encoded.charCodeAt(
          index++
        ) - 63;


      result |=
        (byte & 0x1f)
        << shift;


      shift += 5;

    } while (
      byte >= 0x20
    );


    const deltaLon =
      (
        result & 1
      )
        ? ~(result >> 1)
        : (result >> 1);


    lon +=
      deltaLon;


    coordinates.push(
      [
        lat / 1e5,
        lon / 1e5
      ]
    );
  }


  return coordinates;
}


// ============================================================
// LOAD GRAPH
// ============================================================

async function loadGraph(
  fit
) {

  let graph;


  try {

    graph =
      await api(
        "/graph"
      );

  } catch (error) {

    $("graphInfo").textContent =
      error.message;

    return;
  }


  graphLayer.clearLayers();

  routeLayer.clearLayers();

  nodeById = {};


  // ----------------------------------------------------------
  // SAVE NODES
  // ----------------------------------------------------------

  for (
    const node of graph.nodes
  ) {

    nodeById[
      node.id
    ] = node;
  }


  // ----------------------------------------------------------
  // DRAW EDGES
  // ----------------------------------------------------------

  for (
    const edge of graph.edges
  ) {

    const a =
      nodeById[
        edge.u
      ];


    const b =
      nodeById[
        edge.v
      ];


    if (
      !a ||
      !b
    ) {

      continue;
    }


    const risk =
      Number(
        edge.risk || 0
      );


    const level =
      risk <= 0.3
        ? "low"
        : risk <= 0.6
          ? "moderate"
          : "high";


    L.polyline(
      [
        [
          a.lat,
          a.lon
        ],

        [
          b.lat,
          b.lon
        ]
      ],
      {

        color:
          COLORS[level],

        weight:
          3,

        opacity:
          0.45
      }
    )
      .addTo(
        graphLayer
      )
      .bindTooltip(
        edge.u
        + " – "
        + edge.v
        + " · "
        + edge.distance_km
        + " km · risk "
        + risk.toFixed(2)
      );
  }


  // ----------------------------------------------------------
  // DRAW NODES
  // ----------------------------------------------------------

  for (
    const node of graph.nodes
  ) {

    L.circleMarker(
      [
        node.lat,
        node.lon
      ],
      {

        radius:
          6,

        color:
          "#0b182b",

        weight:
          2,

        fillColor:
          "#eaf2ff",

        fillOpacity:
          1
      }
    )
      .addTo(
        graphLayer
      )
      .bindTooltip(
        node.id,
        {

          permanent:
            true,

          direction:
            "top",

          offset:
            [0, -6]
        }
      );
  }


  // ----------------------------------------------------------
  // GRAPH INFO
  // ----------------------------------------------------------

  if (
    graph.nodes.length === 0
  ) {

    $("graphInfo").textContent =
      "No roads loaded yet.";

  } else {

    $("graphInfo").textContent =
      graph.nodes.length
      + " points and "
      + graph.edges.length
      + " roads loaded.";


    if (
      fit
      &&
      graph.nodes.length > 0
    ) {

      map.fitBounds(
        graph.nodes.map(
          (n) => [
            n.lat,
            n.lon
          ]
        ),
        {
          padding:
            [60, 60]
        }
      );
    }
  }
}


// ============================================================
// DEMO
// ============================================================

async function loadDemo() {

  try {

    await api(
      "/graph",
      "DELETE"
    );


    await api(
      "/demo",
      "POST"
    );


    await loadGraph(
      true
    );


    fillDemoPoints();


    say(
      "Demo network loaded."
    );

  } catch (error) {

    say(
      error.message,
      true
    );
  }
}


// ============================================================
// CLEAR GRAPH
// ============================================================

async function clearGraph() {

  try {

    await api(
      "/graph",
      "DELETE"
    );


    await loadGraph(
      false
    );


    say(
      "Network cleared."
    );

  } catch (error) {

    say(
      error.message,
      true
    );
  }
}


// ============================================================
// ADD NODE
// ============================================================

async function addNode(
  event
) {

  event.preventDefault();


  const node = {

    id:
      $("nId")
        .value
        .trim(),

    lat:
      Number(
        $("nLat").value
      ),

    lon:
      Number(
        $("nLon").value
      )
  };


  try {

    await api(
      "/nodes",
      "POST",
      [node]
    );


    await loadGraph(
      false
    );


    say(
      "Added point "
      + node.id
      + "."
    );


    $("nId").value =
      "";

  } catch (error) {

    say(
      error.message,
      true
    );
  }
}


// ============================================================
// ADD EDGE
// ============================================================

async function addEdge(
  event
) {

  event.preventDefault();


  const edge = {

    u:
      $("eU")
        .value
        .trim(),

    v:
      $("eV")
        .value
        .trim(),

    distance_km:
      Number(
        $("eDist").value
      ),

    traffic_delay:
      Number(
        $("eTraffic").value
      ),

    accidents:
      Number(
        $("eAccidents").value
      ),

    width:
      Number(
        $("eWidth").value
      ),

    surface:
      Number(
        $("eSurface").value
      ),

    slope:
      Number(
        $("eSlope").value
      ),

    weather_delay:
      Number(
        $("eWeather").value
      )
  };


  try {

    await api(
      "/edges",
      "POST",
      [edge]
    );


    await loadGraph(
      false
    );


    say(
      "Added road "
      + edge.u
      + " – "
      + edge.v
      + "."
    );

  } catch (error) {

    say(
      error.message,
      true
    );
  }
}


// ============================================================
// MESSAGE
// ============================================================

function say(
  text,
  isError
) {

  const note =
    $("graphNote");


  note.textContent =
    text;


  note.classList.toggle(
    "bad",
    !!isError
  );


  note.classList.remove(
    "hidden"
  );
}


// ============================================================
// DEMO LOCATIONS
// ============================================================

function fillDemoPoints() {

  $("source").value =
    "22.5958, 88.2636";


  $("destination").value =
    "22.5990, 88.2860";
}


// ============================================================
// MY LOCATION
// ============================================================

function useMyLocation() {

  if (
    !navigator.geolocation
  ) {

    showFailure(
      "This browser cannot share your location."
    );

    return;
  }


  navigator.geolocation.getCurrentPosition(

    (position) => {

      $("source").value =
        position.coords.latitude.toFixed(6)
        + ", "
        + position.coords.longitude.toFixed(6);

    },


    () => {

      showFailure(
        "Could not get your location. Allow location access or type an address."
      );
    }
  );
}


// ============================================================
// CAPITALIZE
// ============================================================

function cap(
  text
) {

  return (
    text.charAt(0).toUpperCase()
    +
    text.slice(1)
  );
}