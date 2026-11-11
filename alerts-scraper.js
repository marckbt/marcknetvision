/* Breaking Alert System — every active NWS warning and watch in the US.
 *
 * Source: https://api.weather.gov/alerts/active (land areas, actual
 * alerts and updates only). Advisories and statements are left out; only
 * events named "... Warning" or "... Watch" are kept.
 *
 * Each alert is reduced to what the /wx page needs: the text shown in the
 * list and detail view, the counties it covers (5-digit FIPS codes from
 * its SAME geocodes, which the page maps onto county shapes) and, when
 * the NWS drew one, the storm-based polygon.
 *
 * Results are cached for CACHE_MS; concurrent requests share one fetch,
 * and a failed refresh keeps serving the last good data.
 */
const fetch = require('node-fetch');

const UA = 'MarckNetVision/1.0 (weather dashboard; contact@marcknetvision.local)';
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&region_type=land';
const CACHE_MS = 2 * 60 * 1000;

let cache = null;        // { fetchedAt, data }
let inFlight = null;

function bucketOf(event) {
  if (/\bwarning$/i.test(event)) return 'warning';
  if (/\bwatch$/i.test(event)) return 'watch';
  return null;
}

// Round polygon coordinates to ~100 m; plenty for a national map and
// a fraction of the payload.
function roundGeometry(g) {
  if (!g || !g.type || !g.coordinates) return null;
  const r = (v) => Array.isArray(v) ? v.map(r) : Math.round(v * 1000) / 1000;
  return { type: g.type, coordinates: r(g.coordinates) };
}

// What a river flood warning covers: the gauge locations listed after
// "...for the following rivers in <state>...", e.g. "St Johns River Near
// Sanford". Several warnings can share a county, one per gauge, so this is
// what tells them apart. '' for other alerts.
function riverPoints(description) {
  const m = /following rivers in [^.]*\.\.\.\s*([\s\S]*?)(?:\n\s*\n\s*[.*]|\*\s*WHAT|$)/i.exec(description || '');
  if (!m) return '';
  const points = [];
  const re = /([^\n.][^\n]*?)\s+affecting\s/gi;
  let r;
  while ((r = re.exec(m[1]))) points.push(r[1].replace(/\s+/g, ' ').trim());
  return [...new Set(points)].join('; ');
}

// The VTEC event this message belongs to (office, phenomenon,
// significance, event number). Updates to one event share it.
function vtecKey(p) {
  const v = p.parameters && Array.isArray(p.parameters.VTEC) ? p.parameters.VTEC[0] : '';
  const m = /^\/[A-Z]\.[A-Z]{3}\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./.exec(v || '');
  return m ? m.slice(1).join('.') : null;
}

// Keep one message per alert: drop any that a later active message
// references (it was updated or replaced), and keep only the newest
// message for each VTEC event and area. (One event can be issued in
// several segments, each for different zones; those all stay.)
function dedupe(features) {
  const props = features.map(f => f.properties || {});
  const referenced = new Set();
  props.forEach(p => (p.references || []).forEach(r => r && r.identifier && referenced.add(r.identifier)));
  const newest = new Map();
  props.forEach((p, i) => {
    if (referenced.has(p.id)) return;
    const vtec = vtecKey(p);
    const ugc = p.geocode && Array.isArray(p.geocode.UGC) ? p.geocode.UGC.slice().sort().join(',') : '';
    const key = vtec ? vtec + '|' + ugc : (p.id || String(i));
    const prev = newest.get(key);
    if (!prev || Date.parse(p.sent) > Date.parse(prev.p.sent)) newest.set(key, { p, i });
  });
  return [...newest.values()].sort((a, b) => a.i - b.i).map(({ i }) => features[i]);
}

function toAlert(f) {
  const p = f.properties || {};
  const bucket = bucketOf(p.event || '');
  if (!bucket || p.messageType === 'Cancel') return null;
  const ends = p.ends || p.expires || null;
  if (ends && Date.parse(ends) < Date.now()) return null;
  const same = (p.geocode && Array.isArray(p.geocode.SAME)) ? p.geocode.SAME : [];
  const ugc = (p.geocode && Array.isArray(p.geocode.UGC)) ? p.geocode.UGC : [];
  // SAME is "0" + state FIPS + county FIPS; whole-state codes end in 000.
  const counties = [...new Set(same
    .filter(c => /^\d{6}$/.test(c))
    .map(c => c.slice(1))
    .filter(c => !c.endsWith('000')))];
  const states = [...new Set(ugc.map(u => String(u).slice(0, 2)).filter(s => /^[A-Z]{2}$/.test(s)))];
  return {
    id: p.id || f.id || '',
    event: p.event,
    bucket,
    severity: p.severity || 'Unknown',
    urgency: p.urgency || 'Unknown',
    certainty: p.certainty || 'Unknown',
    headline: (p.parameters && p.parameters.NWSheadline && p.parameters.NWSheadline[0]) || p.headline || '',
    areaDesc: p.areaDesc || '',
    subject: riverPoints(p.description),
    description: p.description || '',
    instruction: p.instruction || '',
    sender: p.senderName || 'NWS',
    sent: p.sent || null,
    effective: p.onset || p.effective || null,
    expires: ends,
    counties,
    states,
    geometry: roundGeometry(f.geometry),
  };
}

async function fetchAlerts() {
  const res = await fetch(ALERTS_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
    timeout: 20000,
  });
  if (!res.ok) throw new Error('NWS alerts HTTP ' + res.status);
  const body = await res.json();
  const features = Array.isArray(body.features) ? body.features : [];
  const alerts = dedupe(features).map(toAlert).filter(Boolean);
  return {
    updated: body.updated || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    alerts,
  };
}

async function getActiveAlerts() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  if (!inFlight) {
    inFlight = fetchAlerts()
      .then(data => {
        cache = { fetchedAt: Date.now(), data };
        console.log(`[Alerts] ${data.alerts.length} active warnings/watches`);
        return data;
      })
      .catch(err => {
        console.error('[Alerts] fetch failed:', err.message);
        if (cache) return { ...cache.data, stale: true };
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

module.exports = { getActiveAlerts };
