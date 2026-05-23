const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Location configs
const LOCATIONS = {
  chantilly: {
    name: 'Chantilly, VA',
    nwsForecast: 'https://api.weather.gov/gridpoints/LWX/83,69/forecast',
    nwsHourly: 'https://api.weather.gov/gridpoints/LWX/83,69/forecast/hourly',
    wuSlug: 'us/va/chantilly',
    lat: 38.8942,
    lon: -77.4311,
  },
  cincinnati: {
    name: 'Cincinnati, OH',
    nwsForecast: 'https://api.weather.gov/gridpoints/ILN/36,38/forecast',
    nwsHourly: 'https://api.weather.gov/gridpoints/ILN/36,38/forecast/hourly',
    wuSlug: 'us/oh/cincinnati',
    lat: 39.1031,
    lon: -84.5120,
  },
};

const UA = 'MarckNetVision/1.0 (weather dashboard; contact@marcknetvision.local)';

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

// Fetch Weather Underground API (internal JSON endpoint)
async function fetchWUForecast(slug) {
  try {
    const url = `https://api.weather.com/v3/wx/forecast/daily/7day?geocode=${LOCATIONS[slug]?.lat || 38.89},${LOCATIONS[slug]?.lon || -77.43}&format=json&units=e&language=en-US&apiKey=e1f10a1e78da46f5b10a1e78da96f525`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`WU API ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`WU fetch failed for ${slug}: ${e.message}`);
    return null;
  }
}

// Scrape Weather Underground HTML via internal Sun API (backup)
async function fetchWUSunAPI(locKey) {
  const loc = LOCATIONS[locKey];
  try {
    const url = `https://api.weather.com/v3/wx/forecast/daily/7day?geocode=${loc.lat},${loc.lon}&format=json&units=e&language=en-US&apiKey=e1f10a1e78da46f5b10a1e78da96f525`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
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

    const dayName = p.name.replace(/ .*/, ''); // "Saturday" -> "Sat" handled below
    const shortDay = dayName.length > 3 ? dayName.substring(0, 3) : dayName;
    // Handle "This Afternoon" / "Today"
    const displayDay = (p.name === 'This Afternoon' || p.name === 'Today') ? 'Today' : shortDay;

    const windMatch = (p.windSpeed || '').match(/(\d+)/);
    const windMph = windMatch ? parseInt(windMatch[1]) : 0;

    days.push({
      dayName: displayDay,
      date: new Date(p.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
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

// Parse Weather.com (WU backend) data
function parseWUData(wuData) {
  if (!wuData || !wuData.dayOfWeek) return [];
  const days = [];
  const numDays = Math.min(7, wuData.dayOfWeek.length);

  for (let i = 0; i < numDays; i++) {
    const dayPart = wuData.daypart?.[0];
    const dayIdx = i * 2; // daypart alternates day/night

    days.push({
      dayName: (wuData.dayOfWeek[i] || '').substring(0, 3),
      date: wuData.validTimeLocal?.[i]
        ? new Date(wuData.validTimeLocal[i]).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        : '',
      high: wuData.temperatureMax?.[i] ?? null,
      low: wuData.temperatureMin?.[i] ?? null,
      dewPoint: dayPart?.relativeHumidity?.[dayIdx] != null
        ? Math.round((wuData.temperatureMax?.[i] || 60) - ((100 - (dayPart.relativeHumidity[dayIdx] || 50)) * 0.36))
        : null,
      wind: dayPart?.windSpeed?.[dayIdx] != null
        ? `${dayPart.windSpeed[dayIdx]} mph ${dayPart.windDirectionCardinal?.[dayIdx] || ''}`
        : null,
      windMph: dayPart?.windSpeed?.[dayIdx] || 0,
      cloudCover: dayPart?.cloudCover?.[dayIdx] ?? null,
      precipChance: dayPart?.precipChance?.[dayIdx] ?? wuData.qpf?.[i] != null ? Math.min(100, Math.round((wuData.qpf[i] || 0) * 100)) : 0,
      condition: dayPart?.wxPhraseLong?.[dayIdx] || wuData.narrative?.[i] || 'Unknown',
      forecastText: wuData.narrative?.[i] || dayPart?.narrative?.[dayIdx] || '',
      source: 'WU',
    });
  }
  return days;
}

// Merge NWS and WU data, averaging where both have values
function mergeForecastData(nwsDays, wuDays) {
  const merged = [];
  const maxDays = Math.max(nwsDays.length, wuDays.length);

  for (let i = 0; i < Math.min(maxDays, 7); i++) {
    const nws = nwsDays[i] || {};
    const wu = wuDays[i] || {};

    const avg = (a, b) => {
      if (a != null && b != null) return Math.round((a + b) / 2);
      return a ?? b ?? 0;
    };

    const high = avg(nws.high, wu.high);
    const low = avg(nws.low, wu.low);

    // Estimate dew point from humidity or use WU value
    let dewPoint = wu.dewPoint;
    if (dewPoint == null) {
      // Rough estimate: dew point is typically 10-20 degrees below temp
      dewPoint = Math.round(low - 5 + (nws.precipChance || 0) * 0.15);
    }

    // Estimate cloud cover from condition text if not available
    let cloudCover = wu.cloudCover;
    if (cloudCover == null) {
      const cond = (nws.condition || wu.condition || '').toLowerCase();
      if (cond.includes('sunny') || cond.includes('clear')) cloudCover = 10;
      else if (cond.includes('mostly sunny') || cond.includes('mostly clear')) cloudCover = 25;
      else if (cond.includes('partly')) cloudCover = 45;
      else if (cond.includes('mostly cloudy')) cloudCover = 70;
      else if (cond.includes('cloudy') || cond.includes('overcast')) cloudCover = 85;
      else if (cond.includes('rain') || cond.includes('snow') || cond.includes('storm')) cloudCover = 90;
      else cloudCover = 50;
    }

    merged.push({
      dayName: nws.dayName || wu.dayName || `Day ${i + 1}`,
      date: nws.date || wu.date || '',
      high,
      low,
      dewPoint,
      wind: nws.wind || wu.wind || '5 mph',
      cloudCover,
      precipChance: avg(nws.precipChance, wu.precipChance != null ? wu.precipChance : null),
      condition: nws.condition || wu.condition || 'Unknown',
      forecastText: nws.forecastText || wu.forecastText || '',
    });
  }

  return merged;
}

// Main: refresh weather for all locations
async function refreshWeather() {
  console.log('[Weather] Refreshing forecasts...');
  const result = {};
  const sources = [];

  for (const [key, loc] of Object.entries(LOCATIONS)) {
    console.log(`[Weather] Fetching ${loc.name}...`);

    // Fetch from forecast sources + alerts in parallel.
    const [nwsPeriods, wuData, alerts] = await Promise.all([
      fetchNWSForecast(loc.nwsForecast),
      fetchWUForecast(key),
      fetchNWSAlerts(loc.lat, loc.lon),
    ]);
    console.log(`[Weather] ${loc.name}: ${alerts.length} active alert(s)`);

    const nwsDays = parseNWSDays(nwsPeriods);
    const wuDays = parseWUData(wuData);

    const usedSources = [];
    if (nwsDays.length > 0) usedSources.push('NWS');
    if (wuDays.length > 0) usedSources.push('Weather Underground');

    console.log(`[Weather] ${loc.name}: NWS=${nwsDays.length} days, WU=${wuDays.length} days`);

    let daily;
    if (nwsDays.length > 0 && wuDays.length > 0) {
      daily = mergeForecastData(nwsDays, wuDays);
      usedSources.push('(averaged)');
    } else if (nwsDays.length > 0) {
      // Supplement NWS-only data with estimated fields
      daily = nwsDays.map(d => ({
        ...d,
        dewPoint: d.dewPoint || Math.round(d.low - 5 + (d.precipChance || 0) * 0.15),
        cloudCover: d.cloudCover || estimateCloudCover(d.condition),
      }));
    } else if (wuDays.length > 0) {
      daily = wuDays;
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
