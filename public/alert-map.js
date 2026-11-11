/* Breaking Alert System — shared by /wx and the pop-out map (/wx/alerts).
 *
 * Data: /api/alerts/us — every active NWS warning and watch (alerts-scraper.js).
 *
 * window.MnvAlerts provides:
 *   load(force)           fetch the alerts (shared, refreshed every 2 min)
 *   onUpdate(fn)          call fn(data) whenever new data arrives
 *   sorted(data, mode)    alerts by type ('type', most serious first) or newest ('issued')
 *   getSort/setSort       the viewer's saved list sort; sortControlHtml(mode) its buttons
 *   itemHtml(alert)       one alert in a list; listHtml(list, mode) a whole list
 *   colorFor(alert)       the NWS map colour for the event
 *   areaSummary(alert)    affected counties grouped by state
 *   detailHtml(alert)     the full alert, for popups
 *   isNew(alert)          sent in the last 30 minutes
 *   createMap(el)         an interactive map: { update, select, resetView, invalidate }
 *
 * The map uses the same base as the World map (Leaflet + OpenStreetMap),
 * opens over the lower 48, shades each county under a county-based alert
 * and outlines storm-based polygons. Clicking a county or polygon opens
 * its details.
 */
(function () {
  const LEAFLET_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const LEAFLET_CSS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const TOPOJSON_JS_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';
  const COUNTIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json';
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Alerts: NWS';
  const LOWER_48 = [[24.4, -125.0], [49.4, -66.9]];
  const REFRESH_MS = 2 * 60 * 1000;
  const NEW_MS = 30 * 60 * 1000;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Script loading ────────────────────────────────────────────────
  const scripts = {};
  function loadScript(url) {
    if (!scripts[url]) {
      scripts[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = () => { delete scripts[url]; reject(new Error('Failed to load ' + url)); };
        document.head.appendChild(s);
      });
    }
    return scripts[url];
  }
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!document.querySelector('link[href="' + LEAFLET_CSS_URL + '"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS_URL;
      document.head.appendChild(css);
    }
    return loadScript(LEAFLET_JS_URL).then(() => window.L);
  }
  // Shared with the World map in wx.js.
  window.mnvLoadLeaflet = loadLeaflet;

  // County shapes (us-atlas, keyed by 5-digit FIPS) and names.
  let topoLoading = null;
  let countyShapes = null;    // FIPS → GeoJSON feature
  let stateLines = null;      // GeoJSON MultiLineString of state borders
  function loadCounties() {
    if (!topoLoading) {
      topoLoading = Promise.all([loadScript(TOPOJSON_JS_URL), fetch(COUNTIES_URL).then(r => {
        if (!r.ok) throw new Error('Counties HTTP ' + r.status);
        return r.json();
      })]).then(([, topo]) => {
        countyShapes = new Map();
        window.topojson.feature(topo, topo.objects.counties).features
          .forEach(f => countyShapes.set(String(f.id), f));
        stateLines = window.topojson.mesh(topo, topo.objects.states, (a, b) => a !== b);
        // County names are now available for the area summaries.
        if (current) listeners.forEach(fn => { try { fn(current); } catch (e) { console.error(e); } });
      }).catch(e => { topoLoading = null; throw e; });
    }
    return topoLoading;
  }

  const STATE_ABBR = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
    '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
    '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
    '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
    '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
    '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
    '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
  };

  // ── Event colours and priority ────────────────────────────────────
  // NWS watch/warning map colours, listed most important first; the
  // order is also the sort and map-drawing priority.
  const EVENTS = [
    ['Tsunami Warning', '#FD6347'], ['Tornado Warning', '#FF0000'], ['Extreme Wind Warning', '#FF8C00'],
    ['Severe Thunderstorm Warning', '#FFA500'], ['Flash Flood Warning', '#8B0000'],
    ['Hurricane Warning', '#DC143C'], ['Storm Surge Warning', '#B524F7'], ['Typhoon Warning', '#DC143C'],
    ['Snow Squall Warning', '#C71585'], ['Dust Storm Warning', '#FFE4C4'], ['Blizzard Warning', '#FF4500'],
    ['Ice Storm Warning', '#8B008B'], ['Tropical Storm Warning', '#B22222'], ['Winter Storm Warning', '#FF69B4'],
    ['Lake Effect Snow Warning', '#008B8B'], ['High Wind Warning', '#DAA520'],
    ['Extreme Heat Warning', '#C71585'], ['Excessive Heat Warning', '#C71585'],
    ['Extreme Cold Warning', '#0000FF'], ['Wind Chill Warning', '#B0C4DE'], ['Red Flag Warning', '#FF1493'],
    ['Avalanche Warning', '#1E90FF'], ['Flood Warning', '#00FF00'], ['Coastal Flood Warning', '#228B22'],
    ['Lakeshore Flood Warning', '#228B22'], ['High Surf Warning', '#228B22'], ['Hard Freeze Warning', '#9400D3'],
    ['Freeze Warning', '#483D8B'], ['Earthquake Warning', '#8B4513'], ['Volcano Warning', '#2F4F4F'],
    // FAA airport events (faa-scraper.js). Each alert carries its own
    // colour from the FAA severity scale; these are fallbacks.
    ['FAA Ground Stop', '#E3001B'], ['FAA Airport Closure', '#E3001B'], ['FAA Ground Delay Program', '#FF7A00'],
    ['FAA Arrival Delay', '#FFB300'], ['FAA Departure Delay', '#FFB300'], ['FAA Deicing', '#FFE14D'],
    ['Tsunami Watch', '#FF00FF'], ['Tornado Watch', '#FFFF00'], ['Severe Thunderstorm Watch', '#DB7093'],
    ['Hurricane Watch', '#FF00FF'], ['Storm Surge Watch', '#DB7FF7'], ['Typhoon Watch', '#FF00FF'],
    ['Tropical Storm Watch', '#F08080'], ['Flash Flood Watch', '#2E8B57'], ['Flood Watch', '#2E8B57'],
    ['Winter Storm Watch', '#4682B4'], ['Lake Effect Snow Watch', '#87CEFA'], ['High Wind Watch', '#B8860B'],
    ['Extreme Heat Watch', '#800000'], ['Excessive Heat Watch', '#800000'], ['Extreme Cold Watch', '#5F9EA0'],
    ['Wind Chill Watch', '#5F9EA0'], ['Fire Weather Watch', '#FFDEAD'], ['Avalanche Watch', '#F4A460'],
    ['Coastal Flood Watch', '#66CDAA'], ['Lakeshore Flood Watch', '#66CDAA'], ['Hard Freeze Watch', '#4169E1'],
    ['Freeze Watch', '#00FFFF'],
    ['FAA Planned Ground Stop', '#FF7A00'], ['FAA Planned Delay Program', '#FFB300'],
  ];
  const EVENT_COLOR = new Map(EVENTS.map(([e, c]) => [e.toLowerCase(), c]));
  const EVENT_RANK = new Map(EVENTS.map(([e], i) => [e.toLowerCase(), i]));
  const FIRST_WATCH_RANK = EVENTS.findIndex(([e]) => / Watch$/.test(e));

  function colorFor(a) {
    if (a.color) return a.color;   // FAA: its severity colour
    return EVENT_COLOR.get((a.event || '').toLowerCase()) || (a.bucket === 'warning' ? '#FF4D4D' : '#FFD24D');
  }
  function rank(a) {
    const r = EVENT_RANK.get((a.event || '').toLowerCase());
    if (r != null) return r;
    // Unknown types go after the listed ones of their kind.
    return a.bucket === 'warning' ? FIRST_WATCH_RANK - 0.5 : EVENTS.length;
  }
  const isFaa = (a) => a.source === 'faa';
  // By type: types in priority order, every alert of one type together
  // (types missing from the table share a rank, so the name keeps them
  // apart), newest first within a type.
  function compare(a, b) {
    return rank(a) - rank(b) ||
      String(a.event).localeCompare(String(b.event)) ||
      (Date.parse(b.sent) || 0) - (Date.parse(a.sent) || 0);
  }
  function compareIssued(a, b) {
    return (Date.parse(b.sent) || 0) - (Date.parse(a.sent) || 0) || rank(a) - rank(b);
  }
  // mode 'type': most important event type first (newest first within a
  // type). mode 'issued': newest first.
  function sorted(data, mode) {
    return (data && Array.isArray(data.alerts) ? data.alerts.slice() : [])
      .sort(mode === 'issued' ? compareIssued : compare);
  }

  // List sort choice, shared by /wx and the pop-out window.
  const SORT_KEY = 'mnv-alert-sort';
  function getSort() {
    try { return localStorage.getItem(SORT_KEY) === 'issued' ? 'issued' : 'type'; } catch (e) { return 'type'; }
  }
  function setSort(mode) {
    try { localStorage.setItem(SORT_KEY, mode === 'issued' ? 'issued' : 'type'); } catch (e) { /* not saved */ }
  }
  function sortControlHtml(mode) {
    const b = (m, label, title) => '<button type="button" data-alert-sort="' + m + '" title="' + title + '"' +
      ' aria-pressed="' + (mode === m) + '" class="' + (mode === m ? 'active' : '') + '">' + label + '</button>';
    return '<div class="wx-ba-sort" role="group" aria-label="Sort alerts"><span>Sort</span>' +
      b('type', 'Type', 'Most serious alert types first') +
      b('issued', 'Issued', 'Most recently issued first') + '</div>';
  }

  // A sorted list of alerts. Sorted by type, each type gets a heading
  // with its count.
  function listHtml(list, mode) {
    if (mode === 'issued') return list.map(itemHtml).join('');
    const counts = new Map();
    list.forEach(a => counts.set(a.event, (counts.get(a.event) || 0) + 1));
    let prev = null;
    return list.map(a => {
      const head = a.event !== prev
        ? '<div class="wx-ba-group" style="--ba-color:' + colorFor(a) + '">' + esc(a.event) +
          ' <span>' + counts.get(a.event) + '</span></div>'
        : '';
      prev = a.event;
      return head + itemHtml(a);
    }).join('');
  }

  // One alert in a list (middle panel, pop-out window).
  function itemHtml(a) {
    return '<div class="wx-ba-item" role="button" tabindex="0" data-alert-id="' + esc(a.id) + '"' +
      ' style="--ba-color:' + colorFor(a) + '" title="Show on the map">' +
      '<div class="wx-ba-top">' + pill(a) + (isNew(a) ? '<span class="mnv-alert-new">NEW</span>' : '') + '</div>' +
      (a.subject ? '<div class="wx-ba-subject">' + esc(a.subject) + '</div>' : '') +
      '<div class="wx-ba-area">' + esc(areaSummary(a, 14)) + '</div>' +
      '<div class="wx-ba-time">' + esc(timesText(a)) + '</div>' +
    '</div>';
  }
  function isNew(a) {
    const t = Date.parse(a.sent);
    return Number.isFinite(t) && Date.now() - t < NEW_MS;
  }

  // Black or white text on an event colour.
  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const y = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return y > 140 ? '#111' : '#fff';
  }
  function pill(a) {
    const c = colorFor(a);
    return '<span class="mnv-alert-pill" style="background:' + c + ';color:' + textOn(c) + '">' + esc(a.event) + '</span>';
  }

  // "VA: Fairfax, Loudoun · MD: Montgomery". Falls back to the NWS area
  // text until the county names have loaded, or for zone-only alerts.
  function areaSummary(a, maxCounties) {
    if (!countyShapes || !a.counties || !a.counties.length) return a.areaDesc || '';
    const byState = new Map();
    a.counties.forEach(fips => {
      const f = countyShapes.get(fips);
      if (!f) return;
      const st = STATE_ABBR[fips.slice(0, 2)] || fips.slice(0, 2);
      if (!byState.has(st)) byState.set(st, []);
      byState.get(st).push(f.properties.name);
    });
    if (!byState.size) return a.areaDesc || '';
    let left = maxCounties || Infinity;
    let hidden = 0;
    const parts = [];
    byState.forEach((names, st) => {
      names.sort();
      const shown = names.slice(0, Math.max(0, left));
      hidden += names.length - shown.length;
      left -= shown.length;
      if (shown.length) parts.push(st + ': ' + shown.join(', '));
    });
    return parts.join(' · ') + (hidden ? ' +' + hidden + ' more' : '');
  }

  function fmtTime(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function untilText(a) {
    return a.expires ? 'Until ' + fmtTime(a.expires) : '';
  }
  function timesText(a) {
    return [a.sent ? 'Issued ' + fmtTime(a.sent) : '', untilText(a)].filter(Boolean).join(' · ');
  }

  function detailHtml(a) {
    const desc = esc(a.description).replace(/\n/g, '<br>');
    const inst = esc(a.instruction).replace(/\n/g, '<br>');
    return '<div class="mnv-alert-detail">' +
      '<div class="mnv-alert-detail-head">' + pill(a) + (isNew(a) ? '<span class="mnv-alert-new">NEW</span>' : '') + '</div>' +
      (a.headline ? '<div class="mnv-alert-detail-headline">' + esc(a.headline) + '</div>' : '') +
      (a.subject ? '<div class="mnv-alert-detail-subject">' + esc(a.subject) + '</div>' : '') +
      '<div class="mnv-alert-detail-area">' + esc(areaSummary(a)) + '</div>' +
      '<div class="mnv-alert-detail-meta">' +
        (a.effective ? '<span><b>From</b> ' + esc(fmtTime(a.effective)) + '</span>' : '') +
        (a.expires ? '<span><b>Until</b> ' + esc(fmtTime(a.expires)) + '</span>' : '') +
        '<span><b>Severity</b> ' + esc(a.severity) + '</span>' +
        '<span><b>Urgency</b> ' + esc(a.urgency) + '</span>' +
      '</div>' +
      (desc ? '<details class="mnv-alert-detail-more"><summary>Full details</summary><div>' + desc + '</div>' +
        (inst ? '<div class="mnv-alert-detail-inst"><b>What to do</b><br>' + inst + '</div>' : '') + '</details>' : '') +
      '<div class="mnv-alert-detail-src">' + esc(a.sender) + '</div>' +
    '</div>';
  }

  // ── Data ──────────────────────────────────────────────────────────
  let current = null;
  let loading = null;
  let loadedAt = 0;
  const listeners = [];

  function load(force) {
    if (!force && current && Date.now() - loadedAt < REFRESH_MS / 2) return Promise.resolve(current);
    if (!loading) {
      loading = fetch('/api/alerts/us', { credentials: 'same-origin' })
        .then(r => {
          if (r.status === 401) { window.location.href = '/login'; throw new Error('Signed out'); }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(data => {
          current = data;
          loadedAt = Date.now();
          listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
          return data;
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }
  function onUpdate(fn) { listeners.push(fn); }
  setInterval(() => { load(true).catch(e => console.warn('[Alerts]', e.message)); }, REFRESH_MS);

  // ── Map ───────────────────────────────────────────────────────────
  function createMap(el) {
    let map = null;
    let L = null;
    let countyLayer = null;
    let polygonLayer = null;
    let airportLayer = null;
    let bordersLayer = null;
    let legend = null;
    let data = null;
    const layersByAlert = new Map();   // id → [layer]
    const alertsById = new Map();

    async function init() {
      if (map) return map;
      L = await loadLeaflet();
      if (map) return map;
      map = L.map(el, { preferCanvas: true, minZoom: 2, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 0.5, worldCopyJump: true });
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      map.fitBounds(LOWER_48, { animate: false });
      legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const d = L.DomUtil.create('div', 'mnv-alert-legend');
        L.DomEvent.disableClickPropagation(d);
        L.DomEvent.disableScrollPropagation(d);
        return d;
      };
      legend.addTo(map);
      // Alert buttons inside county popups.
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-alert-id]');
        if (b) select(b.dataset.alertId);
      });
      loadCounties().then(() => { if (data) draw(); }).catch(e => console.warn('[Alerts] county shapes unavailable:', e.message));
      return map;
    }

    function countyPopup(fips, list) {
      const f = countyShapes.get(fips);
      const st = STATE_ABBR[fips.slice(0, 2)] || '';
      return '<div class="mnv-alert-county">' +
        '<div class="mnv-alert-county-name">' + esc(f ? f.properties.name : fips) + (st ? ', ' + st : '') + '</div>' +
        list.map(a => '<button type="button" class="mnv-alert-county-item" data-alert-id="' + esc(a.id) + '">' +
          pill(a) + '<span>' + esc(a.subject ? a.subject + ' · ' + untilText(a) : untilText(a)) + '</span></button>').join('') +
      '</div>';
    }

    function renderLegend(alerts) {
      const box = legend && legend.getContainer();
      if (!box) return;
      const counts = new Map();
      alerts.forEach(a => {
        const k = a.event;
        if (!counts.has(k)) counts.set(k, { a, n: 0 });
        counts.get(k).n++;
      });
      box.innerHTML = counts.size
        ? Array.from(counts.values()).map(({ a, n }) =>
            '<div class="mnv-alert-legend-row"><span class="mnv-alert-swatch" style="background:' + colorFor(a) + '"></span>' +
            esc(a.event) + ' <span class="mnv-alert-legend-n">' + n + '</span></div>').join('')
        : '<div class="mnv-alert-legend-row">No active warnings or watches</div>';
    }

    function draw() {
      if (!map || !data) return;
      const alerts = sorted(data);
      [countyLayer, polygonLayer, airportLayer].forEach(l => l && map.removeLayer(l));
      layersByAlert.clear();
      alertsById.clear();
      alerts.forEach(a => alertsById.set(a.id, a));
      renderLegend(alerts);
      const add = (a, layer) => {
        if (!layersByAlert.has(a.id)) layersByAlert.set(a.id, []);
        layersByAlert.get(a.id).push(layer);
      };

      if (countyShapes && !bordersLayer && stateLines) {
        bordersLayer = L.geoJSON(stateLines, {
          interactive: false,
          style: { color: '#9aa4b2', weight: 0.8, opacity: 0.6, fill: false },
        }).addTo(map);
      }

      // County-based alerts shade their counties, most important on top.
      // Storm-based alerts (with a polygon) are drawn as the polygon only,
      // as on the NWS map.
      countyLayer = L.layerGroup();
      if (countyShapes) {
        const perCounty = new Map();   // FIPS → alerts, most important first
        alerts.forEach(a => {
          if (a.geometry) return;
          (a.counties || []).forEach(fips => {
            if (!perCounty.has(fips)) perCounty.set(fips, []);
            perCounty.get(fips).push(a);
          });
        });
        perCounty.forEach((list, fips) => {
          const shape = countyShapes.get(fips);
          if (!shape) return;
          const top = list[0];
          const layer = L.geoJSON(shape, {
            style: { color: colorFor(top), weight: 0.6, opacity: 0.9, fillColor: colorFor(top), fillOpacity: 0.5 },
          });
          layer.bindPopup(() => countyPopup(fips, list), { maxWidth: 320 });
          layer.bindTooltip(esc(shape.properties.name) + ': ' + esc(top.event) + (list.length > 1 ? ' +' + (list.length - 1) : ''), { sticky: true });
          countyLayer.addLayer(layer);
          list.forEach(a => add(a, layer));
        });
      }
      countyLayer.addTo(map);

      polygonLayer = L.layerGroup();
      alerts.slice().reverse().forEach(a => {   // most important drawn last (on top)
        if (!a.geometry) return;
        const layer = L.geoJSON(a.geometry, {
          style: { color: colorFor(a), weight: 2.5, opacity: 1, fillColor: colorFor(a), fillOpacity: 0.25 },
        });
        layer.bindPopup(() => detailHtml(a), { maxWidth: 360, maxHeight: 360 });
        layer.bindTooltip(esc(a.event), { sticky: true });
        polygonLayer.addLayer(layer);
        add(a, layer);
      });
      polygonLayer.addTo(map);

      // FAA: an airplane icon over each airport with an event, in the
      // colour of its most severe one. Active events (warnings) are solid;
      // planned ones (watches) are outlined. Several at one airport share
      // the icon, and its popup lists them.
      airportLayer = L.layerGroup();
      const perAirport = new Map();   // airport → alerts, most important first
      alerts.forEach(a => {
        if (!isFaa(a) || !a.point) return;
        if (!perAirport.has(a.airport)) perAirport.set(a.airport, []);
        perAirport.get(a.airport).push(a);
      });
      perAirport.forEach((list, airport) => {
        // Most severe first: active before planned, then by level.
        const top = list.slice().sort((x, y) =>
          (x.bucket === 'warning' ? 0 : 1) - (y.bucket === 'warning' ? 0 : 1) || (y.level || 0) - (x.level || 0))[0];
        const marker = L.marker([top.point.lat, top.point.lon], {
          icon: L.divIcon({
            className: 'mnv-faa-divicon',
            html: faaIconHtml(top, airport, list.length),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -14],
          }),
          riseOnHover: true,
          zIndexOffset: (top.bucket === 'warning' ? 1000 : 0) + (top.level || 0) * 100,
        });
        marker.bindPopup(() => list.length === 1 ? detailHtml(list[0]) : airportPopup(airport, list), { maxWidth: 360, maxHeight: 360 });
        marker.bindTooltip(esc(airport + ': ' + top.event.replace(/^FAA /, '')) + (list.length > 1 ? ' +' + (list.length - 1) : ''));
        airportLayer.addLayer(marker);
        list.forEach(a => add(a, marker));
      });
      airportLayer.addTo(map);
    }

    function faaIconHtml(a, airport, count) {
      const c = colorFor(a);
      const watch = a.bucket !== 'warning';
      return '<div class="mnv-faa-icon' + (watch ? ' mnv-faa-icon--watch' : '') + '" style="--faa-color:' + c + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>' +
        (count > 1 ? '<span class="mnv-faa-count">' + count + '</span>' : '') +
        '<span class="mnv-faa-code">' + esc(airport) + '</span>' +
      '</div>';
    }

    function airportPopup(airport, list) {
      return '<div class="mnv-alert-county">' +
        '<div class="mnv-alert-county-name">' + esc(list[0].airportName && list[0].airportName !== airport
          ? airport + ' · ' + list[0].airportName : airport) + '</div>' +
        list.map(a => '<button type="button" class="mnv-alert-county-item" data-alert-id="' + esc(a.id) + '">' +
          pill(a) + '<span>' + esc(a.subject || untilText(a)) + '</span></button>').join('') +
      '</div>';
    }

    let highlighted = [];
    function clearHighlight() {
      highlighted.forEach(l => l.setStyle && l.setStyle({ weight: l.__baseWeight, color: l.__baseColor }));
      highlighted = [];
    }

    // The alert's area as polygons (arrays of [lon, lat] rings): its own
    // polygon if the NWS drew one, else its counties.
    function polygonsOf(a) {
      const fromGeom = (g) => g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates : [];
      if (a.geometry) return fromGeom(a.geometry);
      if (!countyShapes) return [];
      return (a.counties || []).flatMap(f => {
        const s = countyShapes.get(f);
        return s ? fromGeom(s.geometry) : [];
      });
    }

    // A point inside the area (the bounding-box centre of an irregular
    // shape can fall outside it): scan across the area at several
    // latitudes and take the middle of the widest stretch inside a polygon.
    function pointInside(polys, bounds) {
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      let best = null;
      const STEPS = 15;
      for (let i = 1; i < STEPS; i++) {
        const lat = south + (north - south) * i / STEPS;
        // Favour scan lines near the middle of the area.
        const weight = 1 - Math.abs(i / STEPS - 0.5);
        polys.forEach(rings => {
          const xs = [];
          rings.forEach(ring => {
            for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
              const [x1, y1] = ring[k];
              const [x2, y2] = ring[j];
              if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + (lat - y1) * (x2 - x1) / (y2 - y1));
            }
          });
          xs.sort((p, q) => p - q);
          for (let j = 0; j + 1 < xs.length; j += 2) {
            const score = (xs[j + 1] - xs[j]) * weight;
            if (!best || score > best.score) best = { score, lat, lon: (xs[j] + xs[j + 1]) / 2 };
          }
        });
      }
      return best ? L.latLng(best.lat, best.lon) : bounds.getCenter();
    }

    function select(id) {
      const a = alertsById.get(id);
      const layers = layersByAlert.get(id);
      if (!map || !a) return false;
      clearHighlight();
      if (isFaa(a) && a.point) {
        // An airport: centre on it, close in, and open the event's details.
        const at = L.latLng(a.point.lat, a.point.lon);
        map.invalidateSize();
        map.setView(at, Math.max(map.getZoom(), 8), { animate: false });
        L.popup({ maxWidth: 360, maxHeight: Math.max(160, Math.round(el.clientHeight / 2) - 60), autoPan: false, offset: [0, -14] })
          .setLatLng(at).setContent(detailHtml(a)).openOn(map);
        const icon = (layers && layers[0] && layers[0].getElement && layers[0].getElement()) || null;
        if (icon) {
          icon.classList.add('mnv-faa-selected');
          map.once('popupclose', () => icon.classList.remove('mnv-faa-selected'));
        }
        return true;
      }
      if (!layers || !layers.length) {
        L.popup({ maxWidth: 360, maxHeight: 360 }).setLatLng(map.getCenter()).setContent(detailHtml(a)).openOn(map);
        return true;
      }
      const bounds = L.latLngBounds([]);
      layers.forEach(l => bounds.extend(l.getBounds()));
      // The popup opens over the alert's area, pointing at a spot inside
      // it, and the map is centred on that spot. Zoom so the whole area
      // still fits around it (mirror the area's corners through the spot).
      const anchor = pointInside(polygonsOf(a), bounds);
      const view = L.latLngBounds([bounds.getSouthWest(), bounds.getNorthEast(),
        [2 * anchor.lat - bounds.getSouth(), 2 * anchor.lng - bounds.getWest()],
        [2 * anchor.lat - bounds.getNorth(), 2 * anchor.lng - bounds.getEast()]]);
      map.invalidateSize();
      const zoom = Math.min(8, map.getBoundsZoom(view, false, L.point(120, 120)));
      map.setView(anchor, zoom, { animate: false });
      // Open first: closing the previous popup clears the old highlight.
      // No auto-pan, which would move the map off the area.
      L.popup({ maxWidth: 360, maxHeight: Math.max(160, Math.round(el.clientHeight / 2) - 60), autoPan: false })
        .setLatLng(anchor).setContent(detailHtml(a)).openOn(map);
      layers.forEach(l => l.eachLayer(sub => {
        if (!sub.setStyle) return;
        sub.__baseWeight = sub.options.weight;
        sub.__baseColor = sub.options.color;
        sub.setStyle({ weight: 3.5, color: '#ffffff' });
        sub.bringToFront && sub.bringToFront();
        highlighted.push(sub);
      }));
      map.once('popupclose', clearHighlight);
      return true;
    }

    return {
      async update(next) {
        data = next;
        await init();
        draw();
      },
      select,
      async resetView() {
        await init();
        map.closePopup();
        map.fitBounds(LOWER_48);
      },
      invalidate() { if (map) map.invalidateSize(); },
    };
  }

  window.MnvAlerts = {
    load, onUpdate, sorted, colorFor, areaSummary, detailHtml, isNew, untilText, timesText,
    getSort, setSort, sortControlHtml, itemHtml, listHtml,
    loadCounties, createMap, pill, escape: esc,
  };
})();
