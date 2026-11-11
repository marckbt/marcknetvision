const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Today's forecast for major world cities, grouped by region. The city
// list is driven by countries_by_region.json; this file supplies the
// lat/lon for each city (the JSON only has names) and fetches each
// city's forecast from Open-Meteo, which — unlike NWS (US-only) — works
// globally, needs no API key, and takes many cities in one request.

const { wmoCondition } = require('./open-meteo');

const UA = 'MarckNetVision/1.0 (weather dashboard; contact@marcknetvision.local)';

// City -> coordinates. Keyed by the exact city strings used in
// countries_by_region.json. If a new city is added to that JSON, add a
// matching entry here (missing coords are skipped with a warning).
const CITY_COORDS = {
  // South Asia
  'Mumbai': [19.0760, 72.8777],
  'Karachi': [24.8607, 67.0011],
  'Dhaka': [23.8103, 90.4125],
  'Tehran': [35.6892, 51.3890],
  'Kabul': [34.5553, 69.2075],
  'Kathmandu': [27.7172, 85.3240],
  'Delhi': [28.6139, 77.2090],
  // East & Southeast Asia
  'Beijing': [39.9042, 116.4074],
  'Jakarta': [-6.2088, 106.8456],
  'Manila': [14.5995, 120.9842],
  'Ho Chi Minh City': [10.8231, 106.6297],
  'Bangkok': [13.7563, 100.5018],
  'Yangon': [16.8409, 96.1735],
  'Seoul': [37.5665, 126.9780],
  'Tokyo': [35.6762, 139.6503],
  'Singapore': [1.3521, 103.8198],
  'Hong Kong': [22.3193, 114.1694],
  // Sub-Saharan Africa
  'Lagos': [6.5244, 3.3792],
  'Addis Ababa': [9.0300, 38.7400],
  'Kinshasa': [-4.4419, 15.2663],
  'Johannesburg': [-26.2041, 28.0473],
  'Nairobi': [-1.2921, 36.8219],
  'Cape Town': [-33.9249, 18.4241],
  'Dakar': [14.7167, -17.4677],
  'Accra': [5.6037, -0.1870],
  // Middle East & North Africa
  'Cairo': [30.0444, 31.2357],
  'Algiers': [36.7538, 3.0588],
  'Baghdad': [33.3152, 44.3661],
  'Casablanca': [33.5731, -7.5898],
  'Riyadh': [24.7136, 46.6753],
  'Sanaa': [15.3694, 44.1910],
  'Istanbul': [41.0082, 28.9784],
  'Dubai': [25.2048, 55.2708],
  // Europe
  'Moscow': [55.7558, 37.6173],
  'Berlin': [52.5200, 13.4050],
  'Frankfurt': [50.1109, 8.6821],
  'London': [51.5074, -0.1278],
  'Paris': [48.8566, 2.3522],
  'Madrid': [40.4168, -3.7038],
  'Kyiv': [50.4501, 30.5234],
  'Saint Petersburg': [59.9311, 30.3609],
  'Warsaw': [52.2297, 21.0122],
  'Prague': [50.0755, 14.4378],
  'Budapest': [47.4979, 19.0402],
  'Bucharest': [44.4268, 26.1025],
  'Sofia': [42.6977, 23.3219],
  'Belgrade': [44.7866, 20.4489],
  'Stockholm': [59.3293, 18.0686],
  'Oslo': [59.9139, 10.7522],
  'Helsinki': [60.1699, 24.9384],
  'Copenhagen': [55.6761, 12.5683],
  'Reykjavik': [64.1466, -21.9426],
  'Riga': [56.9496, 24.1052],
  // Latin America & Caribbean
  'São Paulo': [-23.5505, -46.6333],
  'Mexico City': [19.4326, -99.1332],
  'Bogotá': [4.7110, -74.0721],
  'Buenos Aires': [-34.6037, -58.3816],
  'Lima': [-12.0464, -77.0428],
  'Caracas': [10.4806, -66.9036],
  'Rio de Janeiro': [-22.9068, -43.1729],
  'Guatemala City': [14.6349, -90.5069],
  'Panama City': [8.9824, -79.5199],
  'Quito': [-0.1807, -78.4678],
  'Santiago': [-33.4489, -70.6693],
  'Havana': [23.1136, -82.3666],
  'Kingston': [17.9714, -76.7920],
  'Santo Domingo': [18.4861, -69.9312],
  'San Juan': [18.4655, -66.1057],
  'Nassau': [25.0443, -77.3504],
  'Port of Spain': [10.6549, -61.5019],
  'Port-au-Prince': [18.5944, -72.3074],
  'Bridgetown': [13.0975, -59.6167],
  // Central & North Asia
  'Tashkent': [41.2995, 69.2401],
  'Almaty': [43.2220, 76.8512],
  // North America
  'New York': [40.7128, -74.0060],
  'Los Angeles': [34.0522, -118.2437],
  'Chicago': [41.8781, -87.6298],
  'Houston': [29.7604, -95.3698],
  'Phoenix': [33.4484, -112.0740],
  'Toronto': [43.6532, -79.3832],
  'Vancouver': [49.2827, -123.1207],
  'Montreal': [45.5017, -73.5673],
  'Calgary': [51.0447, -114.0719],
  'Miami': [25.7617, -80.1918],
  'Atlanta': [33.7490, -84.3880],
  'Boston': [42.3601, -71.0589],
  'Washington DC': [38.9072, -77.0369],
  'Dallas': [32.7767, -96.7970],
  'Denver': [39.7392, -104.9903],
  'Seattle': [47.6062, -122.3321],
  'Minneapolis': [44.9778, -93.2650],
  'Anchorage': [61.2181, -149.9003],
  'Honolulu': [21.3069, -157.8583],
  'Halifax': [44.6488, -63.5752],
  'Winnipeg': [49.8951, -97.1384],
  // Oceania
  'Sydney': [-33.8688, 151.2093],
  'Perth': [-31.9523, 115.8613],
  'Alice Springs': [-23.6980, 133.8807],
  'Melbourne': [-37.8136, 144.9631],
  'Auckland': [-36.8509, 174.7645],
  // ── Added: 200 more cities (75 in the US) ──
  // North America
  'Philadelphia': [39.9526, -75.1652],
  'San Antonio': [29.4241, -98.4936],
  'San Diego': [32.7157, -117.1611],
  'San Francisco': [37.7749, -122.4194],
  'Austin': [30.2672, -97.7431],
  'Jacksonville': [30.3322, -81.6557],
  'Columbus': [39.9612, -82.9988],
  'Charlotte': [35.2271, -80.8431],
  'Indianapolis': [39.7684, -86.1581],
  'Nashville': [36.1627, -86.7816],
  'Oklahoma City': [35.4676, -97.5164],
  'El Paso': [31.7619, -106.4850],
  'Las Vegas': [36.1699, -115.1398],
  'Portland': [45.5152, -122.6784],
  'Detroit': [42.3314, -83.0458],
  'Memphis': [35.1495, -90.0490],
  'Louisville': [38.2527, -85.7585],
  'Baltimore': [39.2904, -76.6122],
  'Milwaukee': [43.0389, -87.9065],
  'Albuquerque': [35.0844, -106.6504],
  'Tucson': [32.2226, -110.9747],
  'Fresno': [36.7378, -119.7871],
  'Sacramento': [38.5816, -121.4944],
  'Kansas City': [39.0997, -94.5786],
  'Omaha': [41.2565, -95.9345],
  'Raleigh': [35.7796, -78.6382],
  'Tampa': [27.9506, -82.4572],
  'New Orleans': [29.9511, -90.0715],
  'Cleveland': [41.4993, -81.6944],
  'Pittsburgh': [40.4406, -79.9959],
  'Cincinnati': [39.1031, -84.5120],
  'St. Louis': [38.6270, -90.1994],
  'Orlando': [28.5383, -81.3792],
  'Salt Lake City': [40.7608, -111.8910],
  'Boise': [43.6150, -116.2023],
  'Spokane': [47.6588, -117.4260],
  'Reno': [39.5296, -119.8138],
  'Billings': [45.7833, -108.5007],
  'Bismarck': [46.8083, -100.7837],
  'Fargo': [46.8772, -96.7898],
  'Sioux Falls': [43.5446, -96.7311],
  'Rapid City': [44.0805, -103.2310],
  'Cheyenne': [41.1400, -104.8202],
  'Des Moines': [41.5868, -93.6250],
  'Wichita': [37.6872, -97.3301],
  'Little Rock': [34.7465, -92.2896],
  'Birmingham': [33.5186, -86.8104],
  'Jackson': [32.2988, -90.1848],
  'Charleston': [32.7765, -79.9311],
  'Savannah': [32.0809, -81.0912],
  'Richmond': [37.5407, -77.4360],
  'Norfolk': [36.8508, -76.2859],
  'Buffalo': [42.8864, -78.8784],
  'Albany': [42.6526, -73.7562],
  'Hartford': [41.7658, -72.6734],
  'Providence': [41.8240, -71.4128],
  'Bangor': [44.8016, -68.7712],
  'Burlington': [44.4759, -73.2121],
  'Manchester': [42.9956, -71.4548],
  'Wilmington': [39.7391, -75.5398],
  'Columbia': [34.0007, -81.0348],
  'Knoxville': [35.9606, -83.9207],
  'Lexington': [38.0406, -84.5037],
  'Madison': [43.0731, -89.4012],
  'Green Bay': [44.5133, -88.0133],
  'Duluth': [46.7867, -92.1005],
  'Marquette': [46.5436, -87.3954],
  'Corpus Christi': [27.8006, -97.3964],
  'Amarillo': [35.2220, -101.8313],
  'Lubbock': [33.5779, -101.8552],
  'Flagstaff': [35.1983, -111.6513],
  'Juneau': [58.3019, -134.4197],
  'Fairbanks': [64.8378, -147.7164],
  'Hilo': [19.7074, -155.0885],
  'Key West': [24.5551, -81.7800],
  'Ottawa': [45.4215, -75.6972], // Canada
  'Quebec City': [46.8139, -71.2080], // Canada
  'Edmonton': [53.5461, -113.4938], // Canada
  'St. John\'s': [47.5615, -52.7126], // Canada
  'Yellowknife': [62.4540, -114.3718], // Canada
  'Nuuk': [64.1814, -51.6941], // Greenland
  // South Asia
  'Bengaluru': [12.9716, 77.5946],
  'Chennai': [13.0827, 80.2707],
  'Kolkata': [22.5726, 88.3639],
  'Hyderabad': [17.3850, 78.4867],
  'Ahmedabad': [23.0225, 72.5714],
  'Lahore': [31.5204, 74.3587],
  'Islamabad': [33.6844, 73.0479],
  'Chittagong': [22.3569, 91.7832],
  'Colombo': [6.9271, 79.8612],
  'Malé': [4.1755, 73.5093],
  // East & Southeast Asia
  'Shanghai': [31.2304, 121.4737],
  'Guangzhou': [23.1291, 113.2644],
  'Chengdu': [30.5728, 104.0668],
  'Wuhan': [30.5928, 114.3055],
  'Harbin': [45.8038, 126.5350],
  'Lhasa': [29.6520, 91.1721],
  'Taipei': [25.0330, 121.5654],
  'Osaka': [34.6937, 135.5023],
  'Sapporo': [43.0618, 141.3545],
  'Fukuoka': [33.5904, 130.4017],
  'Busan': [35.1796, 129.0756],
  'Pyongyang': [39.0392, 125.7625],
  'Ulaanbaatar': [47.8864, 106.9057],
  'Hanoi': [21.0278, 105.8342],
  'Kuala Lumpur': [3.1390, 101.6869],
  'Phnom Penh': [11.5564, 104.9282],
  'Vientiane': [17.9757, 102.6331],
  'Cebu': [10.3157, 123.8854],
  'Surabaya': [-7.2575, 112.7521],
  'Denpasar': [-8.6705, 115.2126],
  // Sub-Saharan Africa
  'Abuja': [9.0765, 7.3986],
  'Kano': [12.0022, 8.5920],
  'Durban': [-29.8587, 31.0218],
  'Mombasa': [-4.0435, 39.6682],
  'Dar es Salaam': [-6.7924, 39.2083],
  'Kampala': [0.3476, 32.5825],
  'Kigali': [-1.9441, 30.0619],
  'Mogadishu': [2.0469, 45.3182],
  'Luanda': [-8.8390, 13.2894],
  'Lusaka': [-15.3875, 28.3228],
  'Harare': [-17.8252, 31.0335],
  'Maputo': [-25.9692, 32.5732],
  'Antananarivo': [-18.8792, 47.5079],
  'Windhoek': [-22.5609, 17.0658],
  'Abidjan': [5.3600, -4.0083],
  'Bamako': [12.6392, -8.0029],
  'Niamey': [13.5116, 2.1254],
  'Douala': [4.0511, 9.7679],
  // Middle East & North Africa
  'Alexandria': [31.2001, 29.9187],
  'Jeddah': [21.4858, 39.1925],
  'Doha': [25.2854, 51.5310],
  'Abu Dhabi': [24.4539, 54.3773],
  'Kuwait City': [29.3759, 47.9774],
  'Muscat': [23.5880, 58.3829],
  'Amman': [31.9454, 35.9284],
  'Beirut': [33.8938, 35.5018],
  'Tel Aviv': [32.0853, 34.7818],
  'Ankara': [39.9334, 32.8597],
  'Tunis': [36.8065, 10.1815],
  'Tripoli': [32.8872, 13.1913],
  'Marrakesh': [31.6295, -7.9811],
  'Khartoum': [15.5007, 32.5599],
  // Europe
  'Rome': [41.9028, 12.4964],
  'Milan': [45.4642, 9.1900],
  'Barcelona': [41.3874, 2.1686],
  'Lisbon': [38.7223, -9.1393],
  'Dublin': [53.3498, -6.2603],
  'Edinburgh': [55.9533, -3.1883],
  'Belfast': [54.5973, -5.9301],
  'Marseille': [43.2965, 5.3698],
  'Munich': [48.1351, 11.5820],
  'Hamburg': [53.5511, 9.9937],
  'Amsterdam': [52.3676, 4.9041],
  'Brussels': [50.8503, 4.3517],
  'Zurich': [47.3769, 8.5417],
  'Vienna': [48.2082, 16.3738],
  'Athens': [37.9838, 23.7275],
  'Zagreb': [45.8150, 15.9819],
  'Minsk': [53.9006, 27.5590],
  'Vilnius': [54.6872, 25.2797],
  'Tallinn': [59.4370, 24.7536],
  'Odesa': [46.4825, 30.7233],
  'Kraków': [50.0647, 19.9450],
  'Bergen': [60.3913, 5.3221],
  'Tromsø': [69.6492, 18.9553],
  'Murmansk': [68.9585, 33.0827],
  'Kazan': [55.8304, 49.0661],
  // Latin America & Caribbean
  'Guadalajara': [20.6597, -103.3496],
  'Monterrey': [25.6866, -100.3161],
  'Cancún': [21.1619, -86.8515],
  'Brasília': [-15.7975, -47.8919],
  'Manaus': [-3.1190, -60.0217],
  'Salvador': [-12.9777, -38.5016],
  'Medellín': [6.2442, -75.5812],
  'Montevideo': [-34.9011, -56.1645],
  'Asunción': [-25.2637, -57.5759],
  'La Paz': [-16.4897, -68.1193],
  'Ushuaia': [-54.8019, -68.3030],
  'Punta Arenas': [-53.1638, -70.9171],
  'San José': [9.9281, -84.0907],
  'Managua': [12.1150, -86.2362],
  'Tegucigalpa': [14.0723, -87.1921],
  'San Salvador': [13.6929, -89.2182],
  'Willemstad': [12.1091, -68.9316],
  'Fort-de-France': [14.6161, -61.0588],
  // Central & North Asia
  'Astana': [51.1694, 71.4491],
  'Bishkek': [42.8746, 74.5698],
  'Dushanbe': [38.5598, 68.7870],
  'Ashgabat': [37.9601, 58.3261],
  'Novosibirsk': [55.0084, 82.9357],
  'Irkutsk': [52.2870, 104.3050],
  'Yakutsk': [62.0355, 129.6755],
  'Vladivostok': [43.1155, 131.8855],
  // Oceania
  'Brisbane': [-27.4698, 153.0251],
  'Darwin': [-12.4634, 130.8456],
  'Hobart': [-42.8821, 147.3272],
  'Wellington': [-41.2865, 174.7762],
  'Christchurch': [-43.5321, 172.6362],
  'Suva': [-18.1248, 178.4501],
};

// Flatten countries_by_region.json into a list of
// { region, country, city, lat, lon }. Handles both the single-city
// ("city": "X") and multi-city ("cities": ["X","Y"]) shapes present in
// the source file.
function loadCityList() {
  const jsonPath = path.join(__dirname, 'countries_by_region.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const out = [];
  for (const region of raw.regions || []) {
    for (const c of region.countries || []) {
      const cities = Array.isArray(c.cities) ? c.cities : (c.city ? [c.city] : []);
      for (const city of cities) {
        const coords = CITY_COORDS[city];
        if (!coords) {
          console.warn(`[WorldWeather] No coordinates for "${city}" — skipping. Add it to CITY_COORDS.`);
          continue;
        }
        out.push({
          region: region.region,
          country: c.country,
          city,
          lat: coords[0],
          lon: coords[1],
        });
      }
    }
  }
  return out;
}

// Fetch today's forecast for a batch of cities in one request. "Today" is
// each city's own local date. Returns one { dayName, date, high, low,
// condition } per city, in the same order (null where data is missing).
async function fetchTodayForecasts(cities) {
  const params = new URLSearchParams({
    latitude: cities.map(c => c.lat).join(','),
    longitude: cities.map(c => c.lon).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    // Current conditions ride along in the same request. 6 variables in
    // all stays under Open-Meteo's 10-variable threshold, so each city is
    // still one API call.
    current: 'temperature_2m,weather_code',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: 1,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { 'User-Agent': UA },
    timeout: 20000,
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];   // one city → plain object

  return cities.map((_, i) => {
    const d = list[i]?.daily;
    if (!d || !Array.isArray(d.time) || !d.time.length) return null;
    // A plain local date; format it as UTC so it doesn't shift.
    const when = new Date(d.time[0] + 'T00:00:00Z');
    const round = (v) => (v == null ? null : Math.round(v));
    const cur = list[i]?.current;
    return {
      dayName: when.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      date: when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }),
      high: round(d.temperature_2m_max?.[0]),
      low: round(d.temperature_2m_min?.[0]),
      condition: wmoCondition(d.weather_code?.[0]),
      currentTemp: cur ? round(cur.temperature_2m) : null,
      currentCondition: cur && cur.weather_code != null ? wmoCondition(cur.weather_code) : null,
      // The city's time zone (from timezone=auto), so pages can show its
      // local time; the offset is a fallback for browsers without the zone.
      timezone: list[i]?.timezone || null,
      utcOffset: Number.isFinite(list[i]?.utc_offset_seconds) ? list[i].utc_offset_seconds : null,
    };
  });
}

// Cities per request (keeps the URL a reasonable length).
const BATCH_SIZE = 50;

// ── Temperature layer grid ─────────────────────────────────────────
// The /wx world map's colour layer blends temperatures (today's high, or
// the current temperature) between known points. The cities cover most
// land; this coarse global grid (every 20°, plus a row over Antarctica)
// fills the oceans and empty areas. It's fetched at most every
// GRID_MAX_AGE_MS (153 Open-Meteo calls each time; every 3 hours keeps
// the current temperatures reasonably fresh), and otherwise carried over
// from the last saved file.
const GRID_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function gridPoints() {
  const pts = [];
  for (let lat = -60; lat <= 80; lat += 20) {
    for (let lon = -180; lon < 180; lon += 20) pts.push({ lat, lon });
  }
  for (let lon = -180; lon < 180; lon += 40) pts.push({ lat: -80, lon });
  return pts;
}

async function temperatureGrid(savedPath) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(savedPath, 'utf8')); } catch (_) { /* first run */ }
  const age = saved && saved.gridUpdated ? Date.now() - Date.parse(saved.gridUpdated) : Infinity;
  // A grid saved before current temperatures were added has 3 values per point.
  const hasCurrent = Array.isArray(saved?.grid) && saved.grid.length && saved.grid[0].length >= 4;
  if (hasCurrent && age < GRID_MAX_AGE_MS) {
    return { grid: saved.grid, gridUpdated: saved.gridUpdated };
  }
  const pts = gridPoints();
  const grid = [];
  for (let i = 0; i < pts.length; i += BATCH_SIZE) {
    const batch = pts.slice(i, i + BATCH_SIZE);
    try {
      const fc = await fetchTodayForecasts(batch);
      batch.forEach((p, j) => {
        if (fc[j] && fc[j].high != null) grid.push([p.lat, p.lon, fc[j].high, fc[j].currentTemp]);
      });
    } catch (e) {
      console.error(`[WorldWeather] Temperature grid batch failed: ${e.message}`);
    }
  }
  if (!grid.length && saved?.grid) return { grid: saved.grid, gridUpdated: saved.gridUpdated };
  console.log(`[WorldWeather] Temperature grid: ${grid.length}/${pts.length} points`);
  return { grid, gridUpdated: new Date().toISOString() };   // [[lat, lon, high°F, now°F], ...]
}

// Main: build today's world forecast and write public/data/world-weather.json
async function refreshWorldWeather() {
  console.log('[WorldWeather] Refreshing today\'s forecasts for world cities...');
  const cityList = loadCityList();

  const enriched = [];
  for (let i = 0; i < cityList.length; i += BATCH_SIZE) {
    const batch = cityList.slice(i, i + BATCH_SIZE);
    let forecasts = [];
    try {
      forecasts = await fetchTodayForecasts(batch);
    } catch (e) {
      console.error(`[WorldWeather] Batch of ${batch.length} cities failed: ${e.message}`);
    }
    batch.forEach((c, j) => {
      const fc = forecasts[j];
      enriched.push(fc ? { ...c, ...fc, ok: true } : { ...c, ok: false });
    });
  }

  // Re-group into regions, preserving the source order.
  const regionOrder = [];
  const byRegion = new Map();
  for (const item of enriched) {
    if (!byRegion.has(item.region)) {
      byRegion.set(item.region, []);
      regionOrder.push(item.region);
    }
    byRegion.get(item.region).push({
      country: item.country,
      city: item.city,
      lat: item.lat,
      lon: item.lon,
      dayName: item.dayName || '',
      date: item.date || '',
      high: item.high ?? null,
      currentTemp: item.currentTemp ?? null,
      currentCondition: item.currentCondition || null,
      timezone: item.timezone || null,
      utcOffset: item.utcOffset ?? null,
      low: item.low ?? null,
      condition: item.ok ? item.condition : 'Unavailable',
    });
  }

  const outPath = path.join(__dirname, 'public', 'data', 'world-weather.json');
  const result = {
    lastUpdated: new Date().toISOString(),
    regions: regionOrder.map(r => ({ region: r, cities: byRegion.get(r) })),
    ...(await temperatureGrid(outPath)),
  };

  const okCount = enriched.filter(e => e.ok).length;
  console.log(`[WorldWeather] ${okCount}/${enriched.length} cities fetched OK`);

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`[WorldWeather] Saved to ${outPath}`);
  return result;
}

module.exports = { refreshWorldWeather };

// Run directly for testing: `node world-weather-scraper.js`
if (require.main === module) {
  refreshWorldWeather().then(data => {
    for (const r of data.regions) {
      console.log(`\n${r.region}:`);
      r.cities.forEach(c => console.log(`  ${c.city}, ${c.country}: ${c.high}/${c.low}°F - ${c.condition}`));
    }
  });
}
