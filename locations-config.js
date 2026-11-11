const fs = require('fs');
const path = require('path');

// Weather locations shown on the main page and /wx, in display order.
// Edit config/locations.json to add or remove one; the next weather
// refresh fetches its forecast. Each entry:
//   key   short unique id (lowercase letters, digits, - or _)
//   name  label shown on the page, e.g. "Chantilly, VA"
//   lat, lon  decimal degrees (US locations — forecasts come from NWS)
const CONFIG_PATH = path.join(__dirname, 'config', 'locations.json');

// Used if the file is missing or unreadable, so the page still works.
const DEFAULT_LOCATIONS = [
  { key: 'chantilly', name: 'Chantilly, VA', lat: 38.8942, lon: -77.4311 },
  { key: 'cincinnati', name: 'Cincinnati, OH', lat: 39.1031, lon: -84.5120 },
];

// Keys the pages already use for their built-in tabs.
const RESERVED_KEYS = new Set(['browserLocation', 'world', 'pivotal']);

function validLocation(l, seen) {
  return l && typeof l === 'object' &&
    typeof l.key === 'string' && /^[a-z0-9_-]{1,40}$/.test(l.key) &&
    !RESERVED_KEYS.has(l.key) && !seen.has(l.key) &&
    typeof l.name === 'string' && l.name.trim() !== '' &&
    Number.isFinite(l.lat) && l.lat >= -90 && l.lat <= 90 &&
    Number.isFinite(l.lon) && l.lon >= -180 && l.lon <= 180;
}

// Read on every call, so edits apply without a server restart. Invalid
// entries are skipped with a warning rather than failing the whole list.
function loadLocations() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`[Locations] Can't read ${CONFIG_PATH} (${e.message}); using defaults.`);
    return DEFAULT_LOCATIONS;
  }
  if (!Array.isArray(raw)) {
    console.error('[Locations] locations.json must be a JSON array; using defaults.');
    return DEFAULT_LOCATIONS;
  }
  const seen = new Set();
  const list = [];
  raw.forEach((l, i) => {
    if (!validLocation(l, seen)) {
      console.warn(`[Locations] Skipping entry ${i} in locations.json: ${JSON.stringify(l)}`);
      return;
    }
    seen.add(l.key);
    list.push({ key: l.key, name: l.name.trim(), lat: l.lat, lon: l.lon });
  });
  return list;
}

module.exports = { loadLocations };
