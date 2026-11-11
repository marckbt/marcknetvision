/* FAA airport delays, ground stops and closures for the Breaking Alert
 * System (/wx), from the FAA's NAS Status site (https://nasstatus.faa.gov/).
 *
 *   /api/airport-events   "Active Airport Events": ground stops, ground
 *                          delay programs, arrival/departure delays,
 *                          closures, deicing. Shown as warnings.
 *   /api/operations-plan  "Forecast Events" → "Terminal Planned": possible
 *                          or expected ground stops / delay programs.
 *                          Shown as watches.
 *   /api/pacing-airports  coordinates for the major airports, used to
 *                          place planned events (which name airports only).
 *
 * Closures for non-scheduled ("NON SKED") transient aircraft are routine
 * standing notices and are left out.
 *
 * Each event becomes an alert in the same shape as the NWS ones
 * (alerts-scraper.js), with `source: 'faa'`, the airport's `point`, a
 * severity `level` (1–4) and its colour on that scale. Cached for
 * CACHE_MS; a failed refresh keeps serving the last good data.
 */
const fetch = require('node-fetch');

const UA = 'MarckNetVision/1.0 (weather dashboard; contact@marcknetvision.local)';
const BASE = 'https://nasstatus.faa.gov/api/';
const CACHE_MS = 2 * 60 * 1000;
const COORDS_MS = 24 * 60 * 60 * 1000;
const SENDER = 'FAA Air Traffic Control System Command Center (nasstatus.faa.gov)';

// Severity scale, 1 (minor) to 4 (severe): warning-style colours.
const LEVEL_COLOR = { 1: '#FFE14D', 2: '#FFB300', 3: '#FF7A00', 4: '#E3001B' };
const LEVEL_SEVERITY = { 1: 'Minor', 2: 'Moderate', 3: 'Severe', 4: 'Extreme' };

// Airports the planned events may name that the pacing list doesn't
// cover. The FAA list (and active events' own coordinates) win.
const FALLBACK_COORDS = {
  ABQ: [35.0402, -106.6090], ALB: [42.7483, -73.8017], ANC: [61.1743, -149.9963], AUS: [30.1975, -97.6664],
  BDL: [41.9389, -72.6832], BFI: [47.5300, -122.3020], BHM: [33.5629, -86.7535], BOI: [43.5644, -116.2228],
  BUF: [42.9405, -78.7322], BUR: [34.2007, -118.3585], CHS: [32.8986, -80.0405], CMH: [39.9980, -82.8919],
  DAL: [32.8471, -96.8518], DAY: [39.9024, -84.2194], DSM: [41.5340, -93.6631], ELP: [31.8072, -106.3776],
  GEG: [47.6199, -117.5338], GRR: [42.8808, -85.5228], GSO: [36.0978, -79.9373], HNL: [21.3187, -157.9225],
  HOU: [29.6454, -95.2789], HPN: [41.0670, -73.7076], ISP: [40.7952, -73.1002], JAX: [30.4941, -81.6879],
  LGB: [33.8177, -118.1516], MHT: [42.9326, -71.4357], MKE: [42.9472, -87.8966], MSY: [29.9934, -90.2580],
  OAK: [37.7213, -122.2208], OGG: [20.8986, -156.4305], OKC: [35.3931, -97.6007], OMA: [41.3032, -95.8941],
  ONT: [34.0560, -117.6012], ORF: [36.8946, -76.2012], PBI: [26.6832, -80.0956], PVD: [41.7240, -71.4283],
  PWM: [43.6462, -70.3093], RIC: [37.5052, -77.3197], RNO: [39.4991, -119.7681], ROC: [43.1189, -77.6724],
  RSW: [26.5362, -81.7552], SAT: [29.5337, -98.4698], SAV: [32.1276, -81.2021], SDF: [38.1744, -85.7360],
  SJU: [18.4394, -66.0018], SMF: [38.6954, -121.5908], SNA: [33.6757, -117.8682], SRQ: [27.3954, -82.5544],
  SYR: [43.1112, -76.1063], TUL: [36.1984, -95.8881], TUS: [32.1161, -110.9410],
  ASE: [39.2232, -106.8688], EGE: [39.6426, -106.9177], MDT: [40.1935, -76.7634], ACY: [39.4576, -74.5772],
};

let cache = null;        // { fetchedAt, data }
let inFlight = null;
let coords = null;       // { at, map: { ARPT: { lat, lon, name } } }

async function getJson(endpoint) {
  const res = await fetch(BASE + endpoint, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`FAA ${endpoint} HTTP ${res.status}`);
  return res.json();
}

async function airportCoords() {
  if (coords && Date.now() - coords.at < COORDS_MS) return coords.map;
  const map = {};
  Object.entries(FALLBACK_COORDS).forEach(([id, c]) => { if (c) map[id] = { lat: c[0], lon: c[1] }; });
  try {
    const list = await getJson('pacing-airports');
    (Array.isArray(list) ? list : []).forEach(a => {
      const lat = parseFloat(a.latitude);
      const lon = parseFloat(a.longitude);
      if (a.airportId && Number.isFinite(lat) && Number.isFinite(lon)) map[a.airportId] = { lat, lon };
    });
    coords = { at: Date.now(), map };
  } catch (e) {
    console.warn('[FAA] pacing airports unavailable:', e.message);
    if (coords) return coords.map;
  }
  return map;
}

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '');
const isNonSked = (text) => /NON[\s-]?SKED/i.test(text || '');

const hhmm = (s) => s.slice(0, 2) + ':' + s.slice(2);

// A daily closure window in NOTAM text, "DLY 0730-1415" (UTC): its label
// and whether it is in effect right now.
function dailyWindow(text) {
  const m = /\bDLY\s+(\d{4})-(\d{4})\b/.exec(text || '');
  if (!m) return null;
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(2);
  const a = toMin(m[1]);
  const b = toMin(m[2]);
  const inside = a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);   // may span midnight
  return { now: inside, label: hhmm(m[1]) + '–' + hhmm(m[2]) + ' UTC', until: hhmm(m[2]) + ' UTC' };
}

function delayLevel(min) {
  if (!Number.isFinite(min)) return 2;
  if (min >= 90) return 4;
  if (min >= 60) return 3;
  if (min >= 30) return 2;
  return 1;
}

function faaAlert(base, fields) {
  const level = fields.level;
  return {
    source: 'faa',
    bucket: 'warning',
    urgency: 'Immediate',
    certainty: 'Observed',
    severity: LEVEL_SEVERITY[level],
    color: LEVEL_COLOR[level],
    sender: SENDER,
    instruction: '',
    counties: [],
    states: [],
    geometry: null,
    ...base,
    ...fields,
  };
}

// "Active Airport Events" → warnings, one per event at an airport.
function activeAlerts(events) {
  const out = [];
  (Array.isArray(events) ? events : []).forEach(a => {
    const id = a.airportId;
    if (!id) return;
    const lat = parseFloat(a.latitude);
    const lon = parseFloat(a.longitude);
    const name = a.airportLongName || id;
    const base = {
      airport: id,
      airportName: name,
      point: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      areaDesc: id + ' · ' + name,
    };
    const add = (kind, ev, fields) => out.push(faaAlert(base, {
      id: 'faa:' + id + ':' + kind + ':' + (ev.id || ev.startTime || ev.updateTime || ev.eventTime || ''),
      sent: ev.updatedAt || ev.updateTime || ev.issuedDate || ev.startTime || ev.eventTime || null,
      effective: ev.startTime || ev.eventTime || null,
      expires: ev.endTime || null,
      ...fields,
    }));

    if (a.groundStop) {
      const g = a.groundStop;
      const ext = g.probabilityOfExtension ? cap(g.probabilityOfExtension) + ' chance of extension' : '';
      const why = cap(g.impactingCondition);
      add('gs', g, {
        event: 'FAA Ground Stop', level: 4,
        headline: 'Ground stop at ' + name + (why ? ' due to ' + why.toLowerCase() : ''),
        subject: [why, ext].filter(Boolean).join(' · '),
        description: 'Flights to ' + name + ' (' + id + ') are being held at their departure airports.' +
          (why ? '\nReason: ' + why + '.' : '') + (ext ? '\n' + ext + '.' : '') +
          (g.includedFacilities ? '\nIncluded facilities: ' + [].concat(g.includedFacilities).join(', ') + '.' : '') +
          (g.advisoryUrl ? '\nAdvisory: ' + g.advisoryUrl : ''),
      });
    }
    if (a.groundDelay) {
      const g = a.groundDelay;
      const avg = Number(g.avgDelay);
      const why = cap(g.impactingCondition);
      add('gdp', g, {
        event: 'FAA Ground Delay Program', level: Number.isFinite(avg) && avg >= 120 ? 4 : 3,
        headline: 'Ground delay program at ' + name + (Number.isFinite(avg) ? ', average ' + avg + ' min' : ''),
        subject: [why, Number.isFinite(avg) ? 'Avg ' + avg + ' min' : ''].filter(Boolean).join(' · '),
        description: 'Flights to ' + name + ' (' + id + ') are being given departure delays at their origin airports.' +
          (Number.isFinite(avg) ? '\nAverage delay: ' + avg + ' minutes.' : '') + (why ? '\nReason: ' + why + '.' : '') +
          (g.advisoryUrl ? '\nAdvisory: ' + g.advisoryUrl : ''),
      });
    }
    [['arrivalDelay', 'FAA Arrival Delay', 'arr', 'Arrivals'], ['departureDelay', 'FAA Departure Delay', 'dep', 'Departures']]
      .forEach(([key, event, kind, who]) => {
        const d = a[key];
        if (!d) return;
        const avg = Number(d.averageDelay);
        const why = cap(d.reason);
        const trend = d.trend ? cap(d.trend) : '';
        add(kind, d, {
          event, level: delayLevel(avg),
          headline: who + ' at ' + name + ' delayed' + (Number.isFinite(avg) ? ' about ' + avg + ' min' : ''),
          subject: [why, Number.isFinite(avg) ? 'Avg ' + avg + ' min' : '', trend].filter(Boolean).join(' · '),
          description: who + ' at ' + name + ' (' + id + ') are delayed' +
            (Number.isFinite(avg) ? ' an average of ' + avg + ' minutes' : '') + (trend ? ' and ' + trend.toLowerCase() : '') + '.' +
            (why ? '\nReason: ' + why + '.' : ''),
        });
      });
    // Closures: the formal closure and free-form closure notices alike,
    // except standing NON SKED (non-scheduled transient aircraft) ones.
    [['airportClosure', 'cl'], ['freeForm', 'ff']].forEach(([key, kind]) => {
      const c = a[key];
      if (!c || isNonSked(c.text) || isNonSked(c.simpleText)) return;
      const daily = dailyWindow(c.text);
      const notam = (c.simpleText || ('Closed ' + (c.text || ''))) + (c.notamNumber ? '\nNOTAM ' + c.notamNumber + '.' : '');
      if (daily && !daily.now) {
        // A recurring closure (e.g. "DLY 0730-1415") outside its hours:
        // open now, so a low-level notice rather than a closure.
        add(kind, c, {
          event: 'FAA Airport Closure', level: 1,
          headline: name + ' closes daily ' + daily.label,
          subject: 'Open now · closes daily ' + daily.label,
          description: notam,
        });
        return;
      }
      add(kind, c, {
        event: 'FAA Airport Closure', level: 4,
        headline: name + ' closed' + (daily ? ' until ' + daily.until : c.text ? ' (' + c.text + ')' : ''),
        subject: daily ? 'Closed now · daily ' + daily.label : (c.text ? 'Closed ' + c.text : 'Closed'),
        description: notam,
      });
    });
    if (a.deicing) {
      add('deice', a.deicing, {
        event: 'FAA Deicing', level: 1,
        headline: 'Aircraft deicing in progress at ' + name,
        subject: 'Deicing in progress',
        description: 'Aircraft are being deiced at ' + name + ' (' + id + '), which can slow departures.',
      });
    }
  });
  return out;
}

// "Forecast Events" → "Terminal Planned" → watches, one per airport named.
// Lines look like "AFTER 1600\t-BOS GROUND STOP/DELAY PROGRAM EXPECTED"
// or "1400-1800 -SEA/BFI ...", with times in UTC.
function utcTimeToday(hhmm, now) {
  const m = /^(\d{2})(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[1], +m[2]));
  // The plan looks ahead about a day: a time well past is tomorrow's.
  if (t.getTime() < now.getTime() - 6 * 3600 * 1000) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

function plannedAlerts(plan, coordMap) {
  const now = new Date();
  const out = [];
  (plan && Array.isArray(plan.terminalPlanned) ? plan.terminalPlanned : []).forEach((item, n) => {
    const raw = String(item.event || '').replace(/\s+/g, ' ').trim();
    if (!raw || isNonSked(raw)) return;
    // "<when> -<AIRPORTS> <what>", where <when> is "AFTER 1600",
    // "1400-1800", "1400" or nothing.
    const m = /^((?:(?:AFTER|BEFORE|UNTIL|BY)\s+\d{4})|(?:\d{4}\s*-\s*\d{4})|\d{4})?\s*-?\s*([A-Z0-9]{3,4}(?:\/[A-Z0-9]{3,4})*)\s+(.*)$/i.exec(raw);
    if (!m) return;
    const when = ((item.time ? item.time + ' ' : '') + (m[1] || '')).trim()
      .replace(/\b(\d{2})(\d{2})\b/g, '$1:$2').replace(/^(AFTER|BEFORE|UNTIL|BY)\b/i, (w) => cap(w));
    const what = m[3].trim();
    const expected = /\b(EXPECTED|PROBABLE|LIKELY)\b/i.test(what);
    const stop = /GROUND STOP/i.test(what);
    const event = stop ? 'FAA Planned Ground Stop' : 'FAA Planned Delay Program';
    const level = expected ? 3 : 2;
    const after = /AFTER\s+(\d{2}):?(\d{2})/i.exec(when);
    const range = /(\d{2}):?(\d{2})\s*-\s*(\d{2}):?(\d{2})/.exec(when);
    const effective = after ? utcTimeToday(after[1] + after[2], now) : range ? utcTimeToday(range[1] + range[2], now) : null;
    let ends = range ? utcTimeToday(range[3] + range[4], now) : null;
    if (ends && effective && ends < effective) ends = new Date(ends.getTime() + 86400000);   // past midnight
    m[2].split('/').forEach(id => {
      const c = coordMap[id];
      out.push(faaAlert({}, {
        id: 'faa:plan:' + id + ':' + n + ':' + raw.length,
        bucket: 'watch',
        urgency: 'Future',
        certainty: expected ? 'Likely' : 'Possible',
        event, level,
        airport: id,
        airportName: id,
        point: c ? { lat: c.lat, lon: c.lon } : null,
        areaDesc: id,
        headline: 'FAA operations plan — Terminal Planned',
        subject: cap(what) + (when ? ' · ' + when + ' UTC' : ''),
        description: 'FAA operations plan (Terminal Planned): ' + raw +
          '\nTimes are UTC. "Possible" and "expected" are the FAA\'s own wording.',
        sent: plan.updatedAt || null,
        effective: effective ? effective.toISOString() : null,
        expires: ends ? ends.toISOString() : null,
        color: expected ? LEVEL_COLOR[3] : LEVEL_COLOR[2],
      }));
    });
  });
  return out;
}

async function fetchFaa() {
  const [events, plan, coordMap] = await Promise.all([
    getJson('airport-events'),
    getJson('operations-plan').catch(e => { console.warn('[FAA] operations plan unavailable:', e.message); return null; }),
    airportCoords(),
  ]);
  // Active events carry their own coordinates and names; use them for
  // planned events at the same airports too.
  (Array.isArray(events) ? events : []).forEach(a => {
    const lat = parseFloat(a.latitude);
    const lon = parseFloat(a.longitude);
    if (a.airportId && Number.isFinite(lat) && Number.isFinite(lon)) coordMap[a.airportId] = { lat, lon };
  });
  const alerts = activeAlerts(events).concat(plannedAlerts(plan, coordMap));
  return { fetchedAt: new Date().toISOString(), alerts };
}

async function getFaaAlerts() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  if (!inFlight) {
    inFlight = fetchFaa()
      .then(data => {
        cache = { fetchedAt: Date.now(), data };
        console.log(`[FAA] ${data.alerts.length} airport event(s) and plans`);
        return data;
      })
      .catch(err => {
        console.error('[FAA] fetch failed:', err.message);
        if (cache) return { ...cache.data, stale: true };
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

module.exports = { getFaaAlerts, _test: { activeAlerts, plannedAlerts } };
