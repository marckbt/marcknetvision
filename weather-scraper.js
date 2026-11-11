const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const { loadLocations } = require('./locations-config');
const { wmoCondition } = require('./open-meteo');

const UA = 'MarckNetVision/1.0 (weather dashboard; contact@marcknetvision.local)';

// NWS forecasts are per grid cell; look up each location's forecast URL
// from its lat/lon once and keep it for the life of the process.
const nwsForecastUrls = new Map();   // "lat,lon" → forecast URL

async function resolveNWSForecastUrl(lat, lon) {
  const key = `${lat},${lon}`;
  if (nwsForecastUrls.has(key)) return nwsForecastUrls.get(key);
  try {
    const res = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`NWS points ${res.status}`);
    const url = (await res.json()).properties?.forecast;
    if (!url) throw new Error('no forecast URL (outside NWS coverage?)');
    nwsForecastUrls.set(key, url);
    return url;
  } catch (e) {
    console.error(`NWS grid lookup failed for ${key}: ${e.message}`);
    return null;
  }
}

// Fetch active NWS weather alerts (watches, warnings, advisories) for a
// point. Returns a normalized array sorted by severity (Extreme first).
// Empty array on failure — alerts are best-effort, never block forecasts.
async function fetchNWSAlerts(lat, lon) {
  if (lat == null || lon == null) return [];
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`NWS Alerts ${res.status}`);
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const now = Date.now();

    // Severity ranking — lower index = more important.
    const SEV_ORDER = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    // Bucket the alert into our three user-facing buckets based on the
    // event name ("...Warning" | "...Watch" | "...Advisory" | other).
    const bucketOf = (evt) => {
      const e = (evt || '').toLowerCase();
      if (e.includes('warning')) return 'warning';
      if (e.includes('watch')) return 'watch';
      if (e.includes('advisory')) return 'advisory';
      return 'statement';
    };

    const alerts = features
      .map(f => f.properties || {})
      .filter(p => {
        // Drop cancellations and explicitly-expired alerts. We keep
        // "Update" and "Alert" messageTypes.
        if (p.messageType === 'Cancel') return false;
        if (p.expires) {
          const t = new Date(p.expires).getTime();
          if (Number.isFinite(t) && t < now) return false;
        }
        return true;
      })
      .map(p => ({
        id:          p.id || p['@id'] || '',
        event:       p.event || 'Weather Alert',
        bucket:      bucketOf(p.event),
        severity:    p.severity   || 'Unknown',
        urgency:     p.urgency    || 'Unknown',
        certainty:   p.certainty  || 'Unknown',
        headline:    p.headline   || '',
        description: p.description || '',
        instruction: p.instruction || '',
        areaDesc:    p.areaDesc   || '',
        effective:   p.effective  || '',
        expires:     p.expires    || '',
        sender:      p.senderName || 'NWS',
      }));

    // Sort: most-severe first, then by effective time (most recent first).
    alerts.sort((a, b) => {
      const sa = SEV_ORDER[a.severity] ?? 9;
      const sb = SEV_ORDER[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.effective || 0) - new Date(a.effective || 0);
    });
    return alerts;
  } catch (e) {
    console.error(`[Weather] NWS alerts fetch failed for ${lat},${lon}: ${e.message}`);
    return [];
  }
}

// Fetch NWS forecast
async function fetchNWSForecast(url) {
  if (!url) return [];
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    const data = await res.json();
    return data.properties.periods || [];
  } catch (e) {
    console.error(`NWS fetch failed: ${e.message}`);
    return [];
  }
}

// Fetch the Open-Meteo daily forecast (free, no API key; non-commercial
// use). Dates are in the location's own time zone.
async function fetchOpenMeteoForecast(loc) {
  try {
    const params = new URLSearchParams({
      latitude: loc.lat,
      longitude: loc.lon,
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_probability_max', 'wind_speed_10m_max',
        'wind_direction_10m_dominant', 'cloud_cover_mean', 'dew_point_2m_mean',
      ].join(','),
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto',
      forecast_days: 8,
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`Open-Meteo fetch failed for ${loc.name}: ${e.message}`);
    return null;
  }
}

// Parse NWS periods into daily forecasts
function parseNWSDays(periods) {
  const days = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (!p.isDaytime) continue;

    // Find matching night period
    const nightP = periods[i + 1] && !periods[i + 1].isDaytime ? periods[i + 1] : null;

    // Weekday from the period's local date, not its name: NWS names
    // holidays ("Veterans Day", "Thanksgiving Day"), which would show as
    // "Vet" or "Tha".
    const isoDay = (p.startTime || '').slice(0, 10);
    const shortDay = /^\d{4}-\d{2}-\d{2}$/.test(isoDay)
      ? new Date(isoDay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
      : p.name.replace(/ .*/, '').substring(0, 3);
    // Handle "This Afternoon" / "Today"
    const displayDay = (p.name === 'This Afternoon' || p.name === 'Today') ? 'Today' : shortDay;

    // NWS gives a range such as "5 to 10 mph"; use the top of it.
    const windNums = (p.windSpeed || '').match(/\d+/g) || [];
    const windMph = windNums.length ? Math.max(...windNums.map(Number)) : 0;

    days.push({
      dayName: displayDay,
      date: new Date(p.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
      isoDate: (p.startTime || '').slice(0, 10),   // local date, e.g. "2026-10-28"
      high: p.temperature,
      low: nightP ? nightP.temperature : p.temperature - 15,
      dewPoint: null, // NWS doesn't include in forecast
      wind: `${windMph} mph ${p.windDirection || ''}`.trim(),
      windMph,
      cloudCover: null,
      precipChance: p.probabilityOfPrecipitation?.value || 0,
      condition: p.shortForecast || 'Unknown',
      forecastText: p.detailedForecast || p.shortForecast || '',
      source: 'NWS',
    });
  }
  return days.slice(0, 7);
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Parse the Open-Meteo daily forecast into the same day shape as NWS.
function parseOpenMeteoDays(data) {
  const d = data && data.daily;
  if (!d || !Array.isArray(d.time)) return [];
  const round = (v) => (v == null ? null : Math.round(v));
  return d.time.slice(0, 8).map((isoDate, i) => {
    // isoDate is a plain local date; format it as UTC so it doesn't shift.
    const when = new Date(isoDate + 'T00:00:00Z');
    const windMph = round(d.wind_speed_10m_max?.[i]) ?? 0;
    const deg = d.wind_direction_10m_dominant?.[i];
    const dir = deg != null ? COMPASS[Math.round(deg / 45) % 8] : '';
    const condition = wmoCondition(d.weather_code?.[i]);
    return {
      dayName: when.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      date: when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }),
      isoDate,
      high: round(d.temperature_2m_max?.[i]),
      low: round(d.temperature_2m_min?.[i]),
      dewPoint: round(d.dew_point_2m_mean?.[i]),
      wind: `${windMph} mph ${dir}`.trim(),
      windMph,
      cloudCover: round(d.cloud_cover_mean?.[i]),
      precipChance: round(d.precipitation_probability_max?.[i]) ?? 0,
      condition,
      forecastText: condition,
      source: 'Open-Meteo',
    };
  });
}

// Merge NWS and Open-Meteo data, averaging where both have values. NWS
// leads (its days and wording); Open-Meteo days are matched by date, since
// NWS skips today once only "Tonight" is left.
function mergeForecastData(nwsDays, omDays) {
  const merged = [];
  const omByDate = new Map(omDays.map(d => [d.isoDate, d]));

  for (let i = 0; i < Math.min(nwsDays.length, 7); i++) {
    const nws = nwsDays[i];
    const om = omByDate.get(nws.isoDate) || {};

    const avg = (a, b) => {
      if (a != null && b != null) return Math.round((a + b) / 2);
      return a ?? b ?? 0;
    };

    const high = avg(nws.high, om.high);
    const low = avg(nws.low, om.low);

    // Open-Meteo's dew point, or an estimate without it
    let dewPoint = om.dewPoint;
    if (dewPoint == null) {
      // Rough estimate: dew point is typically 10-20 degrees below temp
      dewPoint = Math.round(low - 5 + (nws.precipChance || 0) * 0.15);
    }

    // Estimate cloud cover from condition text if not available
    let cloudCover = om.cloudCover;
    if (cloudCover == null) {
      const cond = (nws.condition || om.condition || '').toLowerCase();
      if (cond.includes('sunny') || cond.includes('clear')) cloudCover = 10;
      else if (cond.includes('mostly sunny') || cond.includes('mostly clear')) cloudCover = 25;
      else if (cond.includes('partly')) cloudCover = 45;
      else if (cond.includes('mostly cloudy')) cloudCover = 70;
      else if (cond.includes('cloudy') || cond.includes('overcast')) cloudCover = 85;
      else if (cond.includes('rain') || cond.includes('snow') || cond.includes('storm')) cloudCover = 90;
      else cloudCover = 50;
    }

    merged.push({
      dayName: nws.dayName || om.dayName || `Day ${i + 1}`,
      date: nws.date || om.date || '',
      high,
      low,
      dewPoint,
      wind: nws.wind || om.wind || '5 mph',
      cloudCover,
      precipChance: avg(nws.precipChance, om.precipChance != null ? om.precipChance : null),
      condition: nws.condition || om.condition || 'Unknown',
      forecastText: nws.forecastText || om.forecastText || '',
    });
  }

  return merged;
}

// Main: refresh weather for all locations
async function refreshWeather() {
  console.log('[Weather] Refreshing forecasts...');
  const result = {};
  const sources = [];

  for (const loc of loadLocations()) {
    const key = loc.key;
    console.log(`[Weather] Fetching ${loc.name}...`);

    // Fetch from forecast sources + alerts in parallel.
    const [nwsPeriods, omData, alerts] = await Promise.all([
      resolveNWSForecastUrl(loc.lat, loc.lon).then(fetchNWSForecast),
      fetchOpenMeteoForecast(loc),
      fetchNWSAlerts(loc.lat, loc.lon),
    ]);
    console.log(`[Weather] ${loc.name}: ${alerts.length} active alert(s)`);

    const nwsDays = parseNWSDays(nwsPeriods);
    const omDays = parseOpenMeteoDays(omData);

    const usedSources = [];
    if (nwsDays.length > 0) usedSources.push('NWS');
    if (omDays.length > 0) usedSources.push('Open-Meteo');

    console.log(`[Weather] ${loc.name}: NWS=${nwsDays.length} days, Open-Meteo=${omDays.length} days`);

    let daily;
    if (nwsDays.length > 0 && omDays.length > 0) {
      daily = mergeForecastData(nwsDays, omDays);
      usedSources.push('(averaged)');
    } else if (nwsDays.length > 0) {
      // Supplement NWS-only data with estimated fields
      daily = nwsDays.map(d => ({
        ...d,
        dewPoint: d.dewPoint || Math.round(d.low - 5 + (d.precipChance || 0) * 0.15),
        cloudCover: d.cloudCover || estimateCloudCover(d.condition),
      }));
    } else if (omDays.length > 0) {
      daily = omDays.slice(0, 7);
    } else {
      console.error(`[Weather] No data for ${loc.name}! Using fallback.`);
      // Return existing data if available
      const existingPath = path.join(__dirname, 'public', 'data', 'weather.json');
      if (fs.existsSync(existingPath)) {
        const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
        if (existing[key]) {
          result[key] = existing[key];
          result[key].lastUpdated = 'cached';
          continue;
        }
      }
      daily = [];
    }

    result[key] = {
      name: loc.name,
      sources: usedSources,
      lastUpdated: new Date().toISOString(),
      daily,
      alerts,
    };
  }

  // Write to file
  const outPath = path.join(__dirname, 'public', 'data', 'weather.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`[Weather] Saved to ${outPath}`);

  return result;
}

function estimateCloudCover(condition) {
  const cond = (condition || '').toLowerCase();
  if (cond.includes('sunny') || cond.includes('clear')) return 10;
  if (cond.includes('mostly sunny') || cond.includes('mostly clear')) return 25;
  if (cond.includes('partly')) return 45;
  if (cond.includes('mostly cloudy')) return 70;
  if (cond.includes('cloudy') || cond.includes('overcast')) return 85;
  if (cond.includes('rain') || cond.includes('snow') || cond.includes('storm')) return 90;
  return 50;
}

module.exports = { refreshWeather, fetchNWSAlerts };

// Run directly for testing
if (require.main === module) {
  refreshWeather().then(data => {
    for (const [k, v] of Object.entries(data)) {
      console.log(`\n${v.name} (${v.sources.join(', ')}):`);
      v.daily.forEach(d => console.log(`  ${d.dayName} ${d.date}: ${d.high}/${d.low}°F - ${d.condition}`));
    }
  });
}
