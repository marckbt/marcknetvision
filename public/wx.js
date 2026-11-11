/* MarckNet WX page — weather-focused page.
 *
 * Runs alongside the shared app.js, which provides the 7-day forecast (in
 * the middle column), the hidden location tabs that drive selection, and
 * the weather cycle in the bottom ticker. app.js skips news and sports
 * events when window.MNV_PAGE === 'wx'.
 *
 * This file adds:
 *   - the Locations list (left column): current conditions and an alert
 *     indicator per location; clicking one selects it,
 *   - the Radar & Maps view (default main panel) for the selected location,
 *     or, for World, an interactive map of today's highs and conditions,
 *   - while a live feed plays (live-stream.js) nothing else takes over the
 *     main panel; leaving it (close, or the Windy Radar card) stops playback.
 */
(function () {
  const STREAM_PANEL = window.mnvLiveStream.PANEL;
  const $ = (id) => document.getElementById(id);

  // Every panel change goes through here.
  //  - The welcome and World-list panels are replaced by the selected
  //    location's view: Radar & Maps, or the world map for World.
  //  - While a feed plays, other panels are ignored unless the change was
  //    asked for explicitly (close, Windy Radar card).
  const MAPS_PANEL = 'wxMapsPanel';
  const WORLD_PANEL = 'wxWorldPanel';
  const ALERTS_PANEL = 'wxAlertsPanel';
  const REDIRECT_TO_SELECTION = new Set(['welcomeScreen', 'worldWeatherPanel']);

  function activeLocation() {
    const tab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    return tab ? tab.dataset.location : null;
  }
  // The main-panel view for the selected location.
  function selectionPanel() {
    const loc = activeLocation();
    if (loc === 'world') return WORLD_PANEL;
    if (loc === 'alerts') return ALERTS_PANEL;
    return MAPS_PANEL;
  }
  const baseShowPanel = window.showPanel;
  let allowLeaveStream = false;
  window.showPanel = function (panelId) {
    if (REDIRECT_TO_SELECTION.has(panelId)) panelId = selectionPanel();
    if (panelId !== STREAM_PANEL && document.body.classList.contains('wx-streaming') && !allowLeaveStream) return;
    allowLeaveStream = false;
    const result = baseShowPanel.call(this, panelId);
    if (panelId === MAPS_PANEL) refreshMaps();
    if (panelId === WORLD_PANEL) renderWorldMap();
    if (panelId === ALERTS_PANEL) renderAlertsMap();
    return result;
  };

  function leaveStreamTo(panelId) {
    allowLeaveStream = true;
    window.showPanel(panelId);
  }

  window.wxCloseStream = function () {
    leaveStreamTo(selectionPanel());   // live-stream.js stops playback
  };

  // Popped-out feed: the main panel goes back to the selected location's
  // view and is free for other selections while the feed plays on.
  window.mnvLiveStream.onPoppedOut = function () {
    leaveStreamTo(selectionPanel());
  };
  // Brought back from the pop-out player: it takes the main panel again.
  window.mnvLiveStream.onPoppedBack = function () {
    window.showPanel(STREAM_PANEL);
  };

  // Windy Radar card: a full-panel radar, replacing a playing feed if any.
  window.wxShowRadar = function () {
    allowLeaveStream = true;
    showWeatherRadar();   // app.js; calls showPanel('weatherscanPanel')
  };

  // ── Radar & Maps (main panel) ─────────────────────────────────────
  let mapOverlay = 'satellite';

  function setFrameSrc(frame, url) {
    if (frame && frame.getAttribute('src') !== url) frame.setAttribute('src', url);
  }

  async function refreshMaps() {
    const t = await resolveRadarTarget();
    const title = $('wxMapsTitle');
    if (title) title.textContent = 'Radar & Maps — ' + (t.label || 'Selected location');
    setFrameSrc($('wxRadarFrame'), buildRadarUrl(t.lat, t.lon, t.zoom));
    setFrameSrc($('wxMapFrame'), buildWindyUrl(t.lat, t.lon, mapOverlay, t.zoom));
  }

  $('wxMapOverlays')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-overlay]');
    if (!btn) return;
    mapOverlay = btn.dataset.overlay;
    $('wxMapOverlays').querySelectorAll('[data-overlay]').forEach(b => b.classList.toggle('active', b === btn));
    refreshMaps();
  });

  // ── World map (main panel, World location) ────────────────────────
  // Leaflet, loaded on first use and pinned to an exact version, over
  // OpenStreetMap tiles (darkened by CSS in the dark theme).
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // The loader lives in alert-map.js, which the alert map shares.
  const loadLeaflet = window.mnvLoadLeaflet;

  let worldMap = null;
  let worldMarkers = null;
  let worldMarkersStamp = null;  // lastUpdated of the data the markers show
  // (the mode switch rebuilds the markers itself)

  // Black or white text, whichever reads better on a temperature colour.
  function textOn(rgb) {
    const [r, g, b] = (rgb.match(/\d+/g) || [0, 0, 0]).map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff';
  }

  function tempBadge(t) {
    if (t == null) return '<span class="wx-wm-temp">--</span>';
    const bg = getTempColor(t);
    return '<span class="wx-wm-temp" style="background:' + bg + ';color:' + textOn(bg) + '">' + t + '&deg;</span>';
  }

  // Declutter for the current zoom. Each city gets the full marker if it
  // fits, else just its temperature pill, else it is hidden until zooming
  // in gives it room. Placement takes turns between regions (see
  // buildWorldMarkers) so no area monopolises the space.
  const FULL_BOX = { w: 76, h: 46, top: 18 };   // approx. marker footprint, px
  const PILL_BOX = { w: 36, h: 20, top: 18 };
  let worldMarkerList = [];

  function declutterWorldMarkers() {
    if (!worldMap) return;
    const placed = [];
    const boxAt = (p, b) => ({ x: p.x - b.w / 2, y: p.y - b.top, w: b.w, h: b.h });
    const fits = (box) => !placed.some(b =>
      box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
    let shown = 0;
    worldMarkerList.forEach(m => {
      const el = m.getElement();
      if (!el) return;
      const p = worldMap.latLngToContainerPoint(m.getLatLng());
      const full = boxAt(p, FULL_BOX);
      const pill = boxAt(p, PILL_BOX);
      const showFull = fits(full);
      const showPill = !showFull && fits(pill);
      el.classList.toggle('wx-wm--compact', !showFull);
      el.classList.toggle('wx-wm--hidden', !showFull && !showPill);
      if (showFull) placed.push(full);
      else if (showPill) placed.push(pill);
      if (showFull || showPill) shown++;
    });
    const note = $('wxWorldCount');
    if (note) {
      const total = worldMarkerList.length;
      note.textContent = shown < total ? 'Showing ' + shown + ' of ' + total + ' cities — zoom in for more' : '';
    }
  }

  // ── Day and night (World map) ─────────────────────────────────────
  // Where the sun is, from a standard low-precision solar position
  // (good to a fraction of a degree): each city's icon switches to its
  // night version once the sun has set there, and a shading layer darkens
  // the night side, deepening through twilight.
  const SUNSET_ALT = -0.833;   // sun's centre below the horizon at sunset, degrees
  const NIGHT_FULL_ALT = -12;  // fully dark shading from here (nautical twilight)
  const NIGHT_MAX_ALPHA = 0.55;
  const DAY_NIGHT_REFRESH_MS = 5 * 60 * 1000;
  const RAD = Math.PI / 180;

  // Subsolar point (where the sun is overhead) at a moment in time.
  function subsolarPoint(date) {
    const d = date.getTime() / 86400000 - 10957.5;   // days since J2000.0
    const g = (357.529 + 0.98560028 * d) * RAD;      // mean anomaly
    const q = 280.459 + 0.98564736 * d;              // mean longitude
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;       // obliquity
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
    const gmst = 280.46061837 + 360.98564736629 * d;
    let lon = (ra - gmst) % 360;
    if (lon < -180) lon += 360;
    if (lon > 180) lon -= 360;
    return { lat: dec, lon };
  }

  // The sun's altitude above the horizon at a place, in degrees.
  function sunAltitude(lat, lon, sun) {
    const h = (lon - sun.lon) * RAD;
    return Math.asin(Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
      Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos(h)) / RAD;
  }

  function isNightAt(lat, lon, sun) {
    return sunAltitude(lat, lon, sun || subsolarPoint(new Date())) < SUNSET_ALT;
  }

  // Night shading: a Web Mercator image like the temperature layer, black
  // with opacity rising from 0 at sunset to NIGHT_MAX_ALPHA by -12°.
  const NIGHT_W = 360;
  const NIGHT_H = 300;
  const NIGHT_PANE = 'wxNightPane';
  let nightLayer = null;

  function buildNightImage(sun) {
    const canvas = document.createElement('canvas');
    canvas.width = NIGHT_W;
    canvas.height = NIGHT_H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(NIGHT_W, NIGHT_H);
    const yMax = Math.log(Math.tan(Math.PI / 4 + HEAT_MAX_LAT * Math.PI / 360));
    for (let y = 0; y < NIGHT_H; y++) {
      const my = yMax - (y + 0.5) / NIGHT_H * 2 * yMax;
      const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) / RAD;
      for (let x = 0; x < NIGHT_W; x++) {
        const lon = -180 + (x + 0.5) / NIGHT_W * 360;
        const alt = sunAltitude(lat, lon, sun);
        let f = (SUNSET_ALT - alt) / (SUNSET_ALT - NIGHT_FULL_ALT);   // 0 at sunset → 1 at -12°
        f = Math.max(0, Math.min(1, f));
        f = f * f * (3 - 2 * f);                                     // smooth ramp
        const o = (y * NIGHT_W + x) * 4;
        img.data[o] = 4; img.data[o + 1] = 8; img.data[o + 2] = 24;  // deep navy
        img.data[o + 3] = Math.round(f * NIGHT_MAX_ALPHA * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // On/off, remembered per viewer (on by default). Only the shading: city
  // icons follow day and night either way.
  const NIGHT_KEY = 'mnv-world-night';
  function nightWanted() {
    try { return localStorage.getItem(NIGHT_KEY) !== 'off'; } catch (e) { return true; }
  }
  function syncNightButton() {
    const btn = $('wxWorldNightToggle');
    if (btn) { btn.classList.toggle('active', nightWanted()); btn.setAttribute('aria-pressed', String(nightWanted())); }
  }
  $('wxWorldNightToggle')?.addEventListener('click', async () => {
    try { localStorage.setItem(NIGHT_KEY, nightWanted() ? 'off' : 'on'); } catch (e) { /* not saved */ }
    syncNightButton();
    if (worldMap) renderNightLayer(await loadLeaflet());
  });
  syncNightButton();

  function renderNightLayer(L) {
    if (!worldMap) return;
    if (!nightWanted()) {
      if (nightLayer) { worldMap.removeLayer(nightLayer); nightLayer = null; }
      return;
    }
    if (!worldMap.getPane(NIGHT_PANE)) {
      // Above the temperature layer, below the city markers.
      const pane = worldMap.createPane(NIGHT_PANE);
      pane.style.zIndex = 450;
      pane.style.pointerEvents = 'none';
    }
    const url = buildNightImage(subsolarPoint(new Date()));
    const next = L.layerGroup([-360, 0, 360].map(shift => L.imageOverlay(url,
      [[-HEAT_MAX_LAT, -180 + shift], [HEAT_MAX_LAT, 180 + shift]],
      { pane: NIGHT_PANE, interactive: false, className: 'wx-night-layer' })));
    next.addTo(worldMap);
    if (nightLayer) worldMap.removeLayer(nightLayer);
    nightLayer = next;
  }

  // Swap each city's icon between its day and night version as the sun
  // sets and rises there.
  function updateMarkerDayNight() {
    const sun = subsolarPoint(new Date());
    worldMarkerList.forEach(m => {
      const night = isNightAt(m.__city.lat, m.__city.lon, sun);
      if (m.__night === night) return;
      m.__night = night;
      const icon = m.getElement() && m.getElement().querySelector('.wx-wm-icon');
      if (icon) icon.innerHTML = getWxIcon(shownCondition(m.__city, night), night ? 'night' : 'day');
    });
  }

  setInterval(() => {
    if (!worldMap || !window.L) return;
    renderNightLayer(window.L);
    updateMarkerDayNight();
  }, DAY_NIGHT_REFRESH_MS);

  // ── Today's forecast / Current weather ────────────────────────────
  // The map shows either today's high and forecast conditions, or the
  // current temperature and conditions (both come with the same hourly
  // data refresh). The choice is remembered per viewer.
  const WORLD_MODE_KEY = 'mnv-world-mode';
  function worldMode() {
    try { return localStorage.getItem(WORLD_MODE_KEY) === 'now' ? 'now' : 'today'; } catch (e) { return 'today'; }
  }
  const nowMode = () => worldMode() === 'now';
  function shownTemp(c) { return nowMode() ? c.currentTemp : c.high; }
  // Open-Meteo names a clear sky "Sunny" around the clock; after sunset
  // the current conditions say "Clear" instead.
  function nightPhrase(text) {
    return String(text || '').replace(/\bMostly Sunny\b/, 'Mostly Clear').replace(/\bSunny\b/, 'Clear');
  }
  function shownCondition(c, night) {
    if (!nowMode()) return c.condition;
    const cond = c.currentCondition || c.condition;
    return night ? nightPhrase(cond) : cond;
  }
  function syncWorldMode() {
    const mode = worldMode();
    document.querySelectorAll('#wxWorldMode [data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
    const title = $('wxWorldTitle');
    if (title) title.textContent = mode === 'now' ? 'World Weather — Current Conditions' : "World Weather — Today's Highs";
  }
  $('wxWorldMode')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn || btn.dataset.mode === worldMode()) return;
    try { localStorage.setItem(WORLD_MODE_KEY, btn.dataset.mode); } catch (_) { /* not saved */ }
    syncWorldMode();
    const L = await loadLeaflet();
    const data = await loadWorldWeather();   // app.js; cached
    if (data && worldMap) {
      buildWorldMarkers(L, data);
      renderHeatLayer(L, data);
    }
  });
  syncWorldMode();

  let worldMapFitted = false;
  function buildWorldMarkers(L, data) {
    if (worldMarkers) worldMap.removeLayer(worldMarkers);
    worldMarkers = L.layerGroup();
    worldMarkerList = [];
    const sun = subsolarPoint(new Date());
    const now = nowMode();
    // Order by position within each region: every region's first city, then
    // every region's second, and so on (the declutter order).
    const cities = (data.regions || [])
      .flatMap(r => r.cities.map((c, turn) => ({ ...c, turn })))
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .sort((a, b) => a.turn - b.turn);
    const colored = (t) => t != null ? '<span style="color:' + getTempColor(t) + '">' + t + '&deg;</span>' : '--';
    cities.forEach(c => {
      const night = isNightAt(c.lat, c.lon, sun);
      const cond = shownCondition(c, night);
      const temp = shownTemp(c);
      const html =
        '<div class="wx-wm-marker">' +
          '<div class="wx-wm-badge">' +
            '<span class="wx-wm-icon">' + getWxIcon(cond, night ? 'night' : 'day') + '</span>' +
            tempBadge(temp) +
          '</div>' +
          '<div class="wx-wm-name">' + escapeHtml(c.city) + '</div>' +
        '</div>';
      const marker = L.marker([c.lat, c.lon], {
        icon: L.divIcon({ className: 'wx-wm-divicon', html, iconSize: [96, 54], iconAnchor: [48, 18] }),
        title: c.city + ': ' + (temp != null ? temp + '°F, ' : '') + cond + (now ? ' (now)' : ' (today)'),
        riseOnHover: true,
      });
      marker.__city = c;
      marker.__night = night;
      // Built when opened, so the icons match day or night at that moment.
      // Shows both: the selected view first.
      marker.bindPopup(() => {
        const n = isNightAt(c.lat, c.lon);
        const nowCond = n ? nightPhrase(c.currentCondition || '') : (c.currentCondition || '');
        const nowRow = c.currentTemp != null
          ? '<div class="wx-wm-popup-sect"><div class="wx-wm-popup-label">Now</div>' +
              '<div class="wx-wm-popup-row">' + getWxIcon(nowCond || c.condition, n ? 'night' : 'day') +
                '<span class="wx-wm-popup-temps">' + colored(c.currentTemp) + '</span>' +
                '<span>' + escapeHtml(nowCond) + '</span></div></div>'
          : '';
        const todayRow =
          '<div class="wx-wm-popup-sect"><div class="wx-wm-popup-label">Today' +
              (c.date ? ' · ' + escapeHtml(c.dayName + ' ' + c.date) : '') + '</div>' +
            '<div class="wx-wm-popup-row">' + getWxIcon(c.condition, 'day') +
              '<span class="wx-wm-popup-temps">' + colored(c.high) + (c.low != null ? ' / ' + colored(c.low) : '') + '</span>' +
              '<span>' + escapeHtml(c.condition) + '</span></div></div>';
        const localTime = worldLocalTimeHtml(c, 'Local time');   // app.js; kept current every minute
        return '<div class="wx-wm-popup">' +
          '<div class="wx-wm-popup-city">' + escapeHtml(c.city) + ', ' + escapeHtml(c.country) + '</div>' +
          (localTime ? '<div class="wx-wm-popup-time">' + localTime + '</div>' : '') +
          (nowMode() ? nowRow + todayRow : todayRow + nowRow) +
        '</div>';
      });
      worldMarkers.addLayer(marker);
      worldMarkerList.push(marker);
    });
    worldMarkers.addTo(worldMap);
    // Frame all cities the first time only, so switching views keeps the
    // viewer's zoom. Not animated: a zoom animation still running when the
    // panel is re-shown gets cut short, leaving the map at the wrong zoom.
    if (cities.length && !worldMapFitted) {
      worldMap.fitBounds(cities.map(c => [c.lat, c.lon]), { padding: [12, 12], animate: false });
      worldMapFitted = true;
    }
    worldMarkersStamp = data.lastUpdated;
    declutterWorldMarkers();
  }

  // ── Temperature colour layer (World map) ──────────────────────────
  // Today's highs blended between the cities and the background grid
  // that world-weather-scraper.js adds (inverse-distance weighting),
  // coloured on the same scale as the badges and drawn semi-transparent
  // under the markers. The image is computed in Web Mercator rows so it
  // lines up with the map at every zoom. On/off is remembered per viewer.
  const HEAT_W = 360;
  const HEAT_H = 300;
  const HEAT_MAX_LAT = 85.0511;    // edge of the Web Mercator map
  const HEAT_OPACITY = 0.45;
  const HEAT_KEY = 'mnv-world-heat';
  let heatLayer = null;
  let heatStamp = null;
  let heatBuild = 0;               // cancels a stale build when data changes

  function heatWanted() {
    try { return localStorage.getItem(HEAT_KEY) !== 'off'; } catch (e) { return true; }
  }
  function syncHeatButton() {
    const btn = $('wxWorldHeatToggle');
    if (btn) { btn.classList.toggle('active', heatWanted()); btn.setAttribute('aria-pressed', String(heatWanted())); }
  }

  // Colour for each whole degree from -40 to 130 °F, as [r, g, b].
  let heatLut = null;
  function heatColor(t) {
    if (!heatLut) {
      heatLut = [];
      for (let d = -40; d <= 130; d++) heatLut.push((getTempColor(d).match(/\d+/g) || [0, 0, 0]).map(Number));
    }
    return heatLut[Math.max(0, Math.min(170, Math.round(t) + 40))];
  }

  // [lat, lon, °F] for the selected view: today's highs or current temps.
  // Grid points are [lat, lon, high, now].
  function heatPoints(data) {
    const now = nowMode();
    const pts = (data.regions || []).flatMap(r => r.cities)
      .filter(c => shownTemp(c) != null && Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .map(c => [c.lat, c.lon, shownTemp(c)]);
    if (Array.isArray(data.grid)) {
      data.grid.forEach(p => {
        const t = Array.isArray(p) ? p[now ? 3 : 2] : null;
        if (t != null) pts.push([p[0], p[1], t]);
      });
    }
    return pts;
  }

  // Builds the image a few rows at a time so the page stays responsive.
  function buildHeatImage(points, build) {
    return new Promise((resolve) => {
      const n = points.length;
      const plat = Float64Array.from(points, p => p[0]);
      const plon = Float64Array.from(points, p => p[1]);
      const ptemp = Float64Array.from(points, p => p[2]);
      const canvas = document.createElement('canvas');
      canvas.width = HEAT_W;
      canvas.height = HEAT_H;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(HEAT_W, HEAT_H);
      const yMax = Math.log(Math.tan(Math.PI / 4 + HEAT_MAX_LAT * Math.PI / 360));
      let y = 0;
      const ROWS_PER_TICK = 15;
      (function rows() {
        if (build !== heatBuild) return resolve(null);   // superseded
        const end = Math.min(HEAT_H, y + ROWS_PER_TICK);
        for (; y < end; y++) {
          const my = yMax - (y + 0.5) / HEAT_H * 2 * yMax;
          const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;
          const cosLat = Math.cos(lat * Math.PI / 180);
          for (let x = 0; x < HEAT_W; x++) {
            const lon = -180 + (x + 0.5) / HEAT_W * 360;
            let wSum = 0;
            let tSum = 0;
            for (let i = 0; i < n; i++) {
              let dLon = Math.abs(lon - plon[i]);
              if (dLon > 180) dLon = 360 - dLon;            // across the date line
              const dx = dLon * cosLat;
              const dy = lat - plat[i];
              const d2 = dx * dx + dy * dy + 0.25;
              const w = 1 / (d2 * Math.sqrt(d2));          // weight ∝ 1/distance³
              wSum += w;
              tSum += w * ptemp[i];
            }
            const [r, g, b] = heatColor(tSum / wSum);
            const o = (y * HEAT_W + x) * 4;
            img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
          }
        }
        if (y < HEAT_H) return setTimeout(rows, 0);
        ctx.putImageData(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      })();
    });
  }

  async function renderHeatLayer(L, data) {
    if (!worldMap) return;
    if (!heatWanted()) {
      if (heatLayer) worldMap.removeLayer(heatLayer);
      return;
    }
    const stamp = data.lastUpdated + '|' + worldMode();
    if (heatLayer && heatStamp === stamp) {
      if (!worldMap.hasLayer(heatLayer)) heatLayer.addTo(worldMap);
      return;
    }
    const points = heatPoints(data);
    if (points.length < 3) return;
    const build = ++heatBuild;
    const url = await buildHeatImage(points, build);
    if (!url || build !== heatBuild) return;
    if (heatLayer) worldMap.removeLayer(heatLayer);
    // One copy per side as well, for when the map shows the world twice.
    heatLayer = L.layerGroup([-360, 0, 360].map(shift => L.imageOverlay(url,
      [[-HEAT_MAX_LAT, -180 + shift], [HEAT_MAX_LAT, 180 + shift]],
      { opacity: HEAT_OPACITY, interactive: false, className: 'wx-heat-layer' })));
    heatStamp = stamp;
    if (heatWanted()) heatLayer.addTo(worldMap);
  }

  $('wxWorldHeatToggle')?.addEventListener('click', async () => {
    try { localStorage.setItem(HEAT_KEY, heatWanted() ? 'off' : 'on'); } catch (e) { /* not saved */ }
    syncHeatButton();
    const L = await loadLeaflet();
    const data = await loadWorldWeather();   // app.js; cached
    if (data) renderHeatLayer(L, data);
  });
  syncHeatButton();

  function renderWorldLegend() {
    const el = $('wxWorldLegend');
    if (!el || el.childElementCount) return;
    const temps = [];
    for (let t = -20; t <= 110; t += 5) temps.push(t);
    const gradient = temps.map((t, i) => getTempColor(t) + ' ' + (i / (temps.length - 1) * 100).toFixed(1) + '%').join(', ');
    const labels = [-20, 0, 20, 40, 60, 80, 100].map(t =>
      '<span style="left:' + ((t + 20) / 130 * 100).toFixed(1) + '%">' + t + '&deg;</span>').join('');
    el.innerHTML = '<div class="wx-world-legend-bar" style="background:linear-gradient(to right, ' + gradient + ')"></div>' +
      '<div class="wx-world-legend-labels">' + labels + '</div>';
  }

  async function renderWorldMap() {
    const el = $('wxWorldMap');
    if (!el) return;
    let L;
    try {
      L = await loadLeaflet();
    } catch (e) {
      el.innerHTML = '<div class="loading-spinner">World map unavailable</div>';
      return;
    }
    if (!worldMap) {
      worldMap = L.map(el, { worldCopyJump: true, minZoom: 0, maxZoom: 10, zoomSnap: 0.25, zoomDelta: 0.5 }).setView([20, 10], 2);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(worldMap);
      worldMap.on('zoomend moveend', declutterWorldMarkers);
      renderNightLayer(L);   // then refreshed every few minutes
    }
    // The panel was hidden until now, so let Leaflet re-measure it.
    worldMap.invalidateSize();
    declutterWorldMarkers();
    renderWorldLegend();
    const data = await loadWorldWeather();   // app.js; cached after the first load
    // Selecting World shows this panel twice (here and via app.js), so
    // build once per data update rather than once per call.
    if (data && Array.isArray(data.regions) && data.lastUpdated !== worldMarkersStamp) buildWorldMarkers(L, data);
    if (data && Array.isArray(data.regions)) renderHeatLayer(L, data);
  }

  // ── Breaking Alert System (Locations entry below World) ───────────
  // Middle panel: every active US warning and watch, scrolling top to
  // bottom and starting over (hover, scroll or click to hold it). Main panel: the same
  // alerts on a map; picking one in the list zooms the map to it.
  // Data, colours and the map itself come from alert-map.js.
  const Alerts = window.MnvAlerts;
  const BA_SPEED_PX_PER_SEC = 30;
  const BA_HOLD_MS = 15 * 1000;   // pause after the user scrolls or clicks
  let alertsData = null;
  let alertsMap = null;
  let alertsMapStamp = null;
  let alertsMapReady = Promise.resolve();

  function alertsSelected() { return activeLocation() === 'alerts'; }
  function streaming() { return document.body.classList.contains('wx-streaming'); }

  function alertCounts(data) {
    const list = (data && data.alerts) || [];
    const warnings = list.filter(a => a.bucket === 'warning').length;
    return { total: list.length, warnings, watches: list.length - warnings };
  }
  function countsText(data) {
    const c = alertCounts(data);
    if (!c.total) return 'No active warnings or watches';
    const faa = ((data && data.alerts) || []).filter(a => a.source === 'faa').length;
    return c.warnings + ' warning' + (c.warnings === 1 ? '' : 's') + ' · ' +
      c.watches + ' watch' + (c.watches === 1 ? '' : 'es') +
      (faa ? ' (' + faa + ' FAA airport)' : '');
  }
  function updatedText(data) {
    const t = Date.parse(data && data.fetchedAt);
    if (!Number.isFinite(t)) return '';
    return 'Updated ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
      (data.stale ? ' (NWS unreachable — showing last data)' : '');
  }

  // Renders into the middle panel; app.js calls this for the alerts
  // location (renderWeatherSidebar).
  window.wxRenderAlertsSidebar = function (resetScroll) {
    const area = $('weatherScrollArea');
    if (!area) return;
    Alerts.loadCounties().catch(() => {});   // county names for the summaries
    if (!alertsData) {
      area.innerHTML = '<div class="loading-spinner">Loading alerts&hellip;</div>';
      Alerts.load().catch(() => {
        if (alertsSelected() && !alertsData) area.innerHTML = '<div class="loading-spinner">NWS alerts unavailable</div>';
      });
      return;
    }
    const sort = Alerts.getSort();
    const list = Alerts.sorted(alertsData, sort);
    const keep = (area.querySelector('.wx-ba-feed') && !resetScroll) ? area.scrollTop : 0;
    area.innerHTML =
      '<div class="wx-ba-summary"><div class="wx-ba-counts">' + Alerts.escape(countsText(alertsData)) + '</div>' +
        '<div class="wx-ba-updated">' + Alerts.escape(updatedText(alertsData)) + '</div>' +
        Alerts.sortControlHtml(sort) + '</div>' +
      (list.length
        ? '<div class="wx-ba-feed"><div class="wx-ba-run">' + Alerts.listHtml(list, sort) + '</div></div>'
        : '<div class="wx-ba-empty">All clear: no NWS warnings or watches are in effect in the US.</div>');
    area.scrollTop = keep;
    if (resetScroll) baAtEnd = false;
  };

  // Scrolling of the alert list: down to the last alert, a pause, back
  // to the top, a pause, and again. Each alert is listed once. (An
  // endless loop needs a second copy of the list after the first, which
  // reads as every alert being listed twice.)
  const BA_END_PAUSE_MS = 4000;   // at the last alert, before going back up
  const BA_TOP_PAUSE_MS = 3000;   // at the top, before scrolling again
  let baRaf = null;
  let baLast = 0;
  let baAcc = 0;
  let baHoldUntil = 0;
  let baHover = false;
  let baAtEnd = false;
  function appAutoScrollOn() {
    return typeof weatherAutoScrollRafId !== 'undefined' && !!weatherAutoScrollRafId;   // app.js
  }
  function baStep(ts) {
    baRaf = requestAnimationFrame(baStep);
    const dt = baLast ? Math.min(ts - baLast, 100) : 0;
    baLast = ts;
    const area = $('weatherScrollArea');
    if (!area || baHover || Date.now() < baHoldUntil) return;
    if (!area.querySelector('.wx-ba-feed, .wx-ba-empty')) return;   // still loading
    if (baAtEnd) {
      // The pause at the end is over. With app.js auto-scroll on, move to
      // the next location as the forecasts do; otherwise start over.
      baAtEnd = false;
      baAcc = 0;
      if (appAutoScrollOn()) { cycleWeatherPanel(); return; }
      area.scrollTo({ top: 0, behavior: 'smooth' });
      baHoldUntil = Date.now() + BA_TOP_PAUSE_MS;
      return;
    }
    const max = area.scrollHeight - area.clientHeight;
    if (max <= 0) {
      // Everything fits: nothing to scroll, but auto-scroll still moves on.
      if (appAutoScrollOn()) { baAtEnd = true; baHoldUntil = Date.now() + BA_END_PAUSE_MS; }
      return;
    }
    baAcc += BA_SPEED_PX_PER_SEC * dt / 1000;
    if (baAcc < 1) return;
    const px = Math.floor(baAcc);
    baAcc -= px;
    area.scrollTop = Math.min(area.scrollTop + px, max);
    if (area.scrollTop >= max - 1) {
      baAtEnd = true;
      baHoldUntil = Date.now() + BA_END_PAUSE_MS;
    }
  }
  function setAlertScroll(on) {
    // app.js auto-scroll leaves the list to this scroller while it's shown.
    window.mnvSidebarScrollOwner = on ? 'alerts' : null;
    baAtEnd = false;
    if (on && !baRaf) { baLast = 0; baAcc = 0; baRaf = requestAnimationFrame(baStep); }
    if (!on && baRaf) { cancelAnimationFrame(baRaf); baRaf = null; }
  }

  const scrollAreaEl = $('weatherScrollArea');
  if (scrollAreaEl) {
    // The user scrolling or clicking holds the list where they put it.
    const hold = () => {
      if (!alertsSelected()) return;
      baHoldUntil = Date.now() + BA_HOLD_MS;
      baAtEnd = false;
    };
    scrollAreaEl.addEventListener('mouseenter', () => { baHover = true; });
    scrollAreaEl.addEventListener('mouseleave', () => { baHover = false; });
    ['wheel', 'touchstart', 'keydown'].forEach(ev => scrollAreaEl.addEventListener(ev, hold, { passive: true }));
    scrollAreaEl.addEventListener('click', (e) => {
      const sortBtn = e.target.closest('[data-alert-sort]');
      if (sortBtn) {
        Alerts.setSort(sortBtn.dataset.alertSort);
        hold();
        window.wxRenderAlertsSidebar(true);   // back to the top of the new order
        return;
      }
      const item = e.target.closest('.wx-ba-item');
      if (!item) return;
      hold();
      showAlertOnMap(item.dataset.alertId);
    });
    scrollAreaEl.addEventListener('keydown', (e) => {
      const item = e.target.closest('.wx-ba-item');
      if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showAlertOnMap(item.dataset.alertId); }
    });
  }

  function renderAlertsMap() {
    const el = $('wxAlertsMap');
    if (!el) return Promise.resolve();
    if (!alertsMap) alertsMap = Alerts.createMap(el);
    alertsMap.invalidate();   // the panel was hidden until now
    const meta = $('wxAlertsMeta');
    if (meta) meta.textContent = alertsData ? countsText(alertsData) + ' · ' + updatedText(alertsData) : 'Loading…';
    if (!alertsData) {
      Alerts.load().catch(() => { if (meta) meta.textContent = 'NWS alerts unavailable'; });
    } else if (alertsData.fetchedAt !== alertsMapStamp) {
      alertsMapStamp = alertsData.fetchedAt;
      alertsMapReady = alertsMap.update(alertsData).catch(e => {
        console.warn('[Alerts] map unavailable:', e.message);
        alertsMapStamp = null;
        if (meta) meta.textContent = 'Alert map unavailable';
      });
    }
    return alertsMapReady;
  }

  // While a live feed plays the main panel stays on it, so the alert
  // opens in the details popup instead.
  function showAlertOnMap(id) {
    const alert = alertsData && alertsData.alerts.find(a => a.id === id);
    if (!alert) return;
    if (streaming()) {
      _wxAlertCache.set(id, { ...alert, areaDesc: Alerts.areaSummary(alert) });
      showWeatherAlertPopup(id);   // app.js
      return;
    }
    if (!$(ALERTS_PANEL)?.classList.contains('active')) window.showPanel(ALERTS_PANEL);
    renderAlertsMap().then(() => alertsMap.select(id));
  }

  $('wxAlertsReset')?.addEventListener('click', () => { if (alertsMap) alertsMap.resetView(); });
  $('wxAlertsPopout')?.addEventListener('click', () => {
    const w = Math.min(1400, screen.availWidth - 80);
    const h = Math.min(900, screen.availHeight - 80);
    const win = window.open('/wx/alerts', 'mnvBreakingAlerts',
      'width=' + w + ',height=' + h + ',left=40,top=40,resizable=yes,scrollbars=no');
    if (win) win.focus();
  });

  Alerts.onUpdate((data) => {
    alertsData = data;
    renderLocations();
    if (alertsSelected()) window.wxRenderAlertsSidebar();
    if ($(ALERTS_PANEL)?.classList.contains('active')) renderAlertsMap();
  });
  Alerts.load().catch(e => console.warn('[Alerts]', e.message));   // for the Locations card

  // ── Locations list (left column) ──────────────────────────────────
  // One card per location tab (configured locations from
  // config/locations.json, then Browser Location and World). The tabs are hidden; a card
  // click clicks its tab so app.js does the selection work.
  const CONDITIONS_TTL_MS = 10 * 60 * 1000;
  const conditions = {};   // "lat,lon" → { at, data } (data null on failure)

  function locationTabs() {
    return Array.from(document.querySelectorAll('#weatherLocationTabs .tab-btn'));
  }

  function coordsFor(loc) {
    if (LOCATION_COORDS[loc]) return LOCATION_COORDS[loc];
    if (loc === 'browserLocation' && currentLocation && currentLocation.lat != null) {
      return { lat: currentLocation.lat, lon: currentLocation.lon };
    }
    return null;
  }

  function forecastFor(loc) {
    if (loc === 'browserLocation') return browserLocationWeather;
    return weatherData ? weatherData[loc] : null;
  }

  async function loadConditions(c) {
    const key = c.lat + ',' + c.lon;
    const hit = conditions[key];
    if (hit && Date.now() - hit.at < CONDITIONS_TTL_MS) return;
    conditions[key] = { at: Date.now(), data: hit ? hit.data : null };
    try {
      const res = await fetch('/api/current-weather?lat=' + encodeURIComponent(c.lat) + '&lon=' + encodeURIComponent(c.lon));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      conditions[key] = { at: Date.now(), data: await res.json() };
    } catch (e) {
      console.warn('[WX] current conditions unavailable:', e.message);
    }
  }

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function formatWind(speed, deg) {
    if (speed == null) return '--';
    if (speed === 0) return 'Calm';
    const dir = deg != null ? ' ' + COMPASS[Math.round(deg / 22.5) % 16] : '';
    return speed + ' mph' + dir;
  }

  function alertHtml(loc, alerts) {
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return '<div class="wx-loc-alert wx-loc-alert--none">No active alerts</div>';
    }
    const SEV = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    const ranked = alerts.map((a, i) => ({ a, id: a.id || loc + '|' + i }))
      .sort((x, y) => (SEV[x.a.severity] ?? 9) - (SEV[y.a.severity] ?? 9));
    ranked.forEach(({ a, id }) => _wxAlertCache.set(id, a));
    const top = ranked[0];
    const more = ranked.length > 1 ? '<span class="wx-loc-alert-more">+' + (ranked.length - 1) + '</span>' : '';
    const safeId = escapeHtml(top.id.replace(/'/g, "\\'"));
    return '<div class="wx-loc-alert ' + alertCssClass(top.a) + '" title="Click for details"' +
      ' onclick="event.stopPropagation(); showWeatherAlertPopup(\'' + safeId + '\')">' +
      '<span aria-hidden="true">&#9888;</span><span class="wx-loc-alert-event">' + escapeHtml(top.a.event) + '</span>' + more +
      '</div>';
  }

  const GLOBE_ICON = '<svg class="globe-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/>' +
    '<ellipse cx="10" cy="10" rx="3.5" ry="8"/><path d="M2 10h16M3.3 5.5h13.4M3.3 14.5h13.4"/></svg>';

  const ALERT_ICON = '<svg class="globe-icon wx-ba-icon" viewBox="0 0 20 20" aria-hidden="true">' +
    '<path d="M10 2.5 18.5 17h-17z"/><path d="M10 8v4.5M10 14.6v.4"/></svg>';

  function alertsCardHtml(label, active) {
    const top = alertsData ? Alerts.sorted(alertsData)[0] : null;
    const total = alertsData ? alertsData.alerts.length : 0;
    let status;
    if (!alertsData) status = '<div class="wx-loc-alert wx-loc-alert--none">Loading US alerts&hellip;</div>';
    else if (!top) status = '<div class="wx-loc-alert wx-loc-alert--none">No active warnings or watches</div>';
    else {
      status = '<div class="wx-loc-alert ' + (top.bucket === 'warning' ? 'wx-alert--warning' : 'wx-alert--watch') + '">' +
        '<span aria-hidden="true">&#9888;</span><span class="wx-loc-alert-event">' + escapeHtml(top.event) + '</span>' +
        (total > 1 ? '<span class="wx-loc-alert-more">+' + (total - 1) + '</span>' : '') + '</div>';
    }
    return '<div class="wx-loc-card' + active + '" data-location="alerts">' +
      '<div class="wx-loc-name wx-loc-name--icon">' + ALERT_ICON + label + '</div>' +
      '<div class="wx-loc-sub">' + (alertsData ? escapeHtml(countsText(alertsData)) : 'US warnings &amp; watches by county') + '</div>' +
      status + '</div>';
  }

  function cardHtml(tab) {
    const loc = tab.dataset.location;
    const label = escapeHtml(tab.textContent.trim());
    const active = tab.classList.contains('active') ? ' active' : '';
    if (loc === 'alerts') return alertsCardHtml(label, active);
    if (loc === 'world') {
      return '<div class="wx-loc-card' + active + '" data-location="world">' +
        '<div class="wx-loc-name wx-loc-name--icon">' + GLOBE_ICON + label + '</div>' +
        '<div class="wx-loc-sub">Today\'s forecast for major cities</div></div>';
    }
    const c = coordsFor(loc);
    if (!c) {
      return '<div class="wx-loc-card' + active + '" data-location="' + loc + '">' +
        '<div class="wx-loc-name">' + label + '</div>' +
        '<div class="wx-loc-sub">Allow location access, or pick a city from the location menu.</div></div>';
    }
    const cur = (conditions[c.lat + ',' + c.lon] || {}).data;
    const fc = forecastFor(loc);
    const today = fc && Array.isArray(fc.daily) ? fc.daily[0] : null;
    const precip = today && today.precipChance != null ? today.precipChance + '%' : '--';
    const icon = cur && cur.description ? getWxIcon(cur.description, 'auto') : '';
    const temp = cur && cur.temperature != null ? cur.temperature + '&deg;' : '--';
    const dew = cur && cur.dewPoint != null ? cur.dewPoint + '&deg;' : '--';
    return '<div class="wx-loc-card' + active + '" data-location="' + loc + '">' +
      '<div class="wx-loc-name">' + label + '</div>' +
      '<div class="wx-loc-now">' +
        '<span class="wx-loc-icon">' + icon + '</span>' +
        '<span class="wx-loc-temp">' + temp + '</span>' +
        '<span class="wx-loc-cond">' + escapeHtml(cur ? cur.description : 'Loading…') + '</span>' +
      '</div>' +
      '<div class="wx-loc-stats">' +
        '<span title="Wind">&#127788; ' + formatWind(cur && cur.windSpeed, cur && cur.windDirection) + '</span>' +
        '<span title="Dew point">Dew pt ' + dew + '</span>' +
        '<span title="Chance of precipitation today">&#128167; ' + precip + '</span>' +
      '</div>' +
      alertHtml(loc, fc && fc.alerts) +
      '</div>';
  }

  function renderLocations() {
    const list = $('wxLocationList');
    if (!list) return;
    list.innerHTML = locationTabs().map(cardHtml).join('');
  }

  async function refreshLocations() {
    renderLocations();
    const coords = locationTabs().map(t => coordsFor(t.dataset.location)).filter(Boolean);
    await Promise.all(coords.map(loadConditions));
    renderLocations();
  }

  $('wxLocationList')?.addEventListener('click', (e) => {
    const card = e.target.closest('.wx-loc-card');
    if (!card) return;
    const tab = document.querySelector('#weatherLocationTabs .tab-btn[data-location="' + card.dataset.location + '"]');
    if (tab) tab.click();
  });

  // Follow the selected tab — whether set by a card, auto-scroll's
  // location cycling, or app.js relabelling the browser-location tab.
  let selectedLoc = null;
  function onSelectionChange() {
    const tab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    const label = $('wxForecastLocation');
    if (label && tab) label.textContent = tab.textContent.trim();
    renderLocations();
    const loc = tab ? tab.dataset.location : null;
    if (loc === selectedLoc) return;
    selectedLoc = loc;
    setAlertScroll(loc === 'alerts');
    const title = $('wxMiddleTitle');
    if (title) title.textContent = loc === 'alerts' ? 'ACTIVE ALERTS' : '7-DAY FORECAST';
    // Show the view for the new location, unless a feed is playing or the
    // full-panel radar is open (app.js re-centres that itself).
    if (document.body.classList.contains('wx-streaming')) return;
    if ($('weatherscanPanel')?.classList.contains('active')) return;
    const target = selectionPanel();
    if (target === MAPS_PANEL && $(MAPS_PANEL)?.classList.contains('active')) refreshMaps();
    else window.showPanel(target);
  }

  const tabsEl = $('weatherLocationTabs');
  if (tabsEl) {
    new MutationObserver((mutations) => {
      onSelectionChange();
      // app.js adds the configured locations' tabs after load; fetch their
      // current conditions right away rather than at the next refresh.
      if (mutations.some(m => m.type === 'childList' && m.target === tabsEl)) refreshLocations();
    }).observe(tabsEl, {
      subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true,
    });
  }

  onSelectionChange();
  refreshLocations();
  // Forecast and alert data arrive shortly after load; conditions refresh
  // every 10 minutes (the cache TTL), cards re-render every minute.
  setTimeout(refreshLocations, 3000);
  setInterval(refreshLocations, 60 * 1000);

})();
