const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Today's forecast for major world cities, grouped by region. The city
// list is driven by countries_by_region.json; this file supplies the
// lat/lon for each city (the JSON only has names) and fetches each
// city's forecast from the Weather.com geocode API, which — unlike NWS
// (US-only) — works globally.

const WU_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

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
  // East & Southeast Asia
  'Beijing': [39.9042, 116.4074],
  'Jakarta': [-6.2088, 106.8456],
  'Manila': [14.5995, 120.9842],
  'Ho Chi Minh City': [10.8231, 106.6297],
  'Bangkok': [13.7563, 100.5018],
  'Yangon': [16.8409, 96.1735],
  'Seoul': [37.5665, 126.9780],
  // Sub-Saharan Africa
  'Lagos': [6.5244, 3.3792],
  'Addis Ababa': [9.0300, 38.7400],
  'Kinshasa': [-4.4419, 15.2663],
  'Johannesburg': [-26.2041, 28.0473],
  'Nairobi': [-1.2921, 36.8219],
  // Middle East & North Africa
  'Cairo': [30.0444, 31.2357],
  'Algiers': [36.7538, 3.0588],
  'Baghdad': [33.3152, 44.3661],
  'Casablanca': [33.5731, -7.5898],
  'Riyadh': [24.7136, 46.6753],
  'Sanaa': [15.3694, 44.1910],
  // Europe
  'Moscow': [55.7558, 37.6173],
  'Berlin': [52.5200, 13.4050],
  'Frankfurt': [50.1109, 8.6821],
  'London': [51.5074, -0.1278],
  'Paris': [48.8566, 2.3522],
  'Madrid': [40.4168, -3.7038],
  'Kyiv': [50.4501, 30.5234],
  // Latin America & Caribbean
  'São Paulo': [-23.5505, -46.6333],
  'Mexico City': [19.4326, -99.1332],
  'Bogotá': [4.7110, -74.0721],
  'Buenos Aires': [-34.6037, -58.3816],
  'Lima': [-12.0464, -77.0428],
  'Caracas': [10.4806, -66.9036],
  // Central Asia
  'Tashkent': [41.2995, 69.2401],
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
  // Oceania
  'Sydney': [-33.8688, 151.2093],
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

// Fetch one city's 7-day forecast from Weather.com and pull TODAY's
// values out of it. Returns { high, low, condition } or null on failure.
async function fetchTodayForecast(lat, lon) {
  const url = `https://api.weather.com/v3/wx/forecast/daily/7day?geocode=${lat},${lon}&format=json&units=e&language=en-US&apiKey=${WU_API_KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
  if (!res.ok) throw new Error(`WU ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.dayOfWeek)) return null;

  // daypart[0] holds alternating day/night entries; index 0 is today's
  // daytime, index 1 tonight. Prefer the short day phrase; when the
  // daytime slot has already passed (US-evening) it's null, so fall back
  // to the night phrase — both map cleanly to the retro weather icons.
  const dp = data.daypart && data.daypart[0];
  const phrase = (arr) => (Array.isArray(arr) ? (arr[0] || arr[1] || '') : '');
  const condition =
    phrase(dp?.wxPhraseShort) ||
    phrase(dp?.wxPhraseLong) ||
    data.narrative?.[0] ||
    'Unknown';

  // calendarDayTemperature* give today's high/low for the whole calendar
  // day regardless of the current time, so they don't go null in the
  // evening the way temperatureMax[0] does.
  const high =
    data.calendarDayTemperatureMax?.[0] ??
    data.temperatureMax?.[0] ??
    dp?.temperature?.[0] ?? null;
  const low =
    data.calendarDayTemperatureMin?.[0] ??
    data.temperatureMin?.[0] ??
    dp?.temperature?.[1] ?? null;

  return {
    dayName: (data.dayOfWeek?.[0] || '').substring(0, 3),
    date: data.validTimeLocal?.[0]
      ? new Date(data.validTimeLocal[0]).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      : '',
    high: high != null ? Math.round(high) : null,
    low: low != null ? Math.round(low) : null,
    condition,
  };
}

// Run an array of async task functions with limited concurrency so we
// don't fire 48 simultaneous requests at the Weather.com endpoint.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Main: build today's world forecast and write public/data/world-weather.json
async function refreshWorldWeather() {
  console.log('[WorldWeather] Refreshing today\'s forecasts for world cities...');
  const cityList = loadCityList();

  const enriched = await mapLimit(cityList, 6, async (c) => {
    try {
      const fc = await fetchTodayForecast(c.lat, c.lon);
      if (!fc) return { ...c, ok: false };
      return { ...c, ...fc, ok: true };
    } catch (e) {
      console.error(`[WorldWeather] ${c.city}: ${e.message}`);
      return { ...c, ok: false };
    }
  });

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
      dayName: item.dayName || '',
      date: item.date || '',
      high: item.high ?? null,
      low: item.low ?? null,
      condition: item.ok ? item.condition : 'Unavailable',
    });
  }

  const result = {
    lastUpdated: new Date().toISOString(),
    regions: regionOrder.map(r => ({ region: r, cities: byRegion.get(r) })),
  };

  const okCount = enriched.filter(e => e.ok).length;
  console.log(`[WorldWeather] ${okCount}/${enriched.length} cities fetched OK`);

  const outPath = path.join(__dirname, 'public', 'data', 'world-weather.json');
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
